// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { updateMasterTaskProgress, completeMasterTask, getMasterTask } from './taskManager.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

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
    const url = `https://${bucket.bucketName}.${bucket.endpoint}/${encodeURI(key)}`;
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
 * 带重试的 fetch
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * 获取文件大小，优先 HEAD，失败则 GET
 */
async function getFileSize(url) {
    const headRes = await fetchWithRetry(url, { method: 'HEAD' });
    if (headRes.ok) {
        const length = headRes.headers.get('content-length');
        if (length) return parseInt(length, 10);
    }
    const getRes = await fetchWithRetry(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
    if (getRes.ok) {
        const length = getRes.headers.get('content-length') || getRes.headers.get('content-range')?.split('/')[1];
        if (length) return parseInt(length, 10);
    }
    throw new Error('Unable to determine file size');
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
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`;
            const length = await getFileSize(rawUrl);
            const rawRes = await fetchWithRetry(rawUrl, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' },
            });
            if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);

            const b2Path = `${owner}/${repo}/${date}/${encodedPath}`;
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
 * 处理单个资产文件（带重试）
 */
export async function processAsset(assetTask, env) {
    const { masterTaskId, bucketId, owner, repo, asset, batchIndex, totalBatches } = assetTask;
    const date = new Date().toISOString().split('T')[0];
    
    const { client, bucket } = await getB2Client(bucketId, env);
    
    let lastError;
    let success = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            let length = asset.size;
            if (!length) {
                length = await getFileSize(asset.url);
            }

            const assetRes = await fetchWithRetry(asset.url, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' }
            });
            if (!assetRes.ok) throw new Error(`Asset download failed: ${assetRes.status}`);

            const b2Path = `${owner}/${repo}/releases/${encodeURIComponent(asset.name)}`;
            await uploadFile(client, bucket, b2Path, assetRes.body, length);

            success = true;
            break;
        } catch (err) {
            lastError = err;
            console.error(`Asset attempt ${attempt + 1} failed for ${asset.name}:`, err);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
            }
        }
    }

    const masterKey = `master:${masterTaskId}`;
    const master = await env.B2_KV.get(masterKey, 'json') || {};
    
    const completedAssetBatches = master.completedAssetBatches || [];
    if (!completedAssetBatches.includes(batchIndex)) {
        completedAssetBatches.push(batchIndex);
    }
    
    let updates = {
        completedAssetBatches: completedAssetBatches,
    };
    
    if (success) {
        const processedAssets = (master.processedAssets || 0) + 1;
        updates.processedAssets = processedAssets;
    } else {
        const failedAssets = master.failedAssets || [];
        failedAssets.push({ name: asset.name, url: asset.url, error: lastError.message });
        updates.failedAssets = failedAssets;
    }

    await updateMasterTaskProgress(env, masterTaskId, updates);

    const updatedMaster = await env.B2_KV.get(masterKey, 'json');
    if (updatedMaster) {
        const allFileBatchesDone = updatedMaster.completedFileBatches?.length === updatedMaster.totalFileBatches;
        const allAssetBatchesDone = updatedMaster.completedAssetBatches?.length === updatedMaster.totalAssetBatches;
        if (allFileBatchesDone && allAssetBatchesDone) {
            const finalStatus = (updatedMaster.failedFiles?.length > 0 || updatedMaster.failedAssets?.length > 0) ? 'completed_with_errors' : 'completed';
            await completeMasterTask(env, masterTaskId, finalStatus, updatedMaster.failedFiles, updatedMaster.failedAssets);
        }
    }

    if (!success) {
        throw lastError;
    }
}
