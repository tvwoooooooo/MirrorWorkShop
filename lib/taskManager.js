// lib/taskManager.js
import {
    ensureMasterTasksTable,
    ensureActiveTasksTable,
    ensureProjectsTable
} from './d1.js';

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
    const filePathsJSON = serializeJSON(filePaths); // 存储完整的文件树

    // 插入 master_tasks 表（包含 file_paths 字段）
    await env.DB.prepare(`
        INSERT INTO master_tasks (
            task_id, owner, repo, bucket_id,
            total_files, total_file_batches, completed_file_batches,
            processed_files, failed_files,
            total_assets, total_asset_batches, completed_asset_batches,
            processed_assets, failed_assets,
            file_paths,
            status, created_at
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
        filePathsJSON,
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
        filePaths: filePaths, // 返回文件树
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
 * @param {Object} env - 环境变量
 * @param {string} taskId - 任务 ID
 * @param {string} finalStatus - 最终状态 ('completed' 或 'completed_with_errors' 或 'failed')
 * @param {Array} failedFiles - 失败的文件列表
 * @param {Array} failedAssets - 失败的资产列表
 * @param {string|null} metaPath - 元数据文件路径（仅对 GitHub 项目有效）
 */
export async function completeMasterTask(env, taskId, finalStatus, failedFiles = [], failedAssets = [], metaPath = null) {
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

    // 保存项目信息到 projects 表
    // 对于 GitHub 项目，需要传入 metaPath；对于 Docker 项目，无需传入 tags（已在 docker-master 中保存）
    if (master.owner !== 'docker') {
        await saveProjectToDb(env, master, null, metaPath);
    }
    // Docker 项目的保存已在 docker-master 中完成，此处不再重复
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
        filePaths: parseJSON(result.file_paths), // 解析文件树
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
 * @param {Object} env - 环境变量
 * @param {Object} task - 主任务对象（从 getMasterTask 获取）
 * @param {Array} tags - 对于 Docker 项目，传入 tags 列表
 * @param {string|null} metaPath - 对于 GitHub 项目，传入元数据文件路径
 */
export async function saveProjectToDb(env, task, tags = null, metaPath = null) {
    await ensureProjectsTable(env);

    const { owner, repo, status } = task;
    const type = owner === 'docker' ? 'docker' : 'github';
    const now = new Date().toISOString().split('T')[0]; // 当前日期作为最后更新

    let name, homepage, versions;

    if (type === 'github') {
        name = `${owner}/${repo}`;
        homepage = `https://github.com/${owner}/${repo}`;
        // 构建 versions 数据：每个版本包含日期和元数据路径
        versions = [{
            date: now,
            metaPath: metaPath // 存储元数据文件在 B2 中的路径
        }];
    } else {
        name = repo; // 对于 Docker，repo 就是完整镜像名，如 xhofe/alist
        homepage = `https://hub.docker.com/r/${repo}`;
        // 如果传入 tags，则使用；否则尝试从任务中获取（任务中可能存储了 tags，但当前设计未存，因此需要传入）
        const tagList = tags || [];
        versions = tagList.map(tag => ({
            tag: tag,
            date: now
        }));
    }

    // 序列化 versions 为 JSON 字符串
    const versionsStr = JSON.stringify(versions);

    // 插入或替换（使用 INSERT OR REPLACE，以 name 和 type 为唯一键）
    await env.DB.prepare(`
        INSERT OR REPLACE INTO projects (type, name, homepage, last_update, versions)
        VALUES (?, ?, ?, ?, ?)
    `).bind(type, name, homepage, now, versionsStr).run();

    console.log(`[saveProjectToDb] Saved ${type} project: ${name}`, metaPath ? `metaPath: ${metaPath}` : '');
}
