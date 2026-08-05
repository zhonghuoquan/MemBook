/**
 * 贴纸图片加载 Hook
 *
 * 从 MemBookStorage.blobs 读取贴纸图片，转为 dataURL 供 <img>/拖拽预览使用，
 * 或转为 HTMLImageElement 供 Konva.Image 使用。
 *
 * 内置 dataURL 缓存（LRU），避免同一贴纸在多个组件中重复读取 IndexedDB。
 *
 * P0-fix: 缓存改为 dataURL（而非 blob URL）。
 *   原实现缓存 blob URL，LRU 淘汰时 URL.revokeObjectURL 会撤销正在被 <img> 使用的 URL，
 *   导致贴纸加载失败/显示空白。dataURL 是字符串，不会被 revoke，只要字符串被引用即有效，
 *   彻底解决加载失败问题。贴纸通常较小（几十 KB），dataURL 内存占用可控。
 */
import { useState, useEffect, useRef } from 'react';
import { getPhotoBlob } from '../engine/handle-store';

/** dataURL 缓存：blobId → dataURL，避免重复读取 IndexedDB。
 *  使用 Map 维护插入顺序实现 LRU：命中时 delete+set 移到末尾，淘汰时取 Map 第一个 key（最久未访问）。
 *  P0-fix: 缓存值是 dataURL 字符串，淘汰时无需 revoke（dataURL 不可撤销）。 */
const dataURLCache = new Map<string, string>();
const DATA_URL_CACHE_MAX = 200;

/** 将 Blob 转 dataURL（FileReader.readAsDataURL） */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cacheDataURL(blobId: string, url: string) {
  // 若已存在，先 delete 再 set，将其移到 Map 末尾（标记为最近访问）
  if (dataURLCache.has(blobId)) {
    dataURLCache.delete(blobId);
  } else if (dataURLCache.size >= DATA_URL_CACHE_MAX) {
    // 淘汰 Map 第一个 key（最久未访问的）。dataURL 是字符串，无需 revoke。
    const firstKey = dataURLCache.keys().next().value;
    if (firstKey) {
      dataURLCache.delete(firstKey);
    }
  }
  dataURLCache.set(blobId, url);
}

/** 将已存在的缓存条目移到末尾（标记为最近访问），用于读取命中时的 LRU 更新。
 *  仅在命中时调用，不影响缓存内容。 */
function touchCache(blobId: string) {
  const url = dataURLCache.get(blobId);
  if (url) {
    dataURLCache.delete(blobId);
    dataURLCache.set(blobId, url);
  }
}

/** 从 IndexedDB 读取贴纸并转为 dataURL（带缓存） */
async function readStickerDataURL(blobId: string): Promise<string | null> {
  const cached = dataURLCache.get(blobId);
  if (cached) {
    touchCache(blobId);
    return cached;
  }
  const blob = await getPhotoBlob(blobId);
  if (!blob) return null;
  const dataURL = await blobToDataURL(blob);
  cacheDataURL(blobId, dataURL);
  return dataURL;
}

/** 同步读取缓存的 dataURL（无异步读取，用于拖拽预览等即时场景）。
 *  命中时更新 LRU 顺序，避免热点贴纸被错误淘汰。 */
export function getCachedStickerSrc(blobId: string): string | null {
  const url = dataURLCache.get(blobId) ?? null;
  if (url) touchCache(blobId);
  return url;
}

/** 预加载贴纸 dataURL 到缓存（拖拽开始前调用，确保拖拽预览能即时取到） */
export async function preloadStickerSrc(blobId: string): Promise<string | null> {
  return readStickerDataURL(blobId);
}

/**
 * 加载贴纸 dataURL，自动缓存。
 * P0-fix: 返回 dataURL 字符串，组件卸载时无需清理（dataURL 不可撤销）。
 */
export function useStickerSrc(blobId: string | undefined | null): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!blobId) return null;
    const url = dataURLCache.get(blobId) ?? null;
    if (url) touchCache(blobId);
    return url;
  });

  useEffect(() => {
    if (!blobId) {
      setSrc(null);
      return;
    }
    const cached = dataURLCache.get(blobId);
    if (cached) {
      touchCache(blobId);
      setSrc(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const url = await readStickerDataURL(blobId);
      if (cancelled || !url) return;
      setSrc(url);
    })();
    return () => { cancelled = true; };
  }, [blobId]);

  return src;
}

/** 已加载的 HTMLImageElement 缓存：blobId → HTMLImageElement */
const imageCache = new Map<string, HTMLImageElement>();

/**
 * 加载贴纸为 HTMLImageElement（供 Konva.Image 使用）。
 * 返回 { image, dataURL }，image 就绪后触发重渲染。
 */
export function useStickerImage(blobId: string | undefined | null): { image: HTMLImageElement | null; dataURL: string | null } {
  const dataURL = useStickerSrc(blobId);
  const [image, setImage] = useState<HTMLImageElement | null>(() => (blobId ? imageCache.get(blobId) ?? null : null));
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!dataURL) {
      setImage(null);
      return;
    }
    if (blobId && imageCache.has(blobId)) {
      setImage(imageCache.get(blobId) ?? null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      if (blobId) {
        imageCache.set(blobId, img);
      }
      setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setImage(null);
    };
    img.src = dataURL;
    imgRef.current = img;
    return () => {
      cancelled = true;
    };
  }, [dataURL, blobId]);

  return { image, dataURL };
}
