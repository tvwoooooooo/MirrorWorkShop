// lib/docker.js
const DOCKER_HUB_LOGIN_API = 'https://hub.docker.com/v2/users/login';
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/v2/search/repositories';
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY_API = 'https://registry-1.docker.io/v2';
const DOCKER_AUTH_SERVICE = 'registry.docker.io';
const FETCH_TIMEOUT = 20000; // 20秒超时

// ==================== 通用工具函数 ====================

/**
 * 从 D1 获取所有 Docker 令牌（包含 id, username, token）
 */
async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT id, username, token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results || [];
}

/**
 * 使用用户名和 PAT 获取 Docker Hub API 的 JWT（用于 hub.docker.com）
 */
async function getDockerHubJwt(username, pat, logMessages = []) {
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

/**
 * 从 Docker Registry 的认证服务获取 token（用于 registry-1.docker.io）
 */
async function getRegistryToken(repo, username, pat, logMessages = []) {
    // 解析 repo 格式，如 "library/alpine" 或 "username/repo"
    const scope = `repository:${repo}:pull`;
    const authUrl = `https://auth.docker.io/token?service=${DOCKER_AUTH_SERVICE}&scope=${encodeURIComponent(scope)}`;
    
    logMessages.push(`Requesting registry token from ${authUrl} with basic auth for user ${username}`);
    try {
        // 使用 Basic 认证，用户名和密码是 username 和 PAT
        const credentials = btoa(`${username}:${pat}`);
        const response = await fetch(authUrl, {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'User-Agent': 'B2-Mirror-Worker'
            }
        });
        if (!response.ok) {
            logMessages.push(`[ERROR] Registry token request failed with status: ${response.status}`);
            const errorText = await response.text().catch(() => 'Could not read error body');
            logMessages.push(`[ERROR] Body: ${errorText}`);
            throw new Error(logMessages.join('\n'));
        }
        const data = await response.json();
        const token = data.token;
        if (!token) {
            logMessages.push(`[ERROR] Registry token response did not contain a token.`);
            throw new Error(logMessages.join('\n'));
        }
        logMessages.push(`Successfully obtained registry token for repo ${repo}`);
        return token;
    } catch (e) {
        // Avoid adding the log message twice if it's our self-thrown error
        if (!e.message.includes('Registry token request failed')) {
            logMessages.push(`[CRASH] Registry token request failed: ${e.message}`);
        }
        throw new Error(logMessages.join('\n'));
    }
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT, logMessages = []) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        logMessages.push(`Fetching URL: ${url}`);
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

/**
 * 更新令牌使用次数
 */
async function incrementTokenUsage(env, tokenId, logMessages = []) {
    if (!tokenId) return;
    try {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(tokenId).run();
    } catch (e) {
        logMessages.push(`[ERROR] Failed to increment token usage: ${e.message}`);
    }
}

/**
 * 获取下一个令牌的索引（简单轮询）
 */
let lastTokenIndex = -1;
function getNextTokenIndex(tokens) {
    if (tokens.length === 0) return -1;
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    return lastTokenIndex;
}

/**
 * 执行带认证的 Docker Hub API 请求（用于搜索和 tags）
 */
async function executeDockerHubRequest(url, env, logMessages = []) {
    const tokens = await getAllTokens(env);
    let lastUsedTokenIndex = -1;

    logMessages.push("Attempting public API call.");
    let response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    }, FETCH_TIMEOUT, logMessages);

    if (response.status === 429 || response.status === 401 || response.status === 403) {
        if (tokens.length > 0) {
            logMessages.push(`[WARN] Public API call failed (${response.status}), switching to token authentication flow.`);
            for (let i = 0; i < tokens.length; i++) {
                const index = getNextTokenIndex(tokens);
                const dbToken = tokens[index];

                if (!dbToken.username || !dbToken.token) {
                    logMessages.push(`[WARN] Skipping token ID ${dbToken.id} because username or PAT is missing.`);
                    continue;
                }

                logMessages.push(`Attempting JWT login with credentials from token ID: ${dbToken.id}`);
                const jwt = await getDockerHubJwt(dbToken.username, dbToken.token, logMessages);

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
                        break;
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

// ==================== 搜索函数 ====================

export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const logMessages = [];
    logMessages.push(`--- searchDockerHub started for query: "${query}" ---`);
    
    const url = `${DOCKER_HUB_SEARCH_API}/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;

    try {
        const response = await executeDockerHubRequest(url, env, logMessages);

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

export async function checkDockerHasTags(repo, env) {
    const logMessages = [];
    logMessages.push(`Checking tags for repo: ${repo}`);
    const url = `${DOCKER_HUB_V2_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const response = await executeDockerHubRequest(url, env, logMessages);

        if (!response.ok) {
            if (response.status === 404) {
                logMessages.push(`Repo ${repo} not found (404), assuming no tags.`);
                return { hasTags: false, logs: logMessages };
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const hasTags = data.results && data.results.length > 0;
        logMessages.push(`Repo ${repo} has tags: ${hasTags}`);
        return { hasTags, logs: logMessages };
    } catch (error) {
        logMessages.push(`[ERROR] Failed to check tags for ${repo}: ${error.message}`);
        return { hasTags: false, logs: logMessages };
    }
}

// ==================== 备份相关函数 ====================

/**
 * 获取 Docker 镜像的 tags 列表（用于前端选择）
 */
export async function getDockerTags(repo, env) {
    const logMessages = [];
    logMessages.push(`--- getDockerTags started for repo: "${repo}" ---`);

    const url = `${DOCKER_HUB_V2_API}/repositories/${repo}/tags/?page_size=100`;

    const response = await executeDockerHubRequest(url, env, logMessages);

    if (!response.ok) {
        logMessages.push(`[ERROR] Final tags request failed with status ${response.status}`);
        return { items: [], total: 0, logs: logMessages };
    }

    const data = await response.json();
    const tags = data.results || [];
    const items = tags.map(tag => ({
        name: tag.name,
        digest: tag.digest,
        lastUpdate: tag.last_updated ? tag.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
        size: tag.images?.[0]?.size || 0
    }));

    logMessages.push(`--- getDockerTags finished, found ${items.length} tags. ---`);
    return { items, total: data.count || 0, logs: logMessages };
}

/**
 * 使用 Docker 令牌认证获取 Registry 资源（manifest 或 blob）
 */
export async function fetchWithDockerAuth(url, env, logMessages = []) {
    // 从 URL 中提取 repo 信息
    // URL 格式: https://registry-1.docker.io/v2/<repo>/manifests/<tag> 或 /blobs/<digest>
    const match = url.match(/\/v2\/([^\/]+(?:\/[^\/]+)?)\/(?:manifests|blobs)\//);
    if (!match) {
        throw new Error(`无法从 URL 解析 repo: ${url}`);
    }
    const repo = match[1];

    const tokens = await getAllTokens(env);
    if (tokens.length === 0) {
        logMessages.push(`[WARN] No Docker tokens available, attempting unauthenticated request (likely to fail).`);
        return fetchWithTimeout(url, { headers: { 'User-Agent': 'B2-Mirror-Worker' } }, FETCH_TIMEOUT, logMessages);
    }

    // 尝试每个令牌
    for (const token of tokens) {
        if (!token.username || !token.token) continue;
        logMessages.push(`Attempting to get registry token for user ${token.username} (token ID ${token.id})...`);
        const registryToken = await getRegistryToken(repo, token.username, token.token, logMessages);
        if (registryToken) {
            const headers = {
                'User-Agent': 'B2-Mirror-Worker',
                'Authorization': `Bearer ${registryToken}`
            };
            const response = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT, logMessages);
            if (response.ok) {
                logMessages.push(`Registry request with token from user ${token.username} succeeded!`);
                await incrementTokenUsage(env, token.id, logMessages);
                return response;
            } else {
                logMessages.push(`[WARN] Registry request with token from user ${token.username} failed with status ${response.status}.`);
            }
        }
    }

    // 所有令牌失败
    throw new Error('All Docker tokens failed to authenticate for registry access');
}