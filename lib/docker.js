// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 搜索 Docker Hub 镜像（单次请求，无重试）
 */
export async function searchDockerHub(query, page = 1, perPage = 5) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    console.log(`Docker search request: ${url}`); // 添加日志

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });

        console.log(`Docker API response status: ${response.status}`); // 日志

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Docker Hub API error ${response.status}: ${errorText.substring(0, 200)}`);
            return { items: [], total: 0 };
        }

        const data = await response.json();
        console.log(`Docker API data count: ${data.count}, results length: ${data.results?.length}`); // 日志

        if (!data.results || !Array.isArray(data.results)) {
            console.warn('Docker API response missing results array:', data);
            return { items: [], total: 0 };
        }

        const items = data.results.map(item => {
            const mapped = {
                name: item.repo_name,
                description: item.short_description || '暂无描述',
                stars: item.star_count || 0,
                pulls: item.pull_count || 0,
                lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
                homepage: `https://hub.docker.com/r/${item.repo_name}`,
                type: 'docker',
                owner: item.repo_name.split('/')[0],
                repo: item.repo_name.split('/')[1] || item.repo_name,
                has_releases: false
            };
            // 可选：输出第一个映射后的对象，检查字段
            // if (items.length === 0) console.log('First mapped item:', mapped);
            return mapped;
        });

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}
