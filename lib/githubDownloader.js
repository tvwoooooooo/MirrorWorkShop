// lib/githubDownloader.js
import { githubFetch } from './github.js';

export async function getRepoFileTree(owner, repo, env, branch = 'HEAD') {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await githubFetch(url, { method: 'GET' }, env);
  const data = await res.json();
  if (!data.tree) {
    throw new Error('GitHub API returned no tree data');
  }
  return data.tree.filter(item => item.type === 'blob').map(item => item.path);
}

export async function getReleaseAssets(owner, repo, tag, env) {
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
  const res = await githubFetch(releaseUrl, { method: 'GET' }, env);
  if (!res.ok) {
    throw new Error(`Failed to get release ${tag}: ${res.status}`);
  }
  const release = await res.json();
  return release.assets.map(asset => ({
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  }));
}