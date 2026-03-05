// lib/github.js
export async function fetchWithRetry(url, options, retries = 3, token = null, env = null) {
    let useToken = !!token; // 如果外部传入了token，则直接使用该token（向后兼容）
    let tokenIndex = -1;
    let tokens = [];

    for (let i = 0; i < retries; i++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let currentToken = token; // 如果外部指定了token，则使用它

            if (!useToken && env) {
                // 如果没有指定使用令牌，但env存在，则先尝试公共API
                // 不添加Authorization头
            } else if (useToken || (env && i > 0)) {
                // 如果需要使用令牌（可能因为公共API限流切换而来），则从env获取令牌列表
                if (env && tokens.length === 0) {
                    const tokenList = await env.B2_KV.get('github_tokens', 'json') || [];
                    tokens = tokenList.map(t => t.token);
                }
                if (tokens.length > 0) {
                    tokenIndex = (tokenIndex + 1) % tokens.length;
                    currentToken = tokens[tokenIndex];
                    headers['Authorization'] = `token ${currentToken}`;
                }
                // 如果没有令牌，则继续使用公共API
            }

            const res = await fetch(url, { ...options, headers });

            // 检查公共API限流
            if (!useToken && env && res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
                console.log('Public API rate limit reached, switching to token mode');
                useToken = true;
                tokenIndex = -1; // 重置，从第一个令牌开始
                continue; // 重试
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }
            return res;
        } catch (e) {
            if (i === retries - 1) throw e;
            // 如果是令牌错误，尝试下一个
            if (useToken && e.message.includes('403') && tokens.length > 0) {
                console.log('Token error, trying next token');
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 以下为原有函数（searchGitHub, checkGitHubHasReleases等），无需修改，但需确保它们传入env参数
export async function getRandomGithubToken(env) {
    // 此函数已不再使用，但保留以兼容旧代码
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;
    const token = tokens[0].token;
    tokens[0].usageCount = (tokens[0].usageCount || 0) + 1;
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    return token;
}

export async function checkGitHubHasReleases(owner, repo, env) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, null, env);
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
    } catch {
        return false;
    }
}

export async function searchGitHub(query, page = 1, perPage = 10, env) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
    try {
        const response = await fetchWithRetry(url, { method: 'GET' }, 3, null, env);
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
