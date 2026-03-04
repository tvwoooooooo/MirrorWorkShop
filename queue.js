// queue.js
import { processBatch } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/githubDownloader.js';
import { createMasterTask, completeMasterTask } from './lib/taskManager.js';

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      try {
        const { taskId, owner, repo, bucketId } = task;
        const filePaths = await getRepoFileTree(owner, repo);
        await createMasterTask(env, taskId, owner, repo, bucketId, filePaths);
        message.ack();
      } catch (error) {
        console.error('Master task failed:', error);
        // 保存详细错误信息到任务中
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
