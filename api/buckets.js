// api/buckets.js
import { ensureBucketsTable } from '../lib/d1.js';

export async function handleBuckets(request, env) {
    await ensureBucketsTable(env);
    const method = request.method;

    if (method === 'GET') {
        const { results } = await env.DB.prepare("SELECT * FROM buckets").all();
        const buckets = results.map(row => ({
            id: row.id,
            customName: row.custom_name,
            keyID: row.key_id,
            applicationKey: row.application_key,
            bucketName: row.bucket_name,
            endpoint: row.endpoint,
            snippetId: row.snippet_id,
            usage: row.usage,
            total: row.total
        }));
        return Response.json(buckets);
    } else if (method === 'POST') {
        const newBuckets = await request.json();
        // 简单处理：清空表后重新插入（适合小数据量）
        await env.DB.prepare("DELETE FROM buckets").run();
        for (const b of newBuckets) {
            await env.DB.prepare(`
                INSERT INTO buckets (id, custom_name, key_id, application_key, bucket_name, endpoint, snippet_id, usage, total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                b.id,
                b.customName,
                b.keyID,
                b.applicationKey,
                b.bucketName,
                b.endpoint,
                b.snippetId || null,
                b.usage || 0,
                b.total || 10
            ).run();
        }
        return Response.json({ success: true });
    }
    return new Response('Method not allowed', { status: 405 });
}