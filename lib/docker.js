// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

let lastTokenIndex = -1;

async function getAllDockerTokens(env) {
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
 * 带令牌的请求，返回响应和调试数组
 */
async function fetchWithToken(url, options, env, debug) {
    const tokens = await getAllDockerTokens(env);
    debug.tokensAvailable = tokens.length;

    // 尝试公共 API
    debug.publicAttempt = { status: null, error: null };
    try {
        const publicRes = await fetch(url, {
            ...options,
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });
        debug.publicAttempt.status = publicRes.status;
        if (publicRes.ok) {
            debug.finalSource = 'public';
            return { response: publicRes, debug };
        }
        if (publicRes.status !== 429) {
            // 非限流错误，直接返回
            debug.finalSource = 'public-error';
            return { response: publicRes, debug };
        }
        const reset = publicRes.headers.get('x-ratelimit-reset');
        debug.publicAttempt.rateLimitReset = reset;
    } catch (e) {
        debug.publicAttempt.error = e.message;
    }

    // 尝试令牌
    debug.tokenAttempts = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = getNextToken(tokens);
        const attempt = { index: i, tokenPrefix: token?.substring(0, 6), status: null, error: null };
        try {
            const tokenRes = await fetch(url, {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'B2-Mirror-Worker',
                    'Authorization': `Bearer ${token}`
                }
            });
            attempt.status = tokenRes.status;
            if (tokenRes.ok) {
                await incrementTokenUsage(env, token);
                debug.finalSource = 'token';
                attempt.success = true;
                debug.tokenAttempts.push(attempt);
                return { response: tokenRes, debug };
            }
            if (tokenRes.status !== 429) {
                // 非限流错误，返回此响应
                debug.finalSource = 'token-error';
                debug.tokenAttempts.push(attempt);
                return { response: tokenRes, debug };
            }
        } catch (e) {
            attempt.error = e.message;
        }
        debug.tokenAttempts.push(attempt);
    }

    // 所有尝试失败
    debug.finalSource = 'all-failed';
    throw new Error('All Docker tokens exhausted or rate limited');
}

export async function searchDockerHub(query, page = 1, perPage = 30, env) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    const debug = { url, steps: [] };

    try {
        const { response, debug: innerDebug } = await fetchWithToken(url, { method: 'GET' }, env, debug);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Docker Hub API error ${response.status}: ${errorText}`);
            return { items: [], total: 0, _dockerDebug: innerDebug };
        }

        const data = await response.json();

        if (!data.results || !Array.isArray(data.results)) {
            console.warn('Docker API response missing results array:', data);
            return { items: [], total: 0, _dockerDebug: innerDebug };
        }

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
            has_releases: false
        }));

        return { items, total: data.count || 0, _dockerDebug: innerDebug };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0, _dockerDebug: { ...debug, error: error.message } };
    }
}
