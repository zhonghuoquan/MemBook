/**
 * 贴纸服务：处理贴纸图片上传、读取等业务逻辑。
 * 与 photoService 平行，封装贴纸相关的 IndexedDB 操作。
 */
import { saveSticker, listStickers, deleteSticker, toggleStickerFavorite, renameSticker, type StickerRecord } from '../db';
import { logger } from '../utils/logger';

/** 生成贴纸 ID */
function generateStickerId(): string {
  return `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 从 File 上传贴纸：
 * 1. 读取文件为 Blob
 * 2. 解码获取原始像素尺寸（用于计算默认尺寸宽高比）
 * 3. 持久化到 IndexedDB（stickers 表 + blobs 表）
 * @returns 新创建的贴纸记录
 */
export async function uploadStickerFromFile(file: File): Promise<StickerRecord> {
  // 读取图片原始尺寸
  const { width, height } = await getImageDimensions(file);
  const id = generateStickerId();
  const name = file.name.replace(/\.[^.]+$/, '') || '贴纸';
  await saveSticker({
    id,
    name,
    blob: file,
    width,
    height,
  });
  logger.info(`[sticker] 上传贴纸成功: ${name} (${width}x${height})`);
  return {
    id,
    name,
    blobId: `sticker-blob-${id}`,
    category: 'custom',
    width,
    height,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 批量上传贴纸文件。
 * @returns 成功上传的贴纸记录列表
 */
export async function uploadStickersFromFiles(files: File[]): Promise<StickerRecord[]> {
  const results: StickerRecord[] = [];
  for (const file of files) {
    try {
      if (!file.type.startsWith('image/')) continue;
      const rec = await uploadStickerFromFile(file);
      results.push(rec);
    } catch (err) {
      logger.warn(`[sticker] 上传贴纸失败: ${file.name}`, err);
    }
  }
  return results;
}

/** 读取图片原始像素尺寸 */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      URL.revokeObjectURL(url);
      resolve({ width: w || 100, height: h || 100 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 100, height: 100 });
    };
    img.src = url;
  });
}

export { listStickers, deleteSticker, toggleStickerFavorite, renameSticker };
export type { StickerRecord };
