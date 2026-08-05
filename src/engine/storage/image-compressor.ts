import { loadImageDimensions } from './utils';
import type { CompressWorkerRequest, CompressWorkerResponse, CompressWorkerError, CompressSizeSpec } from './compress.worker';

const MAX_IMPORT_WIDTH = 4096; // 最大宽度，超过则缩小（原2048 → 4096保留更高分辨率）
const MAX_PREVIEW_WIDTH = 1200; // 编辑预览图最大宽度
const PREVIEW_QUALITY = 0.85;
const SKIP_COMPRESS_MAX_WIDTH = 2048; // 小图跳过压缩阈值
const SKIP_COMPRESS_MAX_SIZE = 2 * 1024 * 1024; // 2MB
// P1-1 LOD 三级体系：thumb 档用于网格/面板小图，位图仅 ~2MB
const MAX_THUMB_WIDTH = 256;
const THUMB_QUALITY = 0.7;

export interface CompressOptions {
  maxWidth?: number;
  quality?: number;
}

export interface CompressMultiResult {
  original: { blob: Blob; width: number; height: number };
  preview: { blob: Blob; width: number; height: number };
}

/** P1-1 LOD 三级压缩结果：thumb(256) + preview(1200) + original(4096) */
export interface CompressLODResult extends CompressMultiResult {
  thumb: { blob: Blob; width: number; height: number };
}

// P1: Worker 池动态扩容——根据 CPU 核心数自适应，8 核 CPU 压缩速度提升 2x
const WORKER_POOL_SIZE = Math.min(
  typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4,
  8,
);

class CompressWorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<Worker, Map<string, { resolve: (r: CompressWorkerResponse['results']) => void; reject: (e: Error) => void }>>();
  private roundRobinIndex = 0;

  constructor() {
    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      const w = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' });
      const taskMap = new Map<string, { resolve: (r: CompressWorkerResponse['results']) => void; reject: (e: Error) => void }>();
      this.pending.set(w, taskMap);
      w.addEventListener('message', (e: MessageEvent<CompressWorkerResponse | CompressWorkerError>) => {
        const data = e.data;
        if ('error' in data) {
          const t = taskMap.get(data.id);
          if (t) {
            taskMap.delete(data.id);
            t.reject(new Error(data.error));
          }
          return;
        }
        if ('results' in data) {
          const t = taskMap.get(data.id);
          if (t) {
            taskMap.delete(data.id);
            t.resolve(data.results);
          }
        }
      });
      this.workers.push(w);
    }
  }

  compress(file: File, sizes: CompressSizeSpec[]): Promise<CompressWorkerResponse['results']> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worker = this.workers[this.roundRobinIndex % this.workers.length];
    this.roundRobinIndex++;
    return new Promise((resolve, reject) => {
      this.pending.get(worker)!.set(id, { resolve, reject });
      worker.postMessage({ id, file, sizes } as CompressWorkerRequest);
    });
  }

  /** P0: 终止所有 Worker，释放线程内存。
   *  8 个 Worker 常驻约 160-400MB，导入完成后不再需要，应终止释放。 */
  dispose(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.pending.clear();
  }
}

let workerPool: CompressWorkerPool | null = null;

function getWorkerPool(): CompressWorkerPool {
  if (!workerPool) workerPool = new CompressWorkerPool();
  return workerPool;
}

/** P0: 终止 Worker 池并释放内存（用于项目切换/退出编辑器）。
 *  下次需要压缩时会自动重建 Worker 池。 */
export function terminateWorkerPool(): void {
  if (workerPool) {
    workerPool.dispose();
    workerPool = null;
  }
}

/** 判断是否需要压缩 */
export function shouldCompress(file: File): boolean {
  // 非 JPEG 或文件较大时需要压缩
  return file.type !== 'image/jpeg' || file.size > SKIP_COMPRESS_MAX_SIZE;
}

/** 主线程压缩（fallback） */
export function compressImage(file: File, maxWidth = MAX_IMPORT_WIDTH, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = (h / w) * maxWidth;
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('压缩失败'));
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Worker 多尺寸压缩（使用 Worker 池） */
function compressImageInWorker(file: File, sizes: CompressSizeSpec[]): Promise<CompressWorkerResponse['results']> {
  return getWorkerPool().compress(file, sizes);
}

/** 压缩并返回 Blob（可能直接返回原文件，如果不需要压缩） */
export async function compressImageIfNeeded(file: File, options: CompressOptions = {}): Promise<Blob> {
  const { maxWidth = MAX_IMPORT_WIDTH, quality = 0.92 } = options;

  // 小图 JPEG：直接返回原文件
  if (!shouldCompress(file)) {
    return file;
  }

  // 先读尺寸，如果尺寸也不大，直接返回
  const tempSrc = URL.createObjectURL(file);
  try {
    const dims = await loadImageDimensions(tempSrc);
    if (dims.width <= SKIP_COMPRESS_MAX_WIDTH && file.size <= SKIP_COMPRESS_MAX_SIZE && file.type === 'image/jpeg') {
      return file;
    }
  } finally {
    URL.revokeObjectURL(tempSrc);
  }

  // 使用 Worker 压缩
  try {
    const results = await compressImageInWorker(file, [{ key: 'single', maxWidth, quality }]);
    const r = results.find((x) => x.key === 'single');
    if (!r) throw new Error('Worker 未返回压缩结果');
    return r.blob;
  } catch {
    // Worker 失败 fallback 到主线程
    return await compressImage(file, maxWidth, quality);
  }
}

/**
 * 仅生成编辑预览图，不生成高清原图。
 * 用于 Tauri 桌面端：原文件保留在磁盘，通过路径引用，不需要把原图存入 IndexedDB。
 */
export async function compressImageToPreviewOnly(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  // 小图：直接作为预览图
  if (!shouldCompress(file)) {
    const tempSrc = URL.createObjectURL(file);
    try {
      const dims = await loadImageDimensions(tempSrc);
      return { blob: file, width: dims.width, height: dims.height };
    } finally {
      URL.revokeObjectURL(tempSrc);
    }
  }

  try {
    const results = await compressImageInWorker(file, [{ key: 'preview', maxWidth: MAX_PREVIEW_WIDTH, quality: PREVIEW_QUALITY }]);
    const preview = results.find((x) => x.key === 'preview');
    if (!preview) throw new Error('Worker 未返回预览图结果');
    return preview;
  } catch {
    const blob = await compressImage(file, MAX_PREVIEW_WIDTH, PREVIEW_QUALITY);
    const src = URL.createObjectURL(blob);
    try {
      const dims = await loadImageDimensions(src);
      return { blob, width: dims.width, height: dims.height };
    } finally {
      URL.revokeObjectURL(src);
    }
  }
}

/**
 * 同时生成编辑预览图和高清原图。
 * 预览图用于画布编辑，高清图用于导出/打印。
 */
export async function compressImageToPreviewAndOriginal(file: File): Promise<CompressMultiResult> {
  // 直接可用的小图：原图即可同时充当预览和高清
  if (!shouldCompress(file)) {
    const tempSrc = URL.createObjectURL(file);
    try {
      const dims = await loadImageDimensions(tempSrc);
      return {
        preview: { blob: file, width: dims.width, height: dims.height },
        original: { blob: file, width: dims.width, height: dims.height },
      };
    } finally {
      URL.revokeObjectURL(tempSrc);
    }
  }

  const sizes: CompressSizeSpec[] = [
    { key: 'preview', maxWidth: MAX_PREVIEW_WIDTH, quality: PREVIEW_QUALITY },
    { key: 'original', maxWidth: MAX_IMPORT_WIDTH, quality: 0.92 },
  ];

  try {
    const results = await compressImageInWorker(file, sizes);
    const preview = results.find((x) => x.key === 'preview');
    const original = results.find((x) => x.key === 'original');
    if (!preview || !original) throw new Error('Worker 未返回完整尺寸结果');
    return { preview, original };
  } catch {
    // Worker 失败 fallback：主线程分别压缩两次
    const [previewBlob, originalBlob] = await Promise.all([
      compressImage(file, MAX_PREVIEW_WIDTH, PREVIEW_QUALITY),
      compressImage(file, MAX_IMPORT_WIDTH, 0.92),
    ]);
    const previewSrc = URL.createObjectURL(previewBlob);
    const originalSrc = URL.createObjectURL(originalBlob);
    try {
      const [previewDims, originalDims] = await Promise.all([
        loadImageDimensions(previewSrc),
        loadImageDimensions(originalSrc),
      ]);
      return {
        preview: { blob: previewBlob, width: previewDims.width, height: previewDims.height },
        original: { blob: originalBlob, width: originalDims.width, height: originalDims.height },
      };
    } finally {
      URL.revokeObjectURL(previewSrc);
      URL.revokeObjectURL(originalSrc);
    }
  }
}

export { loadImageDimensions, MAX_IMPORT_WIDTH, MAX_PREVIEW_WIDTH, MAX_THUMB_WIDTH, THUMB_QUALITY };

/**
 * P1-1 LOD 三级体系：同时生成 thumb(256) + preview(1200) + original(4096) 三档。
 * - thumb：网格/面板小图，单张位图 ~2MB，300 张仅 ~600MB（vs preview 档 ~3GB）
 * - preview：编辑器画布、全屏预览
 * - original：导出/打印
 *
 * 小图（< 2MB 且 < 2048px JPEG）直接用原文件同时充当三档，避免无谓压缩。
 */
export async function compressImageToThumbPreviewOriginal(file: File): Promise<CompressLODResult> {
  // 小图：原文件同时充当三档
  if (!shouldCompress(file)) {
    const tempSrc = URL.createObjectURL(file);
    try {
      const dims = await loadImageDimensions(tempSrc);
      return {
        thumb: { blob: file, width: dims.width, height: dims.height },
        preview: { blob: file, width: dims.width, height: dims.height },
        original: { blob: file, width: dims.width, height: dims.height },
      };
    } finally {
      URL.revokeObjectURL(tempSrc);
    }
  }

  const sizes: CompressSizeSpec[] = [
    { key: 'thumb', maxWidth: MAX_THUMB_WIDTH, quality: THUMB_QUALITY },
    { key: 'preview', maxWidth: MAX_PREVIEW_WIDTH, quality: PREVIEW_QUALITY },
    { key: 'original', maxWidth: MAX_IMPORT_WIDTH, quality: 0.92 },
  ];

  try {
    const results = await compressImageInWorker(file, sizes);
    const thumb = results.find((x) => x.key === 'thumb');
    const preview = results.find((x) => x.key === 'preview');
    const original = results.find((x) => x.key === 'original');
    if (!thumb || !preview || !original) throw new Error('Worker 未返回完整 LOD 结果');
    return { thumb, preview, original };
  } catch {
    // Worker 失败 fallback：主线程分别压缩三次
    const [thumbBlob, previewBlob, originalBlob] = await Promise.all([
      compressImage(file, MAX_THUMB_WIDTH, THUMB_QUALITY),
      compressImage(file, MAX_PREVIEW_WIDTH, PREVIEW_QUALITY),
      compressImage(file, MAX_IMPORT_WIDTH, 0.92),
    ]);
    const [thumbSrc, previewSrc, originalSrc] = [
      URL.createObjectURL(thumbBlob),
      URL.createObjectURL(previewBlob),
      URL.createObjectURL(originalBlob),
    ];
    try {
      const [thumbDims, previewDims, originalDims] = await Promise.all([
        loadImageDimensions(thumbSrc),
        loadImageDimensions(previewSrc),
        loadImageDimensions(originalSrc),
      ]);
      return {
        thumb: { blob: thumbBlob, width: thumbDims.width, height: thumbDims.height },
        preview: { blob: previewBlob, width: previewDims.width, height: previewDims.height },
        original: { blob: originalBlob, width: originalDims.width, height: originalDims.height },
      };
    } finally {
      URL.revokeObjectURL(thumbSrc);
      URL.revokeObjectURL(previewSrc);
      URL.revokeObjectURL(originalSrc);
    }
  }
}

/**
 * P1-1 LOD：仅生成 thumb + preview（不存原图，用于 Tauri direct 模式）。
 * 原文件保留在磁盘通过路径引用，IndexedDB 仅存 thumb + preview。
 */
export async function compressImageToThumbAndPreview(file: File, originalWidth?: number, originalHeight?: number): Promise<{
  thumb: { blob: Blob; width: number; height: number };
  preview: { blob: Blob; width: number; height: number };
  originalWidth: number;
  originalHeight: number;
}> {
  if (!shouldCompress(file) && originalWidth != null && originalHeight != null) {
    return {
      thumb: { blob: file, width: originalWidth, height: originalHeight },
      preview: { blob: file, width: originalWidth, height: originalHeight },
      originalWidth,
      originalHeight,
    };
  }

  const sizes: CompressSizeSpec[] = [
    { key: 'thumb', maxWidth: MAX_THUMB_WIDTH, quality: THUMB_QUALITY },
    { key: 'preview', maxWidth: MAX_PREVIEW_WIDTH, quality: PREVIEW_QUALITY },
  ];

  try {
    const results = await compressImageInWorker(file, sizes);
    const thumb = results.find((x) => x.key === 'thumb');
    const preview = results.find((x) => x.key === 'preview');
    if (!thumb || !preview) throw new Error('Worker 未返回 thumb+preview 结果');
    return {
      thumb,
      preview,
      originalWidth: originalWidth ?? preview.width,
      originalHeight: originalHeight ?? preview.height,
    };
  } catch {
    const [thumbBlob, previewBlob] = await Promise.all([
      compressImage(file, MAX_THUMB_WIDTH, THUMB_QUALITY),
      compressImage(file, MAX_PREVIEW_WIDTH, PREVIEW_QUALITY),
    ]);
    const previewSrc = URL.createObjectURL(previewBlob);
    try {
      const previewDims = await loadImageDimensions(previewSrc);
      return {
        thumb: { blob: thumbBlob, width: MAX_THUMB_WIDTH, height: Math.round(MAX_THUMB_WIDTH * (previewDims.height / previewDims.width)) },
        preview: { blob: previewBlob, width: previewDims.width, height: previewDims.height },
        originalWidth: originalWidth ?? previewDims.width,
        originalHeight: originalHeight ?? previewDims.height,
      };
    } finally {
      URL.revokeObjectURL(previewSrc);
    }
  }
}
