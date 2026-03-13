// api/config.js
import { ensureConfigTable } from '../lib/d1.js';

export async function handleConfig(request, env) {
    await ensureConfigTable(env);
    const method = request.method;

    if (method === 'GET') {
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
        const merged = { ...defaultConfig, ...config };
        return Response.json(merged);
    } else if (method === 'POST') {
        const newConfig = await request.json();
        await env.DB.prepare("DELETE FROM config").run();
        for (const [key, value] of Object.entries(newConfig)) {
            await env.DB.prepare("INSERT INTO config (key, value) VALUES (?, ?)")
                .bind(key, JSON.stringify(value)).run();
        }
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}