// queue.js
import { processBatch, processAsset, processDockerLayer, processDockerManifest } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/github.js';
import { createMasterTask, updateMasterTaskProgress, completeMasterTask, getMasterTask, getActiveTasks } from './lib/taskManager.js';

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      try {
        const { taskId, owner, repo, bucketId, files, assets } = task;
        
        // 如果没有提供 files，则获取整个文件树（兼容旧版）
        const fileList = files || await getRepoFileTree(owner, repo, env);
        
        // 使用 D1 的 createMasterTask（已包含队列发送）
        await createMasterTask(env, taskId, owner, repo, bucketId, fileList, assets || []);
        
        message.ack();
      } catch (error) {
        console.error('Master task failed:', error);
        // 记录失败到 D1
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
    } else if (task.type === 'docker-manifest') {
        try {
            await processDockerManifest(task, env);
            message.ack();
        } catch (error) {
            console.error('Docker manifest task failed', error);
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