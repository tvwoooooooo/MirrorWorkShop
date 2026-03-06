// lib/taskManager.js
const BATCH_SIZE = 10; // 稳定值，可调整

/**
 * 序列化 JSON 数组为字符串（用于 D1 存储）
 */
function serializeJSON(data) {
    return data ? JSON.stringify(data) : '[]';
}

/**
 * 解析 JSON 字符串为数组
 */
function parseJSON(str) {
    try {
        return str ? JSON.parse(str) : [];
    } catch {
        return [];
    }
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
        task_id: taskId,
        owner,
        repo,
        bucket_id: bucketId,
        total_files: filePaths.length,
        total_file_batches: fileBatches.length,
        completed_file_batches: serializeJSON([]),
        processed_files: 0,
        failed_files: serializeJSON([]),
        total_assets: assets.length,
        total_asset_batches: assets.length,
        completed_asset_batches: serializeJSON([]),
        processed_assets: 0,
        failed_assets: serializeJSON([]),
        status: 'processing',
        created_at: Date.now(),
        updated_at: null,
        completed_at: null
    };

    // 插入 master_tasks 表
    await env.DB.prepare(`
        INSERT INTO master_tasks (
            task_id, owner, repo, bucket_id,
            total_files, total_file_batches, completed_file_batches,
            processed_files, failed_files,
            total_assets, total_asset_batches, completed_asset_batches,
            processed_assets, failed_assets,
            status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        masterTask.task_id,
        masterTask.owner,
        masterTask.repo,
        masterTask.bucket_id,
        masterTask.total_files,
        masterTask.total_file_batches,
        masterTask.completed_file_batches,
        masterTask.processed_files,
        masterTask.failed_files,
        masterTask.total_assets,
        masterTask.total_asset_batches,
        masterTask.completed_asset_batches,
        masterTask.processed_assets,
        masterTask.failed_assets,
        masterTask.status,
        masterTask.created_at
    ).run();

    // 添加到 active_tasks
    await env.DB.prepare(`
        INSERT OR REPLACE INTO active_tasks (task_id, name, status) VALUES (?, ?, ?)
    `).bind(taskId, `${owner}/${repo}`, 'processing').run();

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

    // 发送资产批次
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

/**
 * 更新主任务进度
 */
export async function updateMasterTaskProgress(env, taskId, updates) {
    const master = await getMasterTask(env, taskId);
    if (!master) return;

    // 合并更新
    Object.assign(master, updates);
    master.updated_at = Date.now();

    // 序列化 JSON 字段
    const completed_file_batches = serializeJSON(master.completed_file_batches);
    const failed_files = serializeJSON(master.failed_files);
    const completed_asset_batches = serializeJSON(master.completed_asset_batches);
    const failed_assets = serializeJSON(master.failed_assets);

    await env.DB.prepare(`
        UPDATE master_tasks SET
            completed_file_batches = ?,
            processed_files = ?,
            failed_files = ?,
            completed_asset_batches = ?,
            processed_assets = ?,
            failed_assets = ?,
            status = ?,
            updated_at = ?
        WHERE task_id = ?
    `).bind(
        completed_file_batches,
        master.processed_files,
        failed_files,
        completed_asset_batches,
        master.processed_assets,
        failed_assets,
        master.status,
        master.updated_at,
        taskId
    ).run();

    if (updates.status) {
        await env.DB.prepare(`
            UPDATE active_tasks SET status = ? WHERE task_id = ?
        `).bind(updates.status, taskId).run();
    }
}

/**
 * 完成主任务
 */
export async function completeMasterTask(env, taskId, finalStatus, failedFiles = [], failedAssets = []) {
    const master = await getMasterTask(env, taskId);
    if (!master) return;

    master.status = finalStatus;
    master.completed_at = Date.now();
    master.failed_files = failedFiles;
    master.failed_assets = failedAssets;

    const failed_files = serializeJSON(master.failed_files);
    const failed_assets = serializeJSON(master.failed_assets);

    await env.DB.prepare(`
        UPDATE master_tasks SET
            status = ?,
            failed_files = ?,
            failed_assets = ?,
            completed_at = ?,
            updated_at = ?
        WHERE task_id = ?
    `).bind(
        master.status,
        failed_files,
        failed_assets,
        master.completed_at,
        master.completed_at, // updated_at 也设为完成时间
        taskId
    ).run();

    // 从 active_tasks 删除
    await env.DB.prepare(`DELETE FROM active_tasks WHERE task_id = ?`).bind(taskId).run();
}

/**
 * 获取主任务
 */
export async function getMasterTask(env, taskId) {
    const result = await env.DB.prepare(`SELECT * FROM master_tasks WHERE task_id = ?`).bind(taskId).first();
    if (!result) return null;

    // 解析 JSON 字段
    return {
        taskId: result.task_id,
        owner: result.owner,
        repo: result.repo,
        bucketId: result.bucket_id,
        totalFiles: result.total_files,
        totalFileBatches: result.total_file_batches,
        completedFileBatches: parseJSON(result.completed_file_batches),
        processedFiles: result.processed_files,
        failedFiles: parseJSON(result.failed_files),
        totalAssets: result.total_assets,
        totalAssetBatches: result.total_asset_batches,
        completedAssetBatches: parseJSON(result.completed_asset_batches),
        processedAssets: result.processed_assets,
        failedAssets: parseJSON(result.failed_assets),
        status: result.status,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
        completedAt: result.completed_at
    };
}

/**
 * 获取活动任务列表（用于前端队列显示）
 */
export async function getActiveTasks(env) {
    const { results } = await env.DB.prepare(`SELECT task_id, name, status FROM active_tasks`).all();
    return results.map(r => ({
        taskId: r.task_id,
        name: r.name,
        status: r.status
    }));
}
