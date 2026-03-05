// lib/github.js

// 模块级变量（每个 isolate 独立）
let lastTokenIndex = -1;

// 获取下一个 GitHub 令牌（轮询）
async function getNextGithubToken(env) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;

    lastTokenIndex = (lastTokenIndex + 1) % tokens.length;
    const tokenObj = tokens[lastTokenIndex];
    
    // 增加使用计数
    tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    
    return tokenObj.token;
}

export async function fetchWithRetry(url, options, retries = 3, env) {
    // 先尝试公共 API，失败则切换令牌
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            // attempt > 0 时尝试使用令牌
            if (attempt > 0) {
                const token = await getNextGithubToken(env);
                if (token) {
                    headers['Authorization'] = `token ${token}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理限流
            if (res.status === 403) {
                const remaining = res.headers.get('X-RateLimit-Remaining');
                if (remaining === '0') {
                    const reset = res.headers.get('X-RateLimit-Reset');
                    const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                    if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue; // 重试（可能换令牌）
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
