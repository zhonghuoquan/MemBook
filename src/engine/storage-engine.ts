/**
 * MemBook — 双轨存储引擎 (PRD 1.4)
 *
 * 两种模式：
 * 1. direct  — 直接访问模式 (File System Access API)
 *    用户授权一个文件夹，直接从原路径读取照片，不复制到浏览器。
 * 2. import  — 导入存储模式 (IndexedDB)
 *    照片压缩后存入 IndexedDB/Dexie，完全离线可用。
 *
 * HEIC/HEIF 支持：
 * 通过 heic2any 库在浏览器端解码 HEIC 为 JPEG，
 * 确保 Chrome/Firefox/Edge 等非 Safari 浏览器也能导入 iPhone 照片。
 *
 * 此文件现在作为统一导出入口，具体实现已拆分到 storage/ 目录。
 */

import type { Photo, StorageMode } from '../types';
import type { ImportResult } from './storage/types';

export {
  supportsDirectAccess,
  pickPhotoDirectory,
  restoreDirectoryHandle,
  readDirectPhoto,
  scanDirectPhotos,
} from './storage/direct-access';

export {
  importPhotoToDB,
  importPhotoThumbAndPreview,
  generatePreviewForDirectPhoto,
  readPhotoFromDB,
  acquirePhotoUrl,
  releasePhotoUrl,
  isBlobUrlAlive,
} from './storage/import-store';

export {
  isHeicFile,
  IMAGE_EXTS,
  loadImageDimensions,
  getOrientation,
} from './storage/utils';

export { ensureSupportedFormat } from './storage/heic-converter';

export type { ImportResult } from './storage/types';

import { readDirectPhoto } from './storage/direct-access';
import { importPhotoToDB, importPhotoThumbAndPreview } from './storage/import-store';
import { ensureSupportedFormat, HeicAbortError } from './storage/heic-converter';
import {
  loadImageDimensions,
  getOrientation,
  isActuallyHeicFile,
  tryLoadNativeImageDimensions,
} from './storage/utils';
import { isTauri } from '../utils/tauri';
import { logger } from '../utils/logger';

/* ════════════════════════════════════════════════
   Tauri 环境检测与文件读取
   ════════════════════════════════════════════════ */

// isTauri 已提取到 utils/tauri.ts，此处重新导出以保持向后兼容
export { isTauri };

/** 通过 Tauri asset 协议把本地绝对路径转换为可直接加载的 URL */
async function readTauriFile(path: string): Promise<string | null> {
  try {
    if (!isTauri()) return null;
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════
   统一导入入口
   ════════════════════════════════════════════════ */

export interface ProcessOneFileOptions {
  /** 原始文件绝对路径（Tauri 拖拽导入时使用） */
  originalPath?: string;
  /** 中止信号，用于取消 HEIC 转换等长时间操作 */
  signal?: AbortSignal;
}

/** 内部：真正处理单张图片 */
async function processOneFileInner(
  file: File,
  mode: StorageMode,
  exifDates: Map<string, string>,
  options: ProcessOneFileOptions = {},
): Promise<ImportResult | null> {
  // ── HEIC/HEIF 转换（每个文件独立转换，可并行） ──
  if (options?.signal?.aborted) throw new HeicAbortError();
  const actuallyHeic = await isActuallyHeicFile(file);
  let processFile = file;
  let convertedName = file.name;
  if (actuallyHeic) {
    try {
      const jpegFile = await ensureSupportedFormat(file, options?.signal, options?.originalPath);
      processFile = jpegFile;
      convertedName = jpegFile.name;
    } catch (err) {
      if (err instanceof HeicAbortError || options?.signal?.aborted) throw err;
      // 转换失败时尝试浏览器原生解码（如 Safari 支持 HEIC，或文件实际为其他格式但扩展名错误）
      logger.warn(`HEIC 转换失败，尝试浏览器原生解码: ${file.name}`, err);
      const nativeDims = await tryLoadNativeImageDimensions(file);
      if (!nativeDims) throw err;
      processFile = file;
      convertedName = file.name;
    }
  }

  const tempSrc = URL.createObjectURL(processFile);
  const dims = await loadImageDimensions(tempSrc);
  URL.revokeObjectURL(tempSrc);

  const fileKey = file.name + '|' + file.size;
  const isoDate = exifDates.get(fileKey) || new Date(file.lastModified).toISOString();

  if (mode === 'direct' && !actuallyHeic) {
    // 直接访问模式（非 HEIC）
    // P0-fix: Phase 1 一次性生成 thumb(256px) + preview(1200px)，消除 P2 后台任务。
    //   旧方案：Phase 1 只生成 thumb，photo.src = asset:// 原文件，P2 后台再读原文件生成 preview。
    //   问题：1) 原文件被读两次（Phase 1 解码 + P2 readFile）；2) P2 期间画布读原文件致内存峰值；
    //         3) 项目加载时 EditorView 仍用 asset://，P2 生成的 preview 白做。
    //   新方案：Phase 1 一次解码生成 thumb + preview，photo.src = preview blob URL。
    //         原文件导入后永不再读，画布/项目加载都用 preview blob。
    const result = await importPhotoThumbAndPreview(processFile, dims.width, dims.height);
    return {
      id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      src: result.previewUrl,
      name: file.name.replace(/\.[^/.]+$/, ''),
      date: isoDate,
      width: dims.width,
      height: dims.height,
      orientation: getOrientation(dims.width, dims.height),
      fileSize: file.size,
      storageMode: 'direct',
      relativePath: options.originalPath || file.name,
      thumbBlobId: result.thumbBlobId,
      previewBlobId: result.previewBlobId,
    };
  }

  // Tauri 桌面端导入 HEIC：转换为 JPEG 后，原文件路径指向生成的 JPEG 对象 URL，原文件可能已不可用；
  // 所以 HEIC 一律走 import 模式存入 IndexedDB，避免后续 photo.src 引用失效。
  // 另外，Tauri 下若无法获得原文件路径（如通过文件选择框导入），也回退到 import 模式，
  // 避免照片被标记为 direct 但实际没有可用路径。
  const canUsePathReference = isTauri() && !actuallyHeic && !!options.originalPath;
  const effectiveMode = actuallyHeic || (mode === 'direct' && isTauri() && !canUsePathReference) ? 'import' : mode;
  const importResult = await importPhotoToDB(processFile, {
    onlyPreview: canUsePathReference,
    originalWidth: dims.width,
    originalHeight: dims.height,
  });
  // 直接用压缩后的 preview blob 创建 URL，避免写入 IndexedDB 后再回读
  const previewUrl = importResult.previewUrl || URL.createObjectURL(processFile);
  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    src: previewUrl,
    name: convertedName.replace(/\.[^/.]+$/, ''),
    date: isoDate,
    width: dims.width,
    height: dims.height,
    orientation: getOrientation(dims.width, dims.height),
    fileSize: file.size,
    storageMode: effectiveMode,
    relativePath: canUsePathReference ? options.originalPath : undefined,
    blobId: importResult.originalBlobId,
    originalBlobId: importResult.originalBlobId,
    previewBlobId: importResult.previewBlobId,
  };
}

/** 并行处理一张图片：HEIC 转换 → 获取尺寸 → 压缩存储，失败时自动重试一次 */
export async function processOneFile(
  file: File,
  mode: StorageMode,
  exifDates: Map<string, string>,
  options: ProcessOneFileOptions = {},
): Promise<ImportResult | null> {
  try {
    return await processOneFileInner(file, mode, exifDates, options);
  } catch (err) {
    if (err instanceof HeicAbortError || options?.signal?.aborted) {
      logger.warn(`处理照片已取消: ${file.name}`);
      throw err;
    }
    logger.warn(`处理照片失败，准备重试: ${file.name}`, err);
    try {
      return await processOneFileInner(file, mode, exifDates, options);
    } catch (retryErr) {
      if (retryErr instanceof HeicAbortError || options?.signal?.aborted) {
        logger.warn(`处理照片已取消: ${file.name}`);
        throw retryErr;
      }
      logger.error(`处理照片最终失败: ${file.name}`, retryErr);
      return null;
    }
  }
}

/**
 * 根据存储模式导入一组文件
 * P0-1: 改为并发限流（6 路），避免 300+ 张全并行导致主线程同时解码全图（峰值 1-2GB）。
 *   Worker 池仅 4 个，全并行只会让 300 次 loadImageDimensions 在主线程堆积解码。
 *   限流后同时仅 6 个 File 驻留 + 6 次解码，内存峰值 ~200MB。
 */
const IMPORT_CONCURRENCY = 6;
export async function importFilesByMode(
  files: File[],
  mode: StorageMode,
  exifDates: Map<string, string>,
  options?: {
    originalPaths?: Map<string, string>;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<ImportResult[]> {
  const originalPaths = options?.originalPaths;
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  const results: (ImportResult | null)[] = new Array(files.length).fill(null);
  let nextIndex = 0;
  let running = 0;
  let done = 0;

  await new Promise<void>((resolve) => {
    const maybeResolve = () => {
      if (running === 0 && nextIndex >= files.length) resolve();
    };
    const pump = () => {
      while (running < IMPORT_CONCURRENCY && nextIndex < files.length) {
        const i = nextIndex++;
        running++;
        const file = files[i];
        const fileKey = `${file.name}|${file.size}`;
        processOneFile(file, mode, exifDates, { originalPath: originalPaths?.get(fileKey), signal })
          .then((r) => { results[i] = r; })
          .catch((err) => {
            if (err instanceof HeicAbortError || signal?.aborted) {
              logger.warn(`处理照片已取消: ${file.name}`);
            } else {
              logger.error(`处理照片最终失败: ${file.name}`, err);
            }
          })
          .finally(() => {
            running--;
            done++;
            onProgress?.(done, files.length);
            maybeResolve();
            pump();
          });
      }
    };
    pump();
  });

  return results.filter((r): r is ImportResult => r !== null);
}

export async function makeDirectPhotoUrl(photo: Photo): Promise<string | null> {
  if (photo.storageMode === 'import') return Promise.resolve(photo.src);
  if (photo.storageMode === 'direct') {
    // Tauri 桌面端直接访问模式：用绝对路径通过 asset 协议读取
    if (isTauri() && photo.relativePath) {
      return readTauriFile(photo.relativePath);
    }
    return readDirectPhoto(photo.src || photo.relativePath || '');
  }
  return Promise.resolve(photo.src);
}
