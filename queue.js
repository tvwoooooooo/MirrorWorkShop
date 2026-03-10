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
          console.log(`Fetching manifest for ${repo}:${tag} from ${manifestUrl}`);
          const manifestResponse = await fetchWithDockerAuth(manifestUrl, env);
          if (!manifestResponse.ok) {
            throw new Error(`Failed to get manifest for ${repo}:${tag}: ${manifestResponse.status}`);
          }
          const manifest = await manifestResponse.json();
          
          // 打印 manifest 的基本信息到日志（便于调试）
          console.log(`Manifest for ${repo}:${tag}: schemaVersion=${manifest.schemaVersion}, mediaType=${manifest.mediaType}`);
          
          // 处理 manifest list 或普通 manifest
          let targetManifest = manifest;
          if (manifest.mediaType && manifest.mediaType.includes('manifest.list')) {
            // 如果是 manifest list，选择第一个平台（例如 linux/amd64）
            if (!manifest.manifests || manifest.manifests.length === 0) {
              throw new Error(`Manifest list for ${repo}:${tag} has no manifests`);
            }
            const first = manifest.manifests[0];
            const platformManifestUrl = `https://registry-1.docker.io/v2/${repo}/manifests/${first.digest}`;
            console.log(`Fetching platform manifest from ${platformManifestUrl}`);
            const platformResponse = await fetchWithDockerAuth(platformManifestUrl, env);
            if (!platformResponse.ok) {
              throw new Error(`Failed to get platform manifest for ${repo}:${tag}: ${platformResponse.status}`);
            }
            targetManifest = await platformResponse.json();
          }
          
          // 处理目标 manifest 的 layers
          await processManifestLayers(taskId, repo, bucketId, tag, targetManifest, env);
        }
        
        // 所有 tags 处理完后，检查是否需要立即完成（如果没有层）
        const master = await getMasterTask(env, taskId);
        if (master.totalAssets === 0) {
          // 没有层，直接完成
          await completeMasterTask(env, taskId, 'completed', [], []);
        }
        message.ack();
      } catch (error) {
        console.error('Docker master task failed:', error);
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
  // 尝试获取 layers（支持不同版本的 manifest）
  let layers = [];
  if (manifest.layers && Array.isArray(manifest.layers)) {
    layers = manifest.layers;
  } else if (manifest.fsLayers && Array.isArray(manifest.fsLayers)) {
    // 兼容 schema1
    layers = manifest.fsLayers.map(l => ({ digest: l.blobSum, size: 0 })); // schema1 可能没有 size
  }
  
  const totalLayers = layers.length;
  console.log(`Manifest for ${repo}:${tag} has ${totalLayers} layers`);
  
  if (totalLayers === 0) {
    console.error(`No layers found in manifest for ${repo}:${tag}`);
    // 记录失败资产，不抛出异常，避免中断其他 tags
    const master = await getMasterTask(env, masterTaskId);
    if (master) {
      const failedAssets = master.failedAssets || [];
      failedAssets.push({ tag, error: 'No layers in manifest' });
      await updateMasterTaskProgress(env, masterTaskId, { failedAssets });
    }
    return;
  }

  // 更新 master 任务的总层数
  const master = await getMasterTask(env, masterTaskId);
  if (!master) {
    throw new Error(`Master task ${masterTaskId} not found`);
  }
  const newTotal = (master.totalAssets || 0) + totalLayers;
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
      totalBatches: totalLayers,
    };
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
