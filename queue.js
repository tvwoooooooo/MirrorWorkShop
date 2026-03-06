// queue.js
import { processBatch, processAsset } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/githubDownloader.js';
import { createMasterTask, updateMasterTaskProgress, completeMasterTask, getMasterTask } from './lib/taskManager.js';

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      try {
        const { taskId, owner, repo, bucketId, files, assets } = task;
        
        // 如果没有提供 files，则获取整个文件树（兼容旧版）
        const fileList = files || await getRepoFileTree(owner, repo, env);
        
        // 创建主任务（包含文件数和资产数）
        await createMasterTask(env, taskId, owner, repo, bucketId, fileList, assets || []);
        
        message.ack();
      } catch (error) {
        console.error('Master task failed:', error);
        await env.B2_KV.put(`master:${task.taskId}`, JSON.stringify({
          status: 'failed',
          owner: task.owner,
          repo: task.repo,
          bucketId: task.bucketId,
          error: error.message,
          stack: error.stack,
          createdAt: Date.now(),
          failedAt: Date.now()
        }));
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
    } else {
      message.ack();
    }
  }
}

export async function handleQueueStatus(request, env) {
  const activeTasks = await env.B2_KV.get('active_tasks', 'json') || [];
  const tasks = activeTasks.map(t => ({
    name: t.name,
    status: t.status || 'processing'
  }));
  return Response.json({ tasks });
}
