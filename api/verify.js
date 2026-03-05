// api/verify.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from '../lib/b2.js';

export async function handleVerify(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { keyID, applicationKey, bucketName, endpoint } = await request.json();

    if (!keyID || !applicationKey || !bucketName || !endpoint) {
      return Response.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const client = new AwsClient({
      accesskeyID: keyID,
      secretAccessKey: applicationKey,
      service: 's3',
      region: extractRegionFromEndpoint(endpoint)
    });

    const listUrl = `https://${bucketName}.${endpoint}/?max-keys=1`;
    const signed = await client.sign(listUrl, { method: 'GET' });

    const res = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers
    });

    if (res.ok) {
      return Response.json({ success: true, message: '连接成功' });
    } else {
      const errorText = await res.text();
      return Response.json({
        success: false,
        error: `连接失败 (HTTP ${res.status}): ${errorText.substring(0, 200)}`
      });
    }
  } catch (error) {
    console.error('Verify bucket error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}