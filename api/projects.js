// api/projects.js
import { getRepoFileTree } from '../lib/github.js';
import { fetchWithRetry } from '../lib/github.js';
import { getDockerManifest } from '../lib/docker.js';
import { createMasterTask } from '../lib/taskManager.js';
import { ensureProjectsTable } from '../lib/d1.js';

// ... 保留原有 handleProjects, handleRepoTree, handleRepoReleases 等不变

/**
 * 处理详细备份任务（扩展支持 Docker）
 */
export async function handleDetailedProject(request, env) {
    await ensureProjectsTable(env);
    const { type, owner, repo, bucketId, files, assets, tag } = await request.json();

    if (type === 'github') {
        // GitHub 备份逻辑（保持不变）
        if (!owner || !repo || !bucketId) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
        if (!bucket) {
            return Response.json({ error: '指定的桶不存在' }, { status: 400 });
        }
        const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        await createMasterTask(env, taskId, owner, repo, bucketId, files || [], assets || []);
        return Response.json({ success: true, taskId, message: 'GitHub 备份任务已提交，正在处理' });
    } else if (type === 'docker') {
        // Docker 备份逻辑
        if (!owner || !repo || !bucketId) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
        if (!bucket) {
            return Response.json({ error: '指定的桶不存在' }, { status: 400 });
        }

        const image = `${owner}/${repo}`; // 可能包含 library/ 前缀，但 owner 已处理
        const tagToUse = tag || 'latest';
        const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        try {
            // 获取 manifest，解析所有层
            const manifest = await getDockerManifest(image, tagToUse, env);
            if (!manifest || !manifest.layers) {
                throw new Error('Invalid manifest or no layers');
            }

            // 构建层资产列表
            const layers = manifest.layers.map((layer, index) => ({
                name: `layer-${index + 1}-${layer.digest.replace(/[^a-zA-Z0-9]/g, '_')}.tar.gz`,
                digest: layer.digest,
                size: layer.size,
                url: `${image}/blobs/${layer.digest}` // 用于标识，实际下载时使用 getDockerLayer
            }));

            // 创建主任务，资产为这些层
            await createMasterTask(env, taskId, owner, repo, bucketId, [], layers);
            return Response.json({ success: true, taskId, message: 'Docker 备份任务已提交，正在处理' });
        } catch (error) {
            console.error('Docker backup error:', error);
            return Response.json({ error: `获取镜像 manifest 失败: ${error.message}` }, { status: 500 });
        }
    } else {
        return Response.json({ error: '不支持的类型' }, { status: 400 });
    }
}
