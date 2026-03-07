// lib/github.js

// 确保 token_index 表存在
async function ensureTokenIndexTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS token_index (
            type TEXT PRIMARY KEY,
            idx INTEGER NOT NULL DEFAULT 0
        )
    `).run();
}

// 获取当前令牌信息（按 ID 升序的索引）
async function getCurrentToken(env) {
    // 获取所有 GitHub 令牌（按 ID 升序）
    const tokens = await getAllTokens(env);
    if (tokens.length === 0) return null;

    await ensureTokenIndexTable(env);
    let result = await env.DB.prepare("SELECT idx FROM token_index WHERE type = ?").bind('github').first();
    let idx = 0;
    if (!result) {
        // 初始为 0
        await env.DB.prepare("INSERT INTO token_index (type, idx) VALUES (?, ?)").bind('github', 0).run();
        idx = 0;
    } else {
        idx = result.idx;
        // 防止令牌数量变化导致索引越界
        if (idx >= tokens.length) idx = 0;
    }
    return { token: tokens[idx], index: idx, total: tokens.length };
}

// 成功请求后，原子递增索引（轮询）
async function advanceTokenIndex(env, totalTokens) {
    if (totalTokens === 0) return;
    await ensureTokenIndexTable(env);
    await env.DB.prepare(`
        UPDATE token_index SET idx = (idx + 1) % ? WHERE type = ?
    `).bind(totalTokens, 'github').run();
}

// 从 D1 获取所有 GitHub 令牌（按 ID 升序）
async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT id, token FROM tokens WHERE type = ? ORDER BY id ASC"
    ).bind('github').all();
    return results.map(r => ({ id: r.id, token: r.token }));
}

// 更新令牌使用次数
async function incrementTokenUsage(env, tokenId) {
    await env.DB.prepare(
        "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
    ).bind(tokenId).run();
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;
            let usedTokenId = null;
            let currentIndexInfo = null;

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                // 获取当前索引对应的令牌
                currentIndexInfo = await getCurrentToken(env);
                if (currentIndexInfo) {
                    usedToken = currentIndexInfo.token.token;
                    usedTokenId = currentIndexInfo.token.id;
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
                        // 公共 API 限流，立即切换到令牌（当前索引已获取）
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 当前令牌限流，尝试下一个令牌
                        // 手动递增索引并保存，跳过当前令牌
                        if (currentIndexInfo) {
                            let nextIdx = (currentIndexInfo.index + 1) % tokens.length;
                            await env.DB.prepare("UPDATE token_index SET idx = ? WHERE type = ?").bind(nextIdx, 'github').run();
                        }
                        continue;
                    } else {
                        // 所有令牌都用过，等待后重试
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，更新使用计数，并递增索引（准备下次使用）
            if (usedTokenId !== null) {
                await incrementTokenUsage(env, usedTokenId);
                await advanceTokenIndex(env, tokens.length);
            }
            return res;
        } catch (e) {
            if (attempt === retries + tokens.length) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

/**
 * 获取仓库完整文件树（递归）
 */
export async function getRepoFileTree(owner, repo, env, branch = 'HEAD') {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetchWithRetry(url, { method: 'GET' }, 3, env);
    const data = await res.json();
    if (!data.tree) {
        throw new Error('GitHub API returned no tree data');
    }
    return data.tree.filter(item => item.type === 'blob').map(item => item.path);
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
