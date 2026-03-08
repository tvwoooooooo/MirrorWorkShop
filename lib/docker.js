// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY_API = 'https://registry-1.docker.io/v2';
const DOCKER_AUTH_SERVICE = 'https://auth.docker.io/token';
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
 * 获取 Docker registry 的临时 token（使用用户提供的 PAT）
 * @param {string} image - 镜像名，如 "library/alpine"
 * @param {string} pat - Docker Hub 个人访问令牌
 * @returns {Promise<string>} 临时 token
 */
async function getRegistryToken(image, pat) {
    // 解析 scope，例如 repository:library/alpine:pull
    const scope = `repository:${image}:pull`;
    const url = `${DOCKER_AUTH_SERVICE}?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
    const headers = {};
    if (pat) {
        headers['Authorization'] = `Bearer ${pat}`;
    }
    const response = await fetchWithTimeout(url, { headers });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to get registry token (${response.status}): ${text.substring(0, 200)}`);
    }
    const data = await response.json();
    return data.token;
}

/**
 * 搜索 Docker Hub 镜像（保持原有不变）
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
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

        const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;

        try {
            const response = await fetchWithTimeout(url, { headers });

            if (response.status === 429) {
                if (attempt < (hasTokens ? tokens.length : 0)) {
                    continue;
                } else {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                    console.warn(`Docker API 429, waiting ${waitTime}ms`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
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
            if (attempt === 0 && hasTokens) continue;
            if (attempt < (hasTokens ? tokens.length : 0)) continue;
            return { items: [], total: 0 };
        }
    }
    return { items: [], total: 0 };
}

/**
 * 检查镜像是否有 tags（保持原有不变）
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

/**
 * 获取 Docker 镜像的 manifest（支持 manifest list）
 * @param {string} image - 镜像名，如 "library/alpine" 或 "username/repo"
 * @param {string} tag - 标签，如 "latest"
 * @param {Object} env - 环境变量
 * @returns {Promise<Object>} manifest 对象（如果是 list，返回第一个 linux/amd64 的 manifest）
 */
export async function getDockerManifest(image, tag, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= (hasTokens ? tokens.length : 0); attempt++) {
        let pat = null;
        if (attempt === 0) {
            // 公共 API（不使用 PAT）
        } else if (hasTokens) {
            pat = getNextToken(tokens);
        }

        try {
            // 获取临时 registry token
            const registryToken = await getRegistryToken(image, pat);
            
            const headers = {
                'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json',
                'Authorization': `Bearer ${registryToken}`,
                'User-Agent': 'B2-Mirror-Worker'
            };

            const url = `${DOCKER_REGISTRY_API}/${image}/manifests/${tag}`;
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

            const manifest = await response.json();
            
            // 处理 manifest list
            if (manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json') {
                // 找到第一个 linux/amd64 的 manifest
                const amd64Manifest = manifest.manifests.find(m => 
                    m.platform.architecture === 'amd64' && m.platform.os === 'linux'
                );
                if (!amd64Manifest) {
                    throw new Error('No linux/amd64 manifest found in manifest list');
                }
                // 递归获取具体的 manifest
                return await getDockerManifest(image, amd64Manifest.digest, env);
            }

            // 验证 manifest 包含 layers
            if (!manifest.layers || !Array.isArray(manifest.layers) || manifest.layers.length === 0) {
                throw new Error('Invalid manifest: no layers');
            }

            if (pat) {
                await incrementTokenUsage(env, pat);
            }
            return manifest;
        } catch (error) {
            console.error(`Attempt ${attempt} failed for getDockerManifest:`, error.message);
            if (attempt === 0 && hasTokens) continue;
            if (attempt < (hasTokens ? tokens.length : 0)) continue;
            throw error;
        }
    }
}

/**
 * 获取 Docker 镜像层数据（blob），使用临时 token
 * @param {string} image - 镜像名
 * @param {string} digest - 层的 digest，如 "sha256:..."
 * @param {Object} env - 环境变量
 * @param {Object} options - 可选，如 headers
 * @returns {Promise<Response>} fetch Response 对象（流式）
 */
export async function getDockerLayer(image, digest, env, options = {}) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= (hasTokens ? tokens.length : 0); attempt++) {
        let pat = null;
        if (attempt === 0) {
            // 公共 API
        } else if (hasTokens) {
            pat = getNextToken(tokens);
        }

        try {
            const registryToken = await getRegistryToken(image, pat);
            
            const headers = {
                'Accept': 'application/octet-stream',
                'Authorization': `Bearer ${registryToken}`,
                'User-Agent': 'B2-Mirror-Worker',
                ...options.headers
            };

            const url = `${DOCKER_REGISTRY_API}/${image}/blobs/${digest}`;
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

            if (pat) {
                await incrementTokenUsage(env, pat);
            }
            return response;
        } catch (error) {
            console.error(`Attempt ${attempt} failed for getDockerLayer:`, error.message);
            if (attempt === 0 && hasTokens) continue;
            if (attempt < (hasTokens ? tokens.length : 0)) continue;
            throw error;
        }
    }
}
