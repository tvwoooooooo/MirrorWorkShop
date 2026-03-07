// lib/github.js

/**
 * 确保tokens表有round和used字段（首次调用时检查并添加）
 * 注：如果字段已存在，ALTER会报错，因此需先检查
 */
async function ensureTokenFields(env) {
    // 检查round字段是否存在
    const tableInfo = await env.DB.prepare("PRAGMA table_info(tokens)").all();
    const columns = tableInfo.results.map(col => col.name);
    if (!columns.includes('round')) {
        await env.DB.prepare("ALTER TABLE tokens ADD COLUMN round INTEGER DEFAULT 0").run();
    }
    if (!columns.includes('used')) {
        await env.DB.prepare("ALTER TABLE tokens ADD COLUMN used INTEGER DEFAULT 0").run();
    }
}

/**
 * 获取下一个可用的GitHub令牌，并更新其used状态
 * 返回 { id, token } 或 null
 */
async function getNextGithubToken(env) {
    await ensureTokenFields(env);

    // 获取所有GitHub令牌，按id排序
    const { results } = await env.DB.prepare(
        "SELECT id, token, round, used FROM tokens WHERE type = ? ORDER BY id"
    ).bind('github').all();
    if (results.length === 0) return null;

    // 确定当前轮次（取第一个令牌的round作为参考，所有令牌round应一致）
    const currentRound = results[0].round;

    // 查找当前轮次中未使用的令牌
    let available = results.find(t => t.round === currentRound && t.used === 0);
    if (!available) {
        // 当前轮次无可用令牌，切换轮次
        const newRound = currentRound === 0 ? 1 : 0;
        // 更新所有令牌的round为新值，used重置为0
        await env.DB.prepare(
            "UPDATE tokens SET round = ?, used = 0 WHERE type = ?"
        ).bind(newRound, 'github').run();
        // 重新查询，取第一个令牌作为可用（所有令牌used均为0）
        const { results: newResults } = await env.DB.prepare(
            "SELECT id, token FROM tokens WHERE type = ? ORDER BY id"
        ).bind('github').all();
        if (newResults.length === 0) return null;
        available = newResults[0];
    } else {
        // 直接使用找到的令牌
        available = { id: available.id, token: available.token };
    }

    // 标记该令牌为已使用，并增加使用计数（原子操作）
    await env.DB.prepare(
        "UPDATE tokens SET used = 1, usage_count = usage_count + 1 WHERE id = ?"
    ).bind(available.id).run();

    return available;
}

/**
 * 带重试的fetch，自动使用令牌
 */
export async function fetchWithRetry(url, options, retries = 3, env) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;

            // 第一次尝试使用公共API，后续尝试使用令牌
            if (attempt > 0) {
                const tokenInfo = await getNextGithubToken(env);
                if (tokenInfo) {
                    usedToken = tokenInfo.token;
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

                    if (attempt === 0) {
                        // 公共API限流，下一次尝试使用令牌（立即继续）
                        continue;
                    } else if (waitTime > 0) {
                        // 令牌也限流，等待后重试
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }

            return res;
        } catch (e) {
            if (attempt === retries) throw e;
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
