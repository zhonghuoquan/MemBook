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

/** HEIC 转换缓存上限：只保留最近处理的一小批，避免大 HEIC 相册浏览时无限增长 */
const HEIC_CACHE_LIMIT = 100;
/** 人脸裁剪缩略图缓存 key 前缀（与普通缩略图分开，避免误清） */
const FACE_CACHE_PREFIX = 'face:';

/** 写入 HEIC 转换缓存（超上限时淘汰最旧条目），防止 Map 无界增长 */
export function setHeicConvertedCache(photoId: string, blob: Blob): void {
  if (heicConvertedCache.size >= HEIC_CACHE_LIMIT) {
    const oldest = heicConvertedCache.keys().next().value;
    if (oldest !== undefined) heicConvertedCache.delete(oldest);
  }
  heicConvertedCache.set(photoId, blob);
}
/** 当前 HEIC 转换缓存条目数（主要供测试断言缓存有界） */
export function getHeicConvertedCacheSize(): number { return heicConvertedCache.size; }

/** 判断某缓存 key 是否属于指定照片：普通 `${photoId}:` 前缀 **或** 人脸 `face:${photoId}:` 前缀 */
export function isPhotoCacheKey(photoId: string, key: string): boolean {
  return key.startsWith(`${photoId}:`) || key.startsWith(`${FACE_CACHE_PREFIX}${photoId}:`);
}

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
        setHeicConvertedCache(photo.id, converted);
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
    // 同时命中普通 `${photoId}:` 与人脸 `face:${photoId}:` 前缀，避免人脸缩略图 URL 在照片删除后泄漏
    if (isPhotoCacheKey(photoId, key)) {
      keysToDelete.push(key);
      URL.revokeObjectURL(entry.url);
    }
  }
  for (const k of keysToDelete) cache.delete(k);
  // 同时清理 HEIC 转换缓存
  heicConvertedCache.delete(photoId);
}

/** 生成人脸裁剪缩略图 — 根据人脸在照片中的相对位置裁剪放大，
 * 让人脸区域清晰可辨（解决有人脸照片缩略图模糊的问题）。
 *
 * @param photo 照片信息
 * @param face 人脸记录（含相对位置 x/y/width/height，均为 0-1）
 * @param readPhotoData 读取照片二进制
 * @param targetDim 输出缩略图边长（默认 256，2x DPI 下更清晰）
 * @param margin 人脸边界外扩比例（相对人脸宽高），默认 0.45，让裁剪框包含更多上下文
 */
export async function getFaceThumbUrl(
  photo: PhotoFileInfo,
  face: { x: number; y: number; width: number; height: number },
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>,
  targetDim = 256,
  margin = 0.45,
): Promise<string | null> {
  // Web 模式已有完整 thumbUrl 时，直接返回（人脸裁剪需要原始数据，此处忽略 thumbUrl）
  const key = `${FACE_CACHE_PREFIX}${photo.id}:${face.x.toFixed(3)}:${face.y.toFixed(3)}:${face.width.toFixed(3)}:${face.height.toFixed(3)}:${targetDim}`;
  const cached = cache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.url;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const buf = await readPhotoData(photo);
      if (!buf) return null;
      const mime = photo.mimeType || 'image/jpeg';
      let blob = new Blob([buf], { type: mime });
      if (isHeicFile(photo.name)) {
        let converted = heicConvertedCache.get(photo.id);
        if (!converted) {
          try {
            const file = new File([buf], photo.name, { type: mime });
            const jpegFile = await ensureSupportedFormat(file);
            converted = new Blob([await jpegFile.arrayBuffer()], { type: 'image/jpeg' });
            setHeicConvertedCache(photo.id, converted);
          } catch { /* 转换失败则用原 blob */ }
        }
        if (converted) blob = converted;
      }

      // 解码原图获取尺寸
      let img: { width: number; height: number };
      try {
        const bitmap = await createImageBitmap(blob);
        img = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } catch {
        return null;
      }

      // 计算人脸裁剪框（外扩 margin，并夹紧在图片范围内）
      const mw = face.width * img.width;
      const mh = face.height * img.height;
      let sx = (face.x - margin * face.width) * img.width;
      let sy = (face.y - margin * face.height) * img.height;
      let sw = mw * (1 + margin * 2);
      let sh = mh * (1 + margin * 2);
      // 夹紧
      sx = Math.max(0, Math.min(sx, img.width - 1));
      sy = Math.max(0, Math.min(sy, img.height - 1));
      sw = Math.min(sw, img.width - sx);
      sh = Math.min(sh, img.height - sy);
      if (sw < 4 || sh < 4) return null;

      // 取正方形源区域（以人脸中心为准）保证输出为方形
      const srcSide = Math.max(sw, sh);
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      sx = Math.max(0, cx - srcSide / 2);
      sy = Math.max(0, cy - srcSide / 2);
      const side = Math.min(srcSide, img.width - sx, img.height - sy);

      // 输出到 Canvas（保持 2x 清晰度）
      const canvas = document.createElement('canvas');
      canvas.width = targetDim;
      canvas.height = targetDim;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // 重绘（先解码 bitmap 再绘制裁剪区域）
      try {
        const source = await createImageBitmap(blob, sx, sy, side, side);
        ctx.drawImage(source, 0, 0, targetDim, targetDim);
        source.close();
      } catch {
        // fallback：Image 元素
        const url = URL.createObjectURL(blob);
        const im = new Image();
        await new Promise<void>((resolve) => {
          im.onload = () => resolve();
          im.onerror = () => resolve();
          im.src = url;
        });
        URL.revokeObjectURL(url);
        if (im.width === 0) return null;
        ctx.drawImage(im, sx, sy, side, side, 0, 0, targetDim, targetDim);
      }

      const outBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      );
      if (!outBlob) return null;
      const url = URL.createObjectURL(outBlob);
      evictIfNeeded();
      cache.set(key, { url, lastUsed: Date.now() });
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
