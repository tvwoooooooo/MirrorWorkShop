// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 3;

// 内存中记录上次使用的令牌索引（每个 isolate 独立）
let lastTokenIndex = -1;

/**
 * 从 D1 获取所有 Docker 令牌
 */
async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results.map(r => r.token);
}

/**
 * 获取下一个令牌（内存轮询）
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
 * 带令牌轮询的 fetch（先公共 API，如果返回空结果或限流则尝试令牌）
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    // 尝试顺序：公共 API -> 令牌1 -> 令牌2 ...
    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        let currentToken = null;
        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'B2-Mirror-Worker'
            };

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                currentToken = getNextToken(tokens);
                if (currentToken) {
                    headers['Authorization'] = `Bearer ${currentToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 429) {
                if (attempt === 0 && hasTokens) {
                    // 公共 API 限流，立即切换到令牌
                    continue;
                } else if (hasTokens && attempt <= tokens.length) {
                    // 还有令牌可用，立即尝试下一个
                    continue;
                } else {
                    // 所有令牌用完，等待后重试
                    const retryAfter = res.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                    console.warn(`Docker API 429, waiting ${waitTime}ms`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Docker API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 尝试解析 JSON，如果失败则抛出
            const data = await res.json();

            // 检查是否返回了错误（Docker Hub 有时会返回 200 但包含错误信息）
            if (data.error || data.message) {
                throw new Error(data.error || data.message);
            }

            // 请求成功，更新使用计数
            if (currentToken) {
                await incrementTokenUsage(env, currentToken);
            }
            return { response: res, data };
        } catch (err) {
            console.error(`Attempt ${attempt + 1} failed:`, err.message);
            // 如果是公共 API 失败且有令牌，则继续尝试令牌
            if (attempt === 0 && hasTokens) {
                continue;
            }
            // 如果是最后一次尝试，则抛出
            if (attempt === retries + tokens.length) {
                throw err;
            }
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

/**
 * 检查镜像是否有 tags
 */
export async function checkDockerHasTags(repo, env) {
    const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const { data } = await fetchWithRetry(url, {}, MAX_RETRIES, env);
        return data.results && data.results.length > 0;
    } catch {
        return false;
    }
}

/**
 * 搜索 Docker Hub 镜像
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const { data } = await fetchWithRetry(url, {}, MAX_RETRIES, env);

        if (!data.results) {
            console.warn('Docker API response missing results:', data);
            return { items: [], total: 0 };
        }

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

        // 批次检查 tags
        const hasReleasesArray = [];
        for (let i = 0; i < items.length; i += 5) {
            const batch = items.slice(i, i + 5);
            const batchResults = await Promise.all(
                batch.map(item => checkDockerHasTags(item.name, env))
            );
            hasReleasesArray.push(...batchResults);
        }

        const itemsWithReleases = items.map((item, idx) => ({
            ...item,
            has_releases: hasReleasesArray[idx] || false
        }));

        return { items: itemsWithReleases, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
