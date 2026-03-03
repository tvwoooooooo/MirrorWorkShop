// lib/docker.js
export async function checkDockerHasTags(repo) {
  const url = `https://hub.docker.com/v2/repositories/library/${repo}/tags/?page_size=1`;
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

export async function searchDockerHub(query, page = 1, perPage = 10) {
  const url = `https://hub.docker.com/v2/repositories/library/${encodeURIComponent(query)}/?page=${page}&page_size=${perPage}`;
  try {
    let response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (response.status === 401) {
      const authenticate = response.headers.get('www-authenticate') || '';
      const realmMatch = authenticate.match(/realm="([^"]+)"/);
      const serviceMatch = authenticate.match(/service="([^"]+)"/);
      const scopeMatch = authenticate.match(/scope="([^"]+)"/);
      if (realmMatch && serviceMatch) {
        const tokenUrl = `${realmMatch[1]}?service=${serviceMatch[1]}${scopeMatch ? '&scope=' + scopeMatch[1] : ''}`;
        const tokenRes = await fetch(tokenUrl);
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${tokenData.token}`,
              'User-Agent': 'B2-Mirror-Worker'
            }
          });
        }
      }
    }
    if (!response.ok) {
      console.error(`Docker Hub API error ${response.status}: ${await response.text()}`);
      return {
        items: [{
          name: `library/${query}`,
          description: '镜像名称',
          stars: 0,
          pulls: 0,
          lastUpdate: new Date().toISOString().split('T')[0],
          homepage: `https://hub.docker.com/_/${query}`,
          type: 'docker',
          repo: query,
          has_releases: false
        }],
        total: 1
      };
    }
    const data = await response.json();
    const results = data.results || [];
    const baseItems = results.map(item => ({
      name: `library/${item.name}`,
      description: item.description || '暂无描述',
      stars: item.star_count || 0,
      pulls: item.pull_count || 0,
      lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
      homepage: `https://hub.docker.com/_/${item.name}`,
      type: 'docker',
      repo: item.name
    }));

    const hasReleasesArray = await Promise.all(
      baseItems.map(item => checkDockerHasTags(item.repo))
    );
    const items = baseItems.map((item, idx) => ({
      ...item,
      has_releases: hasReleasesArray[idx]
    }));

    return { items, total: data.count || items.length };
  } catch (error) {
    console.error('Docker Hub search error:', error);
    return { items: [], total: 0 };
  }
}