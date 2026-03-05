// lib/github.js

// 更新令牌使用次数
async function incrementTokenUsage(env, tokenValue) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    const tokenObj = tokens.find(t => t.token === tokenValue);
    if (tokenObj) {
        tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
        await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    }
}

// 获取所有令牌
async function getAllTokens(env) {
    return await env.B2_KV.get('github_tokens', 'json') || [];
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    let tokenIndex = -1; // -1 表示公共 API

    for (let attempt = 0; attempt <= retries + tokens.length; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let currentToken = null;
            if (attempt === 0) {
                // 公共 API，无 token
            } else {
                if (tokens.length > 0) {
                    // 切换到下一个令牌
                    tokenIndex = (tokenIndex + 1) % tokens.length;
                    currentToken = tokens[tokenIndex].token;
                    headers['Authorization'] = `token ${currentToken}`;
                }
                // 如果没有令牌，后续尝试依然无 token
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    // 判断是否还有未尝试的凭证
                    const hasMoreTokens = tokens.length > 0 && (tokenIndex < tokens.length - 1 || attempt < tokens.length);
                    if (attempt === 0 && tokens.length > 0) {
                        // 公共 API 限流，且有令牌，立即重试（不等待）
                        continue;
                    } else if (hasMoreTokens) {
                        // 还有令牌未尝试，立即重试
                        continue;
                    } else {
                        // 所有凭证都已耗尽，只能等待
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        // 等待后继续下一次尝试
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，更新使用计数
            if (currentToken) {
                await incrementTokenUsage(env, currentToken);
            }
            return res;
        } catch (e) {
            // 非限流错误，如果还有尝试次数则等待后重试
            if (attempt === retries + tokens.length) throw e;
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
