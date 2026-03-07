// queue.js
import { processBatch, processAsset, getB2Client, uploadFile } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/github.js';
import { createMasterTask, updateMasterTaskProgress, completeMasterTask, getMasterTask, getActiveTasks } from './lib/taskManager.js';

async function processDockerBackup(task, env) {
  const { taskId, owner, repo, bucketId, tags } = task;
  const date = new Date().toISOString().split('T')[0];
  const data = {
    repository: `${owner}/${repo}`,
    tags,
    backupDate: date,
    timestamp: Date.now()
  };
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const stream = blob.stream();
  const contentLength = blob.size;

  const { client, bucket } = await getB2Client(bucketId, env);
  const key = `${owner}/${repo}/tags-${date}.json`;
  await uploadFile(client, bucket, key, stream, contentLength);

  // 更新主任务状态为完成
  await env.DB.prepare(`
    UPDATE master_tasks SET status = ?, completed_at = ? WHERE task_id = ?
  `).bind('completed', Date.now(), taskId).run();
}

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
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
    } else if (task.type === 'docker') {
      try {
        await processDockerBackup(task, env);
        message.ack();
      } catch (error) {
        console.error('Docker backup failed', error);
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
