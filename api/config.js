// api/config.js

async function initConfigTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();
}

export async function handleConfig(request, env) {
    await initConfigTable(env);
    const method = request.method;

    if (method === 'GET') {
        // 默认配置
        const defaultConfig = {
            officialHostname: '',
            bucketHostname: '',
            monitor: { enabled: true, scope: 'all', customProjects: [], intervalDays: 1 }
        };
        const { results } = await env.DB.prepare("SELECT key, value FROM config").all();
        const config = {};
        for (const row of results) {
            config[row.key] = JSON.parse(row.value);
        }
        // 合并默认值
        const merged = { ...defaultConfig, ...config };
        return Response.json(merged);
    } else if (method === 'POST') {
        const newConfig = await request.json(); // 完整配置对象
        // 清空表后重新插入
        await env.DB.prepare("DELETE FROM config").run();
        for (const [key, value] of Object.entries(newConfig)) {
            await env.DB.prepare("INSERT INTO config (key, value) VALUES (?, ?)")
                .bind(key, JSON.stringify(value)).run();
        }
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}