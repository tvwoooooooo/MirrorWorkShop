// lib/kv.js
export async function getJSON(kv, key, defaultValue = null) {
  const val = await kv.get(key, 'json');
  return val !== null ? val : defaultValue;
}

export async function putJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

// 默认数据不再需要，因为从 D1 读取