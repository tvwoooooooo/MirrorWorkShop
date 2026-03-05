// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { getJSON } from './kv.js';
import { updateMasterTaskProgress, completeMasterTask } from './taskManager.js';

async function getB2Client(bucketId, env) {
    const buckets = await getJSON(env.B2_KV, 'buckets');
    const bucket = buckets.find(b => b.id === bucketId);
    if (!bucket) throw new Error('Bucket not found');
    const { keyID, applicationKey, bucketName, endpoint } = bucket;
    if (!keyID || !applicationKey || !bucketName || !endpoint) {
        throw new Error('Bucket missing required fields (keyID, applicationKey, bucketName, endpoint)');
    }
    const client = new AwsClient({
        accesskeyID: keyID,
        secretAccessKey: applicationKey,
        service: 's3',
        region: extractRegionFromEndpoint(endpoint)
    });
    return { client, bucket };
}

async function uploadFile(b2Client, bucket, key, body, contentLength) {
    const url = `https://${bucket.bucketName}.${bucket.endpoint}/${key}`;
    const signed = await b2Client.sign(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': contentLength,
            'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
        },
        body: body,
    });
    const res = await fetch(signed.url, {
        method: 'PUT',
        headers: signed.headers,
        body: body,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Upload failed (${res.status}): ${errorText.substring(0, 200)}`);
    }
}

export async function processBatch(batchTask, env) {
    const { masterTaskId, bucketId, owner, repo, files, batchIndex, totalBatches } = batchTask;
    const date = new Date().toISOString().split('T')[0];
    const { client, bucket } = await getB2Client(bucketId, env);

    let successCount = 0;
    const failedFiles = [];

    for (const fileItem of files) {
        try {
            let downloadUrl, b2Path;
            let isRelease = typeof fileItem === 'object';

            if (isRelease) {
                // 这是一个release资产对象
                downloadUrl = fileItem.url;
                b2Path = fileItem.path; // 已经包含完整路径
            } else {
                // 普通文件路径
                downloadUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${fileItem}`;
                b2Path = `${owner}/${repo}/${date}/${fileItem}`;
            }

            const rawRes = await fetch(downloadUrl, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' },
            });
            if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);

            let body, length;
            const contentLength = rawRes.headers.get('content-length');
            if (contentLength) {
                body = rawRes.body;
                length = parseInt(contentLength, 10);
            } else {
                const buffer = await rawRes.arrayBuffer();
                body = buffer;
                length = buffer.byteLength;
            }

            await uploadFile(client, bucket, b2Path, body, length);
            successCount++;
        } catch (err) {
            console.error(`Failed to process ${typeof fileItem === 'object' ? fileItem.url : fileItem}:`, err);
            failedFiles.push({ path: typeof fileItem === 'object' ? fileItem.path : fileItem, error: err.message });
        }
    }

    // 获取当前主任务
    const masterKey = `master:${masterTaskId}`;
    const master = await env.B2_KV.get(masterKey, 'json') || {};
    
    const completedBatches = master.completedBatches || [];
    if (!completedBatches.includes(batchIndex)) {
        completedBatches.push(batchIndex);
    }
    const newProcessedFiles = (master.processedFiles || 0) + successCount;
    const newFailedFiles = (master.failedFiles || []).concat(failedFiles);

    // 更新主任务
    await updateMasterTaskProgress(env, masterTaskId, {
        completedBatches,
        processedFiles: newProcessedFiles,
        failedFiles: newFailedFiles,
        status: 'processing'
    });

    // 检查是否所有批次完成
    const updatedMaster = await env.B2_KV.get(masterKey, 'json');
    if (updatedMaster && updatedMaster.completedBatches.length === updatedMaster.totalBatches) {
        const finalStatus = updatedMaster.failedFiles && updatedMaster.failedFiles.length > 0 ? 'completed_with_errors' : 'completed';
        await completeMasterTask(env, masterTaskId, finalStatus, updatedMaster.failedFiles);
    }
}
