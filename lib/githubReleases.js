// lib/githubReleases.js
import { fetchWithRetry } from './github.js';

export async function getReleaseAssets(owner, repo, tag, env) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
  const res = await fetchWithRetry(url, { method: 'GET' }, 3, null, env);
  const data = await res.json();
  if (!data.assets) {
    throw new Error(`Release ${tag} has no assets or not found`);
  }
  return data.assets.map(asset => ({
    name: asset.name,
    size: asset.size,
    browser_download_url: asset.browser_download_url,
    content_type: asset.content_type
  }));
}