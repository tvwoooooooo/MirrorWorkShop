// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 检查镜像是否有 tags（原版本，保持对外接口不变）
 */
export async function checkDockerHasTags(repo) {
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
 * 带重试的 tags 检查（内部使用）
 */
async function checkTagsWithRetry(repo, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
      });

      if (!res.ok) {
        // 如果是 429（限流）或 5xx 错误，进行重试
        if (res.status === 429 || res.status >= 500) {
          if (attempt < retries) {
            const delay = 1000 * attempt; // 递增等待
            console.log(`Rate limit or server error for ${repo}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        return false;
      }

      const data = await res.json();
      return data.results && data.results.length > 0;
    } catch (error) {
      if (attempt === retries) {
        console.error(`Failed to check tags for ${repo} after ${retries} attempts:`, error);
        return false;
      }
      const delay = 1000 * attempt;
      console.log(`Network error for ${repo}, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

/**
 * 分批检查多个镜像的 tags（控制并发）
 */
async function batchCheckTags(repos, batchSize = 3) {
  const results = [];
  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(repo => checkTagsWithRetry(repo))
    );
    results.push(...batchResults);

    // 每批完成后等待一小段时间，避免请求过于密集
    if (i + batchSize < repos.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
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
      const errorText = await response.text();
      console.error(`Docker Hub API error ${response.status}: ${errorText}`);
      return { items: [], total: 0 };
    }

    const data = await response.json();

    // 提取关键字段
    const items = (data.results || []).map(item => ({
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

    // 分批检查每个镜像是否有 tags（控制并发，避免限流）
    const hasReleasesArray = await batchCheckTags(items.map(item => item.name), 3);
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
