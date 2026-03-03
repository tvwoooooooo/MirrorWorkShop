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
        console.error('Master task failed', error);
        await completeMasterTask(env, task.taskId, 'failed');
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
    progress: t.progress || 0,
    totalFiles: t.totalFiles,
    processedFiles: t.processedFiles,
    currentFile: t.currentFile
  }));
  return Response.json({ tasks });
}
