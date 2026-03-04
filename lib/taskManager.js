// lib/taskManager.js
const BATCH_SIZE = 20; // 每批文件数量

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

// 创建主任务（状态为 queued）
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
        status: 'queued',           // 初始状态为 queued
        createdAt: Date.now(),
    };
    await env.B2_KV.put(`master:${taskId}`, JSON.stringify(masterTask));

    await updateActiveTasks(env, taskId, 'add', {
        taskId,
        name: `${owner}/${repo}`,
        status: 'queued'             // 活动列表中状态为 queued
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

// 标记任务为 processing（开始处理时调用）
export async function markTaskAsProcessing(env, taskId) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json');
    if (task && task.status === 'queued') {
        task.status = 'processing';
        task.startedAt = Date.now();
        await env.B2_KV.put(key, JSON.stringify(task));
        // 同时更新活动列表中的状态
        await updateActiveTasks(env, taskId, 'update', { status: 'processing' });
    }
}

// 更新主任务进度（仅在批次完成时调用，不再每个文件更新）
export async function updateMasterTaskProgress(env, taskId, updates) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json') || {};
    Object.assign(task, updates, { updatedAt: Date.now() });
    await env.B2_KV.put(key, JSON.stringify(task));

    // 如果状态变化为 completed，则从活动列表移除（由 completeMasterTask 处理）
    // 否则更新活动列表中的信息（如 processedFiles 可选，但我们不再需要进度）
    // 为了简化，活动列表不再更新进度，只保留状态
    // 如果需要显示已处理文件数，可以更新，但为了减少写入，不更新
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
