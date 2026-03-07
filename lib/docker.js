// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

// 带超时和重试的 fetch
async function fetchWithTimeout(url, options, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

// 带重试的 fetch，最多重试2次，延迟1秒
async function fetchWithRetry(url, options, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetchWithTimeout(url, options, 5000);
            if (res.status === 429 || res.status >= 500) {
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
            }
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// 简单的并发控制，限制同时执行数量为2
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

/**
 * 检查镜像是否有 tags（超时2秒，失败返回false）
 */
export async function checkDockerHasTags(repo) {
  const url = `${DOCKER_HUB_API}/repositories/${repo}/tags/?page_size=1`;
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    }, 2);
    if (!res.ok) return false;
    const data = await res.json();
    return data.results && data.results.length > 0;
  } catch (err) {
    console.warn(`checkDockerHasTags failed for ${repo}:`, err.message);
    return false;
  }
}

/**
 * 搜索 Docker Hub 镜像
 */
export async function searchDockerHub(query, page = 1, perPage = 10) {
  // 限制每页结果数，避免过多并发
  const limitedPerPage = Math.min(perPage, 8);
  const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${limitedPerPage}`;
  try {
    const response = await fetchWithRetry(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    }, 2);

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

    // 并发控制，最多同时2个 tags 检查
    const hasReleasesArray = await mapConcurrent(items, 2, async (item) => {
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
