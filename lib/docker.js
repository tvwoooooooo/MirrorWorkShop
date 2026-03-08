// lib/docker.js
// FINAL ATTEMPT: Switching to the V2 API endpoint as V1 is unreliable.
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/v2/repositories'; 
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
const FETCH_TIMEOUT = 20000; // 20秒超时

async function getAllTokens(env, logMessages) {
    try {
        const { results } = await env.DB.prepare(
            "SELECT id, token FROM tokens WHERE type = ? ORDER BY id"
        ).bind('docker').all();
        logMessages.push(`Found ${results ? results.length : 0} Docker tokens.`);
        return results || [];
    } catch (e) {
        logMessages.push(`[ERROR] Failed to get tokens from DB: ${e.message}`);
        return [];
    }
}

function getNextToken(tokens, currentIndex) {
    if (!tokens || tokens.length === 0) return { token: null, index: -1 };
    const nextIndex = (currentIndex + 1) % tokens.length;
    return { token: tokens[nextIndex].token, index: nextIndex };
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
            logMessages.push(`[WARN] Public API call failed (${response.status}), switching to tokens.`);
            for (let i = 0; i < tokens.length; i++) {
                const { token, index } = getNextToken(tokens, lastUsedTokenIndex);
                lastUsedTokenIndex = index;

                logMessages.push(`Retrying with token ID: ${tokens[index].id}`);
                const headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'B2-Mirror-Worker',
                    'Authorization': `Bearer ${token}`
                };
                
                response = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT, logMessages);
                
                if (response.ok) {
                    logMessages.push(`Token with ID ${tokens[index].id} succeeded!`);
                    await incrementTokenUsage(env, tokens[index].id, logMessages);
                    return response;
                }
                logMessages.push(`[WARN] Token with ID ${tokens[index].id} failed with status ${response.status}.`);
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
    
    // Using V2 endpoint which supports pagination
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
        
        // V2 response is an object with a "results" array
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
        
        logMessages.push("Checking for tags on found items...");
        const tagCheckPromises = items.map(item => checkDockerHasTags(item.name, env));
        const tagResults = await Promise.all(tagCheckPromises);

        const itemsWithReleases = items.map((item, idx) => {
            const { hasTags, logs } = tagResults[idx];
            logMessages.push(...logs);
            return { ...item, has_releases: hasTags };
        });

        logMessages.push("--- searchDockerHub finished successfully. ---");
        return { items: itemsWithReleases, total: data.count || 0, logs: logMessages };

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
        const response = await executeApiRequest(url, env, logMessages);

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