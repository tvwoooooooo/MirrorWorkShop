// lib/docker.js

/**
 * 搜索 Docker Hub 镜像
 * @param {string} query - 搜索关键词
 * @param {number} page - 页码
 * @param {number} perPage - 每页数量
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
    const url = `https://hub.docker.com/v2/repositories?page=${page}&page_size=${perPage}&name=${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });
        if (!res.ok) {
            console.error(`Docker Hub API error ${res.status}: ${await res.text()}`);
            return { items: [], total: 0 };
        }
        const data = await res.json();
        const items = data.results.map(item => ({
            name: item.name,
            description: item.description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.namespace}/${item.name}`,
            type: 'docker',
            owner: item.namespace,
            repo: item.name,
            has_releases: item.pull_count > 0 // 简单判断，实际应检查是否有 tags
        }));

        return { items, total: data.count || 0 };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}

/**
 * 获取 Docker 镜像的 tags 列表
 * @param {string} owner - 镜像所属命名空间（用户或组织）
 * @param {string} repo - 镜像名称
 * @returns {Promise<Array<{name: string, last_updated: string, digest: string, size: number}>>}
 */
export async function getDockerTags(owner, repo) {
    const url = `https://hub.docker.com/v2/repositories/${owner}/${repo}/tags?page_size=100`;
    try {
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });
        if (!res.ok) {
            console.error(`Docker tags API error ${res.status}: ${await res.text()}`);
            return [];
        }
        const data = await res.json();
        return data.results.map(tag => ({
            name: tag.name,
            last_updated: tag.last_updated ? tag.last_updated.split('T')[0] : '未知',
            digest: tag.digest || '',
            size: tag.images?.[0]?.size || 0
        }));
    } catch (error) {
        console.error('Get Docker tags error:', error);
        return [];
    }
}
