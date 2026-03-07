// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

// 内存中记录上次使用的 Docker 令牌索引（每个 isolate 独立）
let lastTokenIndex = -1;

/**
 * 从 D1 获取所有 Docker 令牌
 */
async function getAllDockerTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results.map(r => r.token);
}

/**
 * 获取下一个 Docker 令牌（轮询）
 */
function getNextToken(tokens) {
    if (tokens.length === 0) return null;
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return tokens[lastTokenIndex];
}

/**
 * 更新令牌使用次数
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
 * 带令牌的简单请求（最多尝试所有令牌一次，不再无限循环）
 */
async function fetchWithToken(url, options, env) {
    const tokens = await getAllDockerTokens(env);
    const hasTokens = tokens.length > 0;

    // 先尝试公共 API
    try {
        const publicRes = await fetch(url, {
            ...options,
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });
        if (publicRes.ok) {
            return publicRes;
        }
        // 如果公共 API 返回 429，尝试令牌
        if (publicRes.status === 429 && hasTokens) {
            // 继续尝试令牌
        } else {
            // 其他错误直接返回
            return publicRes;
        }
    } catch (e) {
        // 公共 API 网络错误，如果无令牌则抛出
        if (!hasTokens) throw e;
        // 否则尝试令牌
    }

    // 尝试所有令牌
    for (let i = 0; i < tokens.length; i++) {
        const token = getNextToken(tokens);
        if (!token) continue;
        try {
            const tokenRes = await fetch(url, {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'B2-Mirror-Worker',
                    'Authorization': `Bearer ${token}`
                }
            });
            if (tokenRes.ok) {
                await incrementTokenUsage(env, token);
                return tokenRes;
            }
            // 如果令牌也返回 429，继续尝试下一个令牌
            if (tokenRes.status !== 429) {
                // 非限流错误，返回此响应（可能失败）
                return tokenRes;
            }
        } catch (e) {
            // 单个令牌网络错误，继续尝试下一个
            console.error(`Token ${i} fetch error:`, e.message);
        }
    }

    // 所有令牌尝试完毕，仍然限流或无有效响应，抛出最后捕获的错误或构造一个错误
    throw new Error('All Docker tokens exhausted or rate limited');
}

/**
 * 搜索 Docker Hub 镜像（使用令牌）
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    
    try {
        const response = await fetchWithToken(url, { method: 'GET' }, env);

        if (!response.ok) {
            console.error(`Docker Hub API error ${response.status}: ${await response.text()}`);
            return { items: [], total: 0 };
        }

        const data = await response.json();

        if (!data.results || !Array.isArray(data.results)) {
            console.warn('Docker API response missing results array:', data);
            return { items: [], total: 0 };
        }

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
            has_releases: false
        }));

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
