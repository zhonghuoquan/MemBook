/**
 * Blob URL 统一管理：按 photoId 引用计数，避免内存泄漏。
 * 同一 photoId 的 Blob URL 只创建一次，多处引用共享，全部释放后才 revoke。
 */

interface CacheEntry {
  url: string;
  refCount: number;
}

const cache = new Map<string, CacheEntry>();
// 反向映射：url → photoId，用于通过 URL 查找
const urlToKey = new Map<string, string>();

/**
 * 获取（或创建）指定 key 的 Blob URL。
 * 多次调用同一 key 会增加引用计数，共享同一个 URL。
 */
export function getBlobUrl(key: string, blob: Blob): string {
  const existing = cache.get(key);
  if (existing) {
    existing.refCount++;
    return existing.url;
  }
  const url = URL.createObjectURL(blob);
  cache.set(key, { url, refCount: 1 });
  urlToKey.set(url, key);
  return url;
}

/**
 * 释放指定 key 的一个引用。引用计数归零时撤销 URL。
 */
export function releaseBlobUrl(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    URL.revokeObjectURL(entry.url);
    cache.delete(key);
    urlToKey.delete(entry.url);
  }
}

/**
 * 通过 URL 释放引用（如果该 URL 是由本缓存管理的）。
 */
export function releaseBlobUrlByUrl(url: string): void {
  const key = urlToKey.get(url);
  if (key) {
    releaseBlobUrl(key);
  } else if (url.startsWith('blob:')) {
    // 不在缓存中的 blob URL，直接撤销
    URL.revokeObjectURL(url);
  }
}

/**
 * 检查 key 是否已有缓存的 Blob URL。
 */
export function hasBlobUrl(key: string): boolean {
  return cache.has(key);
}

/**
 * 获取已缓存的 URL（不增加引用计数）。
 */
export function peekBlobUrl(key: string): string | undefined {
  return cache.get(key)?.url;
}

/**
 * 清空所有缓存的 Blob URL（如切换项目时）。
 */
export function clearAllBlobUrls(): void {
  for (const { url } of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
  urlToKey.clear();
}
