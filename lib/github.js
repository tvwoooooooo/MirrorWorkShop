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

// 递增轮次（更新缓存）
async function incrementRound(env) {
    await ensureTokenRoundTable(env);
    await env.DB.prepare(`
        UPDATE token_round SET round = round + 1 WHERE type = ?
    `).bind('github').run();
    // 使缓存失效
    cachedRound = null;
    cachedRoundExpiry = 0;
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
    // 获取令牌列表和当前轮次
    let tokens = await getTokens(env);
    const hasTokens = tokens.length > 0;
    let currentRound = await getCurrentRound(env);

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
                // 查找本轮未使用的令牌（round_used < currentRound）
                let availableToken = tokens.find(t => t.round_used < currentRound);
                // 如果没有可用令牌，说明本轮所有令牌已用，需要递增轮次
                if (!availableToken) {
                    await incrementRound(env);
                    currentRound = await getCurrentRound(env); // 获取新轮次
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
                        // 公共 API 限流，立即切换到令牌（继续循环，attempt++后会用令牌）
                        continue;
                    } else if (hasTokens && attempt <= tokens.length) {
                        // 当前令牌限流，尝试下一个令牌（重新查找可用令牌，注意此时当前令牌的 round_used 可能已更新？但还未成功，不应更新）
                        // 由于限流，我们不应该继续使用当前令牌，而是跳过它，继续查找下一个可用的。
                        // 简单做法：将当前令牌标记为不可用？但更简单的做法是继续循环，重新查找可用令牌，因为当前令牌可能仍然可用（只是限流），但为了避免无限循环，我们可以在令牌列表中去掉当前令牌？复杂。
                        // 我们采用：继续循环，重新查找可用令牌。如果当前令牌是唯一可用的，可能会再次选中它，导致无限循环。因此需要将当前令牌暂时排除。
                        // 但这里我们简化：假设限流后，令牌暂时不可用，我们通过继续循环，再次查找时，由于 round_used 未变，仍可能选中同一令牌，导致死循环。因此需要一种机制跳过当前令牌。
                        // 一个简单方法：在尝试下一个令牌时，我们手动递增 attempt 并重新查找，但 attempt 已经递增。为了保险，我们可以将当前令牌的 round_used 临时标记为当前轮次+1？但这会污染数据。
                        // 实际上，限流是暂时的，我们可以等待后重试同一令牌，或者尝试下一个。我们采用：如果当前令牌限流，我们继续循环，但 attempt 已递增，下一次查找可用令牌可能会选中另一个（如果存在），如果只有这一个令牌，则会再次选中它，但之后会因限流而继续等待，最终达到最大重试后失败。
                        // 因此不需要特别处理。
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
                await markTokenUsed(env, usedTokenId, currentRound);
                // 更新本地缓存中的 round_used，避免后续请求再次获取数据库
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
