// lib/docker.js
import { createMasterTask } from './taskManager.js';
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/v2/search/repositories'; 
const DOCKER_HUB_LOGIN_API = 'https://hub.docker.com/v2/users/login';
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
const FETCH_TIMEOUT = 20000; // 20秒超时

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
            // Omit has_releases check to avoid subrequest limit
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

export async function getDockerRegistryToken(imageName, env, logMessages) {
    const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${imageName}:pull`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'B2-Mirror-Worker'
        }
    });
    if (!response.ok) {
        logMessages.push(`[ERROR] Failed to get registry token: ${await response.text()}`);
        return null;
    }
    const data = await response.json();
    return data.token;
}

export async function getDockerImageManifest(imageName, tag, env) {
    const logMessages = [];
    // Adjust for official images like 'ubuntu' which are library/ubuntu
    const fullImageName = imageName.includes('/') ? imageName : `library/${imageName}`;

    const token = await getDockerRegistryToken(fullImageName, env, logMessages);
    if (!token) {
        return { manifest: null, logs: logMessages };
    }

    const url = `https://registry-1.docker.io/v2/${fullImageName}/manifests/${tag}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
            'User-Agent': 'B2-Mirror-Worker'
        }
    });

    if (!response.ok) {
        logMessages.push(`[ERROR] Failed to get manifest: ${await response.text()}`);
        return { manifest: null, logs: logMessages };
    }

    const manifest = await response.json();
    return { manifest, logs: logMessages };
}

export async function startDockerBackupTask(env, taskId, imageName, tag, bucketId) {
    const fullImageName = imageName.includes('/') ? imageName : `library/${imageName}`;

    const { manifest, logs } = await getDockerImageManifest(fullImageName, tag, env);

    if (!manifest) {
        // Here we should update the task with a failed status.
        console.error(`Failed to get manifest for ${fullImageName}:${tag}`, logs);
        return;
    }

    // The manifest itself is a valuable asset, let's back it up too.
    const manifestAsset = {
        type: 'docker-manifest',
        imageName: fullImageName,
        tag: tag,
        digest: manifest.config.digest // Use config digest for manifest file name
    }
    
    // The config is a separate JSON file.
    const configAsset = {
        type: 'docker-layer',
        imageName: fullImageName,
        digest: manifest.config.digest,
        size: manifest.config.size
    };

    const layerAssets = manifest.layers.map(layer => ({
        type: 'docker-layer',
        imageName: fullImageName,
        digest: layer.digest,
        size: layer.size
    }));
    
    const assets = [manifestAsset, configAsset, ...layerAssets];
    
    // We are not backing up any "files" in the GitHub sense, only "assets".
    await createMasterTask(env, taskId, fullImageName, tag, bucketId, [], assets);
}

export async function getDockerTags(imageName, env) {
    const logMessages = [];
    const fullImageName = imageName.includes('/') ? imageName : `library/${imageName}`;
    let url = `${DOCKER_HUB_V2_API}/repositories/${fullImageName}/tags`;
    const allTags = [];

    while (url) {
        try {
            const response = await executeApiRequest(url, env, logMessages);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const tags = data.results.map(t => t.name);
            allTags.push(...tags);
            url = data.next;
        } catch (error) {
            console.error(`Failed to fetch tags from ${url}:`, error);
            // On error, just return what we have so far.
            return allTags;
        }
    }
    return allTags;
}