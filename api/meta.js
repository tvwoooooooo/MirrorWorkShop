// api/meta.js
import { getB2Client } from '../lib/batchProcessor.js';

export async function handleMeta(request, env) {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    const bucketId = url.searchParams.get('bucketId');

    if (!path || !bucketId) {
        return new Response(JSON.stringify({ error: 'Missing path or bucketId' }), { status: 400 });
    }

    try {
        const { client, bucket } = await getB2Client(bucketId, env);
        const fileUrl = `https://${bucket.bucketName}.${bucket.endpoint}/${path}`;
        const signed = await client.sign(fileUrl, { method: 'GET' });

        const res = await fetch(signed.url, {
            method: 'GET',
            headers: signed.headers
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ error: `Failed to fetch metadata: ${res.status}` }), { status: res.status });
        }

        const data = await res.json();
        return Response.json(data);
    } catch (error) {
        console.error('Meta API error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}