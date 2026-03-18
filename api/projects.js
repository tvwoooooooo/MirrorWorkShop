// api/projects.js
import { getRepoFileTree } from '../lib/github.js';
import { fetchWithRetry } from '../lib/github.js';
import { getDockerTags } from '../lib/docker.js';
import { createMasterTask } from '../lib/taskManager.js';
import { ensureProjectsTable } from '../lib/d1.js';

/**
 * 获取已备份的项目列表（用于首页展示）
 */
export async function handleProjects(type, env) {
    await ensureProjectsTable(env);
    const { results } = await env.DB.prepare(
        "SELECT name, homepage, last_update, versions, description, has_releases FROM projects WHERE type = ?"
    ).bind(type).all();
    const projects = results.map(row => ({
        name: row.name,
        homepage: row.homepage,
        lastUpdate: row.last_update,
        versions: JSON.parse(row.versions || '[]'),
        description: row.description || '',
        has_releases: row.has_releases === 1 // 转换为布尔值
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
 * 处理详细备份任务（包含用户选择的文件和资产）
 */
export async function handleDetailedProject(request, env) {
    await ensureProjectsTable(env);
    const { type, owner, repo, bucketId, files, assets, description } = await request.json();

    if (type !== 'github') {
        return Response.json({ error: '目前仅支持 GitHub 项目完整备份' }, { status: 400 });
    }

    if (!owner || !repo || !bucketId) {
        return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
    if (!bucket) {
        return Response.json({ error: '指定的桶不存在' }, { status: 400 });
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await createMasterTask(env, taskId, owner, repo, bucketId, files || [], assets || [], description || '');
    return Response.json({ success: true, taskId, message: '详细备份任务已提交，正在处理' });
}

// ==================== Docker 相关接口 ====================

/**
 * 获取 Docker 镜像的 tags 列表
 */
export async function handleDockerTags(request, env) {
    const url = new URL(request.url);
    const repo = url.searchParams.get('repo'); // 格式如 library/alpine 或 username/repo
    const page = parseInt(url.searchParams.get('page')) || 1;
    const perPage = parseInt(url.searchParams.get('perPage')) || 30;

    if (!repo) {
        return Response.json({ error: 'Missing repo parameter' }, { status: 400 });
    }

    try {
        const result = await getDockerTags(repo, env);
        return Response.json({
            items: result.items,
            total: result.total,
            page,
            perPage,
            logs: result.logs || []
        });
    } catch (error) {
        return Response.json({ error: error.message, logs: error.logs || [] }, { status: 500 });
    }
}

/**
 * 处理 Docker 详细备份任务（包含用户选择的 tags）
 */
export async function handleDockerDetailedProject(request, env) {
    await ensureProjectsTable(env);
    const { type, repo, bucketId, tags } = await request.json();

    if (type !== 'docker') {
        return Response.json({ error: '类型错误，应为 docker' }, { status: 400 });
    }

    if (!repo || !bucketId || !tags || !Array.isArray(tags)) {
        return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const bucket = await env.DB.prepare("SELECT id FROM buckets WHERE id = ?").bind(bucketId).first();
    if (!bucket) {
        return Response.json({ error: '指定的桶不存在' }, { status: 400 });
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    await env.TASKS_QUEUE.send(JSON.stringify({
        type: 'docker-master',
        taskId,
        repo,
        bucketId,
        tags
    }));

    await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
        status: 'queued',
        repo,
        bucketId,
        tagsCount: tags.length,
        createdAt: Date.now()
    }));

    return Response.json({ success: true, taskId, message: 'Docker 备份任务已提交，正在处理' });
}