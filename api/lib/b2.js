// lib/b2.js
export function extractRegionFromEndpoint(ep) {
  const match = ep.match(/^s3\.([\w-]+)\.backblazeb2\.com$/);
  return match ? match[1] : 'us-east-1';
}