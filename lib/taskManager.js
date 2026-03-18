// lib/taskManager.js
import {
    ensureMasterTasksTable,
    ensureActiveTasksTable,
    ensureProjectsTable
} from './d1.js';
import { getB2Client, uploadFile } from './batchProcessor.js';

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
 * 对于 GitHub 项目，metadata 中存储 { files: filePaths, assets: assets, fileSizes: {}, assetSizes: {}, description: description }
 * assets 格式：[{ name, url, size, tag, releaseDate }]
 */
export async function createMasterTask(env, taskId, owner, repo, bucketId, filePaths, assets = [], description = '') {
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
    
    // 构建 metadata：存储完整的文件列表、资产列表（带 tag）和描述
    const metadata = JSON.stringify({
        files: filePaths,
        assets: assets,      // 现在包含 tag 信息
        description: description,
        fileSizes: {},       // 键为文件路径，值为大小（字节）
        assetSizes: {}       // 键为资产URL，值为大小（字节）
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
        metadata: { files: filePaths, assets: assets, fileSizes: {}, assetSizes: {}, description },
        status: 'processing',
        createdAt: Date.now()
    };
}

/**
 * 更新主任务进度（支持更新 metadata 字段）
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
    const metadata = JSON.stringify(master.metadata); // 如果有更新 metadata 字段，需要传入

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
            metadata = ?,
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
        metadata,
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

    let name, homepage, metaData, description;
    let hasReleases = false;

    if (type === 'github') {
        name = `${owner}/${repo}`;
        homepage = `https://github.com/${owner}/${repo}`;
        description = metadata?.description || '';
        // 从 metadata 中获取文件列表、资产列表和大小信息
        const fileList = metadata?.files || [];
        const assetList = metadata?.assets || [];
        const fileSizes = metadata?.fileSizes || {};
        const assetSizes = metadata?.assetSizes || {};
        
        // 构建包含完整信息的文件对象
        const filesWithInfo = fileList.map(path => ({
            path: path,
            key: `${owner}/${repo}/${now}/${path}`,
            size: fileSizes[path] || 0
        }));
        
        // 将资产按 tag 分组
        const releasesByTag = {};
        assetList.forEach(asset => {
            if (!releasesByTag[asset.tag]) {
                releasesByTag[asset.tag] = {
                    tag: asset.tag,
                    date: asset.releaseDate || now,
                    assets: []
                };
            }
            releasesByTag[asset.tag].assets.push({
                name: asset.name,
                url: asset.url,
                size: asset.size
            });
        });
        const releasesWithTags = Object.values(releasesByTag);
        hasReleases = releasesWithTags.length > 0;

        metaData = {
            backupId: taskId,
            date: now,
            type: 'github',
            files: filesWithInfo,
            releases: releasesWithTags
        };
    } else {
        name = repo;
        homepage = `https://hub.docker.com/r/${repo}`;
        description = metadata?.description || '';
        const tagList = tags || metadata?.tags || [];
        hasReleases = tagList.length > 0; // Docker 用 tags 表示版本，也视为 releases
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
    console.log(`[saveProjectToDb] Uploading metadata to ${metaPath} for task ${taskId}`);
    try {
        const { client, bucket } = await getB2Client(bucketId, env);
        const metaString = JSON.stringify(metaData, null, 2);
        await uploadFile(client, bucket, metaPath, metaString, metaString.length);
        console.log(`[saveProjectToDb] Successfully uploaded metadata to ${metaPath}`);
    } catch (e) {
        console.error(`[saveProjectToDb] Failed to upload metadata: ${e.message}`);
        throw new Error(`Metadata upload failed: ${e.message}`);
    }

    // 从 D1 读取现有项目记录
    const existing = await env.DB.prepare(
        "SELECT versions, has_releases FROM projects WHERE type = ? AND name = ?"
    ).bind(type, name).first();

    let versions = [];
    let existingHasReleases = false;
    if (existing && existing.versions) {
        try {
            versions = JSON.parse(existing.versions);
        } catch {
            versions = [];
        }
        existingHasReleases = existing.has_releases === 1;
    }

    // 添加新版本信息（只存储元数据路径）
    const newVersion = {
        backupId: taskId,
        date: now,
        metaPath: metaPath,
        bucketId: bucketId
    };
    versions.push(newVersion);

    // 更新 has_releases：本次有或之前有，则标记为 1
    const finalHasReleases = hasReleases || existingHasReleases ? 1 : 0;

    // 插入或替换项目记录（包含描述和 has_releases）
    await env.DB.prepare(`
        INSERT OR REPLACE INTO projects (type, name, homepage, last_update, versions, description, has_releases)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(type, name, homepage, now, JSON.stringify(versions), description, finalHasReleases).run();

    console.log(`[saveProjectToDb] Saved ${type} project: ${name} with version ${taskId} (metadata path: ${metaPath})`);
}