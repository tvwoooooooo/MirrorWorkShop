// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 检查镜像是否有 tags（用于判断是否有 releases）
 */
export async function checkDockerHasTags(repo) {
  // repo 格式可能是 "library/nginx" 或 "username/repo"
  const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
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
 * 搜索 Docker Hub 镜像（全局搜索，包括官方库和用户仓库）
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
  const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });

    if (!response.ok) {
      console.error(`Docker Hub API error ${response.status}: ${await response.text()}`);
      return { items: [], total: 0 };
    }

    const data = await response.json();
    // 提取关键字段
    const items = data.results.map(item => ({
      name: item.repo_name,                // 例如 "library/alpine" 或 "username/repo"
      description: item.short_description || '暂无描述',
      stars: item.star_count || 0,
      pulls: item.pull_count || 0,
      lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
      homepage: `https://hub.docker.com/r/${item.repo_name}`,
      type: 'docker',
      // 拆分为 owner 和 repo 便于后续使用
      owner: item.repo_name.split('/')[0],
      repo: item.repo_name.split('/')[1] || item.repo_name,
    }));

    // 并行检查每个镜像是否有 tags
    const hasReleasesArray = await Promise.all(
      items.map(item => checkDockerHasTags(item.name))
    );
    const itemsWithReleases = items.map((item, idx) => ({
      ...item,
      has_releases: hasReleasesArray[idx]
    }));

    return { items: itemsWithReleases, total: data.count || 0 };
  } catch (error) {
    console.error('Docker Hub search error:', error);
    return { items: [], total: 0 };
  }
}