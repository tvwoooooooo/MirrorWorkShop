// api/projects.js
import { getJSON, putJSON, defaultGithubProjects, defaultDockerProjects } from '../lib/kv.js';

export async function handleProjects(type, env) {
  const kvKey = type === 'github' ? 'projects_github' : 'projects_docker';
  const defaultVal = type === 'github' ? defaultGithubProjects : defaultDockerProjects;
  const projects = await getJSON(env.B2_KV, kvKey, defaultVal);
  return Response.json(projects);
}

export async function handleProject(request, env) {
  const { type, name, bucketId, backupOptions } = await request.json();

  if (type !== 'github') {
    return Response.json({ error: '目前仅支持 GitHub 项目完整备份' }, { status: 400 });
  }

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

  await env.TASKS_QUEUE.send(JSON.stringify({
    type: 'master',
    taskId,
    owner,
    repo,
    bucketId,
    backupOptions,
  }));

  await env.B2_KV.put(`master:${taskId}`, JSON.stringify({
    status: 'queued',
    owner,
    repo,
    bucketId,
    backupOptions,
    createdAt: Date.now()
  }));

  return Response.json({ success: true, taskId, message: '完整备份任务已提交，正在处理' });
}