// lib/docker.js
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 搜索 Docker Hub 镜像，返回带调试信息的对象
 */
export async function searchDockerHub(query, page = 1, perPage = 30) {
    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    
    // 准备调试对象
    const debug = {
        requestUrl: url,
        requestHeaders: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' },
        responseStatus: null,
        responseHeaders: null,
        responseText: null,
        parseError: null
    };

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
        });

        debug.responseStatus = response.status;
        // 获取部分响应头（避免过大）
        const headers = {};
        response.headers.forEach((value, key) => {
            if (key.toLowerCase().includes('content') || key.toLowerCase().includes('rate')) {
                headers[key] = value;
            }
        });
        debug.responseHeaders = headers;

        if (!response.ok) {
            const errorText = await response.text();
            debug.responseText = errorText.substring(0, 500); // 取前500字符
            return { items: [], total: 0, _debug: debug };
        }

        const responseText = await response.text(); // 先取文本，便于调试
        debug.responseText = responseText.substring(0, 500);
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            debug.parseError = e.message;
            return { items: [], total: 0, _debug: debug };
        }

        if (!data.results || !Array.isArray(data.results)) {
            debug.parseError = 'Missing results array';
            return { items: [], total: 0, _debug: debug };
        }

        const items = data.results.map(item => ({
            name: item.repo_name,
            description: item.short_description || '暂无描述',
            stars: item.star_count || 0,
            pulls: item.pull_count || 0,
            lastUpdate: new Date().toISOString().split('T')[0],
            homepage: `https://hub.docker.com/r/${item.repo_name}`,
            type: 'docker',
            owner: item.repo_name.split('/')[0],
            repo: item.repo_name.split('/')[1] || item.repo_name,
            has_releases: false
        }));

        return { items, total: data.count || 0, _debug: debug };
    } catch (error) {
        debug.error = error.message;
        return { items: [], total: 0, _debug: debug };
    }
}
