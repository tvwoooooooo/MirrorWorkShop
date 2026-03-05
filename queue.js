// queue.js
import { processBatch } from './lib/batchProcessor.js';
import { getRepoFileTree } from './lib/githubDownloader.js';
import { createMasterTask, completeMasterTask } from './lib/taskManager.js';

export async function queueHandler(batch, env, ctx) {
    for (const message of batch.messages) {
        const task = JSON.parse(message.body);
        
        if (task.type === 'master') {
            try {
                const { taskId, owner, repo, bucketId, options } = task;
                let totalFiles = 0;
                let fileBatches = [];
                const BATCH_SIZE = 20;
                
                // 如果需要备份代码文件
                if (options.backupCode) {
                    const filePaths = await getRepoFileTree(owner, repo, env);
                    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
                        fileBatches.push(filePaths.slice(i, i + BATCH_SIZE));
                    }
                    totalFiles += filePaths.length;
                }
                
                // 创建 master 任务记录
                // 注意：createMasterTask 需要修改以接收 releases 信息，这里我们简单处理
                // 实际可扩展 taskManager 支持 releases
                const masterTask = {
                    taskId,
                    owner,
                    repo,
                    bucketId,
                    totalFiles,
                    totalBatches: fileBatches.length,
                    completedBatches: [],
                    processedFiles: 0,
                    failedFiles: [],
                    status: 'processing',
                    createdAt: Date.now(),
                    options
                };
                await env.B2_KV.put(`master:${taskId}`, JSON.stringify(masterTask));
                
                // 发送代码文件批次
                for (let i = 0; i < fileBatches.length; i++) {
                    const batchTask = {
                        type: 'batch',
                        masterTaskId: taskId,
                        bucketId,
                        owner,
                        repo,
                        files: fileBatches[i],
                        batchIndex: i,
                        totalBatches: fileBatches.length,
                    };
                    await env.TASKS_QUEUE.send(JSON.stringify(batchTask));
                }
                
                // 处理 Releases 资产（简化：暂不实现，提示用户）
                if (options.releases && options.releases.length > 0) {
                    console.log('Release backup not implemented yet, skipping');
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