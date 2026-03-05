// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { updateMasterTaskProgress, completeMasterTask } from './taskManager.js';

/**
 * 从 D1 获取桶配置
 */
async function getB2Client(bucketId, env) {
    // 查询 buckets 表（字段名与创建时一致）
    const bucket = await env.DB.prepare(
        "SELECT key_id, application_key, bucket_name, endpoint FROM buckets WHERE id = ?"
    ).bind(bucketId).first();

    if (!bucket) throw new Error(`Bucket not found: ${bucketId}`);
    
    const { key_id, application_key, bucket_name, endpoint } = bucket;
    if (!key_id || !application_key || !bucket_name || !endpoint) {
        throw new Error('Bucket missing required fields (key_id, application_key, bucket_name, endpoint)');
    }

    const client = new AwsClient({
        accesskeyID: key_id,
        secretAccessKey: application_key,
        service: 's3',
        region: extractRegionFromEndpoint(endpoint)
    });

    return { client, bucket: { bucketName: bucket_name, endpoint } };
}

/**
 * 上传单个文件到 B2
 */
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

/**
 * 处理一个批次任务
 */
export async function processBatch(batchTask, env) {
    const { masterTaskId, bucketId, owner, repo, files, batchIndex, totalBatches } = batchTask;
    const date = new Date().toISOString().split('T')[0];

    // 获取 B2 客户端和桶信息（从 D1）
    let client, bucket;
    try {
        const result = await getB2Client(bucketId, env);
        client = result.client;
        bucket = result.bucket;
    } catch (err) {
        console.error(`Failed to get B2 client for bucket ${bucketId}:`, err);
        // 如果无法获取桶，整个批次失败，需要更新主任务状态为失败
        await updateMasterTaskProgress(env, masterTaskId, {
            status: 'failed',
            error: `Bucket error: ${err.message}`
        });
        await completeMasterTask(env, masterTaskId, 'failed', []);
        throw err; // 让队列重试
    }

    let successCount = 0;
    const failedFiles = [];

    for (const filePath of files) {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`;
            const rawRes = await fetch(rawUrl, {
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

            const b2Path = `${owner}/${repo}/${date}/${filePath}`;
            await uploadFile(client, bucket, b2Path, body, length);
            successCount++;
        } catch (err) {
            console.error(`Failed to process ${filePath}:`, err);
            failedFiles.push({ path: filePath, error: err.message });
        }
    }

    // 获取当前主任务（从 KV 读取，任务状态仍保留在 KV）
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
