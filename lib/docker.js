// lib/docker.js
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/v2/search/repositories';
const DOCKER_HUB_LOGIN_API = 'https://hub.docker.com/v2/users/login';
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY_AUTH = 'https://auth.docker.io/token';
const DOCKER_REGISTRY = 'https://registry-1.docker.io';
const FETCH_TIMEOUT = 20000; // 20秒超时

// ==================== 原有搜索相关函数 ====================
async function getAllTokens(env, logMessages) {
    try {
        const { results } = await env.DB.prepare(
            "SELECT id, username, token FROM tokens WHERE type = ? ORDER BY id"
        ).bind('docker').all();
        logMessages.push(`Found ${results ? results.length : 0} Docker tokens.`);
        return results || [];
    } catch (e) {
        logMessages.push(`[ERROR] Failed to get tokens from DB: ${e.message}`);
        return [];
    }
}

async function getDockerJwt(env, logMessages, username, pat) {
    logMessages.push(`Attempting to get JWT for user: ${username}`);
    try {
        const response = await fetch(DOCKER_HUB_LOGIN_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'B2-Mirror-Worker'
            },
            body: JSON.stringify({ username, password: pat })
        });

        if (!response.ok) {
            logMessages.push(`[ERROR] JWT login failed with status: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const jwt = data.token;
        if (!jwt) {
            logMessages.push(`[ERROR] JWT login response did not contain a token.`);
            return null;
        }
        logMessages.push(`Successfully obtained JWT for user: ${username}`);
        return jwt;
    } catch (e) {
        logMessages.push(`[CRASH] JWT login request failed: ${e.message}`);
        return null;
    }
}

function getNextToken(tokens, currentIndex) {
    if (!tokens || tokens.length === 0) return { token: null, index: -1 };
    const nextIndex = (currentIndex + 1) % tokens.length;
    return { token: tokens[nextIndex], index: nextIndex };
}

async function incrementTokenUsage(env, tokenId, logMessages) {
    if (tokenId === null) return;
    try {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(tokenId).run();
    } catch (e) {
        logMessages.push(`[ERROR] Failed to increment token usage: ${e.message}`);
    }
}

async function fetchWithTimeout(url, options, timeout, logMessages) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        logMessages.push(`Fetching URL: ${url}`);
        logMessages.push(`With Headers: ${JSON.stringify(options.headers, null, 2)}`);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        logMessages.push(`Got Response Status: ${response.status}`);
        return response;
    } catch (error) {
        clearTimeout(id);
        logMessages.push(`[ERROR] Fetch failed: ${error.message}`);
        throw error;
    }
}

async function executeApiRequest(url, env, logMessages) {
    const tokens = await getAllTokens(env, logMessages);
    let lastUsedTokenIndex = -1;

    logMessages.push("Attempting public API call.");
    let response = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' } }, FETCH_TIMEOUT, logMessages);

    if (response.status === 429 || response.status === 401 || response.status === 403) {
        if (tokens.length > 0) {
            logMessages.push(`[WARN] Public API call failed (${response.status}), switching to token authentication flow.`);
            for (let i = 0; i < tokens.length; i++) {
                const { token: pat, index } = getNextToken(tokens, lastUsedTokenIndex);
                lastUsedTokenIndex = index;
                const dbToken = tokens[index];

                if (!dbToken.username || !dbToken.token) {
                    logMessages.push(`[WARN] Skipping token ID ${dbToken.id} because username or PAT is missing.`);
                    continue;
                }

                logMessages.push(`Attempting JWT login with credentials from token ID: ${dbToken.id}`);
                const jwt = await getDockerJwt(env, logMessages, dbToken.username, dbToken.token);

                if (jwt) {
                    const headers = {
                        'Accept': 'application/json',
                        'User-Agent': 'B2-Mirror-Worker',
                        'Authorization': `Bearer ${jwt}`
                    };
                    
                    response = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT, logMessages);
                    
                    if (response.ok) {
                        logMessages.push(`Request with JWT from token ID ${dbToken.id} succeeded!`);
                        await incrementTokenUsage(env, dbToken.id, logMessages);
                        return response;
                    }
                    logMessages.push(`[WARN] Request with JWT from token ID ${dbToken.id} failed with status ${response.status}.`);
                }
            }
        } else {
            logMessages.push(`[WARN] API call failed (${response.status}) and no tokens are configured.`);
        }
    }
    
    return response;
}

export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const logMessages = [];
    logMessages.push(`--- searchDockerHub started for query: "${query}" ---`);
    
    const url = `${DOCKER_HUB_SEARCH_API}/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;

    try {
        const response = await executeApiRequest(url, env, logMessages);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        logMessages.push("Response was OK. Reading body...");
        const rawBody = await response.text();
        logMessages.push(`Raw Response Body: ${rawBody}`);

        let data;
        try {
            data = JSON.parse(rawBody);
            logMessages.push("Successfully parsed JSON.");
        } catch (e) {
            logMessages.push(`[ERROR] Failed to parse JSON: ${e.message}`);
            throw new Error("Invalid JSON response from Docker Hub API");
        }
        
        const results = data.results;

        if (!Array.isArray(results)) {
            logMessages.push(`[ERROR] Parsed data.results is not an array. Aborting.`);
            return { items: [], total: 0, logs: logMessages };
        }
        logMessages.push(`Parsed data contains ${results.length} items.`);

        const items = results.map(item => ({
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
        
        logMessages.push("--- searchDockerHub finished successfully. ---");
        return { items: items, total: data.count || 0, logs: logMessages };
    } catch (error) {
        logMessages.push(`[CRASH] --- searchDockerHub CRASHED: ${error.message} ---`);
        return { items: [], total: 0, logs: logMessages };
    }
}

// ==================== 新增：获取 Docker 镜像 tags ====================
export async function getDockerTags(owner, repo, env) {
    const logMessages = [];
    logMessages.push(`--- getDockerTags started for ${owner}/${repo} ---`);
    
    const url = `${DOCKER_HUB_V2_API}/repositories/${owner}/${repo}/tags/?page_size=100`;
    
    try {
        const response = await executeApiRequest(url, env, logMessages);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.results || !Array.isArray(data.results)) {
            logMessages.push(`[ERROR] No tags found or invalid response.`);
            return { tags: [], logs: logMessages };
        }
        
        const tags = data.results.map(tag => ({
            name: tag.name,
            size: tag.full_size || 0,
            lastUpdate: tag.last_updated ? tag.last_updated.split('T')[0] : '未知',
            digest: tag.digest
        }));
        
        logMessages.push(`Found ${tags.length} tags.`);
        return { tags, logs: logMessages };
    } catch (error) {
        logMessages.push(`[CRASH] getDockerTags failed: ${error.message}`);
        return { tags: [], logs: logMessages };
    }
}

// ==================== 新增：获取 registry token ====================
async function getRegistryToken(env, logMessages, username, pat, imageName) {
    logMessages.push(`Getting registry token for ${imageName} using user ${username}`);
    
    const authUrl = `${DOCKER_REGISTRY_AUTH}?service=registry.docker.io&scope=repository:${imageName}:pull`;
    
    // 使用 username:pat 进行 basic auth 获取 token
    const auth = btoa(`${username}:${pat}`);
    try {
        const response = await fetch(authUrl, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        
        if (!response.ok) {
            logMessages.push(`[ERROR] Failed to get registry token: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        return data.token;
    } catch (e) {
        logMessages.push(`[ERROR] Registry token fetch failed: ${e.message}`);
        return null;
    }
}

// ==================== 新增：获取镜像 manifest（返回 manifest 和 registryToken）====================
export async function getManifest(env, logMessages, imageName, tag) {
    const tokens = await getAllTokens(env, logMessages);
    if (tokens.length === 0) {
        throw new Error('No Docker tokens available');
    }
    
    let lastUsedTokenIndex = -1;
    for (let i = 0; i < tokens.length; i++) {
        const { token: pat, index } = getNextToken(tokens, lastUsedTokenIndex);
        lastUsedTokenIndex = index;
        const dbToken = tokens[index];
        
        if (!dbToken.username || !dbToken.token) continue;
        
        const registryToken = await getRegistryToken(env, logMessages, dbToken.username, dbToken.token, imageName);
        if (!registryToken) continue;
        
        const manifestUrl = `${DOCKER_REGISTRY}/v2/${imageName}/manifests/${tag}`;
        const manifestRes = await fetch(manifestUrl, {
            headers: {
                'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
                'Authorization': `Bearer ${registryToken}`
            }
        });
        
        if (manifestRes.ok) {
            await incrementTokenUsage(env, dbToken.id, logMessages);
            const manifest = await manifestRes.json();
            return { manifest, registryToken, logs: logMessages };
        } else {
            logMessages.push(`Manifest fetch failed with status ${manifestRes.status} using token ID ${dbToken.id}`);
        }
    }
    
    throw new Error('Failed to get manifest with all tokens');
}

// ==================== 新增：获取 layer 下载流 ====================
export async function getLayerStream(env, logMessages, imageName, digest) {
    // 这里我们需要一个有效的 registryToken，但 getManifest 已经返回了一个 token，可以复用
    // 但为了独立使用，我们重新获取 token
    const tokens = await getAllTokens(env, logMessages);
    if (tokens.length === 0) {
        throw new Error('No Docker tokens available');
    }
    
    let lastUsedTokenIndex = -1;
    for (let i = 0; i < tokens.length; i++) {
        const { token: pat, index } = getNextToken(tokens, lastUsedTokenIndex);
        lastUsedTokenIndex = index;
        const dbToken = tokens[index];
        
        if (!dbToken.username || !dbToken.token) continue;
        
        const registryToken = await getRegistryToken(env, logMessages, dbToken.username, dbToken.token, imageName);
        if (!registryToken) continue;
        
        const layerUrl = `${DOCKER_REGISTRY}/v2/${imageName}/blobs/${digest}`;
        const layerRes = await fetch(layerUrl, {
            headers: {
                'Authorization': `Bearer ${registryToken}`
            }
        });
        
        if (layerRes.ok) {
            await incrementTokenUsage(env, dbToken.id, logMessages);
            return layerRes.body;
        } else {
            logMessages.push(`Layer fetch failed with status ${layerRes.status} using token ID ${dbToken.id}`);
        }
    }
    
    throw new Error('Failed to get layer stream with all tokens');
}
