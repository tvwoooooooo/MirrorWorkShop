// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const FETCH_TIMEOUT = 10000; // 10 秒超时

/**
 * 带超时和重试的 fetch
 */
async function fetchWithTimeoutAndRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            // 对 429 或 5xx 进行重试
            if (res.status === 429 || res.status >= 500) {
                const wait = Math.pow(2, i) * 1000;
                console.warn(`Docker API returned ${res.status}, retrying in ${wait}ms`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            return res;
        } catch (err) {
            clearTimeout(timeoutId);
            console.error(`Docker fetch attempt ${i + 1} failed:`, err.message);
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * 检查镜像是否有 tags（用于判断是否有 releases）
 */
export async function checkDockerHasTags(repo) {
    const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
    try {
        const res = await fetchWithTimeoutAndRetry(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });
        if (!res.ok) return false;
        const data = await res.json();
        return data.results && data.results.length > 0;
    } catch (err) {
        console.error('checkDockerHasTags error:', err);
        return false; // 失败时认为无 releases
    }
}

/**
 * 搜索 Docker Hub 镜像（全局搜索）
 */
export async function searchDockerHub(query, page = 1, perPage = 20) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const response = await fetchWithTimeoutAndRetry(url, {
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
        }));

        // 并行检查 tags，但限制并发数以避免过多请求
        const hasReleasesArray = [];
        for (let i = 0; i < items.length; i += 5) {
            const batch = items.slice(i, i + 5);
            const batchResults = await Promise.all(
                batch.map(item => checkDockerHasTags(item.name))
            );
            hasReleasesArray.push(...batchResults);
        }

        const itemsWithReleases = items.map((item, idx) => ({
            ...item,
            has_releases: hasReleasesArray[idx] || false
        }));

        return { items: itemsWithReleases, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
