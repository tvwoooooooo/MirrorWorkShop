// lib/github.js

// 确保 tokens 表有 used_in_round 字段（默认 0）
async function ensureUsedInRoundColumn(env) {
    try {
        await env.DB.prepare("ALTER TABLE tokens ADD COLUMN used_in_round INTEGER DEFAULT 0").run();
    } catch (e) {
        // 列可能已存在，忽略错误
    }
}

// 获取下一个可用的令牌（原子操作）
async function getNextAvailableToken(env) {
    await ensureUsedInRoundColumn(env);
    
    // 尝试找到一个未使用的令牌
    const result = await env.DB.prepare(`
        UPDATE tokens 
        SET used_in_round = 1, usage_count = usage_count + 1
        WHERE type = ? AND used_in_round = 0
        ORDER BY id ASC
        LIMIT 1
        RETURNING id, token
    `).bind('github').first();

    if (result) {
        return { id: result.id, token: result.token };
    }

    // 没有未使用的令牌，需要重置所有令牌的 used_in_round 为 0
    await env.DB.prepare(`
        UPDATE tokens SET used_in_round = 0 WHERE type = ?
    `).bind('github').run();

    // 重置后再次尝试获取第一个令牌
    const resetResult = await env.DB.prepare(`
        UPDATE tokens 
        SET used_in_round = 1, usage_count = usage_count + 1
        WHERE type = ? AND used_in_round = 0
        ORDER BY id ASC
        LIMIT 1
        RETURNING id, token
    `).bind('github').first();

    return resetResult ? { id: resetResult.id, token: resetResult.token } : null;
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    // 检查是否有令牌可用（用于公共 API 尝试后切换）
    const tokenCountResult = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM tokens WHERE type = ?"
    ).bind('github').first();
    const hasTokens = tokenCountResult && tokenCountResult.count > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokenCountResult.count : 0); attempt++) {
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
                // 获取下一个可用令牌（原子操作，已包含计数更新）
                const tokenInfo = await getNextAvailableToken(env);
                if (tokenInfo) {
                    usedToken = tokenInfo.token;
                    usedTokenId = tokenInfo.id;
                    headers['Authorization'] = `token ${usedToken}`;
                } else {
                    // 没有令牌（理论上不会发生）
                    continue;
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
                    } else if (hasTokens && attempt <= tokenCountResult.count) {
                        // 当前令牌限流，继续尝试下一个（getNextAvailableToken 会自动跳过已使用的令牌）
                        continue;
                    } else {
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            // 请求成功，无需额外操作（计数已在 getNextAvailableToken 中更新）
            return res;
        } catch (e) {
            if (attempt === retries + tokenCountResult.count) throw e;
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
