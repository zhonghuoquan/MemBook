/**
 * P1-3 ImageBitmap 加载器
 *
 * 用 createImageBitmap 替代 HTMLImageElement 的核心收益：
 * - ImageBitmap 可主动 close() 立即释放位图内存（HTMLImageElement.src='' 依赖 GC，时机不确定）
 * - ImageBitmap 可指定 resizeWidth/Height，加载时即降采样，避免加载 4096px 原图后再缩放
 * - ImageBitmap 是 Transferable 对象，可零拷贝传递给 Worker
 *
 * Konva.Image 接受 CanvasImageSource，ImageBitmap 是其中一种，可直接传入。
 * gridThumbnailRenderer 的 ctx.drawImage 也接受 ImageBitmap。
 *
 * 注意：ImageBitmap 没有 naturalWidth/naturalHeight，用 width/height 替代。
 */

import { LRUCache } from './lruCache';
import { loadImage } from './tauri';

/** ImageBitmap 缓存：淘汰时主动 close() 释放位图内存 */
const BITMAP_CACHE_CAPACITY = 100;
const bitmapCache = new LRUCache<string, ImageBitmap>(BITMAP_CACHE_CAPACITY, (_key, bmp) => {
  try {
    bmp.close();
  } catch { /* ignore */ }
});

/** P1-4：loadImageBitmap 并发去重表。同一 cacheKey 并发调用共享一个 Promise，避免重复 fetch/解码。 */
const pendingBitmapLoads = new Map<string, Promise<ImageBitmap>>();

export interface LoadBitmapOptions {
  /** 最大宽度，超过则降采样（用于按 LOD 级别加载） */
  maxWidth?: number;
  /** 最大高度，超过则降采样 */
  maxHeight?: number;
}

/**
 * 加载图片为 ImageBitmap（带缓存）。
 * 支持 blob:/data:/asset:/http(s): URL。
 * 失败时抛错，调用方可回退到 HTMLImageElement。
 */
export async function loadImageBitmap(src: string, options: LoadBitmapOptions = {}): Promise<ImageBitmap> {
  const { maxWidth, maxHeight } = options;

  // 缓存 key：包含尺寸约束，不同尺寸不共享
  const cacheKey = maxWidth || maxHeight
    ? `${src}|${maxWidth ?? 0}x${maxHeight ?? 0}`
    : src;

  const cached = bitmapCache.get(cacheKey);
  if (cached) return cached;

  // P1-4 并发去重：同一 cacheKey 进行中则复用 Promise
  const pending = pendingBitmapLoads.get(cacheKey);
  if (pending) return pending;

  const p = (async () => {
    // P0-fix CSP: data: URL 不能用 fetch（CSP connect-src 不允许 data: 协议）。
    //   dataURL 通过 Image.src 加载（CSP img-src 允许），再用 createImageBitmap(img) 转换。
    //   blob:/asset:/http(s): 仍用 fetch 获取 Blob。
    const bitmapOpts: ImageBitmapOptions = {};
    if (maxWidth) { bitmapOpts.resizeWidth = maxWidth; bitmapOpts.resizeQuality = 'medium'; }
    if (maxHeight) { bitmapOpts.resizeHeight = maxHeight; bitmapOpts.resizeQuality = 'medium'; }

    if (src.startsWith('data:')) {
      // dataURL → Image → ImageBitmap（绕过 fetch 的 CSP 限制）
      const img = await loadImage(src);
      const bmp = await createImageBitmap(img, bitmapOpts);
      bitmapCache.set(cacheKey, bmp);
      return bmp;
    }

    const blob = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(`加载失败: ${src.slice(0, 80)}`);
      return r.blob();
    });
    const bmp = await createImageBitmap(blob, bitmapOpts);
    bitmapCache.set(cacheKey, bmp);
    return bmp;
  })();

  pendingBitmapLoads.set(cacheKey, p);
  const clearDedup = () => { pendingBitmapLoads.delete(cacheKey); };
  p.then(clearDedup, clearDedup);
  return p;
}

/** 预加载到缓存（不返回，仅填充缓存） */
export async function preloadImageBitmap(src: string, options: LoadBitmapOptions = {}): Promise<void> {
  try {
    await loadImageBitmap(src, options);
  } catch { /* 预加载失败静默忽略 */ }
}

/** 从缓存中移除并释放（用于主动释放特定图片） */
export function releaseImageBitmap(src: string, options: LoadBitmapOptions = {}): void {
  const { maxWidth, maxHeight } = options;
  const cacheKey = maxWidth || maxHeight
    ? `${src}|${maxWidth ?? 0}x${maxHeight ?? 0}`
    : src;
  bitmapCache.evict(cacheKey);
}

/** 获取缓存大小（调试用） */
export function getBitmapCacheSize(): number {
  return bitmapCache.size;
}

/** 清空全部 ImageBitmap 缓存（项目切换时调用） */
export function clearBitmapCache(): void {
  bitmapCache.clear();
}

/** 检查 createImageBitmap 是否可用（旧 WebView2 可能不支持） */
export function isImageBitmapSupported(): boolean {
  return typeof createImageBitmap === 'function';
}
