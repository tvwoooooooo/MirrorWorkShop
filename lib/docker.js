// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

// 内存中记录上次使用的令牌索引
let lastTokenIndex = -1;

/**
 * 从 D1 获取所有 Docker 令牌（返回 token 值列表）
 */
async function getAllDockerTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results.map(r => r.token);
}

/**
 * 获取下一个 Docker 令牌（内存轮询）
 */
function getNextToken(tokens) {
    if (tokens.length === 0) return null;
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return tokens[lastTokenIndex];
}

/**
 * 根据 token 值更新使用次数
 */
async function incrementTokenUsage(env, tokenValue) {
    const { results } = await env.DB.prepare(
        "SELECT id FROM tokens WHERE type = ? AND token = ? ORDER BY id"
    ).bind('docker', tokenValue).all();
    if (results.length > 0) {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(results[0].id).run();
    }
}

/**
 * 带令牌轮询的 fetch 函数（用于 Docker Hub API）
 */
async function fetchWithToken(url, options, env, retries = 3) {
    const tokens = await getAllDockerTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;

            if (attempt === 0) {
                // 公共 API（无认证）
            } else if (hasTokens) {
                usedToken = getNextToken(tokens);
                if (usedToken) {
                    // Docker Hub 个人访问令牌通常作为 Bearer Token 使用
                    headers['Authorization'] = `Bearer ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流或认证错误
            if (res.status === 429 || res.status === 401 || res.status === 403) {
                const waitTime = res.status === 429 ? 2000 * (attempt + 1) : 1000;
                if (attempt === 0 && hasTokens) {
                    // 公共 API 限流，立即切换到令牌
                    continue;
                } else if (hasTokens && attempt <= tokens.length) {
                    // 还有令牌未用，尝试下一个
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                } else {
                    // 所有令牌都用过，等待后重试
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Docker API error (${res.status}): ${errorText.substring(0, 200)}`);
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
 * 检查镜像是否有 tags，使用令牌轮询
 */
async function checkDockerHasTags(repo, env) {
    const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const res = await fetchWithToken(url, { method: 'GET' }, env, 2);
        const data = await res.json();
        return data.results && data.results.length > 0;
    } catch {
        return false;
    }
}

/**
 * 搜索 Docker Hub 镜像（全局搜索，使用令牌轮询）
 */
export async function searchDockerHub(query, page = 1, perPage = 10, env) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const response = await fetchWithToken(url, { method: 'GET' }, env, 3);
        const data = await response.json();

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
        }));

        // 串行检查 tags，避免并发
        const itemsWithReleases = [];
        for (const item of items) {
            const has = await checkDockerHasTags(item.name, env);
            itemsWithReleases.push({ ...item, has_releases: has });
        }

        return { items: itemsWithReleases, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
