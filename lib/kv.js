// lib/kv.js
export async function getJSON(kv, key, defaultValue = null) {
  const val = await kv.get(key, 'json');
  return val !== null ? val : defaultValue;
}

export async function putJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

export const defaultGithubProjects = [
  {
    name: 'vuejs/core',
    lastUpdate: '2025-03-12',
    homepage: 'https://github.com/vuejs/core',
    bucketId: 'default',
    versions: [
      {
        date: '2025-03-14',
        files: ['src/', 'README.md', 'package.json', 'index.js', '.gitignore'],
        releases: [
          { tag: 'v3.5.0', date: '2025-03-10' },
          { tag: 'v3.4.0', date: '2025-02-15' }
        ]
      },
      {
        date: '2025-02-10',
        files: ['src/', 'README.md', 'package.json', 'old.js', '.gitignore'],
        releases: [
          { tag: 'v3.4.0', date: '2025-02-15' }
        ]
      }
    ]
  }
];

export const defaultDockerProjects = [
  {
    name: 'library/nginx',
    lastUpdate: '2025-03-11',
    homepage: 'https://hub.docker.com/_/nginx',
    bucketId: 'bucket-2',
    versions: [
      {
        date: '2025-03-15',
        tags: ['latest', 'alpine', '1.27'],
        releases: [
          { tag: '1.27.0', date: '2025-03-10', digest: 'sha256:abc123' }
        ]
      }
    ]
  }
];

export const defaultBuckets = [
  { customName: '我的默认桶', id: 'default', usage: 2.3, total: 5, endpoint: 's3.ca-east-006.backblazeb2.com' },
  { customName: '我的桶2', id: 'bucket-2', usage: 1.1, total: 5, endpoint: 's3.eu-central-003.backblazeb2.com' },
  { customName: '我的桶3', id: 'bucket-3', usage: 0.4, total: 5, endpoint: 's3.us-west-001.backblazeb2.com' }
];

export const defaultConfig = {
  officialHostname: 'https://gh-mirror.example.com',
  bucketHostname: 'https://b2-mirror.example.com',
  monitor: { enabled: true, scope: 'all', customProjects: [], intervalDays: 1 }
};