// lib/github.js

// 内存中记录上次使用的令牌索引（每个 isolate 独立）
let lastTokenIndex = -1;

// 从 D1 获取所有 GitHub 令牌（只返回 token 列表）
async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    return results.map(r => r.token);
}

// 获取下一个令牌（内存轮询）
function getNextToken(tokens) {
    if (tokens.length === 0) return null;
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return tokens[lastTokenIndex];
}

// 根据 token 值更新使用次数（需要从 D1 找到对应行）
async function incrementTokenUsage(env, tokenValue) {
    const { results } = await env.DB.prepare(
        "SELECT id FROM tokens WHERE type = ? AND token = ? ORDER BY id"
    ).bind('github', tokenValue).all();
    if (results.length > 0) {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(results[0].id).run();
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

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                usedToken = getNextToken(tokens);
                if (usedToken) {
                    headers['Authorization'] = `token ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    if (attempt === 0 && hasTokens) {
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        continue;
                    } else {
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

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

/**
 * 获取仓库完整文件树（递归）
 */
export async function getRepoFileTree(owner, repo, env, branch = 'HEAD') {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
    const data = await res.json();
    if (!data.tree) {
        throw new Error('GitHub API returned no tree data');
    }
    return data.tree.filter(item => item.type === 'blob').map(item => item.path);
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