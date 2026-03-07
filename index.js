// index.js
import { handleAPI } from './api/apiIndex.js';
import { renderFullPage } from './templates/page.js';
import { queueHandler } from './queue.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env);
    }
    return new Response(renderFullPage(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  },
  async queue(batch, env, ctx) {
    await queueHandler(batch, env, ctx);
  }
};