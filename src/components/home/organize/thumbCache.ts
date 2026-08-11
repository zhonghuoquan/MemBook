/**
 * 缩略图缓存模块 — 性能优化核心
 *
 * 解决问题：
 * 1. 照片整理工具（相似分析/人脸识别/时间线/日历/去重）显示大量缩略图时卡顿
 * 2. 日历 28px 小图也加载几 MB 原图，浪费内存和 CPU
 * 3. 同一照片在多处重复加载
 *
 * 优化策略：
 * - **Canvas 缩小**：加载完整数据后用 createImageBitmap + Canvas 缩小到目标尺寸，
 *   原始 ArrayBuffer 立即释放，blob URL 只持有缩小后的小图（几 KB）
 * - **全局 LRU 缓存**：按 `photoId:sizeKey` 缓存，同一照片同一尺寸只生成一次
 * - **并发去重**：同一照片并发请求只发起一次 IO
 *
 * 尺寸分级（displayPx 是 CSS 显示尺寸，dim 是 2x DPI 渲染尺寸）：
 * - tiny   64px  → 日历格子（28px 显示）
 * - small  128px → 列表项（72px 显示）
 * - medium 256px → 网格（120px 显示）
 * - full   原图  → 大图预览
 */

import type { PhotoFileInfo } from '../../../photo-tools';
import { ensureSupportedFormat } from '../../../engine/storage/heic-converter';
import { isHeicFile } from '../../../engine/storage/utils';

export type ThumbSize = 'tiny' | 'small' | 'medium' | 'full';

/** HEIC 转换结果缓存（按 photoId），避免同一 HEIC 照片多次转换 */
const heicConvertedCache = new Map<string, Blob>();

const SIZE_DIM: Record<ThumbSize, number> = {
  tiny: 64,
  small: 128,
  medium: 256,
  full: 0, // 0 = 不缩小，用原图
};

/** 缓存条目 */
interface CacheEntry {
  url: string;
  lastUsed: number;
}

/** 缓存：key = `${photoId}:${sizeKey}` */
const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 400;

/** 正在加载的请求：避免同一照片并发加载 */
const inflight = new Map<string, Promise<string | null>>();

/**
 * 用 Canvas 将图片数据缩小到目标尺寸（保持原始宽高比），返回缩小后的 blob URL
 *
 * 关键：不能用 createImageBitmap 的 resizeWidth+resizeHeight 同时设为同值，
 * 那会把非正方形图片压扁成正方形。正确做法是先解码原图获取宽高，
 * 再按 Math.min(dim/w, dim/h, 1) 计算等比缩放尺寸。
 *
 * 优先用 createImageBitmap（解码更快），fallback 到 Image + Canvas
 */
async function shrinkToThumb(
  blob: Blob,
  targetDim: number,
): Promise<string | null> {
  // 方案 1：createImageBitmap 解码（不设 resize，获取原始尺寸）+ Canvas 等比缩放
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(targetDim / bitmap.width, targetDim / bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const outBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.75),
    );
    if (!outBlob) return null;
    return URL.createObjectURL(outBlob);
  } catch {
    // 方案 2 fallback：Image 元素 + Canvas（兼容性更好）
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(targetDim / img.width, targetDim / img.height, 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (outBlob) => {
            if (!outBlob) {
              resolve(null);
              return;
            }
            resolve(URL.createObjectURL(outBlob));
          },
          'image/jpeg',
          0.75,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }
}

/**
 * 生成缩略图 URL
 * - full 模式：直接用原始数据创建 blob URL（不缩小）
 * - 其他模式：Canvas 缩小到目标尺寸
 */
async function generateThumb(
  photo: PhotoFileInfo,
  sizeKey: ThumbSize,
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>,
): Promise<string | null> {
  const buf = await readPhotoData(photo);
  if (!buf) return null;

  const dim = SIZE_DIM[sizeKey];
  const mime = photo.mimeType || 'image/jpeg';
  let blob = new Blob([buf], { type: mime });

  // HEIC 格式浏览器无法原生解码，需先转换为 JPEG
  // 转换结果按 photoId 缓存，避免同一照片不同尺寸重复转换
  if (isHeicFile(photo.name)) {
    let converted = heicConvertedCache.get(photo.id);
    if (!converted) {
      try {
        const file = new File([buf], photo.name, { type: mime });
        const jpegFile = await ensureSupportedFormat(file);
        converted = new Blob([await jpegFile.arrayBuffer()], { type: 'image/jpeg' });
        heicConvertedCache.set(photo.id, converted);
      } catch {
        // 转换失败则用原 blob（shrinkToThumb 会进一步处理失败）
      }
    }
    if (converted) blob = converted;
  }

  // full：直接返回原始 blob URL（大图预览用）
  if (dim === 0) {
    return URL.createObjectURL(blob);
  }

  // 缩小到目标尺寸
  return shrinkToThumb(blob, dim);
}

/** LRU 淘汰：淘汰最久未使用的条目 */
function evictIfNeeded() {
  if (cache.size < CACHE_LIMIT) return;
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [k, v] of cache) {
    if (v.lastUsed < oldestTime) {
      oldestTime = v.lastUsed;
      oldestKey = k;
    }
  }
  if (oldestKey) {
    const evicted = cache.get(oldestKey);
    if (evicted) URL.revokeObjectURL(evicted.url);
    cache.delete(oldestKey);
  }
}

/**
 * 获取缩略图 URL（带缓存 + 并发去重）
 *
 * @param photo 照片信息
 * @param sizeKey 尺寸分级
 * @param readPhotoData 读取照片二进制的统一入口
 * @returns blob URL（失败返回 null）
 */
export async function getThumbUrl(
  photo: PhotoFileInfo,
  sizeKey: ThumbSize,
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>,
): Promise<string | null> {
  // Web 模式有 thumbUrl 直接用（已经是缩略图）
  if (photo.thumbUrl) return photo.thumbUrl;

  const key = `${photo.id}:${sizeKey}`;

  // 命中缓存
  const cached = cache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.url;
  }

  // 并发去重：复用正在进行的加载
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const url = await generateThumb(photo, sizeKey, readPhotoData);
      if (url) {
        evictIfNeeded();
        cache.set(key, { url, lastUsed: Date.now() });
      }
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** 清除所有缓存（切换标签/关闭面板时调用，释放内存） */
export function clearThumbCache() {
  for (const { url } of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
  inflight.clear();
  heicConvertedCache.clear();
}

/**
 * 从缓存中移除指定照片的所有尺寸条目
 * 用于照片被删除时清理缓存，避免内存泄漏和悬挂 URL
 */
export function evictFromCache(photoId: string) {
  const keysToDelete: string[] = [];
  for (const [key, entry] of cache) {
    if (key.startsWith(`${photoId}:`)) {
      keysToDelete.push(key);
      URL.revokeObjectURL(entry.url);
    }
  }
  for (const k of keysToDelete) cache.delete(k);
  // 同时清理 HEIC 转换缓存
  heicConvertedCache.delete(photoId);
}
