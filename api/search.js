// api/search.js
import { searchGitHub } from '../lib/github.js';
import { searchDockerHub } from '../lib/docker.js';

export async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const type = url.searchParams.get('type') || 'github';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const perPage = 30; // 提高每页数量，减少分页请求
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
  }
  try {
    let result;
    if (type === 'github') {
      result = await searchGitHub(query, page, perPage, env);
    } else {
      result = await searchDockerHub(query, page, perPage, env);
    }
    return Response.json({
      items: result.items,
      total: result.total,
      page,
      perPage,
      logs: result.logs || []
    });
  } catch (error) {
    const errorLogs = [`Search API crashed: ${error.message}`];
    // In case of a crash, return the logs we have, if any exist on the result object
    const resultLogs = error.result ? error.result.logs : [];
    return new Response(JSON.stringify({ error: error.message, items: [], total: 0, logs: [...errorLogs, ...resultLogs] }), { status: 500 });
  }
}