// lib/docker.js
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/api/content/v1/search';
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 3;
const FETCH_TIMEOUT = 20000; // 20秒超时

// 内存中记录上次使用的令牌索引
let lastTokenIndex = -1;

async function getAllTokens(env) {
    try {
        const { results } = await env.DB.prepare(
            "SELECT id, token FROM tokens WHERE type = ? ORDER BY id"
        ).bind('docker').all();
        console.log(`[LOG] Found ${results ? results.length : 0} Docker tokens.`);
        return results || [];
    } catch (e) {
        console.error("[LOG] Failed to get tokens from DB:", e.message);
        return [];
    }
}

function getNextToken(tokens, currentIndex) {
    if (!tokens || tokens.length === 0) return { token: null, index: -1 };
    const nextIndex = (currentIndex + 1) % tokens.length;
    return { token: tokens[nextIndex].token, index: nextIndex };
}

async function incrementTokenUsage(env, tokenId) {
    if (tokenId === null) return;
    try {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(tokenId).run();
    } catch (e) {
        console.error("[LOG] Failed to increment token usage:", e.message);
    }
}


async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        console.log(`[LOG] Fetching URL: ${url}`);
        console.log(`[LOG] With Headers: ${JSON.stringify(options.headers, null, 2)}`);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        console.log(`[LOG] Got Response Status: ${response.status}`);
        return response;
    } catch (error) {
        clearTimeout(id);
        console.error(`[LOG] Fetch failed: ${error.message}`);
        throw error;
    }
}

async function executeApiRequest(url, env) {
    const tokens = await getAllTokens(env);
    let lastUsedTokenIndex = -1;

    // 第一次尝试：公共API
    console.log("[LOG] Attempting public API call.");
    let response = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' } });

    // 如果因为速率限制或认证失败，则开始使用令牌
    if (response.status === 429 || response.status === 401 || response.status === 403) {
        if (tokens.length > 0) {
            console.warn(`[LOG] Public API call failed (${response.status}), switching to tokens.`);
            for (let i = 0; i < tokens.length; i++) {
                const { token, index } = getNextToken(tokens, lastUsedTokenIndex);
                lastUsedTokenIndex = index;

                console.log(`[LOG] Retrying with token ID: ${tokens[index].id}`);
                const headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'B2-Mirror-Worker',
                    'Authorization': `Bearer ${token}`
                };
                
                response = await fetchWithTimeout(url, { headers });
                
                if (response.ok) {
                    console.log(`[LOG] Token with ID ${tokens[index].id} succeeded!`);
                    await incrementTokenUsage(env, tokens[index].id);
                    return response;
                }
                console.warn(`[LOG] Token with ID ${tokens[index].id} failed with status ${response.status}.`);
            }
        } else {
            console.warn(`[LOG] API call failed (${response.status}) and no tokens are configured.`);
        }
    }
    
    return response;
}

/**
 * 搜索 Docker Hub 镜像 (使用 content/v1/search API 和令牌)
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    console.log(`[LOG] --- searchDockerHub started for query: "${query}" ---`);
    // 修正: 此API端点不支持分页参数, 去掉 page 和 page_size
    const url = `${DOCKER_HUB_SEARCH_API}?q=${encodeURIComponent(query)}&type=image`;

    try {
        const response = await executeApiRequest(url, env);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log("[LOG] Response was OK. Reading body...");
        const rawBody = await response.text();
        console.log(`[LOG] Raw Response Body: ${rawBody}`);

        let data;
        try {
            data = JSON.parse(rawBody);
            console.log("[LOG] Successfully parsed JSON.");
        } catch (e) {
            console.error("[LOG] Failed to parse JSON:", e.message);
            throw new Error("Invalid JSON response from Docker Hub API");
        }


        if (!Array.isArray(data)) {
            console.error("[LOG] Parsed data is not an array. Aborting.");
            return { items: [], total: 0 };
        }
        console.log(`[LOG] Parsed data contains ${data.length} items.`);

        const items = data.map(item => ({
            name: item.name,
            description: item.description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: item.updated_at ? item.updated_at.split('T')[0] : new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.name}`,
            type: 'docker',
            owner: item.name.split('/')[0],
            repo: item.name.split('/')[1] || item.name,
        }));
        
        console.log("[LOG] Checking for tags on found items...");
        const hasReleasesArray = await Promise.all(
            items.map(item => checkDockerHasTags(item.name, env))
        );

        const itemsWithReleases = items.map((item, idx) => ({
            ...item,
            has_releases: hasReleasesArray[idx] || false
        }));
        
        console.log("[LOG] --- searchDockerHub finished successfully. ---");
        return { items: itemsWithReleases, total: itemsWithReleases.length };

    } catch (error) {
        console.error(`[LOG] --- searchDockerHub CRASHED: ${error.message} ---`);
        return { items: [], total: 0 };
    }
}


/**
 * 检查镜像是否有 tags (带令牌逻辑)
 */
export async function checkDockerHasTags(repo, env) {
    console.log(`[LOG] Checking tags for repo: ${repo}`);
    const url = `${DOCKER_HUB_V2_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const response = await executeApiRequest(url, env);

        if (!response.ok) {
            if (response.status === 404) {
                console.log(`[LOG] Repo ${repo} not found (404), assuming no tags.`);
                return false;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const hasTags = data.results && data.results.length > 0;
        console.log(`[LOG] Repo ${repo} has tags: ${hasTags}`);
        return hasTags;
    } catch (error) {
        console.error(`[LOG] Failed to check tags for ${repo}: ${error.message}`);
        return false;
    }
}