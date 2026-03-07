// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 搜索 Docker Hub 镜像（单次请求，无重试，返回标准 items 结构）
 */
export async function searchDockerHub(query, page = 1, perPage = 30) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    console.log(`Docker search request: ${url}`); // 日志输出到 Workers

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
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

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: new Date().toISOString().split('T')[0], // 搜索 API 不返回更新时间，用当前日期
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
            has_releases: false // 暂不检查 tags
        }));

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
