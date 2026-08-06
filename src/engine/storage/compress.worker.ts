/* ── 图片压缩 Web Worker ──
 * 运行在独立线程，不阻塞主线程 UI。
 * 接收 File/Blob，返回压缩后的 Blob。
 */

export interface CompressSizeSpec {
  key: string;
  maxWidth: number;
  quality: number;
  /** 输出格式：'png' 保留透明度（PNG 源图含 alpha 通道时必须用 png），默认 'jpeg' */
  type?: 'jpeg' | 'png';
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
  // 透明度检测：将原图缩小到 64×64 采样 alpha 通道，判断是否需要保留 PNG 格式。
  // JPEG 不支持 alpha，透明 PNG 转 JPEG 后透明区域会变黑（canvas 默认 rgba(0,0,0,0)）。
  const hasAlpha = checkBitmapTransparency(original);
  const results: CompressWorkerSizeResult[] = [];
  try {
    for (const spec of sizes) {
      // 有透明度 → 强制 PNG；否则用 spec.type 或默认 jpeg
      const type = hasAlpha ? 'png' : (spec.type || 'jpeg');
      const { blob, width, height } = await resizeAndEncode(original, spec.maxWidth, spec.quality, type);
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

/** 检测位图是否含透明像素：缩小到 64×64 采样 alpha 通道 */
function checkBitmapTransparency(bitmap: ImageBitmap): boolean {
  const sampleSize = 64;
  const canvas = new OffscreenCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  // alpha 通道在每 4 字节的第 4 位，阈值 250 容忍抗锯齿边缘
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

function resizeAndEncode(bitmap: ImageBitmap, maxWidth: number, quality: number, type: 'jpeg' | 'png' = 'jpeg'): Promise<{ blob: Blob; width: number; height: number }> {
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
  if (type === 'png') {
    // PNG 无损压缩，quality 参数无意义
    return canvas.convertToBlob({ type: 'image/png' }).then((blob) => ({ blob, width: w, height: h }));
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality }).then((blob) => ({ blob, width: w, height: h }));
}

export {};
