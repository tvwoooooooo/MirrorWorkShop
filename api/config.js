// api/config.js
import { getJSON, putJSON, defaultConfig } from '../lib/kv.js';

export async function handleConfig(request, env) {
  const method = request.method;
  if (method === 'GET') {
    const config = await getJSON(env.B2_KV, 'config', defaultConfig);
    return Response.json(config);
  }
  if (method === 'POST') {
    const newConfig = await request.json();
    await putJSON(env.B2_KV, 'config', newConfig);
    return Response.json({ success: true });
  }
  return new Response('Method not allowed', { status: 405 });
}