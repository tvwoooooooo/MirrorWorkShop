// lib/taskManager.js
const BATCH_SIZE = 20; // 减小批次大小，避免 subrequest 超限

// 辅助函数：安全更新活动任务列表
async function updateActiveTasks(env, taskId, action, taskData = null) {
    const key = 'active_tasks';
    let tasks = await env.B2_KV.get(key, 'json') || [];
    
    if (action === 'add') {
        if (!tasks.find(t => t.taskId === taskId)) {
            tasks.push(taskData);
        }
    } else if (action === 'remove') {
        tasks = tasks.filter(t => t.taskId !== taskId);
    } else if (action === 'update') {
        const index = tasks.findIndex(t => t.taskId === taskId);
        if (index !== -1 && taskData) {
            tasks[index] = { ...tasks[index], ...taskData };
        }
    }
    
    await env.B2_KV.put(key, JSON.stringify(tasks));
}

// 创建主任务
export async function createMasterTask(env, taskId, owner, repo, bucketId, filePaths) {
    const batches = [];
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        batches.push(filePaths.slice(i, i + BATCH_SIZE));
    }

    const masterTask = {
        taskId,
        owner,
        repo,
        bucketId,
        totalFiles: filePaths.length,
        totalBatches: batches.length,
        completedBatches: [],
        processedFiles: 0,
        failedFiles: [],
        currentFile: null,
        status: 'processing',
        createdAt: Date.now(),
    };
    await env.B2_KV.put(`master:${taskId}`, JSON.stringify(masterTask));

    await updateActiveTasks(env, taskId, 'add', {
        taskId,
        name: `${owner}/${repo}`,
        totalFiles: filePaths.length,
        processedFiles: 0,
        progress: 0,
        status: 'processing'
    });

    // 发送批次任务
    for (let i = 0; i < batches.length; i++) {
        const batchTask = {
            type: 'batch',
            masterTaskId: taskId,
            bucketId,
            owner,
            repo,
            files: batches[i],
            batchIndex: i,
            totalBatches: batches.length,
        };
        await env.TASKS_QUEUE.send(JSON.stringify(batchTask));
    }
    return masterTask;
}

// 更新主任务进度（同时更新活动列表）
export async function updateMasterTaskProgress(env, taskId, updates) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json') || {};
    Object.assign(task, updates, { updatedAt: Date.now() });
    await env.B2_KV.put(key, JSON.stringify(task));

    // 重新读取以确保一致性
    const updatedTask = await env.B2_KV.get(key, 'json');
    const progress = updatedTask.completedBatches ? 
        Math.round((updatedTask.completedBatches.length / updatedTask.totalBatches) * 100) : 0;

    // 更新活动列表
    await updateActiveTasks(env, taskId, 'update', {
        processedFiles: updatedTask.processedFiles || 0,
        progress: progress,
        currentFile: updatedTask.currentFile
    });
}

// 完成主任务（成功或失败）
export async function completeMasterTask(env, taskId, finalStatus) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json');
    if (task) {
        task.status = finalStatus;
        task.completedAt = Date.now();
        await env.B2_KV.put(key, JSON.stringify(task));
    }
    // 从活动列表移除
    await updateActiveTasks(env, taskId, 'remove');
}

// 获取主任务
export async function getMasterTask(env, taskId) {
    return await env.B2_KV.get(`master:${taskId}`, 'json');
}
