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
 * 带令牌的 fetch 重试
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
                // 公共 API
            } else if (hasTokens) {
                usedToken = getNextToken(tokens);
                if (usedToken) {
                    headers['Authorization'] = `Bearer ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 429) {
                const remaining = res.headers.get('x-ratelimit-remaining');
                if (remaining === '0' || res.status === 429) {
                    const reset = res.headers.get('x-ratelimit-reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    if (attempt === 0 && hasTokens) {
                        // 公共 API 限流，立即切换到令牌
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 还有令牌未用，立即尝试下一个
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
