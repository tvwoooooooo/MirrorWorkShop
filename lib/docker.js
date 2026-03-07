// lib/docker.js

// 内存中记录上次使用的令牌索引（每个 isolate 独立）
let lastTokenIndex = -1;

/**
 * 从 D1 获取所有 Docker 令牌（只返回 token 列表）
 */
async function getAllTokens(env) {
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
 * 带令牌轮询和重试的 fetch 函数（专用于 Docker Hub API）
 * @param {string} url 请求 URL
 * @param {object} options fetch 选项
 * @param {number} retries 重试次数
 * @param {object} env Worker 环境变量
 */
async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;

            if (attempt === 0) {
                // 第一次尝试：公共 API（无令牌）
            } else if (hasTokens) {
                usedToken = getNextToken(tokens);
                if (usedToken) {
                    headers['Authorization'] = `Bearer ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 429 || res.status === 403) {
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

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Docker API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，更新使用计数
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
 * Docker Hub 搜索（使用官方搜索 API）
 * @param {string} query 搜索关键词
 * @param {number} page 页码
 * @param {number} perPage 每页数量
 * @param {object} env Worker 环境变量
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function searchDockerHub(query, page = 1, perPage = 10, env) {
    // 使用较新的搜索端点，支持官方和社区镜像
    const url = `https://hub.docker.com/v2/repositories?page=${page}&page_size=${perPage}&query=${encodeURIComponent(query)}`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        const data = await res.json();
        const results = data.results || [];
        const items = results.map(item => {
            const namespace = item.namespace; // 可能为 'library' 或其他用户名
            const name = item.name;
            const fullName = namespace === 'library' ? name : `${namespace}/${name}`;
            return {
                name: fullName,
                description: item.description || '暂无描述',
                stars: item.star_count || 0,
                pulls: item.pull_count || 0,
                lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
                homepage: `https://hub.docker.com/r/${namespace}/${name}`,
                type: 'docker',
                namespace,
                repo: name,
                has_tags: true
            };
        });
        return { items, total: data.count || items.length };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}

/**
 * 获取镜像的标签列表
 * @param {string} namespace
 * @param {string} repo
 * @param {object} env Worker 环境变量
 * @returns {Promise<Array>}
 */
export async function getImageTags(namespace, repo, env) {
    const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags?page_size=100`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        if (!res.ok) throw new Error('Failed to fetch tags');
        const data = await res.json();
        return data.results.map(tag => ({
            name: tag.name,
            digest: tag.digest,
            lastUpdate: tag.last_updated,
            size: tag.full_size
        }));
    } catch (error) {
        console.error('Get image tags error:', error);
        return [];
    }
}
