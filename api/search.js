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
    let result;
    if (type === 'github') {
      result = await searchGitHub(query, page, perPage, env);
    } else {
      result = await searchDockerHub(query, page, 30);
    }
    
    // 返回结果时带上 _debug 字段（如果有）
    return Response.json({
      items: result.items || [],
      total: result.total || 0,
      page,
      perPage: type === 'github' ? perPage : 30,
      _debug: result._debug || null
    });
  } catch (error) {
    console.error('Search API error:', error);
    return new Response(JSON.stringify({ 
      error: error.message, 
      items: [], 
      total: 0,
      _debug: { exception: error.message }
    }), { status: 500 });
  }
}
