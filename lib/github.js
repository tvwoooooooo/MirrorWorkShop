// lib/github.js

// 内存中记录上次使用的令牌索引（每个 isolate 独立）
let lastTokenIndex = -1;

// 获取所有令牌
async function getAllTokens(env) {
    return await env.B2_KV.get('github_tokens', 'json') || [];
}

// 获取下一个令牌（内存轮询），返回 token 和 index
function getNextToken(tokens) {
    if (tokens.length === 0) return { token: null, index: -1 };
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return { token: tokens[lastTokenIndex].token, index: lastTokenIndex };
}

// 根据索引更新令牌使用次数
async function incrementTokenUsage(env, index) {
    if (index < 0) return;
    const tokens = await getAllTokens(env);
    if (index < tokens.length) {
        tokens[index].usageCount = (tokens[index].usageCount || 0) + 1;
        await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    }
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;
            let usedIndex = -1;

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                const { token, index } = getNextToken(tokens);
                usedToken = token;
                usedIndex = index;
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
                        // 公共 API 限流，立即切换到令牌
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 还有令牌未用，立即尝试下一个令牌
                        continue;
                    } else {
                        // 所有令牌都用过，等待
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，更新使用计数（使用索引）
            if (usedIndex !== -1) {
                await incrementTokenUsage(env, usedIndex);
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
