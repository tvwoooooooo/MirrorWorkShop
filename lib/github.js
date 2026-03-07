// lib/github.js
import {
    ensureTokensTable,
    ensureTokenRoundTable
} from './d1.js';

// 缓存令牌列表和轮次，减少数据库查询
let cachedTokens = null;
let cachedTokensExpiry = 0;
const CACHE_TTL = 60000; // 1分钟缓存

async function getTokens(env) {
    const now = Date.now();
    if (cachedTokens && cachedTokensExpiry > now) {
        return cachedTokens;
    }
    await ensureTokensTable(env);
    const { results } = await env.DB.prepare(
        "SELECT id, token, round_used FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    cachedTokens = results;
    cachedTokensExpiry = now + CACHE_TTL;
    return cachedTokens;
}

// 获取当前轮次（缓存一分钟）
let cachedRound = null;
let cachedRoundExpiry = 0;

async function getCurrentRound(env) {
    const now = Date.now();
    if (cachedRound && cachedRoundExpiry > now) {
        return cachedRound;
    }
    await ensureTokenRoundTable(env);
    const result = await env.DB.prepare("SELECT round FROM token_round WHERE type = ?").bind('github').first();
    if (!result) {
        await env.DB.prepare("INSERT INTO token_round (type, round) VALUES (?, ?)").bind('github', 1).run();
        cachedRound = 1;
    } else {
        cachedRound = result.round;
    }
    cachedRoundExpiry = now + CACHE_TTL;
    return cachedRound;
}

/**
 * 安全地递增轮次（确保每次只增加1）
 * 使用乐观锁：尝试更新当前轮次，如果影响行数为0，说明已被其他请求更新，重新读取
 */
async function safeIncrementRound(env) {
    await ensureTokenRoundTable(env);
    let updated = false;
    let newRound;
    while (!updated) {
        // 读取当前轮次
        const result = await env.DB.prepare("SELECT round FROM token_round WHERE type = ?").bind('github').first();
        if (!result) {
            // 不存在则创建（理论上不会发生，因为 getCurrentRound 已创建）
            await env.DB.prepare("INSERT INTO token_round (type, round) VALUES (?, ?)").bind('github', 1).run();
            newRound = 1;
            updated = true;
            break;
        }
        const currentRound = result.round;
        // 尝试更新：将 round 从 currentRound 增加到 currentRound+1
        const updateResult = await env.DB.prepare(`
            UPDATE token_round SET round = round + 1 WHERE type = ? AND round = ?
        `).bind('github', currentRound).run();
        if (updateResult.meta.changes > 0) {
            // 更新成功
            newRound = currentRound + 1;
            updated = true;
        } else {
            // 更新失败（其他请求已经修改了 round），继续循环
            await new Promise(resolve => setTimeout(resolve, 10)); // 短暂等待避免忙等
        }
    }
    // 使缓存失效
    cachedRound = null;
    cachedRoundExpiry = 0;
    return newRound;
}

// 更新令牌使用信息：增加 usage_count，并将 round_used 设为当前轮次
async function markTokenUsed(env, tokenId, currentRound) {
    await ensureTokensTable(env);
    await env.DB.prepare(`
        UPDATE tokens SET usage_count = usage_count + 1, round_used = ? WHERE id = ?
    `).bind(currentRound, tokenId).run();
    // 使令牌缓存失效
    cachedTokens = null;
    cachedTokensExpiry = 0;
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    // 获取令牌列表
    let tokens = await getTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;
            let usedTokenId = null;
            let currentRound = null;

            if (attempt === 0) {
                // 公共 API
            } else if (hasTokens) {
                // 获取当前轮次
                currentRound = await getCurrentRound(env);
                // 查找本轮未使用的令牌（round_used < currentRound）
                let availableToken = tokens.find(t => t.round_used < currentRound);
                // 如果没有可用令牌，说明本轮所有令牌已用，需要安全地递增轮次
                if (!availableToken) {
                    const newRound = await safeIncrementRound(env);
                    currentRound = newRound; // 使用新轮次
                    // 重新获取令牌列表（因为 round_used 可能已更新，但为了保险，重新获取）
                    tokens = await getTokens(env);
                    // 现在所有令牌的 round_used 都小于新轮次，取第一个
                    availableToken = tokens.find(t => t.round_used < currentRound);
                }
                if (availableToken) {
                    usedToken = availableToken.token;
                    usedTokenId = availableToken.id;
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
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
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

            // 请求成功，更新使用计数和轮次标记
            if (usedTokenId !== null) {
                await markTokenUsed(env, usedTokenId, currentRound);
                // 更新本地缓存中的 round_used
                const token = tokens.find(t => t.id === usedTokenId);
                if (token) {
                    token.round_used = currentRound;
                }
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
