// api/search.js
import { searchGitHub } from '../lib/github.js';
import { searchDockerHub } from '../lib/docker.js';

export async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const type = url.searchParams.get('type') || 'github';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const perPage = 10;
  
  // 调试对象
  const debug = { type, query, page, perPage, steps: [] };

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
  }

  try {
    if (type === 'github') {
      const result = await searchGitHub(query, page, perPage, env);
      return Response.json({
        items: result.items,
        total: result.total,
        page,
        perPage
      });
    } else {
      // 1. 检查 Docker 令牌
      const tokens = await env.DB.prepare("SELECT token FROM tokens WHERE type = ? ORDER BY id").bind('docker').all();
      debug.tokensCount = tokens.results?.length || 0;
      if (tokens.results?.length > 0) {
        // 显示第一个令牌的前6位（安全）
        debug.tokenPrefix = tokens.results[0].token.substring(0, 6) + '...';
      }

      // 2. 手动测试 Docker Hub 公共 API（不带令牌）
      const testUrl = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=30`;
      debug.testUrl = testUrl;
      
      const publicRes = await fetch(testUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
      });
      debug.publicStatus = publicRes.status;
      if (!publicRes.ok) {
        const text = await publicRes.text();
        debug.publicError = text.substring(0, 200);
      } else {
        const data = await publicRes.json();
        debug.publicCount = data.count;
        debug.publicResults = data.results?.length;
      }

      // 3. 调用您的搜索函数（它会尝试令牌）
      const result = await searchDockerHub(query, page, 30, env);
      
      return Response.json({
        items: result.items || [],
        total: result.total || 0,
        page,
        perPage: 30,
        _debug: debug
      });
    }
  } catch (error) {
    console.error('Search API error:', error);
    return new Response(JSON.stringify({ 
      error: error.message, 
      items: [], 
      total: 0,
      _debug: { ...debug, exception: error.message }
    }), { status: 500 });
  }
}
