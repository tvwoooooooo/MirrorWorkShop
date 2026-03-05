// lib/github.js

// 获取所有令牌（从 KV）
async function getAllTokens(env) {
    return await env.B2_KV.get('github_tokens', 'json') || [];
}

// 更新指定令牌的使用次数
async function incrementTokenUsage(env, tokenValue) {
    const tokens = await getAllTokens(env);
    const tokenObj = tokens.find(t => t.token === tokenValue);
    if (tokenObj) {
        tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
        await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    }
}

// 获取下一个令牌（轮询），使用 KV 存储全局索引
async function getNextToken(env) {
    const tokens = await getAllTokens(env);
    if (tokens.length === 0) return null;

    // 读取当前索引，默认为 -1
    let currentIndex = await env.B2_KV.get('github_token_index', 'json');
    if (currentIndex === null) {
        currentIndex = -1;
    }
    // 计算下一个索引
    const nextIndex = (currentIndex + 1) % tokens.length;
    // 写回 KV
    await env.B2_KV.put('github_token_index', JSON.stringify(nextIndex));
    return tokens[nextIndex].token;
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    // 总尝试次数 = 重试次数 + 令牌数量（允许公共 API + 每个令牌一次）
    for (let attempt = 0; attempt <= retries + tokens.length; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;
            if (attempt === 0) {
                // 第一次尝试：公共 API（无 token）
            } else if (hasTokens) {
                // 后续尝试：使用令牌（轮询）
                usedToken = await getNextToken(env);
                if (usedToken) {
                    headers['Authorization'] = `token ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    if (attempt === 0 && hasTokens) {
                        // 公共 API 限流且有令牌，立即切换到令牌（不等待）
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 还有令牌可用，立即尝试下一个令牌
                        continue;
                    } else {
                        // 所有令牌都用过了，或者没有令牌，只能等待
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，如果有使用令牌，则增加使用计数
            if (usedToken) {
                await incrementTokenUsage(env, usedToken);
            }
            return res;
        } catch (e) {
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
