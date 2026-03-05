// lib/github.js

/**
 * GitHub API 请求封装，优先使用公共 API，遇到限流时自动切换至用户令牌轮询
 */

export async function fetchWithRetry(url, options, retries = 3, env = null) {
    // 先尝试无认证请求
    let attempt = 0;
    while (attempt < retries) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            // 第一次尝试不加 token
            const res = await fetch(url, { ...options, headers });
            
            // 如果遇到 403 且速率限制耗尽，则尝试使用令牌
            if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
                // 如果有令牌，则尝试使用令牌重试
                if (env) {
                    const token = await getRandomGithubToken(env, true); // 强制获取令牌
                    if (token) {
                        // 使用令牌重试一次
                        headers['Authorization'] = `token ${token}`;
                        const tokenRes = await fetch(url, { ...options, headers });
                        if (tokenRes.ok) return tokenRes;
                        // 如果令牌请求也失败，继续等待？
                        const reset = tokenRes.headers.get('X-RateLimit-Reset');
                        const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
                // 没有令牌，等待后重试
                const reset = res.headers.get('X-RateLimit-Reset');
                const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                attempt++;
                continue;
            }
            
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }
            return res;
        } catch (e) {
            if (attempt === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            attempt++;
        }
    }
    throw new Error('Max retries exceeded');
}

// 轮询获取下一个令牌（可强制获取，即使有公共请求也要用令牌）
let lastTokenIndex = -1; // 内存中的索引，每个请求独立，实际可改用 KV 实现跨请求轮询

export async function getRandomGithubToken(env, force = false) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;
    
    // 轮询：取 lastTokenIndex 的下一个，循环
    // 为了简单，这里使用随机，避免并发问题。
    // 若需要精确轮询，可将 lastTokenIndex 存入 KV，但会增加写入。
    const randomIndex = Math.floor(Math.random() * tokens.length);
    const token = tokens[randomIndex].token;
    
    // 增加使用计数（可选）
    tokens[randomIndex].usageCount = (tokens[randomIndex].usageCount || 0) + 1;
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    
    return token;
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