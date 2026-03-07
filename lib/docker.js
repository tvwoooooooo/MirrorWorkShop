// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

// 简单的并发控制函数，限制同时执行的 promise 数量
async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (concurrency <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// 带重试的 fetch，用于 Docker Hub API
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      // 如果状态码是 429 或 5xx，则重试
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

/**
 * 检查镜像是否有 tags（用于判断是否有 releases）
 */
export async function checkDockerHasTags(repo) {
  const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.results && data.results.length > 0;
  } catch (err) {
    console.warn(`checkDockerHasTags failed for ${repo}:`, err.message);
    return false; // 失败时返回 false，不阻断整个搜索
  }
}

/**
 * 搜索 Docker Hub 镜像
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
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
    console.log('Docker search response:', { query, page, count: data.count, resultsLength: data.results?.length });

    if (!data.results || !Array.isArray(data.results)) {
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

    // 使用并发控制，限制同时最多 3 个 tags 检查请求
    const hasReleasesArray = await mapConcurrent(items, 3, async (item) => {
      return await checkDockerHasTags(item.name);
    });

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
