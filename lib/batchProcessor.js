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
 * @param {Object} b2Client - AWS客户端
 * @param {Object} bucket - 桶信息 { bucketName, endpoint }
 * @param {string} key - 对象键（原始文件名，不编码）
 * @param {ReadableStream} body - 文件流
 * @param {number} contentLength - 文件大小
 */
export async function uploadFile(b2Client, bucket, key, body, contentLength) {
    // 对 key 进行 URL 编码（保留路径分隔符）
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const url = `https://${bucket.bucketName}.${bucket.endpoint}/${encodedKey}`;
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
            // 处理子请求超限错误
            if (res.status === 429 || res.status === 503) {
                const wait = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * 获取文件大小，优先 HEAD，失败则尝试 GET 带 Range
 */
async function getFileSize(url) {
    // 尝试 HEAD
    const headRes = await fetchWithRetry(url, { method: 'HEAD' });
    if (headRes.ok) {
        const length = headRes.headers.get('content-length');
        if (length) return parseInt(length, 10);
    }
    // HEAD 失败或无长度，尝试 GET（只获取头信息）
    const getRes = await fetchWithRetry(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
    if (getRes.ok) {
        const length = getRes.headers.get('content-length') || getRes.headers.get('content-range')?.split('/')[1];
        if (length) return parseInt(length, 10);
    }
    throw new Error('Unable to determine file size');
}

/**
 * 检查所有批次是否完成，若完成则标记主任务为完成
 */
async function checkAllBatchesCompleted(env, masterTaskId) {
    const master = await getMasterTask(env, masterTaskId);
    if (!master) return;
    
    const allFileBatchesDone = (master.completedFileBatches?.length || 0) === (master.totalFileBatches || 0);
    const allAssetBatchesDone = (master.completedAssetBatches?.length || 0) === (master.totalAssetBatches || 0);
    
    if (allFileBatchesDone && allAssetBatchesDone) {
        const finalStatus = (master.failedFiles?.length > 0 || master.failedAssets?.length > 0) 
            ? 'completed_with_errors' 
            : 'completed';
        await completeMasterTask(env, masterTaskId, finalStatus, master.failedFiles, master.failedAssets);
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
            // 对 URL 中的路径进行编码，但存储的 key 使用原始路径（保留空格等）
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`;
            
            // 获取文件大小
            const length = await getFileSize(rawUrl);

            // 下载文件（流式）
            const rawRes = await fetchWithRetry(rawUrl, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' },
            });
            if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);

            // 使用原始文件路径作为 B2 的 key（不编码）
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

    // 检查所有批次是否完成
    await checkAllBatchesCompleted(env, masterTaskId);
}

/**
 * 处理单个资产文件（带重试）
 */
export async function processAsset(assetTask, env) {
    const { masterTaskId, bucketId, owner, repo, asset, batchIndex, totalBatches } = assetTask;
    const date = new Date().toISOString().split('T')[0];
    
    const { client, bucket } = await getB2Client(bucketId, env);
    
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // 获取资产文件大小
            let length = asset.size;
            if (!length) {
                length = await getFileSize(asset.url);
            }

            const assetRes = await fetchWithRetry(asset.url, {
                headers: { 'User-Agent': 'B2-Mirror-Worker' }
            });
            if (!assetRes.ok) throw new Error(`Asset download failed: ${assetRes.status}`);

            // 存储路径使用原始文件名
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

            // 检查所有批次是否完成
            await checkAllBatchesCompleted(env, masterTaskId);
            
            return; // 成功
        } catch (err) {
            lastError = err;
            console.error(`Asset attempt ${attempt + 1} failed for ${asset.name}:`, err);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
            }
        }
    }

    // 所有重试失败，记录失败资产
    const masterKey = `master:${masterTaskId}`;
    const master = await env.B2_KV.get(masterKey, 'json') || {};
    const failedAssets = master.failedAssets || [];
    failedAssets.push({ name: asset.name, url: asset.url, error: lastError.message });
    await updateMasterTaskProgress(env, masterTaskId, { failedAssets });
    
    // 仍然检查批次完成（可能所有资产都失败，但批次计数可能已完成）
    await checkAllBatchesCompleted(env, masterTaskId);
    
    throw lastError;
}
