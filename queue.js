// queue.js
import { processBatch, processAsset, processDockerLayer } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/github.js';
import { createMasterTask, updateMasterTaskProgress, completeMasterTask, getMasterTask, getActiveTasks } from './lib/taskManager.js';
import { fetchWithDockerAuth } from './lib/docker.js';

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      // GitHub 主任务
      try {
        const { taskId, owner, repo, bucketId, files, assets } = task;
        const fileList = files || await getRepoFileTree(owner, repo, env);
        await createMasterTask(env, taskId, owner, repo, bucketId, fileList, assets || []);
        message.ack();
      } catch (error) {
        console.error('Master task failed:', error);
        await env.DB.prepare(`
            INSERT OR REPLACE INTO master_tasks (task_id, owner, repo, bucket_id, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(task.taskId, task.owner, task.repo, task.bucketId, 'failed', Date.now(), Date.now()).run();
        message.ack();
      }
    } else if (task.type === 'batch') {
      try {
        await processBatch(task, env);
        message.ack();
      } catch (error) {
        console.error('Batch task failed', error);
        message.retry();
      }
    } else if (task.type === 'asset') {
      try {
        await processAsset(task, env);
        message.ack();
      } catch (error) {
        console.error('Asset task failed', error);
        message.retry();
      }
    } else if (task.type === 'docker-master') {
      // Docker 主任务：解析每个 tag 的 manifest，拆分为 layer 任务
      try {
        const { taskId, repo, bucketId, tags } = task;
        // 初始化 master 任务状态
        await env.DB.prepare(`
            INSERT INTO master_tasks (task_id, owner, repo, bucket_id, total_assets, total_asset_batches, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(taskId, 'docker', repo, bucketId, 0, 0, 'processing', Date.now()).run();

        // 为每个 tag 获取 manifest 并拆分层
        for (const tag of tags) {
          // 获取 manifest
          const manifestUrl = `https://registry-1.docker.io/v2/${repo}/manifests/${tag}`;
          console.log(`[Docker-Master] Fetching manifest for ${repo}:${tag} from ${manifestUrl}`);
          const manifestResponse = await fetchWithDockerAuth(manifestUrl, env);
          if (!manifestResponse.ok) {
            const errorText = await manifestResponse.text();
            console.error(`[Docker-Master] Failed to get manifest for ${repo}:${tag}: ${manifestResponse.status} - ${errorText}`);
            throw new Error(`Failed to get manifest for ${repo}:${tag}: ${manifestResponse.status}`);
          }
          const manifest = await manifestResponse.json();
          
          // 打印 manifest 结构（调试用）
          console.log(`[Docker-Master] Manifest for ${repo}:${tag}: schemaVersion=${manifest.schemaVersion}, mediaType=${manifest.mediaType}`);
          // 可选：打印完整 manifest（小心日志过大）
          // console.log(JSON.stringify(manifest, null, 2));
          
          // 处理 manifest list 或普通 manifest
          let targetManifest = manifest;
          if (manifest.mediaType && manifest.mediaType.includes('manifest.list')) {
            console.log(`[Docker-Master] Detected manifest list for ${repo}:${tag}`);
            if (!manifest.manifests || manifest.manifests.length === 0) {
              throw new Error(`Manifest list for ${repo}:${tag} has no manifests`);
            }
            const first = manifest.manifests[0];
            console.log(`[Docker-Master] Selecting first platform: ${first.platform ? first.platform.os + '/' + first.platform.architecture : 'unknown'}`);
            const platformManifestUrl = `https://registry-1.docker.io/v2/${repo}/manifests/${first.digest}`;
            console.log(`[Docker-Master] Fetching platform manifest from ${platformManifestUrl}`);
            const platformResponse = await fetchWithDockerAuth(platformManifestUrl, env);
            if (!platformResponse.ok) {
              const errorText = await platformResponse.text();
              console.error(`[Docker-Master] Failed to get platform manifest for ${repo}:${tag}: ${platformResponse.status} - ${errorText}`);
              throw new Error(`Failed to get platform manifest for ${repo}:${tag}: ${platformResponse.status}`);
            }
            targetManifest = await platformResponse.json();
            console.log(`[Docker-Master] Platform manifest schemaVersion=${targetManifest.schemaVersion}`);
          }
          
          // 处理目标 manifest 的 layers
          await processManifestLayers(taskId, repo, bucketId, tag, targetManifest, env);
        }
        
        // 所有 tags 处理完后，检查是否有任何任务被创建
        const master = await getMasterTask(env, taskId);
        if (master.totalAssets === 0) {
          // 没有创建任何 layer 任务
          if (master.failedAssets && master.failedAssets.length > 0) {
            // 有失败记录但没有任务，标记为失败
            console.log(`[Docker-Master] No layers created and have failures, marking as failed`);
            await completeMasterTask(env, taskId, 'failed', [], master.failedAssets);
          } else {
            // 没有任何任务也没有失败（不应该发生），标记为 completed
            console.log(`[Docker-Master] No layers created and no failures, marking as completed (empty)`);
            await completeMasterTask(env, taskId, 'completed', [], []);
          }
        }
        // 如果有 layers 被创建，则由各个 layer 任务驱动完成
        message.ack();
      } catch (error) {
        console.error('[Docker-Master] Unhandled error:', error);
        await env.DB.prepare(`UPDATE master_tasks SET status = ?, failed_assets = ?, completed_at = ? WHERE task_id = ?`)
          .bind('failed', JSON.stringify([{ error: error.message }]), Date.now(), task.taskId).run();
        message.ack();
      }
    } else if (task.type === 'docker-layer') {
      try {
        await processDockerLayer(task, env);
        message.ack();
      } catch (error) {
        console.error('Docker layer task failed', error);
        message.retry();
      }
    } else {
      message.ack();
    }
  }
}

// 辅助函数：处理 manifest 的 layers，为每个 layer 创建任务
async function processManifestLayers(masterTaskId, repo, bucketId, tag, manifest, env) {
  console.log(`[processManifestLayers] Processing ${repo}:${tag}`);
  
  // 尝试获取 layers（支持不同版本的 manifest）
  let layers = [];
  if (manifest.layers && Array.isArray(manifest.layers)) {
    layers = manifest.layers;
    console.log(`[processManifestLayers] Found ${layers.length} layers via manifest.layers`);
    layers.forEach((layer, idx) => {
      console.log(`[processManifestLayers] Layer ${idx}: digest=${layer.digest}, size=${layer.size}`);
    });
  } else if (manifest.fsLayers && Array.isArray(manifest.fsLayers)) {
    // 兼容 schema1
    layers = manifest.fsLayers.map(l => ({ digest: l.blobSum, size: 0 }));
    console.log(`[processManifestLayers] Found ${layers.length} layers via manifest.fsLayers (schema1)`);
  } else {
    console.log(`[processManifestLayers] No layers found in manifest`);
  }
  
  if (layers.length === 0) {
    console.error(`[processManifestLayers] No layers for ${repo}:${tag}`);
    // 记录失败资产，不抛出异常，避免中断其他 tags
    const master = await getMasterTask(env, masterTaskId);
    if (master) {
      const failedAssets = master.failedAssets || [];
      failedAssets.push({ tag, error: 'No layers in manifest' });
      await updateMasterTaskProgress(env, masterTaskId, { failedAssets });
      console.log(`[processManifestLayers] Recorded failure for ${repo}:${tag}`);
    }
    return;
  }

  // 更新 master 任务的总层数
  const master = await getMasterTask(env, masterTaskId);
  if (!master) {
    throw new Error(`Master task ${masterTaskId} not found`);
  }
  const newTotal = (master.totalAssets || 0) + layers.length;
  console.log(`[processManifestLayers] Updating master task totalAssets from ${master.totalAssets} to ${newTotal}`);
  await updateMasterTaskProgress(env, masterTaskId, {
    totalAssets: newTotal,
    totalAssetBatches: newTotal
  });

  // 发送每个 layer 任务
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerTask = {
      type: 'docker-layer',
      masterTaskId,
      repo,
      bucketId,
      digest: layer.digest,
      size: layer.size || 0,
      batchIndex: i,
      totalBatches: layers.length,
    };
    console.log(`[processManifestLayers] Sending layer task for digest ${layer.digest}`);
    await env.TASKS_QUEUE.send(JSON.stringify(layerTask));
  }
}

export async function handleQueueStatus(request, env) {
  const activeTasks = await getActiveTasks(env);
  const tasks = activeTasks.map(t => ({
    name: t.name,
    status: t.status
  }));
  return Response.json({ tasks });
}