// lib/github.js

// 确保 tokens 表有 round_used 字段（若没有则添加）
async function ensureTokensTableSchema(env) {
    // 检查列是否存在，如果不存在则添加
    await env.DB.prepare(`
        ALTER TABLE tokens ADD COLUMN round_used INTEGER DEFAULT -1
    `).run().catch(() => {}); // 忽略错误（列已存在时）
}

// 获取当前轮次（从 D1 的 token_round 表）
async function getCurrentRound(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS token_round (
            type TEXT PRIMARY KEY,
            round INTEGER NOT NULL
        )
    `).run();
    const result = await env.DB.prepare("SELECT round FROM token_round WHERE type = ?").bind('github').first();
    if (!result) {
        // 初始轮次为 1
        await env.DB.prepare("INSERT INTO token_round (type, round) VALUES (?, ?)").bind('github', 1).run();
        return 1;
    }
    return result.round;
}

// 递增轮次
async function incrementRound(env) {
    await env.DB.prepare(`
        UPDATE token_round SET round = round + 1 WHERE type = ?
    `).bind('github').run();
}

// 从 D1 获取所有 GitHub 令牌（包含 id, token, round_used）
async function getAllTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT id, token, round_used FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    return results;
}

// 更新令牌使用信息：增加 usage_count，并将 round_used 设为当前轮次
async function markTokenUsed(env, tokenId, currentRound) {
    await env.DB.prepare(`
        UPDATE tokens SET usage_count = usage_count + 1, round_used = ? WHERE id = ?
    `).bind(currentRound, tokenId).run();
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    await ensureTokensTableSchema(env);
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

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                // 获取当前轮次
                const currentRound = await getCurrentRound(env);
                // 找出第一个 round_used < currentRound 的令牌（即本轮未使用）
                const availableToken = tokens.find(t => t.round_used < currentRound);
                if (availableToken) {
                    usedToken = availableToken.token;
                    usedTokenId = availableToken.id;
                    headers['Authorization'] = `token ${usedToken}`;
                } else {
                    // 本轮所有令牌已用，递增轮次
                    await incrementRound(env);
                    // 使用第一个令牌（因为所有令牌的 round_used 都小于新轮次）
                    const firstToken = tokens[0];
                    usedToken = firstToken.token;
                    usedTokenId = firstToken.id;
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
                        // 公共 API 限流，立即切换到令牌（继续当前循环，attempt++ 后会用令牌）
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 当前令牌限流，尝试下一个令牌（通过重新获取可用令牌）
                        // 这里我们重新执行循环，attempt 会递增，headers 会重新构造
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

            // 请求成功，更新使用计数和轮次标记
            if (usedTokenId !== null) {
                const currentRound = await getCurrentRound(env);
                await markTokenUsed(env, usedTokenId, currentRound);
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
