// lib/taskManager.js
const BATCH_SIZE = 15; // 从20调整为15，降低单批次子请求数

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

/**
 * 创建主任务，并发送文件批次到队列
 */
export async function createMasterTask(env, taskId, owner, repo, bucketId, filePaths, assets = []) {
    // 文件分批次
    const fileBatches = [];
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        fileBatches.push(filePaths.slice(i, i + BATCH_SIZE));
    }

    const masterTask = {
        taskId,
        owner,
        repo,
        bucketId,
        totalFiles: filePaths.length,
        totalFileBatches: fileBatches.length,
        completedFileBatches: [],
        processedFiles: 0,
        failedFiles: [],
        totalAssets: assets.length,
        totalAssetBatches: assets.length,
        completedAssetBatches: [],
        processedAssets: 0,
        failedAssets: [],
        status: 'processing',
        createdAt: Date.now(),
    };
    await env.B2_KV.put(`master:${taskId}`, JSON.stringify(masterTask));

    await updateActiveTasks(env, taskId, 'add', {
        taskId,
        name: `${owner}/${repo}`,
        status: 'processing'
    });

    // 发送文件批次
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

    // 发送资产批次（每个资产单独一个任务）
    for (let i = 0; i < assets.length; i++) {
        const assetTask = {
            type: 'asset',
            masterTaskId: taskId,
            bucketId,
            owner,
            repo,
            asset: assets[i],
            batchIndex: i,
            totalBatches: assets.length,
        };
        await env.TASKS_QUEUE.send(JSON.stringify(assetTask));
    }

    return masterTask;
}

export async function updateMasterTaskProgress(env, taskId, updates) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json') || {};
    Object.assign(task, updates, { updatedAt: Date.now() });
    await env.B2_KV.put(key, JSON.stringify(task));

    if (updates.status) {
        await updateActiveTasks(env, taskId, 'update', { status: updates.status });
    }
}

export async function completeMasterTask(env, taskId, finalStatus, failedFiles = [], failedAssets = []) {
    const key = `master:${taskId}`;
    const task = await env.B2_KV.get(key, 'json');
    if (task) {
        task.status = finalStatus;
        task.completedAt = Date.now();
        if (failedFiles.length > 0) task.failedFiles = failedFiles;
        if (failedAssets.length > 0) task.failedAssets = failedAssets;
        await env.B2_KV.put(key, JSON.stringify(task));
    }
    await updateActiveTasks(env, taskId, 'remove');
}

export async function getMasterTask(env, taskId) {
    return await env.B2_KV.get(`master:${taskId}`, 'json');
}
