// lib/docker.js

/**
 * 搜索 Docker Hub 仓库
 * @param {string} query 搜索关键词
 * @param {number} page 页码
 * @param {number} perPage 每页数量
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
  const url = `https://hub.docker.com/v2/repositories?name=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (!res.ok) {
      console.error(`Docker Hub search error: ${res.status} ${res.statusText}`);
      // 返回一个模拟项目，提示搜索失败
      return {
        items: [{
          name: '搜索失败',
          namespace: 'error',
          fullName: 'API 错误，请稍后重试',
          description: `HTTP ${res.status} ${res.statusText}`,
          stars: 0,
          pulls: 0,
          lastUpdate: new Date().toISOString().split('T')[0],
          homepage: '#',
          type: 'docker',
          repo: '',
          owner: '',
          has_tags: false
        }],
        total: 1
      };
    }
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      return { items: [], total: 0 };
    }
    const items = data.results.map(item => ({
      name: item.name,
      namespace: item.namespace,
      fullName: `${item.namespace}/${item.name}`,
      description: item.description || '暂无描述',
      stars: item.star_count || 0,
      pulls: item.pull_count || 0,
      lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
      homepage: `https://hub.docker.com/r/${item.namespace}/${item.name}`,
      type: 'docker',
      repo: item.name,
      owner: item.namespace,
      has_tags: false // 稍后填充
    }));

    // 异步检查每个是否有 tags
    const tagsPromises = items.map(async (item, index) => {
      try {
        const hasTags = await checkDockerHasTags(item.owner, item.repo);
        items[index].has_tags = hasTags;
      } catch (e) {
        console.warn(`Failed to check tags for ${item.fullName}:`, e);
        items[index].has_tags = false;
      }
    });
    await Promise.all(tagsPromises);

    return { items, total: data.count || items.length };
  } catch (error) {
    console.error('Docker Hub search error:', error);
    // 返回一个模拟项目，提示网络错误
    return {
      items: [{
        name: '网络错误',
        namespace: 'error',
        fullName: '搜索请求失败',
        description: error.message,
        stars: 0,
        pulls: 0,
        lastUpdate: new Date().toISOString().split('T')[0],
        homepage: '#',
        type: 'docker',
        repo: '',
        owner: '',
        has_tags: false
      }],
      total: 1
    };
  }
}

/**
 * 检查 Docker 仓库是否有 tags
 * @param {string} namespace 命名空间（用户或 library）
 * @param {string} repo 仓库名
 * @returns {Promise<boolean>}
 */
export async function checkDockerHasTags(namespace, repo) {
  if (!namespace || !repo) return false;
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags/?page_size=1`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.results && data.results.length > 0;
  } catch {
    return false;
  }
}

/**
 * 获取 Docker 仓库的 tags 列表
 * @param {string} namespace 命名空间
 * @param {string} repo 仓库名
 * @param {number} page 页码
 * @param {number} perPage 每页数量
 * @returns {Promise<Array>}
 */
export async function getDockerTags(namespace, repo, page = 1, perPage = 100) {
  if (!namespace || !repo) return [];
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags/?page=${page}&page_size=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
    const data = await res.json();
    return data.results.map(tag => ({
      name: tag.name,
      digest: tag.digest,
      size: tag.full_size,
      last_updated: tag.last_updated,
      images: tag.images // 包含架构信息
    }));
  } catch (error) {
    console.error('Get Docker tags error:', error);
    return [];
  }
}
