// api/projects.js
import { getRepoFileTree } from '../lib/githubDownloader.js';
import { fetchWithRetry } from '../lib/github.js';

/**
 * 初始化 projects 表（如果不存在）
 */
async function initProjectsTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            homepage TEXT NOT NULL,
            last_update TEXT,
            versions TEXT,
            UNIQUE(type, name)
        )
    `).run();
}

/**
 * 获取已备份的项目列表（用于首页展示）
 */
export async function handleProjects(type, env) {
    await initProjectsTable(env);
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
    await initProjectsTable(env);
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
        await env.TASKS_QUEUE.send(JSON.stringify({
            type: 'master',
            taskId,
            owner,
            repo,
            bucketId,
            files: filePaths,
            assets: []
        }));
    } catch (error) {
        return Response.json({ error: `获取文件树失败: ${error.message}` }, { status: 500 });
    }

    await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
        status: 'queued',
        owner,
        repo,
        bucketId,
        createdAt: Date.now()
    }));

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
    await initProjectsTable(env);
    const { type, owner, repo, bucketId, files, assets } = await request.json();

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

    // 发送主任务到队列（包含文件列表和资产列表）
    await env.TASKS_QUEUE.send(JSON.stringify({
        type: 'master',
        taskId,
        owner,
        repo,
        bucketId,
        files: files || [],
        assets: assets || []
    }));

    await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
        status: 'queued',
        owner,
        repo,
        bucketId,
        filesCount: files?.length || 0,
        assetsCount: assets?.length || 0,
        createdAt: Date.now()
    }));

    return Response.json({ success: true, taskId, message: '详细备份任务已提交，正在处理' });
}
