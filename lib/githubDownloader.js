// lib/githubDownloader.js
import { fetchWithRetry } from './github.js';

export async function getRepoFileTree(owner, repo, env, branch = 'HEAD') {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetchWithRetry(url, { method: 'GET' }, 3, env); // 不再传入 token
  const data = await res.json();
  if (!data.tree) {
    throw new Error('GitHub API returned no tree data');
  }
  return data.tree.filter(item => item.type === 'blob').map(item => item.path);
}