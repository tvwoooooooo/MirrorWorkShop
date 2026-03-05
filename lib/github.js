// lib/github.js

// 内存缓存令牌列表，避免频繁查询 D1
let cachedTokens = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1 分钟

// 内存中的令牌索引（每个 isolate 独立）
let currentTokenIndex = -1;
// 上次同步索引的时间
let lastSyncTime = 0;
const SYNC_INTERVAL = 60000; // 1 分钟同步一次索引

// 从 D1 获取所有 GitHub 令牌（包含 id 和 token）
async function getAllTokens(env) {
    if (cachedTokens && Date.now() - cacheTime < CACHE_TTL) {
        return cachedTokens;
    }
    const { results } = await env.DB.prepare(
        "SELECT id, token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    cachedTokens = results.map(r => ({ id: r.id, token: r.token }));
    cacheTime = Date.now();
    return cachedTokens;
}

// 初始化内存索引（从 D1 读取上次保存的索引）
async function initTokenIndex(env, tokenCount) {
    if (tokenCount === 0) return -1;
    
    // 确保索引表存在
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS last_token_index (
            type TEXT PRIMARY KEY,
            idx INTEGER NOT NULL DEFAULT 0
        )
    `).run();

    // 读取上次保存的索引
    const row = await env.DB.prepare(
        "SELECT idx FROM last_token_index WHERE type = ?"
    ).bind('github').first();
    
    currentTokenIndex = row ? row.idx : 0;
    lastSyncTime = Date.now();
    return currentTokenIndex;
}

// 获取下一个令牌索引（内存递增）
function getNextTokenIndex(tokens) {
    if (tokens.length === 0) return -1;
    if (currentTokenIndex === -1) {
        // 如果未初始化，则从 0 开始（理论上不会发生，因为 fetchWithRetry 会先初始化）
        currentTokenIndex = 0;
    } else {
        currentTokenIndex = (currentTokenIndex + 1) % tokens.length;
    }
    return currentTokenIndex;
}

// 同步索引到 D1（仅当需要时）
async function syncTokenIndexIfNeeded(env, tokenCount) {
    if (tokenCount === 0 || currentTokenIndex === -1) return;
    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
        // 原子更新
        await env.DB.prepare(`
            INSERT OR REPLACE INTO last_token_index (type, idx) VALUES (?, ?)
        `).bind('github', currentTokenIndex).run();
        lastSyncTime = now;
    }
}

// 根据 id 更新令牌使用次数
async function incrementTokenUsage(env, tokenId) {
    await env.DB.prepare(
        "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
    ).bind(tokenId).run();
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    // 如果内存索引未初始化且存在令牌，则初始化
    if (hasTokens && currentTokenIndex === -1) {
        await initTokenIndex(env, tokens.length);
    }

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;
            let usedTokenId = null;

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                const tokenIndex = getNextTokenIndex(tokens);
                if (tokenIndex >= 0) {
                    usedToken = tokens[tokenIndex].token;
                    usedTokenId = tokens[tokenIndex].id;
                    headers['Authorization'] = `token ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;

                    if (attempt === 0 && hasTokens) {
                        // 公共 API 限流，立即切换到令牌
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 还有令牌未用，立即尝试下一个令牌
                        continue;
                    } else {
                        // 所有令牌都用过，等待
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，更新使用计数
            if (usedTokenId !== null) {
                await incrementTokenUsage(env, usedTokenId);
            }
            
            // 尝试同步索引（不阻塞响应）
            syncTokenIndexIfNeeded(env, tokens.length).catch(console.error);
            
            return res;
        } catch (e) {
            if (attempt === retries + tokens.length) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

export async function searchGitHub(query, page = 1, perPage = 10, env) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
    try {
        const response = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        const data = await response.json();
        const baseItems = data.items.map(item => ({
            name: item.full_name,
            description: item.description || '暂无描述',
            stars: item.stargazers_count,
            forks: item.forks_count,
            lastUpdate: item.pushed_at ? item.pushed_at.split('T')[0] : (item.updated_at ? item.updated_at.split('T')[0] : '未知'),
            homepage: item.html_url,
            type: 'github',
            owner: item.owner.login,
            repo: item.name
        }));

        const hasReleasesArray = await Promise.all(
            baseItems.map(item => checkGitHubHasReleases(item.owner, item.repo, env))
        );
        const items = baseItems.map((item, idx) => ({
            ...item,
            has_releases: hasReleasesArray[idx]
        }));

        return { items, total: data.total_count };
    } catch (error) {
        console.error('GitHub search error:', error);
        return { items: [], total: 0 };
    }
}

export async function checkGitHubHasReleases(owner, repo, env) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
    } catch {
        return false;
    }
}
