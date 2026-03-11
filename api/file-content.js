// api/file-content.js
import { getB2Client } from '../lib/batchProcessor.js';

export async function handleFileContent(request, env) {
    const url = new URL(request.url);
    const path = url.searchParams.get('path'); // B2 中的文件路径，如 "github/owner/repo/date/README.md"
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

        const contentType = res.headers.get('content-type') || 'text/plain';
        const content = await res.text();

        return new Response(content, {
            headers: { 'Content-Type': contentType }
        });
    } catch (error) {
        console.error('File content API error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}