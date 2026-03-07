// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

/**
 * 带简单重试的 fetch
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            // 对 429 或 5xx 进行重试
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
 * 搜索 Docker Hub 镜像（单次请求，带重试和详细日志）
 */
export async function searchDockerHub(query, page = 1, perPage = 30) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    console.log(`Docker search request: ${url}`);

    try {
        const response = await fetchWithRetry(url, {
            headers: { 
                'Accept': 'application/json', 
                'User-Agent': 'Mozilla/5.0 (compatible; B2-Mirror-Worker/1.0; +https://yourdomain.com)' 
            }
        });

        console.log(`Docker API response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Docker Hub API error ${response.status}: ${errorText.substring(0, 200)}`);
            return { items: [], total: 0 };
        }

        const data = await response.json();
        console.log(`Docker API data count: ${data.count}, results length: ${data.results?.length}`);

        if (!data.results || !Array.isArray(data.results)) {
            console.warn('Docker API response missing results array:', data);
            return { items: [], total: 0 };
        }

        const items = data.results.map(item => {
            // 记录第一个项目以验证字段
            if (data.results.indexOf(item) === 0) {
                console.log('First raw item:', JSON.stringify(item));
            }
            return {
                name: item.repo_name,
                description: item.short_description || '暂无描述',
                stars: item.star_count || 0,
                pulls: item.pull_count || 0,
                // 注意：Docker 搜索 API 不返回 last_updated，这里使用当前日期
                lastUpdate: new Date().toISOString().split('T')[0],
                homepage: `https://hub.docker.com/r/${item.repo_name}`,
                type: 'docker',
                owner: item.repo_name.split('/')[0],
                repo: item.repo_name.split('/')[1] || item.repo_name,
                has_releases: false
            };
        });

        console.log(`Mapped items count: ${items.length}`);
        if (items.length > 0) {
            console.log('First mapped item:', JSON.stringify(items[0]));
        }

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
