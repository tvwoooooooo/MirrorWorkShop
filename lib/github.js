// lib/github.js
async function updateTokenUsage(env, tokenValue) {
    // 更新指定令牌的使用次数
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    const index = tokens.findIndex(t => t.token === tokenValue);
    if (index !== -1) {
        tokens[index].usageCount = (tokens[index].usageCount || 0) + 1;
        await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    }
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    // 第一次尝试：公共 API（无 token）
    for (let i = 0; i <= retries; i++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            // 如果是第一次尝试（i=0），不添加 token
            // 如果后续重试，需要在循环内动态添加 token，此处我们先不添加，后面根据情况处理
            // 但我们需要在重试时获取 token，因此调整结构：先尝试公共，若失败且需要令牌，则进入令牌循环
            const res = await fetch(url, { ...options, headers });
            
            // 处理限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    // 需要等待
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                    if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                    // 继续下一次重试（可能使用令牌）
                    continue;
                }
            }
            
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }
            return res;
        } catch (e) {
            // 如果不是最后一次重试，则等待后继续
            if (i === retries) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }

    // 如果公共 API 重试全部失败（理论上不会执行到这里，因为上面循环内会返回或抛出），
    // 但为了处理限流后需要令牌的情况，我们在这里尝试使用令牌
    // 实际上，当公共 API 限流时，上面的循环会一直重试直到耗尽重试次数，但不会使用令牌。
    // 因此我们需要修改逻辑：在检测到限流且还有重试次数时，应开始使用令牌。

    // 更好的结构：在循环内判断是否需要令牌，并尝试使用令牌。
    // 我们重构如下：
}

// 新的实现：先尝试公共 API，如果遇到限流且还有重试次数，则切换到令牌重试
export async function fetchWithRetry(url, options, retries = 3, env) {
    // 先尝试公共 API
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            // 如果是第一次尝试，无 token；后续尝试如果已经决定使用令牌，会在 headers 中添加
            // 但我们在这里统一处理：如果 attempt === 0，无 token；否则，获取一个令牌
            if (attempt > 0) {
                const token = await getNextGithubToken(env);
                if (token) {
                    headers['Authorization'] = `token ${token}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 检查是否限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                    if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                    // 继续下一次重试（如果还有重试次数）
                    continue;
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

// 获取下一个 GitHub 令牌（轮询）
let lastTokenIndex = -1; // 模块级变量，每个 isolate 独立

async function getNextGithubToken(env) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;

    // 轮询选择下一个索引
    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    const tokenObj = tokens[lastTokenIndex];
    
    // 增加使用计数
    tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
    // 写回 KV（更新计数）
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    
    return tokenObj.token;
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