/* ── 图片压缩 Web Worker ──
 * 运行在独立线程，不阻塞主线程 UI。
 * 接收 File/Blob，返回压缩后的 Blob。
 */

export interface CompressSizeSpec {
  key: string;
  maxWidth: number;
  quality: number;
}

export interface CompressWorkerRequest {
  id: string;
  file: File;
  sizes: CompressSizeSpec[];
}

export interface CompressWorkerSizeResult {
  key: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface CompressWorkerResponse {
  id: string;
  results: CompressWorkerSizeResult[];
}

export interface CompressWorkerError {
  id: string;
  error: string;
}

self.onmessage = async (e: MessageEvent<CompressWorkerRequest>) => {
  const { id, file, sizes } = e.data;
  try {
    const results = await compressImageToSizes(file, sizes);
    self.postMessage({ id, results } as CompressWorkerResponse);
  } catch (err) {
    self.postMessage({ id, error: (err as Error)?.message || '压缩失败' } as CompressWorkerError);
  }
};

async function compressImageToSizes(file: File | Blob, sizes: CompressSizeSpec[]): Promise<CompressWorkerSizeResult[]> {
  // 一次性解码原图，再按规格缩放
  const original = await decodeImage(file);
  const results: CompressWorkerSizeResult[] = [];
  try {
    for (const spec of sizes) {
      const { blob, width, height } = await resizeAndEncode(original, spec.maxWidth, spec.quality);
      results.push({ key: spec.key, blob, width, height });
    }
  } finally {
    // P0: 显式 close ImageBitmap 释放位图内存。
    //   5000x3000 原图位图 ~60MB，不 close 会残留在 Worker 堆中直到下次任务覆盖，
    //   8 个 Worker × 60MB = 480MB 常驻内存。
    original.close();
  }
  return results;
}

function decodeImage(file: File | Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function resizeAndEncode(bitmap: ImageBitmap, maxWidth: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  let w = bitmap.width;
  let h = bitmap.height;
  if (w > maxWidth) {
    h = (h / w) * maxWidth;
    w = maxWidth;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('无法创建 canvas context'));
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality }).then((blob) => ({ blob, width: w, height: h }));
}

export {};
