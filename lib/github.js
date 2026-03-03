// lib/github.js
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
        const reset = res.headers.get('X-RateLimit-Reset');
        const waitTime = reset ? (parseInt(reset) * 1000 - Date.now()) : 60000;
        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

export async function checkGitHubHasReleases(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`;
  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'B2-Mirror-Worker'
      }
    });
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function searchGitHub(query, page = 1, perPage = 10) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'B2-Mirror-Worker'
      }
    });
    const data = await response.json();
    const baseItems = data.items.map(item => ({
      name: item.full_name,
      description: item.description || '暂无描述',
      stars: item.stargazers_count,
      forks: item.forks_count,
      lastUpdate: item.pushed_at ? item.pushed_at.split('T')[0] : (item.updated_at ? item.updated_at.split('T')[0] : '未知'),
      homepage: item.html_url,
      type: 'github',
      owner: item.owner.login,
      repo: item.name
    }));

    const hasReleasesArray = await Promise.all(
      baseItems.map(item => checkGitHubHasReleases(item.owner, item.repo))
    );
    const items = baseItems.map((item, idx) => ({
      ...item,
      has_releases: hasReleasesArray[idx]
    }));

    return { items, total: data.total_count };
  } catch (error) {
    console.error('GitHub search error:', error);
    return { items: [], total: 0 };
  }
}