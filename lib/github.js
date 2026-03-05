// lib/github.js

// 内存缓存令牌列表和索引（每个 isolate 独立）
let cachedTokens = null;
let cacheTime = 0;
let lastTokenIndex = -1;
const CACHE_TTL = 60000; // 1 分钟

// 从 D1 获取所有 GitHub 令牌（包含 id 和 token）
async function getAllTokens(env) {
    if (cachedTokens && Date.now() - cacheTime < CACHE_TTL) {
        return cachedTokens;
    }
    const { results } = await env.DB.prepare(
        "SELECT id, token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    cachedTokens = results.map(r => ({ id: r.id, token: r.token }));
    cacheTime = Date.now();
    return cachedTokens;
}

// 获取下一个令牌（内存轮询）
function getNextToken(tokens) {
    if (tokens.length === 0) return { token: null, tokenId: null };
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    const tokenObj = tokens[lastTokenIndex];
    return { token: tokenObj.token, tokenId: tokenObj.id };
}

// 根据 id 更新令牌使用次数
async function incrementTokenUsage(env, tokenId) {
    await env.DB.prepare(
        "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
    ).bind(tokenId).run();
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
            let usedTokenId = null;

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                const next = getNextToken(tokens);
                usedToken = next.token;
                usedTokenId = next.tokenId;
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

            // 请求成功，更新使用计数
            if (usedTokenId !== null) {
                await incrementTokenUsage(env, usedTokenId);
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
