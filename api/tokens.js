// api/tokens.js
import { getJSON, putJSON } from '../lib/kv.js';

// 处理 GitHub 令牌
export async function handleGithubTokens(request, env) {
    const method = request.method;
    if (method === 'GET') {
        const tokens = await getJSON(env.B2_KV, 'github_tokens', []);
        // 返回时移除 token 值，只返回名称和索引
        const safeTokens = tokens.map((t, index) => ({
            index,
            name: t.name,
            usageCount: t.usageCount || 0
        }));
        return Response.json(safeTokens);
    } else if (method === 'POST') {
        const { name, token } = await request.json();
        if (!name || !token) {
            return Response.json({ error: 'Name and token required' }, { status: 400 });
        }
        const tokens = await getJSON(env.B2_KV, 'github_tokens', []);
        tokens.push({ name, token, usageCount: 0, createdAt: Date.now() });
        await putJSON(env.B2_KV, 'github_tokens', tokens);
        return Response.json({ success: true });
    } else if (method === 'DELETE') {
        const url = new URL(request.url);
        const index = parseInt(url.searchParams.get('index'));
        if (isNaN(index) || index < 0) {
            return Response.json({ error: 'Invalid index' }, { status: 400 });
        }
        const tokens = await getJSON(env.B2_KV, 'github_tokens', []);
        if (index >= tokens.length) {
            return Response.json({ error: 'Index out of range' }, { status: 400 });
        }
        tokens.splice(index, 1);
        await putJSON(env.B2_KV, 'github_tokens', tokens);
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}

// 处理 Docker 令牌（使用独立的 KV 键 docker_tokens）
export async function handleDockerTokens(request, env) {
    const method = request.method;
    if (method === 'GET') {
        const tokens = await getJSON(env.B2_KV, 'docker_tokens', []);
        // 返回时移除 token 值，只返回名称和索引
        const safeTokens = tokens.map((t, index) => ({
            index,
            name: t.name,
            usageCount: t.usageCount || 0
        }));
        return Response.json(safeTokens);
    } else if (method === 'POST') {
        const { name, token } = await request.json();
        if (!name || !token) {
            return Response.json({ error: 'Name and token required' }, { status: 400 });
        }
        const tokens = await getJSON(env.B2_KV, 'docker_tokens', []);
        tokens.push({ name, token, usageCount: 0, createdAt: Date.now() });
        await putJSON(env.B2_KV, 'docker_tokens', tokens);
        return Response.json({ success: true });
    } else if (method === 'DELETE') {
        const url = new URL(request.url);
        const index = parseInt(url.searchParams.get('index'));
        if (isNaN(index) || index < 0) {
            return Response.json({ error: 'Invalid index' }, { status: 400 });
        }
        const tokens = await getJSON(env.B2_KV, 'docker_tokens', []);
        if (index >= tokens.length) {
            return Response.json({ error: 'Index out of range' }, { status: 400 });
        }
        tokens.splice(index, 1);
        await putJSON(env.B2_KV, 'docker_tokens', tokens);
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}
