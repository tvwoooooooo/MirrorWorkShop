// lib/taskManager.js
import {
    ensureMasterTasksTable,
    ensureActiveTasksTable,
    ensureProjectsTable
} from './d1.js';
import { getB2Client, uploadFile } from './batchProcessor.js'; // 导入上传工具

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
 * 对于 GitHub 项目，metadata 中存储 { files: filePaths, assets: assets }
 */
export async function createMasterTask(env, taskId, owner, repo, bucketId, filePaths, assets = []) {
    await ensureMasterTasksTable(env);

    // 文件分批次
    const fileBatches = [];
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        fileBatches.push(filePaths.slice(i, i + BATCH_SIZE));
    }

    const completedFileBatches = serializeJSON([]);
    const failedFiles = serializeJSON([]);
    const completedAssetBatches = serializeJSON([]);
    const failedAssets = serializeJSON([]);
    
    // 构建 metadata：存储完整的文件列表和资产列表
    const metadata = JSON.stringify({
        files: filePaths,
        assets: assets
    });

    // 插入 master_tasks 表
    await env.DB.prepare(`
        INSERT INTO master_tasks (
            task_id, owner, repo, bucket_id,
            total_files, total_file_batches, completed_file_batches,
            processed_files, failed_files,
            total_assets, total_asset_batches, completed_asset_batches,
            processed_assets, failed_assets,
            metadata, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        taskId,
        owner,
        repo,
        bucketId,
        filePaths.length,
        fileBatches.length,
        completedFileBatches,
        0,
        failedFiles,
        assets.length,
        assets.length,
        completedAssetBatches,
        0,
        failedAssets,
        metadata,
        'processing',
        Date.now()
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

    return {
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
        metadata: { files: filePaths, assets: assets },
        status: 'processing',
        createdAt: Date.now()
    };
}

/**
 * 更新主任务进度
 */
export async function updateMasterTaskProgress(env, taskId, updates) {
    await ensureMasterTasksTable(env);

    // 先获取当前任务
    const master = await getMasterTask(env, taskId);
    if (!master) return;

    // 合并更新
    Object.assign(master, updates);
    master.updatedAt = Date.now();

    const completedFileBatches = serializeJSON(master.completedFileBatches);
    const failedFiles = serializeJSON(master.failedFiles);
    const completedAssetBatches = serializeJSON(master.completedAssetBatches);
    const failedAssets = serializeJSON(master.failedAssets);

    await env.DB.prepare(`
        UPDATE master_tasks SET
            total_assets = ?,
            total_asset_batches = ?,
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
        master.totalAssets,
        master.totalAssetBatches,
        completedFileBatches,
        master.processedFiles,
        failedFiles,
        completedAssetBatches,
        master.processedAssets,
        failedAssets,
        master.status,
        master.updatedAt,
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
    await ensureMasterTasksTable(env);

    const master = await getMasterTask(env, taskId);
    if (!master) return;

    master.status = finalStatus;
    master.completedAt = Date.now();
    master.failedFiles = failedFiles;
    master.failedAssets = failedAssets;

    const failedFilesStr = serializeJSON(master.failedFiles);
    const failedAssetsStr = serializeJSON(master.failedAssets);

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
        failedFilesStr,
        failedAssetsStr,
        master.completedAt,
        master.completedAt,
        taskId
    ).run();

    // 从 active_tasks 删除
    await env.DB.prepare(`DELETE FROM active_tasks WHERE task_id = ?`).bind(taskId).run();
}

/**
 * 获取主任务
 */
export async function getMasterTask(env, taskId) {
    await ensureMasterTasksTable(env);

    const result = await env.DB.prepare(`SELECT * FROM master_tasks WHERE task_id = ?`).bind(taskId).first();
    if (!result) return null;

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
        metadata: result.metadata ? JSON.parse(result.metadata) : null,
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
    await ensureActiveTasksTable(env);

    const { results } = await env.DB.prepare(`SELECT task_id, name, status FROM active_tasks`).all();
    return results.map(r => ({
        taskId: r.task_id,
        name: r.name,
        status: r.status
    }));
}

// ==================== 保存项目到 projects 表（元数据方案） ====================

/**
 * 将备份成功的项目保存到 projects 表（用于首页展示）
 * 元数据上传到 B2，D1 只存储基本信息和元数据路径
 * @param {Object} env - 环境变量
 * @param {Object} task - 主任务对象（从 getMasterTask 获取）
 * @param {Array} tags - 对于 Docker 项目，可选传入 tags 列表（如果任务中未存储）
 */
export async function saveProjectToDb(env, task, tags = null) {
    await ensureProjectsTable(env);

    const { taskId, owner, repo, bucketId, metadata, status } = task;
    const type = owner === 'docker' ? 'docker' : 'github';
    const now = new Date().toISOString().split('T')[0]; // 当前日期作为最后更新

    let name, homepage, metaData;

    if (type === 'github') {
        name = `${owner}/${repo}`;
        homepage = `https://github.com/${owner}/${repo}`;
        // 从 metadata 中获取文件列表和资产列表
        const fileList = metadata?.files || [];
        const assetList = metadata?.assets || [];
        metaData = {
            backupId: taskId,
            date: now,
            type: 'github',
            files: fileList,
            releases: assetList.map(a => ({ name: a.name, url: a.url, size: a.size }))
        };
    } else {
        name = repo; // 对于 Docker，repo 就是完整镜像名，如 xhofe/alist
        homepage = `https://hub.docker.com/r/${repo}`;
        // 如果传入 tags，则使用；否则尝试从 metadata 中获取
        const tagList = tags || metadata?.tags || [];
        metaData = {
            backupId: taskId,
            date: now,
            type: 'docker',
            tags: tagList
        };
    }

    // 生成元数据文件路径
    const metaPath = `${type}/${owner}/${repo}/meta/${taskId}.json`;

    // 获取 B2 客户端并上传元数据
    try {
        const { client, bucket } = await getB2Client(bucketId, env);
        const metaString = JSON.stringify(metaData, null, 2);
        await uploadFile(client, bucket, metaPath, metaString, metaString.length);
        console.log(`[saveProjectToDb] Uploaded metadata to ${metaPath}`);
    } catch (e) {
        console.error(`[saveProjectToDb] Failed to upload metadata: ${e.message}`);
        // 如果上传失败，则任务应标记为失败？这里记录错误并继续，但最好重试
        // 简单处理：抛出错误，让上层处理
        throw new Error(`Metadata upload failed: ${e.message}`);
    }

    // 从 D1 读取现有项目记录
    const existing = await env.DB.prepare(
        "SELECT versions FROM projects WHERE type = ? AND name = ?"
    ).bind(type, name).first();

    let versions = [];
    if (existing && existing.versions) {
        try {
            versions = JSON.parse(existing.versions);
        } catch {
            versions = [];
        }
    }

    // 添加新版本信息
    const newVersion = {
        backupId: taskId,
        date: now,
        metaPath: metaPath,
        bucketId: bucketId
    };
    versions.push(newVersion);

    // 插入或替换项目记录（使用 INSERT OR REPLACE）
    await env.DB.prepare(`
        INSERT OR REPLACE INTO projects (type, name, homepage, last_update, versions)
        VALUES (?, ?, ?, ?, ?)
    `).bind(type, name, homepage, now, JSON.stringify(versions)).run();

    console.log(`[saveProjectToDb] Saved ${type} project: ${name} with version ${taskId}`);
}