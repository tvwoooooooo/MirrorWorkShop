// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { updateMasterTaskProgress, completeMasterTask, getMasterTask } from './taskManager.js';

/**
 * 从 D1 获取 B2 客户端
 */
export async function getB2Client(bucketId, env) {
    const bucket = await env.DB.prepare(
        "SELECT key_id, application_key, bucket_name, endpoint FROM buckets WHERE id = ?"
    ).bind(bucketId).first();

    if (!bucket) throw new Error(`Bucket not found: ${bucketId}`);
    
    const { key_id, application_key, bucket_name, endpoint } = bucket;
    const client = new AwsClient({
        accesskeyID: key_id,
        secretAccessKey: application_key,
        service: 's3',
        region: extractRegionFromEndpoint(endpoint)
    });

    return { client, bucket: { bucketName: bucket_name, endpoint } };
}

/**
 * 上传文件到 B2（流式）
 */
export async function uploadFile(b2Client, bucket, key, body, contentLength) {
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
 * 处理文件批次
 */
export async function processBatch(batchTask, env) {
    const { masterTaskId, bucketId, owner, repo, files, batchIndex, totalBatches } = batchTask;
    const date = new Date().toISOString().split('T')[0];

    const { client, bucket } = await getB2Client(bucketId, env);

    let successCount = 0;
    const failedFiles = [];

    for (const filePath of files) {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`;
            
            // 获取文件大小（先 HEAD）
            const headRes = await fetch(rawUrl, { method: 'HEAD' });
            if (!headRes.ok) throw new Error(`HEAD failed: ${headRes.status}`);
            const contentLength = headRes.headers.get('content-length');
            if (!contentLength) throw new Error('Missing Content-Length in HEAD response');
            const length = parseInt(contentLength, 10);

            const rawRes = await fetch(rawUrl, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' },
            });
            if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);

            const b2Path = `${owner}/${repo}/${date}/${filePath}`;
            await uploadFile(client, bucket, b2Path, rawRes.body, length);
            successCount++;
        } catch (err) {
            console.error(`Failed to process ${filePath}:`, err);
            failedFiles.push({ path: filePath, error: err.message });
        }
    }

    const masterKey = `master:${masterTaskId}`;
    const master = await env.B2_KV.get(masterKey, 'json') || {};
    
    const completedBatches = master.completedFileBatches || [];
    if (!completedBatches.includes(batchIndex)) {
        completedBatches.push(batchIndex);
    }
    const newProcessedFiles = (master.processedFiles || 0) + successCount;
    const newFailedFiles = (master.failedFiles || []).concat(failedFiles);

    await updateMasterTaskProgress(env, masterTaskId, {
        completedFileBatches: completedBatches,
        processedFiles: newProcessedFiles,
        failedFiles: newFailedFiles,
        status: 'processing'
    });

    const updatedMaster = await env.B2_KV.get(masterKey, 'json');
    if (updatedMaster) {
        const allFileBatchesDone = updatedMaster.completedFileBatches?.length === updatedMaster.totalFileBatches;
        const allAssetBatchesDone = updatedMaster.completedAssetBatches?.length === updatedMaster.totalAssetBatches;
        if (allFileBatchesDone && allAssetBatchesDone) {
            const finalStatus = (updatedMaster.failedFiles?.length > 0 || updatedMaster.failedAssets?.length > 0) ? 'completed_with_errors' : 'completed';
            await completeMasterTask(env, masterTaskId, finalStatus, updatedMaster.failedFiles, updatedMaster.failedAssets);
        }
    }
}

/**
 * 处理单个资产文件
 */
export async function processAsset(assetTask, env) {
    const { masterTaskId, bucketId, owner, repo, asset, batchIndex, totalBatches } = assetTask;
    const date = new Date().toISOString().split('T')[0];
    
    const { client, bucket } = await getB2Client(bucketId, env);
    
    try {
        // 获取资产文件大小（优先使用 asset.size，否则 HEAD）
        let contentLength = asset.size;
        if (!contentLength) {
            const headRes = await fetch(asset.url, { method: 'HEAD' });
            if (!headRes.ok) throw new Error(`HEAD failed: ${headRes.status}`);
            contentLength = headRes.headers.get('content-length');
            if (!contentLength) throw new Error('Missing Content-Length');
        }
        const length = parseInt(contentLength, 10);

        const assetRes = await fetch(asset.url, {
            headers: { 'User-Agent': 'B2-Mirror-Worker' }
        });
        if (!assetRes.ok) throw new Error(`Asset download failed: ${assetRes.status}`);

        // 存储路径：owner/repo/releases/asset_name
        const b2Path = `${owner}/${repo}/releases/${asset.name}`;
        await uploadFile(client, bucket, b2Path, assetRes.body, length);

        // 更新主任务进度
        const masterKey = `master:${masterTaskId}`;
        const master = await env.B2_KV.get(masterKey, 'json') || {};
        const processedAssets = (master.processedAssets || 0) + 1;
        const completedAssetBatches = master.completedAssetBatches || [];
        if (!completedAssetBatches.includes(batchIndex)) {
            completedAssetBatches.push(batchIndex);
        }

        await updateMasterTaskProgress(env, masterTaskId, {
            processedAssets,
            completedAssetBatches,
        });

        // 检查是否所有批次完成（由 processBatch 统一处理，这里只更新进度）

    } catch (err) {
        console.error(`Failed to process asset ${asset.name}:`, err);
        // 记录失败资产
        const masterKey = `master:${masterTaskId}`;
        const master = await env.B2_KV.get(masterKey, 'json') || {};
        const failedAssets = master.failedAssets || [];
        failedAssets.push({ name: asset.name, url: asset.url, error: err.message });
        await updateMasterTaskProgress(env, masterTaskId, { failedAssets });
        throw err;
    }
}
