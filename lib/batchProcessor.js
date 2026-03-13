// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { updateMasterTaskProgress, completeMasterTask, getMasterTask, saveProjectToDb } from './taskManager.js';
import { fetchWithDockerAuth } from './docker.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const CHUNK_SIZE = 100 * 1024 * 1024;        // 100MB 分片
const MULTIPART_THRESHOLD = 130 * 1024 * 1024; // 130MB 以上启用分片

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
 * 普通上传文件到 B2（流式）
 */
export async function uploadFile(b2Client, bucket, key, body, contentLength) {
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
 * 分片上传工具函数
 */
async function initMultipartUpload(b2Client, bucket, key) {
    const initUrl = `https://${bucket.bucketName}.${bucket.endpoint}/${encodeURIComponent(key)}?uploads`;
    const signedInit = await b2Client.sign(initUrl, { method: 'POST' });
    const initRes = await fetch(signedInit.url, { method: 'POST', headers: signedInit.headers });
    if (!initRes.ok) {
        const errorText = await initRes.text();
        throw new Error(`Init multipart upload failed: ${errorText.substring(0, 200)}`);
    }
    const initText = await initRes.text();
    const uploadId = initText.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];
    if (!uploadId) throw new Error('Could not extract UploadId from response');
    return uploadId;
}

async function uploadPart(b2Client, bucket, key, uploadId, partNumber, data) {
    const partUrl = `https://${bucket.bucketName}.${bucket.endpoint}/${encodeURIComponent(key)}?partNumber=${partNumber}&uploadId=${uploadId}`;
    const signedPart = await b2Client.sign(partUrl, {
        method: 'PUT',
        body: data,
    });
    const partRes = await fetch(signedPart.url, {
        method: 'PUT',
        headers: signedPart.headers,
        body: data,
    });
    if (!partRes.ok) {
        const errorText = await partRes.text();
        throw new Error(`Part ${partNumber} upload failed: ${errorText.substring(0, 200)}`);
    }
    return partRes.headers.get('ETag');
}

async function completeMultipartUpload(b2Client, bucket, key, uploadId, parts) {
    const completeXml = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload>
    ${parts.map(p => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`).join('')}
</CompleteMultipartUpload>`;
    const completeUrl = `https://${bucket.bucketName}.${bucket.endpoint}/${encodeURIComponent(key)}?uploadId=${uploadId}`;
    const signedComplete = await b2Client.sign(completeUrl, {
        method: 'POST',
        body: completeXml,
        headers: { 'Content-Type': 'application/xml' }
    });
    const completeRes = await fetch(signedComplete.url, {
        method: 'POST',
        headers: signedComplete.headers,
        body: completeXml,
    });
    if (!completeRes.ok) {
        const errorText = await completeRes.text();
        throw new Error(`Complete multipart upload failed: ${errorText.substring(0, 200)}`);
    }
}

/**
 * 分片上传文件（适用于已知大小的文件，使用 Range 获取分片）
 */
async function multipartUpload(b2Client, bucket, key, fileSize, getChunkStream) {
    const uploadId = await initMultipartUpload(b2Client, bucket, key);
    const partCount = Math.ceil(fileSize / CHUNK_SIZE);
    if (partCount > 50) throw new Error('Too many parts (max 50), increase CHUNK_SIZE');

    const parts = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
        const chunkStream = await getChunkStream(start, end);
        const etag = await uploadPart(b2Client, bucket, key, uploadId, partNumber, chunkStream);
        parts.push({ ETag: etag, PartNumber: partNumber });
    }
    await completeMultipartUpload(b2Client, bucket, key, uploadId, parts);
}

/**
 * 动态分片上传（适用于无法获取文件大小的情况，流式下载并动态分片）
 * 如果文件为空，则直接普通上传空内容。
 */
async function multipartUploadUnknownSize(b2Client, bucket, key, url) {
    const response = await fetchWithRetry(url, {
        headers: { 'User-Agent': 'B2-Mirror-Worker' }
    });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const reader = response.body.getReader();
    let parts = [];
    let partNumber = 1;
    let buffer = new Uint8Array(0);
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        // 合并数据
        let newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer, 0);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        // 当缓冲区大小达到分片大小时，上传一个分片
        while (buffer.length >= CHUNK_SIZE) {
            const chunk = buffer.slice(0, CHUNK_SIZE);
            buffer = buffer.slice(CHUNK_SIZE);
            const etag = await uploadPart(b2Client, bucket, key, uploadId, partNumber, chunk);
            parts.push({ ETag: etag, PartNumber: partNumber });
            partNumber++;
        }
    }
    // 如果没有任何数据（空文件），直接普通上传
    if (totalBytes === 0) {
        // 创建一个空流
        const emptyStream = new ReadableStream({
            start(controller) {
                controller.close();
            }
        });
        await uploadFile(b2Client, bucket, key, emptyStream, 0);
        return;
    }
    // 最后剩余部分
    if (buffer.length > 0) {
        const etag = await uploadPart(b2Client, bucket, key, uploadId, partNumber, buffer);
        parts.push({ ETag: etag, PartNumber: partNumber });
    }
    await completeMultipartUpload(b2Client, bucket, key, uploadId, parts);
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
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
        
        // 任务完成，保存项目信息到 projects 表（仅限 GitHub 项目）
        if (master.owner !== 'docker') {
            try {
                await saveProjectToDb(env, master);
            } catch (e) {
                console.error(`[checkAllBatchesCompleted] Failed to save project metadata for task ${masterTaskId}:`, e);
                // 即使保存失败，任务状态已经是完成，不影响
            }
        }
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
    const batchFileSizes = {}; // 记录本批次成功文件的大小
    const batchFileDates = {}; // 记录本批次成功文件的最后修改日期

    for (const filePath of files) {
        try {
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`;
            
            let length, body, lastModified = null;
            try {
                length = await getFileSize(rawUrl);
                // 获取文件流
                const rawRes = await fetchWithRetry(rawUrl, {
                    headers: { 'User-Agent': 'B2-Mirror-Worker' },
                });
                if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);
                lastModified = rawRes.headers.get('last-modified');
                body = rawRes.body;
            } catch (sizeErr) {
                // 无法获取大小，尝试动态分片上传
                console.warn(`File ${filePath} size unknown, using dynamic multipart upload.`);
                const b2Path = `${owner}/${repo}/${date}/${filePath}`;
                await multipartUploadUnknownSize(client, bucket, b2Path, rawUrl);
                successCount++;
                // 动态分片上传无法直接获取大小和日期，暂时记录为0和null
                batchFileSizes[filePath] = 0;
                batchFileDates[filePath] = null;
                continue;
            }

            const b2Path = `${owner}/${repo}/${date}/${filePath}`;
            await uploadFile(client, bucket, b2Path, body, length);
            successCount++;
            // 记录文件大小和日期
            batchFileSizes[filePath] = length;
            batchFileDates[filePath] = lastModified;
        } catch (err) {
            console.error(`Failed to process ${filePath}:`, err);
            failedFiles.push({ path: filePath, error: err.message });
        }
    }

    // 获取当前 master 任务，更新 metadata 中的 fileSizes 和 fileDates
    const master = await getMasterTask(env, masterTaskId) || {};
    const metadata = master.metadata || { files: [], assets: [], fileSizes: {}, assetSizes: {}, fileDates: {} };
    
    // 合并本批次的大小和日期信息
    Object.assign(metadata.fileSizes, batchFileSizes);
    Object.assign(metadata.fileDates, batchFileDates);
    
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
        metadata: metadata,
        status: 'processing'
    });

    await checkAllBatchesCompleted(env, masterTaskId);
}

/**
 * 处理单个资产文件（带重试，大文件启用分片）
 */
export async function processAsset(assetTask, env) {
    const { masterTaskId, bucketId, owner, repo, asset, batchIndex, totalBatches } = assetTask;
    
    const { client, bucket } = await getB2Client(bucketId, env);
    
    let lastError;
    let fileSize = asset.size || 0;
    const b2Path = `${owner}/${repo}/releases/${asset.name}`;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            let length;
            if (fileSize === 0) {
                length = await getFileSize(asset.url);
                fileSize = length;
            } else {
                length = fileSize;
            }

            if (length < MULTIPART_THRESHOLD) {
                const assetRes = await fetchWithRetry(asset.url, {
                    headers: { 'User-Agent': 'B2-Mirror-Worker' }
                });
                if (!assetRes.ok) throw new Error(`Asset download failed: ${assetRes.status}`);
                await uploadFile(client, bucket, b2Path, assetRes.body, length);
            } else {
                await multipartUpload(client, bucket, b2Path, length, async (start, end) => {
                    const rangeRes = await fetchWithRetry(asset.url, {
                        headers: {
                            'User-Agent': 'B2-Mirror-Worker',
                            'Range': `bytes=${start}-${end}`
                        }
                    });
                    if (!rangeRes.ok) throw new Error(`Range request failed: ${rangeRes.status}`);
                    return rangeRes.body;
                });
            }

            // 成功，更新主任务进度和资产大小
            const master = await getMasterTask(env, masterTaskId) || {};
            const metadata = master.metadata || { files: [], assets: [], fileSizes: {}, assetSizes: {}, fileDates: {} };
            metadata.assetSizes[asset.url] = length;
            
            const processedAssets = (master.processedAssets || 0) + 1;
            const completedAssetBatches = master.completedAssetBatches || [];
            if (!completedAssetBatches.includes(batchIndex)) {
                completedAssetBatches.push(batchIndex);
            }

            await updateMasterTaskProgress(env, masterTaskId, {
                processedAssets,
                completedAssetBatches,
                metadata: metadata,
            });

            await checkAllBatchesCompleted(env, masterTaskId);
            return;
        } catch (err) {
            lastError = err;
            console.error(`Asset attempt ${attempt + 1} failed for ${asset.name}:`, err);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
            }
        }
    }

    // 所有重试失败，记录失败资产
    const master = await getMasterTask(env, masterTaskId) || {};
    const failedAssets = master.failedAssets || [];
    failedAssets.push({ name: asset.name, url: asset.url, error: lastError.message });
    
    const completedAssetBatches = master.completedAssetBatches || [];
    if (!completedAssetBatches.includes(batchIndex)) {
        completedAssetBatches.push(batchIndex);
    }
    
    await updateMasterTaskProgress(env, masterTaskId, {
        failedAssets,
        completedAssetBatches,
    });

    await checkAllBatchesCompleted(env, masterTaskId);
    console.error(`Asset ${asset.name} permanently failed after ${MAX_RETRIES} attempts.`);
}

// ==================== Docker 相关函数 ====================

/**
 * 处理 Docker 层（blob）下载并上传到 B2
 */
export async function processDockerLayer(layerTask, env) {
  const { masterTaskId, repo, bucketId, digest, size, batchIndex, totalBatches } = layerTask;
  const { client, bucket } = await getB2Client(bucketId, env);

  try {
    // 构建 blob 下载 URL
    const blobUrl = `https://registry-1.docker.io/v2/${repo}/blobs/${digest}`;
    
    // 使用带认证的 fetch 获取 blob
    const response = await fetchWithDockerAuth(blobUrl, env);
    if (!response.ok) {
      throw new Error(`Failed to download blob: ${response.status}`);
    }

    // 获取内容长度
    const contentLength = size || response.headers.get('content-length');
    if (!contentLength) {
      throw new Error('Missing content-length for blob');
    }

    // B2 路径：例如 docker/library/nginx/blobs/sha256:xxx
    const b2Path = `docker/${repo}/blobs/${digest.replace(':', '/')}`;

    // 上传（流式）
    await uploadFile(client, bucket, b2Path, response.body, parseInt(contentLength));

    // 更新主任务进度（Docker 层可能不需要记录大小到 metadata，因为已有 digest 关联）
    const master = await getMasterTask(env, masterTaskId) || {};
    const processedAssets = (master.processedAssets || 0) + 1;
    const completedAssetBatches = master.completedAssetBatches || [];
    if (!completedAssetBatches.includes(batchIndex)) {
      completedAssetBatches.push(batchIndex);
    }

    await updateMasterTaskProgress(env, masterTaskId, {
      processedAssets,
      completedAssetBatches,
    });

    await checkAllBatchesCompleted(env, masterTaskId);
  } catch (error) {
    console.error(`Docker layer ${digest} failed:`, error);
    const master = await getMasterTask(env, masterTaskId) || {};
    const failedAssets = master.failedAssets || [];
    failedAssets.push({ digest, error: error.message });
    const completedAssetBatches = master.completedAssetBatches || [];
    if (!completedAssetBatches.includes(batchIndex)) {
      completedAssetBatches.push(batchIndex);
    }
    await updateMasterTaskProgress(env, masterTaskId, {
      failedAssets,
      completedAssetBatches,
    });
    await checkAllBatchesCompleted(env, masterTaskId);
    throw error; // 让队列重试
  }
}