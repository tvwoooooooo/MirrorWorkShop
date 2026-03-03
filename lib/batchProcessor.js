// lib/batchProcessor.js
import { AwsClient } from '../aws4fetch.js';
import { extractRegionFromEndpoint } from './b2.js';
import { getJSON } from './kv.js';
import { updateMasterTaskProgress, completeMasterTask } from './taskManager.js';

// 简单并发控制函数：限制同时执行的 promise 数量
async function asyncPool(concurrency, iterable, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of iterable) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

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
  const concurrency = 5; // 限制并发数为5，避免子请求过多

  // 使用并发池处理文件
  await asyncPool(concurrency, files, async (filePath) => {
    try {
      // 更新当前正在处理的文件（在开始处理前更新）
      await updateMasterTaskProgress(env, masterTaskId, {
        currentFile: filePath
      });

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

      // 每成功一个文件就更新一次进度
      await updateMasterTaskProgress(env, masterTaskId, {
        processedFiles: (await getCurrentProcessed(env, masterTaskId)) + 1
      });

    } catch (err) {
      console.error(`Failed to process ${filePath}:`, err);
      failedFiles.push({ path: filePath, error: err.message });
      // 失败时也更新进度（只增加失败计数，但 processedFiles 只算成功？）
      // 为了保持 processedFiles 只计成功，失败不影响 processedFiles
    }
  });

  // 获取当前主任务状态
  const masterKey = `master:${masterTaskId}`;
  const master = await env.B2_KV.get(masterKey, 'json') || {};
  const completedBatches = master.completedBatches || [];
  if (!completedBatches.includes(batchIndex)) {
    completedBatches.push(batchIndex);
  }
  const newProcessedFiles = (master.processedFiles || 0) + successCount;
  const newFailedFiles = (master.failedFiles || []).concat(failedFiles);

  await updateMasterTaskProgress(env, masterTaskId, {
    completedBatches,
    processedFiles: newProcessedFiles,
    failedFiles: newFailedFiles,
    currentFile: null
  });

  const updatedMaster = await env.B2_KV.get(masterKey, 'json');
  if (updatedMaster && updatedMaster.completedBatches.length === updatedMaster.totalBatches) {
    await completeMasterTask(env, masterTaskId, 'completed');
  }
}

async function getCurrentProcessed(env, masterTaskId) {
  const master = await env.B2_KV.get(`master:${masterTaskId}`, 'json') || {};
  return master.processedFiles || 0;
}