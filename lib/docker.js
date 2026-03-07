// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 检查镜像是否有 tags，带重试和速率限制处理
 */
async function checkDockerHasTagsWithRetry(repo, retries = 2) {
  const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
      });
      if (res.status === 429) {
        // 速率限制，等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      if (!res.ok) return false;
      const data = await res.json();
      return data.results && data.results.length > 0;
    } catch {
      // 网络错误，重试
      if (i === retries - 1) return false;
      await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  return false;
}

/**
 * 搜索 Docker Hub 镜像（全局搜索）
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
  const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });

    if (!response.ok) {
      console.error(`Docker Hub search error ${response.status}: ${await response.text()}`);
      return { items: [], total: 0 };
    }

    const data = await response.json();
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

    // 串行检查 tags，避免并发过多导致 429
    const itemsWithReleases = [];
    for (const item of items) {
      const has = await checkDockerHasTagsWithRetry(item.name);
      itemsWithReleases.push({ ...item, has_releases: has });
    }

    return { items: itemsWithReleases, total: data.count || 0 };
  } catch (error) {
    console.error('Docker Hub search error:', error);
    return { items: [], total: 0 };
  }
}
