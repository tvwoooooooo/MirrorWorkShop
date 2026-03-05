// queue.js
import { processBatch } from './lib/batchProcessor.js';
import { getRepoFileTree, getReleaseAssets } from './lib/githubDownloader.js';

const BATCH_SIZE = 20;

export async function queueHandler(batch, env, ctx) {
  for (const message of batch.messages) {
    const task = JSON.parse(message.body);
    
    if (task.type === 'master') {
      try {
        const { taskId, owner, repo, bucketId, backupOptions } = task;
        let fileList = [];

        // 备份代码文件
        if (backupOptions.codeFiles) {
          const filePaths = await getRepoFileTree(owner, repo, env);
          fileList = fileList.concat(filePaths.map(path => ({
            type: 'code',
            path: path,
            url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
          })));
        }

        // 备份 releases
        if (backupOptions.releases && backupOptions.releases.length > 0) {
          for (const release of backupOptions.releases) {
            const assets = await getReleaseAssets(owner, repo, release.tag, env);
            const selectedAssets = assets.filter(a => release.assets.includes(a.name));
            for (const asset of selectedAssets) {
              fileList.push({
                type: 'release',
                path: `releases/${release.tag}/${asset.name}`,
                url: asset.url
              });
            }
          }
        }

        if (fileList.length === 0) {
          throw new Error('No files selected for backup');
        }

        // 创建主任务记录
        const masterKey = `master:${taskId}`;
        const masterTask = {
          taskId,
          owner,
          repo,
          bucketId,
          totalFiles: fileList.length,
          totalBatches: Math.ceil(fileList.length / BATCH_SIZE),
          completedBatches: [],
          processedFiles: 0,
          failedFiles: [],
          status: 'processing',
          createdAt: Date.now(),
        };
        await env.B2_KV.put(masterKey, JSON.stringify(masterTask));

        // 添加到 active_tasks
        let activeTasks = await env.B2_KV.get('active_tasks', 'json') || [];
        activeTasks.push({ taskId, name: `${owner}/${repo}`, status: 'processing' });
        await env.B2_KV.put('active_tasks', JSON.stringify(activeTasks));

        // 发送批次任务
        for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
          const batchFiles = fileList.slice(i, i + BATCH_SIZE);
          const batchTask = {
            type: 'batch',
            masterTaskId: taskId,
            bucketId,
            owner,
            repo,
            files: batchFiles,
            batchIndex: Math.floor(i / BATCH_SIZE),
            totalBatches: Math.ceil(fileList.length / BATCH_SIZE),
          };
          await env.TASKS_QUEUE.send(JSON.stringify(batchTask));
        }

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