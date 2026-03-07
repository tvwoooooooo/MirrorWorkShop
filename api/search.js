// api/search.js
import { searchGitHub } from '../lib/github.js';
import { searchDockerHub } from '../lib/docker.js';

export async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const type = url.searchParams.get('type') || 'github';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const perPage = 10;
  
  const debug = { type, query, page, perPage };

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
      const result = await searchDockerHub(query, page, 30, env);
      return Response.json({
        items: result.items || [],
        total: result.total || 0,
        page,
        perPage: 30,
        _debug: { ...debug, dockerDebug: result._dockerDebug }
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
