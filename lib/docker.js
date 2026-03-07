// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 3;
const FETCH_TIMEOUT = 20000; // 20秒超时

// 内存中记录上次使用的令牌索引
let lastTokenIndex = -1;

async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results.map(r => r.token);
}

function getNextToken(tokens) {
    if (tokens.length === 0) return null;
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return tokens[lastTokenIndex];
}

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

async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

/**
 * 搜索 Docker Hub 镜像
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    // 尝试顺序：公共 API -> 令牌1 -> 令牌2 ...
    for (let attempt = 0; attempt <= (hasTokens ? tokens.length : 0); attempt++) {
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'B2-Mirror-Worker'
        };
        let currentToken = null;
        if (attempt === 0) {
            // 公共 API
        } else if (hasTokens) {
            currentToken = getNextToken(tokens);
            headers['Authorization'] = `Bearer ${currentToken}`;
        }

        const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;

        try {
            const response = await fetchWithTimeout(url, { headers });

            if (response.status === 429) {
                if (attempt < (hasTokens ? tokens.length : 0)) {
                    // 还有令牌，继续下一个
                    continue;
                } else {
                    // 没有令牌了，等待后重试
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                    console.warn(`Docker API 429, waiting ${waitTime}ms`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    // 重新尝试同一个 attempt
                    attempt--;
                    continue;
                }
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.error || data.message) {
                throw new Error(data.error || data.message);
            }

            // 请求成功，更新使用计数
            if (currentToken) {
                await incrementTokenUsage(env, currentToken);
            }

            if (!data.results) {
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
            console.error(`Attempt ${attempt} failed:`, error.message);
            if (attempt === 0 && hasTokens) {
                // 公共 API 失败，尝试下一个令牌
                continue;
            }
            if (attempt < (hasTokens ? tokens.length : 0)) {
                // 还有令牌未尝试
                continue;
            }
            // 所有尝试都失败，返回空结果
            return { items: [], total: 0 };
        }
    }
    return { items: [], total: 0 };
}

/**
 * 检查镜像是否有 tags
 */
export async function checkDockerHasTags(repo, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= (hasTokens ? tokens.length : 0); attempt++) {
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'B2-Mirror-Worker'
        };
        let currentToken = null;
        if (attempt === 0) {
            // 公共 API
        } else if (hasTokens) {
            currentToken = getNextToken(tokens);
            headers['Authorization'] = `Bearer ${currentToken}`;
        }

        const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;

        try {
            const response = await fetchWithTimeout(url, { headers });

            if (response.status === 429) {
                if (attempt < (hasTokens ? tokens.length : 0)) {
                    continue;
                } else {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    attempt--;
                    continue;
                }
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (currentToken) {
                await incrementTokenUsage(env, currentToken);
            }
            return data.results && data.results.length > 0;
        } catch (error) {
            if (attempt === 0 && hasTokens) continue;
            if (attempt < (hasTokens ? tokens.length : 0)) continue;
            return false;
        }
    }
    return false;
}