// api/tokens.js

// 处理 GitHub 令牌
export async function handleGithubTokens(request, env) {
    const method = request.method;

    if (method === 'GET') {
        const { results } = await env.DB.prepare(
            "SELECT id, name, usage_count as usageCount FROM tokens WHERE type = ?"
        ).bind('github').all();
        const safeTokens = results.map((row, index) => ({
            index,
            name: row.name,
            usageCount: row.usageCount || 0
        }));
        return Response.json(safeTokens);
    } else if (method === 'POST') {
        const { name, token } = await request.json();
        if (!name || !token) {
            return Response.json({ error: 'Name and token required' }, { status: 400 });
        }
        await env.DB.prepare(
            "INSERT INTO tokens (type, name, token, created_at) VALUES (?, ?, ?, ?)"
        ).bind('github', name, token, Date.now()).run();
        return Response.json({ success: true });
    } else if (method === 'DELETE') {
        const url = new URL(request.url);
        const index = parseInt(url.searchParams.get('index'));
        if (isNaN(index) || index < 0) {
            return Response.json({ error: 'Invalid index' }, { status: 400 });
        }
        const { results } = await env.DB.prepare(
            "SELECT id FROM tokens WHERE type = ? ORDER BY id"
        ).bind('github').all();
        if (index >= results.length) {
            return Response.json({ error: 'Index out of range' }, { status: 400 });
        }
        const id = results[index].id;
        await env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(id).run();
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}

// 处理 Docker 令牌（与 GitHub 相同，type='docker'）
export async function handleDockerTokens(request, env) {
    const method = request.method;

    if (method === 'GET') {
        const { results } = await env.DB.prepare(
            "SELECT id, name, usage_count as usageCount FROM tokens WHERE type = ?"
        ).bind('docker').all();
        const safeTokens = results.map((row, index) => ({
            index,
            name: row.name,
            usageCount: row.usageCount || 0
        }));
        return Response.json(safeTokens);
    } else if (method === 'POST') {
        const { name, token } = await request.json();
        if (!name || !token) {
            return Response.json({ error: 'Name and token required' }, { status: 400 });
        }
        await env.DB.prepare(
            "INSERT INTO tokens (type, name, token, created_at) VALUES (?, ?, ?, ?)"
        ).bind('docker', name, token, Date.now()).run();
        return Response.json({ success: true });
    } else if (method === 'DELETE') {
        const url = new URL(request.url);
        const index = parseInt(url.searchParams.get('index'));
        if (isNaN(index) || index < 0) {
            return Response.json({ error: 'Invalid index' }, { status: 400 });
        }
        const { results } = await env.DB.prepare(
            "SELECT id FROM tokens WHERE type = ? ORDER BY id"
        ).bind('docker').all();
        if (index >= results.length) {
            return Response.json({ error: 'Index out of range' }, { status: 400 });
        }
        const id = results[index].id;
        await env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(id).run();
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}
