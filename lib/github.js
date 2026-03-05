// lib/github.js

// 获取下一个令牌并更新全局索引
async function getNextGithubToken(env) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;

    // 读取当前索引，默认为 -1
    let index = await env.B2_KV.get('github_token_last_index', 'json') || -1;
    index = (index + 1) % tokens.length;
    // 保存新索引
    await env.B2_KV.put('github_token_last_index', JSON.stringify(index));

    const tokenObj = tokens[index];
    // 增加使用计数
    tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));

    return tokenObj.token;
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    // 总尝试次数 = 公共 API 1次 + 令牌轮询（最多令牌数） + 重试预留
    const maxAttempts = 1 + (await env.B2_KV.get('github_tokens', 'json') || []).length + retries;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };

            let usingToken = false;
            if (attempt > 0) { // 第一次尝试用公共 API，之后用令牌
                const token = await getNextGithubToken(env);
                if (token) {
                    headers['Authorization'] = `token ${token}`;
                    usingToken = true;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流 403
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    // 如果还有令牌未尝试，立即重试（不等待）
                    if (usingToken && attempt < maxAttempts - 1) {
                        continue;
                    } else if (!usingToken && attempt < maxAttempts - 1) {
                        // 公共 API 限流，且还有令牌，立即重试
                        continue;
                    } else {
                        // 所有凭证耗尽，必须等待
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            return res; // 成功返回
        } catch (e) {
            if (attempt === maxAttempts - 1) throw e; // 最后一次失败则抛出
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

export async function searchGitHub(query, page = 1, perPage = 10, env) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
    try {
        const response = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        const data = await response.json();
        const baseItems = data.items.map(item => ({
            name: item.full_name,
            description: item.description || '暂无描述',
            stars: item.stargazers_count,
            forks: item.forks_count,
            lastUpdate: item.pushed_at ? item.pushed_at.split('T')[0] : (item.updated_at ? item.updated_at.split('T')[0] : '未知'),
            homepage: item.html_url,
            type: 'github',
            owner: item.owner.login,
            repo: item.name
        }));

        const hasReleasesArray = await Promise.all(
            baseItems.map(item => checkGitHubHasReleases(item.owner, item.repo, env))
        );
        const items = baseItems.map((item, idx) => ({
            ...item,
            has_releases: hasReleasesArray[idx]
        }));

        return { items, total: data.total_count };
    } catch (error) {
        console.error('GitHub search error:', error);
        return { items: [], total: 0 };
    }
}

export async function checkGitHubHasReleases(owner, repo, env) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
    } catch {
        return false;
    }
}
