// api/search.js
import { searchGitHub } from '../lib/github.js';
import { searchDockerHub } from '../lib/docker.js';

export async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const type = url.searchParams.get('type') || 'github';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const perPage = 10;
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
      // Docker 搜索：返回原始数据 + 调试信息
      const dockerResult = await searchDockerHub(query, page, 30); // 使用 30 条每页
      // 构造调试响应
      return Response.json({
        debug: true,
        query,
        page,
        perPage: 30,
        dockerResult, // 包含 items 和 total
        // 你也可以把原始 API 返回的完整数据附加上
        raw: dockerResult._raw // 如果我们在 docker.js 中保存了原始数据
      });
    }
  } catch (error) {
    console.error('Search API error:', error);
    return new Response(JSON.stringify({ error: error.message, items: [], total: 0 }), { status: 500 });
  }
}
