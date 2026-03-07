// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * 带简单重试的 fetch
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status === 429 || res.status >= 500) {
                const wait = Math.pow(2, i) * 1000;
                console.warn(`Docker API returned ${res.status}, retrying in ${wait}ms`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * 搜索 Docker Hub 镜像（全局搜索，不检查 tags）
 */
export async function searchDockerHub(query, page = 1, perPage = 30) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const response = await fetchWithRetry(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });

        if (!response.ok) {
            console.error(`Docker Hub API error ${response.status}: ${await response.text()}`);
            return { items: [], total: 0 };
        }

        const data = await response.json();
        if (!data.results) {
            console.warn('Docker API response missing results:', data);
            return { items: [], total: 0 };
        }

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
            has_releases: false // 暂不检查 tags，后续可优化
        }));

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
