// lib/githubDownloader.js
export async function getRepoFileTree(owner, repo, branch = 'HEAD') {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(treeUrl, {
    headers: { 'User-Agent': 'B2-Mirror-Worker' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.tree.filter(item => item.type === 'blob').map(item => item.path);
}