// lib/dockerDownloader.js
import { getDockerTags } from './docker.js';

/**
 * 获取 Docker 镜像的 tags 列表（用于备份选择）
 * @param {string} owner - 命名空间
 * @param {string} repo - 仓库名
 * @returns {Promise<Array<{name: string, last_updated: string, digest: string, size: number}>>}
 */
export async function getDockerTagsList(owner, repo) {
    return await getDockerTags(owner, repo);
}