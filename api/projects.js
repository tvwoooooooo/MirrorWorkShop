// api/projects.js
import { getRepoFileTree } from '../lib/github.js';
import { fetchWithRetry } from '../lib/github.js';
import { getDockerManifest } from '../lib/docker.js';
import { createMasterTask } from '../lib/taskManager.js';
import { ensureProjectsTable } from '../lib/d1.js';

/**
 * 获取已备份的项目列表（用于首页展示）
 */
export async function handleProjects(type, env) {
    await ensureProjectsTable(env);
    const { results } = await env.DB.prepare(
        "SELECT name, homepage, last_update, versions FROM projects WHERE type = ?"
    ).bind(type).all();
    const projects = results.map(row => ({
        name: row.name,
        homepage: row.homepage,
        lastUpdate: row.last_update,
        versions: JSON.parse(row.versions || '[]')
    }));
    return Response.json(projects);
}

/**
 * 旧版简单备份（全量备份，保留兼容）
 */
export async function handleProject(request, env) {
    await ensureProjectsTable(env);
    const { type, name, bucketId } = await request.json();

    if (type !== 'github') {
        return Response.json({ error: '目前仅支持 GitHub 项目完整备份' }, { status: 400 });
    }

    const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
    if (!bucket) {
        return Response.json({ error: '指定的桶不存在' }, { status: 400 });
    }

    const [owner, repo] = name.split('/');
    if (!owner || !repo) {
        return Response.json({ error: 'Invalid repository name' }, { status: 400 });
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
        const filePaths = await getRepoFileTree(owner, repo, env);
        await createMasterTask(env, taskId, owner, repo, bucketId, filePaths, []);
    } catch (error) {
        return Response.json({ error: `获取文件树失败: ${error.message}` }, { status: 500 });
    }

    return Response.json({ success: true, taskId, message: '完整备份任务已提交，正在处理' });
}

/**
 * 获取仓库文件树（用于第一步展示）
 */
export async function handleRepoTree(request, env) {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    if (!owner || !repo) {
        return Response.json({ error: 'Missing owner or repo' }, { status: 400 });
    }

    try {
        const files = await getRepoFileTree(owner, repo, env);
        return Response.json(files);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}

/**
 * 获取仓库 Releases 及资产信息（用于第一步展示）
 */
export async function handleRepoReleases(request, env) {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    if (!owner || !repo) {
        return Response.json({ error: 'Missing owner or repo' }, { status: 400 });
    }

    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
        const response = await fetchWithRetry(apiUrl, { method: 'GET' }, 3, env);
        const data = await response.json();
        const releases = data.map(r => ({
            tag: r.tag_name,
            date: r.published_at ? r.published_at.split('T')[0] : (r.created_at ? r.created_at.split('T')[0] : '未知'),
            assets: r.assets.map(a => ({
                name: a.name,
                size: a.size,
                url: a.browser_download_url
            }))
        }));
        return Response.json(releases);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}

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