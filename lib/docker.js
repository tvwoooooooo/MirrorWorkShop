// lib/docker.js
import { getB2Client, uploadFile } from './batchProcessor.js';

// Docker Hub 认证端点
const DOCKER_AUTH_URL = 'https://auth.docker.io/token';
const DOCKER_REGISTRY = 'https://registry-1.docker.io';

// 内存中记录上次使用的 Docker 令牌索引（每个 isolate 独立）
let lastDockerTokenIndex = -1;

/**
 * 从 D1 获取所有 Docker 令牌（只返回 token 列表）
 */
async function getAllDockerTokens(env) {
    const { results } = await env.DB.prepare(
        "SELECT token FROM tokens WHERE type = ? ORDER BY id"
    ).bind('docker').all();
    return results.map(r => r.token);
}

/**
 * 获取下一个 Docker 令牌（内存轮询）
 */
function getNextDockerToken(tokens) {
    if (tokens.length === 0) return null;
    lastDockerTokenIndex = (lastDockerTokenIndex + 1) % tokens.length;
    return tokens[lastDockerTokenIndex];
}

/**
 * 根据 token 值更新使用次数
 */
async function incrementDockerTokenUsage(env, tokenValue) {
    const { results } = await env.DB.prepare(
        "SELECT id FROM tokens WHERE type = ? AND token = ? ORDER BY id"
    ).bind('docker', tokenValue).all();
    if (results.length > 0) {
        await env.DB.prepare(
            "UPDATE tokens SET usage_count = usage_count + 1 WHERE id = ?"
        ).bind(results[0].id).run();
    }
}

/**
 * 带重试的 Docker API 请求（先公共，后令牌）
 */
async function fetchDockerWithRetry(url, options, retries = 3, env) {
    const tokens = await getAllDockerTokens(env);
    const hasTokens = tokens.length > 0;

    for (let attempt = 0; attempt <= retries + (hasTokens ? tokens.length : 0); attempt++) {
        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'B2-Mirror-Worker'
            };
            let usedToken = null;

            if (attempt === 0) {
                // 公共 API（无 token）
            } else if (hasTokens) {
                usedToken = getNextDockerToken(tokens);
                if (usedToken) {
                    headers['Authorization'] = `Bearer ${usedToken}`;
                }
            }

            const res = await fetch(url, { ...options, headers });

            // 处理可能的限流或未授权
            if (res.status === 429 || res.status === 403 || res.status === 401) {
                if (attempt === 0 && hasTokens) {
                    // 公共 API 失败且有令牌，立即尝试令牌
                    continue;
                } else if (hasTokens && attempt <= tokens.length) {
                    // 还有令牌未用，立即尝试下一个
                    continue;
                } else {
                    // 所有令牌都用过或没有令牌，直接返回错误响应
                    return res;
                }
            }

            if (!res.ok) {
                // 其他错误，但可能不需要重试
                return res;
            }

            // 请求成功，更新使用计数
            if (usedToken) {
                await incrementDockerTokenUsage(env, usedToken);
            }
            return res;
        } catch (err) {
            // 网络错误等
            if (attempt === retries + tokens.length) throw err;
            // 短暂等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

/**
 * Docker Hub 搜索（使用官方搜索 API）
 * @param {string} query 搜索关键词
 * @param {number} page 页码
 * @param {number} perPage 每页数量
 * @param {Object} env 环境变量（用于获取令牌）
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function searchDockerHub(query, page = 1, perPage = 10, env) {
    const url = `https://hub.docker.com/v2/repositories?name=${encodeURIComponent(query)}&page=${page}&page_size=${perPage}`;
    try {
        const response = await fetchDockerWithRetry(url, { method: 'GET' }, 3, env);
        if (!response.ok) {
            console.error('Docker Hub search error:', response.status, await response.text());
            return { items: [], total: 0 };
        }
        const data = await response.json();
        const results = data.results || [];
        const items = results.map(item => {
            const namespace = item.namespace; // 可能为 'library' 或其他用户名
            const name = item.name;
            const fullName = namespace === 'library' ? name : `${namespace}/${name}`;
            return {
                name: fullName,
                description: item.description || '暂无描述',
                stars: item.star_count || 0,
                pulls: item.pull_count || 0,
                lastUpdate: item.last_updated ? item.last_updated.split('T')[0] : new Date().toISOString().split('T')[0],
                homepage: `https://hub.docker.com/r/${namespace}/${name}`,
                type: 'docker',
                namespace,
                repo: name,
                has_tags: true // 默认都有标签
            };
        });
        return { items, total: data.count || items.length };
    } catch (error) {
        console.error('Docker Hub search error:', error);
        return { items: [], total: 0 };
    }
}

/**
 * 获取镜像的标签列表
 * @param {string} namespace
 * @param {string} repo
 * @param {Object} env
 * @returns {Promise<Array>}
 */
export async function getImageTags(namespace, repo, env) {
    const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags?page_size=100`;
    try {
        const response = await fetchDockerWithRetry(url, { method: 'GET' }, 3, env);
        if (!response.ok) throw new Error('Failed to fetch tags');
        const data = await response.json();
        return data.results.map(tag => ({
            name: tag.name,
            digest: tag.digest,
            lastUpdate: tag.last_updated,
            size: tag.full_size
        }));
    } catch (error) {
        console.error('Get image tags error:', error);
        return [];
    }
}

/**
 * 获取 Docker Hub 访问令牌（用于 registry）
 * @param {string} namespace
 * @param {string} repo
 * @param {string} userToken 用户提供的 Docker Hub 令牌（可选）
 * @returns {Promise<string>}
 */
async function getDockerToken(namespace, repo, userToken = null) {
    if (userToken) {
        // 如果用户提供了令牌，直接使用 Bearer 认证
        return userToken;
    }
    // 匿名获取 pull 权限 token
    const scope = `repository:${namespace}/${repo}:pull`;
    const url = `${DOCKER_AUTH_URL}?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to obtain Docker token');
    const data = await res.json();
    return data.token;
}

/**
 * 获取镜像 manifest（只接受单平台 manifest）
 * @param {string} namespace
 * @param {string} repo
 * @param {string} tag
 * @param {string} token
 * @returns {Promise<Object>}
 */
async function getManifest(namespace, repo, tag, token) {
    const url = `${DOCKER_REGISTRY}/v2/${namespace}/${repo}/manifests/${tag}`;
    const headers = {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
        'User-Agent': 'B2-Mirror-Worker'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Manifest fetch failed (${res.status}): ${errorText.substring(0, 200)}`);
    }
    const contentType = res.headers.get('content-type');
    if (contentType !== 'application/vnd.docker.distribution.manifest.v2+json') {
        throw new Error(`Unsupported manifest type: ${contentType} (multi-arch not supported yet)`);
    }
    return await res.json();
}

/**
 * 下载 blob（层或配置）
 * @param {string} namespace
 * @param {string} repo
 * @param {string} digest
 * @param {string} token
 * @returns {Promise<Response>}
 */
async function downloadBlob(namespace, repo, digest, token) {
    const url = `${DOCKER_REGISTRY}/v2/${namespace}/${repo}/blobs/${digest}`;
    const headers = { 'User-Agent': 'B2-Mirror-Worker' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`Blob download failed (${res.status}): ${await res.text()}`);
    }
    return res;
}
