// api/projects.js
import { getJSON, putJSON, defaultGithubProjects, defaultDockerProjects } from '../lib/kv.js';
import { getRepoFileTree } from '../lib/githubDownloader.js';
import { getReleaseAssets } from '../lib/githubReleases.js';
import { createMasterTask } from '../lib/taskManager.js';

export async function handleProjects(type, env) {
  const kvKey = type === 'github' ? 'projects_github' : 'projects_docker';
  const defaultVal = type === 'github' ? defaultGithubProjects : defaultDockerProjects;
  const projects = await getJSON(env.B2_KV, kvKey, defaultVal);
  return Response.json(projects);
}

export async function handleProject(request, env) {
  const { type, name, bucketId, backupFiles, releases } = await request.json();

  if (type !== 'github') {
    return Response.json({ error: '目前仅支持 GitHub 项目完整备份' }, { status: 400 });
  }

  // 验证桶是否存在
  const buckets = await getJSON(env.B2_KV, 'buckets');
  const bucket = buckets.find(b => b.id === bucketId);
  if (!bucket) {
    return Response.json({ error: '指定的桶不存在' }, { status: 400 });
  }

  const [owner, repo] = name.split('/');
  if (!owner || !repo) {
    return Response.json({ error: 'Invalid repository name' }, { status: 400 });
  }

  const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // 收集所有需要备份的文件列表
  let allFiles = []; // 可以是字符串（文件路径）或对象 { url, path } 用于release资产

  // 备份代码文件
  if (backupFiles) {
    try {
      const filePaths = await getRepoFileTree(owner, repo, env);
      allFiles.push(...filePaths); // 字符串
    } catch (error) {
      return Response.json({ error: `获取文件树失败: ${error.message}` }, { status: 500 });
    }
  }

  // 备份Releases资产
  if (releases && releases.length > 0) {
    try {
      for (const tag of releases) {
        const assets = await getReleaseAssets(owner, repo, tag, env);
        // 每个资产转换为对象 { url, path }，path 可自定义存储路径
        const assetObjects = assets.map(asset => ({
          url: asset.browser_download_url,
          path: `${owner}/${repo}/releases/${tag}/${asset.name}` // 存储路径
        }));
        allFiles.push(...assetObjects);
      }
    } catch (error) {
      return Response.json({ error: `获取Releases资产失败: ${error.message}` }, { status: 500 });
    }
  }

  if (allFiles.length === 0) {
    return Response.json({ error: '没有要备份的内容' }, { status: 400 });
  }

  // 创建主任务，传入混合文件列表
  await createMasterTask(env, taskId, owner, repo, bucketId, allFiles);

  await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
    status: 'queued',
    owner,
    repo,
    bucketId,
    createdAt: Date.now()
  }));

  return Response.json({ success: true, taskId, message: '备份任务已提交，正在处理' });
}
