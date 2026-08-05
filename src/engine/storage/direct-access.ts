import { IMAGE_EXTS } from './utils';
import { logger } from '../../utils/logger';
import { LRUCache } from '../../utils/lruCache';
import type { FSADirectoryHandle, FSAFileHandle } from './fsa-types';

let directoryHandle: FSADirectoryHandle | null = null;

/* ── P1-1: direct 模式 blob URL LRU 缓存 ──
 * readDirectPhoto 每次调用都会 URL.createObjectURL(file)，无缓存时同一照片
 * 被多次读取会产生多个 blob URL，旧的不会被 revoke，导致内存泄漏。
 * LRU 缓存复用已创建的 blob URL，淘汰时延迟 revoke 避免 <img> 仍引用时被回收。
 *
 * P0: 容量从 100 降到 30。direct 模式下每个 URL 指向整个原文件（5-10MB），
 *   100 条 = 500MB-1GB，是 2GB 照片导入后内存 1.3GB 的主因。
 *   编辑器画布同时可见的照片有限（单页 8-12 张），30 足够覆盖当前页+相邻页。 */
const DIRECT_URL_CACHE_CAPACITY = 15;
const DIRECT_URL_REVOCATION_DELAY_MS = 60_000;
interface DirectUrlEntry { url: string; revokeTimer: ReturnType<typeof setTimeout> | null; }
const directUrlCache = new LRUCache<string, DirectUrlEntry>(DIRECT_URL_CACHE_CAPACITY, (_key, entry) => {
  // LRU 淘汰时延迟 60s revoke，避免 <img> 仍引用该 URL 时被回收导致裂图
  if (entry.revokeTimer) clearTimeout(entry.revokeTimer);
  entry.revokeTimer = setTimeout(() => {
    URL.revokeObjectURL(entry.url);
  }, DIRECT_URL_REVOCATION_DELAY_MS);
});

/** 从缓存中移除并立即 revoke（用于照片删除等场景）。
 *  P0: 之前调用 directUrlCache.evict 触发 onEvict（延迟 60s revoke），
 *    导致删除照片后内存 60s 内不释放。现在改为 delete + 立即 revoke。 */
export function evictDirectPhotoUrl(filePath: string): void {
  const entry = directUrlCache.get(filePath);
  if (entry) {
    if (entry.revokeTimer) clearTimeout(entry.revokeTimer);
    directUrlCache.delete(filePath);
    URL.revokeObjectURL(entry.url);
  }
}

/** 清空所有 direct 模式 blob URL 缓存（用于项目切换/退出编辑器）。
 *  P0: 项目切换时不清理 directUrlCache，旧项目 30 条原文件 blob URL（每条 5-10MB）
 *    全部残留，导致退出编辑器后内存不释放。 */
export function clearAllDirectPhotoUrls(): void {
  // 逐个 evictDirectPhotoUrl 立即 revoke，避免 clear() 的延迟 60s 回收
  const keys = Array.from(directUrlCache.keys());
  for (const key of keys) {
    evictDirectPhotoUrl(key);
  }
}

/** 检测浏览器是否支持 File System Access API */
export function supportsDirectAccess(): boolean {
  return typeof window.showDirectoryPicker === 'function' &&
         typeof FileSystemFileHandle !== 'undefined';
}

/** 请求用户选择一个照片文件夹，保存句柄 */
export async function pickPhotoDirectory(): Promise<boolean> {
  try {
    directoryHandle = await window.showDirectoryPicker!({ mode: 'read' });
    // 持久化句柄（IndexedDB 可序列化 FileSystemDirectoryHandle）
    const { setDirectHandle } = await import('../handle-store');
    await setDirectHandle(directoryHandle);
    return true;
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return false;
    logger.error('选择文件夹失败:', err);
    return false;
  }
}

/** 恢复之前保存的目录句柄 */
export async function restoreDirectoryHandle(): Promise<boolean> {
  try {
    const { getDirectHandle } = await import('../handle-store');
    const handle = await getDirectHandle();
    if (handle) {
      // 验证权限
      if ((await handle.queryPermission({ mode: 'read' })) === 'granted' ||
          (await handle.requestPermission({ mode: 'read' })) === 'granted') {
        directoryHandle = handle;
        return true;
      }
    }
  } catch { /* handle invalid or revoked */ }
  return false;
}

/** 从直接访问模式读取图片文件
 *  P1-1: 加 LRU 缓存，避免同一照片被多次读取时创建多个 blob URL 导致泄漏 */
export async function readDirectPhoto(filePath: string): Promise<string | null> {
  if (!directoryHandle) {
    const ok = await restoreDirectoryHandle();
    if (!ok) return null;
  }
  // 安全：过滤路径遍历攻击（../ 或绝对路径），只允许相对子路径
  if (!filePath || filePath.includes('..') || /^[\\/]/.test(filePath)) {
    logger.warn('[security] readDirectPhoto: 非法路径已拒绝:', filePath);
    return null;
  }

  // P1-1: 缓存命中直接返回已有 blob URL
  const cached = directUrlCache.get(filePath);
  if (cached) {
    // 取消待 revoke 定时器（URL 又被使用了，不应被回收）
    if (cached.revokeTimer) {
      clearTimeout(cached.revokeTimer);
      cached.revokeTimer = null;
    }
    return cached.url;
  }

  try {
    // 路径格式: "subfolder/filename.jpg"
    const parts = filePath.split('/');
    let handle: FSADirectoryHandle | FSAFileHandle = directoryHandle!;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part || part === '.') continue; // 跳过空段和当前目录
      handle = await (handle as FSADirectoryHandle).getDirectoryHandle(part);
    }
    const fileHandle = await (handle as FSADirectoryHandle).getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    directUrlCache.set(filePath, { url, revokeTimer: null });
    return url;
  } catch {
    return null;
  }
}

/** 读取目录下的所有图片文件（直接访问模式） */
export async function scanDirectPhotos(): Promise<{ file: File; relativePath: string }[]> {
  if (!directoryHandle) {
    const ok = await restoreDirectoryHandle();
    if (!ok) return [];
  }
  const results: { file: File; relativePath: string }[] = [];
  await scanDirRecursive(directoryHandle!, '', results);
  return results;
}

async function scanDirRecursive(
  dirHandle: FSADirectoryHandle,
  path: string,
  results: { file: File; relativePath: string }[],
) {
  const imageExts = IMAGE_EXTS;
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      // 跳过隐藏目录和node_modules
      if (!name.startsWith('.')) {
        await scanDirRecursive(handle as FSADirectoryHandle, fullPath, results);
      }
    } else if (handle.kind === 'file') {
      const ext = '.' + name.split('.').pop()?.toLowerCase();
      if (imageExts.has(ext)) {
        try {
          const file = await (handle as FSAFileHandle).getFile();
          results.push({ file, relativePath: fullPath });
        } catch { /* skip unreadable files */ }
      }
    }
  }
}
