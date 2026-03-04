// lib/github.js
async function fetchWithRetry(url, options, retries = 3, token = null) {
    for (let i = 0; i < retries; i++) {
        try {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            if (token) {
                headers['Authorization'] = `token ${token}`;
            }
            const res = await fetch(url, { ...options, headers });
            if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
                const reset = res.headers.get('X-RateLimit-Reset');
                const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
                if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error (${res.status}): ${errorText.substring(0, 200)}`);
            }
            return res;
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 获取一个可用的 GitHub 令牌（随机选取）
async function getRandomGithubToken(env) {
    const tokens = await env.B2_KV.get('github_tokens', 'json') || [];
    if (tokens.length === 0) return null;
    // 简单轮询，取第一个，后续可改进为按使用次数轮询
    const token = tokens[0].token;
    // 增加使用计数（可选）
    tokens[0].usageCount = (tokens[0].usageCount || 0) + 1;
    await env.B2_KV.put('github_tokens', JSON.stringify(tokens));
    return token;
}

export async function checkGitHubHasReleases(owner, repo, env) {
    const token = await getRandomGithubToken(env);
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`;
    try {
        const res = await fetchWithRetry(url, { method: 'GET' }, 3, token);
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
    } catch {
        return false;
    }
}

export async function searchGitHub(query, page = 1, perPage = 10, env) {
    const token = await getRandomGithubToken(env);
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
    try {
        const response = await fetchWithRetry(url, { method: 'GET' }, 3, token);
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