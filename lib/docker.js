// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY_API = 'https://registry-1.docker.io/v2';
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

/**
 * 带超时、重试和令牌轮询的 fetch（用于所有 Docker API 请求）
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES, env, useToken = true) {
    const tokens = useToken ? await getAllTokens(env) : [];
    const hasTokens = tokens.length > 0;

    // 尝试顺序：公共 API -> 令牌1 -> 令牌2 ...
    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        let usedToken = null;

        try {
            const headers = options.headers || {};
            headers['User-Agent'] = 'B2-Mirror-Worker';

            if (attempt === 0) {
                // 公共 API，无 token
            } else if (hasTokens) {
                usedToken = getNextToken(tokens);
                if (usedToken) {
                    headers['Authorization'] = `Bearer ${usedToken}`;
                }
            }

            const res = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            // 处理限流
            if (res.status === 429) {
                const retryAfter = res.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                console.warn(`Docker API 429, waiting ${waitTime}ms`);

                if (attempt === 0 && hasTokens) {
                    // 公共 API 限流，立即切换到令牌
                    continue;
                } else if (hasTokens && attempt <= tokens.length) {
                    // 还有令牌未用，立即尝试下一个令牌
                    continue;
                } else {
                    // 所有令牌都用过，等待后重试
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            // 其他错误状态（401 可能表示令牌无效，应尝试下一个令牌）
            if (res.status === 401) {
                if (attempt === 0 && hasTokens) {
                    // 公共 API 返回 401？不太可能，但继续尝试令牌
                    continue;
                } else if (hasTokens && attempt <= tokens.length) {
                    // 当前令牌可能无效，尝试下一个
                    continue;
                } else {
                    // 所有令牌都无效，等待后重试？但 401 通常不会因等待解决，直接返回错误
                    throw new Error(`Docker API error (${res.status}): Unauthorized`);
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
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                console.error('Fetch timeout');
            } else {
                console.error(`Attempt ${attempt + 1} failed:`, err.message);
            }
            if (attempt === retries + tokens.length) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

/**
 * 搜索 Docker Hub 镜像（使用 fetchWithRetry）
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const response = await fetchWithRetry(url, {
            headers: { 'Accept': 'application/json' }
        }, MAX_RETRIES, env, true);

        const data = await response.json();

        if (data.error || data.message) {
            throw new Error(data.error || data.message);
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
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}

/**
 * 检查镜像是否有 tags
 */
export async function checkDockerHasTags(repo, env) {
    const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const response = await fetchWithRetry(url, {
            headers: { 'Accept': 'application/json' }
        }, MAX_RETRIES, env, true);
        const data = await response.json();
        return data.results && data.results.length > 0;
    } catch {
        return false;
    }
}

/**
 * 获取 Docker 镜像的 manifest
 */
export async function getDockerManifest(image, tag, env) {
    const url = `${DOCKER_REGISTRY_API}/${image}/manifests/${tag}`;
    try {
        const response = await fetchWithRetry(url, {
            headers: { 'Accept': 'application/vnd.docker.distribution.manifest.v2+json' }
        }, MAX_RETRIES, env, true);
        return await response.json();
    } catch (error) {
        console.error('getDockerManifest error:', error);
        throw error;
    }
}

/**
 * 获取 Docker 镜像层数据（blob）
 */
export async function getDockerLayer(image, digest, env, extraOptions = {}) {
    const url = `${DOCKER_REGISTRY_API}/${image}/blobs/${digest}`;
    try {
        const response = await fetchWithRetry(url, {
            headers: { 'Accept': 'application/octet-stream' },
            ...extraOptions
        }, MAX_RETRIES, env, true);
        return response;
    } catch (error) {
        console.error('getDockerLayer error:', error);
        throw error;
    }
}
