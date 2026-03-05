// api/projects.js

async function initProjectsTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            homepage TEXT NOT NULL,
            last_update TEXT,
            versions TEXT,
            UNIQUE(type, name)
        )
    `).run();
}

export async function handleProjects(type, env) {
    await initProjectsTable(env);
    const { results } = await env.DB.prepare(
        "SELECT name, homepage, last_update, versions FROM projects WHERE type = ?"
    ).bind(type).all();
    const projects = results.map(row => ({
        name: row.name,
        homepage: row.homepage,
        lastUpdate: row.last_update,
        versions: JSON.parse(row.versions || '[]')
    }));
    return Response.json(projects);
}

export async function handleProject(request, env) {
    await initProjectsTable(env);
    const { type, name, bucketId } = await request.json();

    if (type !== 'github') {
        return Response.json({ error: '目前仅支持 GitHub 项目完整备份' }, { status: 400 });
    }

    // 验证桶是否存在（从 D1 查询）
    const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
    if (!bucket) {
        return Response.json({ error: '指定的桶不存在' }, { status: 400 });
    }

    const [owner, repo] = name.split('/');
    if (!owner || !repo) {
        return Response.json({ error: 'Invalid repository name' }, { status: 400 });
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    await env.TASKS_QUEUE.send(JSON.stringify({
        type: 'master',
        taskId,
        owner,
        repo,
        bucketId,
    }));

    // 将任务状态存入 KV（临时状态，保留使用 KV）
    await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
        status: 'queued',
        owner,
        repo,
        bucketId,
        createdAt: Date.now()
    }));

    return Response.json({ success: true, taskId, message: '完整备份任务已提交，正在处理' });
}