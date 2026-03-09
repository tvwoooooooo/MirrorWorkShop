// queue.js
import { processBatch, processAsset, processDockerLayer } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/github.js';
import { getManifest } from './lib/docker.js';
import { createMasterTask, updateMasterTaskProgress, completeMasterTask, getMasterTask, getActiveTasks } from './lib/taskManager.js';

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      // 原有 GitHub master 任务
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
        `).bind(
            task.taskId,
            task.owner,
            task.repo,
            task.bucketId,
            'failed',
            Date.now(),
            Date.now()
        ).run();
        message.ack();
      }
    } else if (task.type === 'docker-master') {
      // 新增 Docker master 任务
      try {
        const { taskId, owner, repo, bucketId, tags } = task;
        const imageName = `${owner}/${repo}`;
        
        // 创建主任务记录（复用 GitHub 的主任务结构）
        await createMasterTask(env, taskId, owner, repo, bucketId, [], []);
        
        // 获取主任务对象，添加 Docker 特定字段
        const masterKey = `master:${taskId}`;
        const master = await env.B2_KV.get(masterKey, 'json');
        if (master) {
          master.totalTags = tags.length;
          master.totalLayers = 0;
          master.processedLayers = 0;
          master.failedLayers = [];
          master.completedLayerBatches = [];
          master.totalLayerBatches = 0; // 将在后面设置
          await env.B2_KV.put(masterKey, JSON.stringify(master));
        }
        
        const logMessages = [];
        let layerBatchIndex = 0;
        for (const tag of tags) {
          try {
            const { manifest, registryToken } = await getManifest(env, logMessages, imageName, tag);
            
            // 解析 layers
            const layers = manifest.layers || [];
            
            // 更新主任务中的总 layer 数
            const currentMaster = await env.B2_KV.get(masterKey, 'json') || {};
            currentMaster.totalLayers = (currentMaster.totalLayers || 0) + layers.length;
            await env.B2_KV.put(masterKey, JSON.stringify(currentMaster));
            
            // 为每个 layer 创建任务
            for (const layer of layers) {
              const layerTask = {
                type: 'docker-layer',
                masterTaskId: taskId,
                bucketId,
                owner,
                repo,
                tag,
                digest: layer.digest,
                size: layer.size,
                imageName,
                batchIndex: layerBatchIndex++,
              };
              await env.TASKS_QUEUE.send(JSON.stringify(layerTask));
            }
          } catch (err) {
            console.error(`Failed to process tag ${tag}:`, err);
            // 记录失败的 tag
            const master = await env.B2_KV.get(masterKey, 'json') || {};
            const failedTags = master.failedTags || [];
            failedTags.push({ tag, error: err.message });
            await env.B2_KV.put(masterKey, JSON.stringify(master));
          }
        }
        
        // 更新主任务的总批次信息
        const finalMaster = await env.B2_KV.get(masterKey, 'json') || {};
        finalMaster.totalLayerBatches = layerBatchIndex;
        await env.B2_KV.put(masterKey, JSON.stringify(finalMaster));
        
        message.ack();
      } catch (error) {
        console.error('Docker master task failed:', error);
        await env.DB.prepare(`
            INSERT OR REPLACE INTO master_tasks (task_id, owner, repo, bucket_id, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            task.taskId,
            task.owner,
            task.repo,
            task.bucketId,
            'failed',
            Date.now(),
            Date.now()
        ).run();
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

export async function handleQueueStatus(request, env) {
  const activeTasks = await getActiveTasks(env);
  const tasks = activeTasks.map(t => ({
    name: t.name,
    status: t.status
  }));
  return Response.json({ tasks });
}
