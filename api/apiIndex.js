// api/apiIndex.js
import { handleSearch } from './search.js';
import { handleProjects, handleProject, handleRepoTree, handleRepoReleases, handleDetailedProject } from './projects.js';
import { handleBuckets } from './buckets.js';
import { handleConfig } from './config.js';
import { handleTask } from './task.js';
import { handleQueueStatus } from '../queue.js';
import { handleVerify } from './verify.js';
import { handleGithubTokens, handleDockerTokens } from './tokens.js';

export async function handleAPI(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.slice(5); // 去掉 '/api/'

  if (path === 'search' && method === 'GET') {
    return handleSearch(request, env);
  }
  if (path === 'projects/github' && method === 'GET') {
    return handleProjects('github', env);
  }
  if (path === 'projects/docker' && method === 'GET') {
    return handleProjects('docker', env);
  }
  if (path === 'project' && method === 'POST') {
    return handleProject(request, env);
  }
  if (path === 'project/detailed' && method === 'POST') {
    return handleDetailedProject(request, env);
  }
  if (path === 'repo-tree' && method === 'GET') {
    return handleRepoTree(request, env);
  }
  if (path === 'repo-releases' && method === 'GET') {
    return handleRepoReleases(request, env);
  }
  if (path === 'buckets' && (method === 'GET' || method === 'POST')) {
    return handleBuckets(request, env);
  }
  if (path === 'config' && (method === 'GET' || method === 'POST')) {
    return handleConfig(request, env);
  }
  if (path.startsWith('task/') && method === 'GET') {
    return handleTask(request, env);
  }
  if (path === 'queue/status' && method === 'GET') {
    return handleQueueStatus(request, env);
  }
  if (path === 'verify-bucket' && method === 'POST') {
    return handleVerify(request, env);
  }
  if (path === 'tokens/github') {
    return handleGithubTokens(request, env);
  }
  if (path === 'tokens/docker') {
    return handleDockerTokens(request, env);
  }
  return new Response('API not found', { status: 404 });
}