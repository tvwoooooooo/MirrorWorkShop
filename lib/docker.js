// lib/docker.js
const DOCKER_HUB_SEARCH_API = 'https://hub.docker.com/api/content/v1/search';
const DOCKER_HUB_V2_API = 'https://hub.docker.com/v2';
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
 * 搜索 Docker Hub 镜像 (使用 content/v1/search API)
 */
export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const headers = {
        'Accept': 'application/json',
        'User-Agent': 'B2-Mirror-Worker'
    };
    
    // 注意：这个API似乎不支持分页(page/perPage)，它通常用于搜索建议，但能返回我们需要的数据
    const url = `${DOCKER_HUB_SEARCH_API}?q=${encodeURIComponent(query)}&type=image`;

    try {
        const response = await fetchWithTimeout(url, { headers });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // 这个API直接返回一个数组
        if (!Array.isArray(data)) {
            return { items: [], total: 0 };
        }

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
        
        // 由于此API不返回总数，我们用返回的数组长度作为总数
        return { items: itemsWithReleases, total: itemsWithReleases.length };

    } catch (error) {
        console.error(`Docker Hub search failed:`, error.message);
        return { items: [], total: 0 };
    }
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
            // Docker Hub API for tags uses JWT token obtained via username/password, 
            // not personal access tokens in the same way as GitHub.
            // This part of the logic might need revision if rate limits are hit.
            // For now, we rely on unauthenticated requests.
            // headers['Authorization'] = `Bearer ${currentToken}`;
        }

        const url = `${DOCKER_HUB_V2_API}/repositories/${repo}/tags/?page_size=1`;

        try {
            const response = await fetchWithTimeout(url, { headers });

            if (response.status === 429) {
                 console.warn(`Docker tags API rate limited for ${repo}. Retrying after a delay.`);
                if (attempt < (hasTokens ? tokens.length : 0)) {
                    continue; // Try next token if available (though auth method is likely different)
                } else {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    attempt--; // Retry the same request
                    continue;
                }
            }

            if (!response.ok) {
                // If a repo is not found (404), it has no tags.
                if(response.status === 404) return false;
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (currentToken) {
                await incrementTokenUsage(env, currentToken);
            }
            return data.results && data.results.length > 0;
        } catch (error) {
            console.error(`Failed to check tags for ${repo}: ${error.message}`);
            if (attempt === 0 && hasTokens) continue;
            if (attempt < (hasTokens ? tokens.length : 0)) continue;
            return false;
        }
    }
    return false;
}