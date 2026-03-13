// api/file.js
import { getB2Client } from '../lib/batchProcessor.js';

export async function handleFile(request, env) {
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
            return new Response(JSON.stringify({ error: `Failed to fetch file: ${res.status}` }), { status: res.status });
        }

        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const body = await res.text();

        return new Response(body, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch (error) {
        console.error('File API error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}