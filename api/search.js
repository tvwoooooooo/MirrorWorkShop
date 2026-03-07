// api/search.js
import { searchGitHub } from '../lib/github.js';
import { searchDockerHub } from '../lib/docker.js';

export async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const type = url.searchParams.get('type') || 'github';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const perPage = 10; // GitHub 每页 10 条
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
  }
  try {
    let result;
    if (type === 'github') {
      result = await searchGitHub(query, page, perPage, env);
    } else {
      // Docker 搜索，使用 30 条每页
      result = await searchDockerHub(query, page, 30);
    }
    // 返回标准结构，附加调试信息（可选）
    return Response.json({
      items: result.items,
      total: result.total,
      page,
      perPage: type === 'github' ? perPage : 30,
      _debug: { // 调试信息，前端不会使用
        query,
        type,
        rawResult: result
      }
    });
  } catch (error) {
    console.error('Search API error:', error);
    return new Response(JSON.stringify({ error: error.message, items: [], total: 0 }), { status: 500 });
  }
}
