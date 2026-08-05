/**
 * MemBook — 缩略图渲染 Worker（P1-5）
 *
 * 在 Web Worker 中用 OffscreenCanvas 绘制页面缩略图，避免 100+ 页面批量渲染时
 * toDataURL/toBlob 的 PNG 编码阻塞主线程（每页 ~5-20ms，累积可达秒级卡顿）。
 *
 * 工作流：
 *   主线程 → postMessage(job, [bitmaps...]) → Worker 绘制 → convertToBlob →
 *   Worker → postMessage({id, blobUrl}) → 主线程缓存并回传
 *
 * 数据约束：
 * - photoBitmaps 以 [photoId, ImageBitmap][] 数组传入，并在 transfer list 中转移所有权
 * - stickerBitmaps 以 [blobId, ImageBitmap][] 数组传入（key 形如 `sticker-blob-{stickerId}`），
 *   也在 transfer list 中转移所有权；Worker 绘制完毕后立即 close() 释放
 * - Worker 绘制完毕后立即 close() 所有 ImageBitmap，释放位图内存
 * - 不绘制时间水印（水印仅全屏视图使用，由主线程在后处理补绘）
 * - 不支持 OffscreenCanvas 时主线程回退到同步渲染
 */

import { drawPageToCanvas, calcThumbSize } from './thumbnailCore';
import type { AlbumPage, Photo } from '../types';
import type { PhotoContentInfo } from '../engine/content-aware';

export interface ThumbnailWorkerRequest {
  id: string;
  page: AlbumPage;
  /** 仅本页用到的照片元数据（缩小克隆体积） */
  photos: Photo[];
  albumSize: { width: number; height: number };
  scale: number;
  baseWidth: number;
  /** photoId → ImageBitmap 对（转移所有权） */
  bitmaps: [string, ImageBitmap][];
  /** 贴纸 blobId → ImageBitmap 对（转移所有权，key 形如 `sticker-blob-{stickerId}`） */
  stickerBitmaps?: [string, ImageBitmap][];
  /** 页面边距（mm），Worker 无法读取主线程 store，需由调用方传入 */
  margin?: { left: number; right: number; top: number; bottom: number };
  /** P1-fix: 内容感知信息映射（photoId → contentInfo），Worker 无法访问主线程全局缓存 */
  contentInfoMap?: [string, PhotoContentInfo][];
}

export interface ThumbnailWorkerResponse {
  id: string;
  /** 成功时为 PNG dataURL；失败时为 null（调用方回退主线程渲染） */
  dataURL: string | null;
  error?: string;
  /** P0-fix: 实际绘制的照片数（用于主线程校验是否完整渲染，避免残缺 dataURL 被写入 IDB） */
  drawnPhotoCount?: number;
}

/**
 * Worker 全局作用域类型（不依赖 WebWorker lib，兼容仅 DOM lib 的 tsconfig）。
 * 仅声明本 worker 用到的 onmessage / postMessage，避免引入完整 WebWorker 类型集。
 */
interface WorkerScope {
  onmessage: ((ev: MessageEvent<ThumbnailWorkerRequest>) => void) | null;
  postMessage: (msg: ThumbnailWorkerResponse) => void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (e: MessageEvent<ThumbnailWorkerRequest>) => {
  const { id, page, photos, albumSize, scale, baseWidth, bitmaps, stickerBitmaps, margin, contentInfoMap } = e.data;
  const bitmapMap = new Map<string, ImageBitmap>(bitmaps);
  const stickerMap = new Map<string, ImageBitmap>(stickerBitmaps ?? []);
  // P1-fix: 接收主线程传入的内容感知信息映射
  const contentInfoMapObj = contentInfoMap ? new Map<string, PhotoContentInfo>(contentInfoMap) : undefined;

  try {
    const size = calcThumbSize(albumSize, { baseWidth, scale });
    if (!size) {
      reply({ id, dataURL: null });
      closeAllBitmaps(bitmapMap);
      closeAllBitmaps(stickerMap);
      return;
    }
    const { thumbW, thumbH, logicalW, logicalH } = size;

    const canvas = new OffscreenCanvas(thumbW, thumbH);
    const offCtx = canvas.getContext('2d');
    if (!offCtx) {
      reply({ id, dataURL: null });
      closeAllBitmaps(bitmapMap);
      closeAllBitmaps(stickerMap);
      return;
    }

    const drawScale = thumbW / logicalW;
    offCtx.scale(drawScale, drawScale);

    const drawnPhotoCount = drawPageToCanvas(offCtx, page, photos, logicalW, logicalH, bitmapMap, stickerMap, margin, contentInfoMapObj);

    // 编码为 PNG blob → dataURL（Worker 内无 canvas.toDataURL，用 convertToBlob + 手动 base64）
    // OffscreenCanvas.convertToBlob 返回 Promise<Blob>，需 await
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataURL = await blobToDataURL(blob);
    reply({ id, dataURL, drawnPhotoCount });
    closeAllBitmaps(bitmapMap);
    closeAllBitmaps(stickerMap);
  } catch (err) {
    reply({ id, dataURL: null, error: String(err) });
    closeAllBitmaps(bitmapMap);
    closeAllBitmaps(stickerMap);
  }
};

function reply(msg: ThumbnailWorkerResponse): void {
  ctx.postMessage(msg);
}

function closeAllBitmaps(map: Map<string, ImageBitmap>): void {
  for (const bmp of map.values()) {
    try {
      bmp.close();
    } catch { /* ignore */ }
  }
  map.clear();
}

/** Worker 内无 FileReader.readAsDataURL，用 Blob.arrayBuffer + 手动 base64 编码 */
async function blobToDataURL(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // 分块 base64 编码，避免大数组 String.fromCharCode 溢出
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  // Worker 内可用 btoa
  const base64 = btoa(binary);
  return `data:image/png;base64,${base64}`;
}

export {};
