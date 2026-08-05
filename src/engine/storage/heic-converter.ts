import { invoke } from '@tauri-apps/api/core';
import { isHeicFile } from './utils';
import { isTauri } from '../../utils/tauri';
import { logger } from '../../utils/logger';

const HEIC_CONCURRENCY = 2; // heic2any 在主线程解码且内存占用大，限制并发避免卡死 UI
const HEIC_CONVERT_TIMEOUT = 30000; // 30 秒超时（大文件 WASM 解码较慢）

export class HeicAbortError extends Error {
  constructor() {
    super('HEIC 转换已取消');
    this.name = 'HeicAbortError';
  }
}

declare global {
  interface Window {
    heic2any?: (options: { blob: Blob; toType: string; quality?: number }) => Promise<Blob | Blob[]>;
  }
}

async function convertHeicToJpeg(file: File, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw new HeicAbortError();

  const h = window.heic2any;
  if (typeof h !== 'function') {
    logger.error('[heic2any] window.heic2any 未加载，请确认 public/heic2any.min.js 已打包且 CSP 允许脚本执行');
    throw new Error('heic2any 未加载，请检查安装包完整性或 CSP 策略');
  }

  logger.info('[heic2any] 开始转换:', file.name, `size=${file.size}`);
  const convertPromise = h({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`HEIC 转换超时（>${HEIC_CONVERT_TIMEOUT / 1000}s）`)), HEIC_CONVERT_TIMEOUT);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new HeicAbortError());
    }, { once: true });
  });
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(new HeicAbortError());
    signal?.addEventListener('abort', () => reject(new HeicAbortError()), { once: true });
  });

  try {
    const result = await Promise.race([convertPromise, timeoutPromise, abortPromise]);
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob || !(blob instanceof Blob) || blob.size === 0) {
      throw new Error('HEIC 转换结果为空');
    }
    if (signal?.aborted) throw new HeicAbortError();
    logger.info('[heic2any] 转换成功:', file.name, `output=${blob.size}`);
    return blob;
  } catch (e) {
    logger.error('[heic2any] 转换失败:', file.name, e);
    throw e;
  }
}

interface QueueItem {
  file: File;
  resolve: (f: File) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
}

let heicQueue: QueueItem[] = [];
let heicRunning = 0;

async function processHeicQueue() {
  // 使用循环而非递归，避免大量文件时栈溢出
  while (heicQueue.length > 0) {
    // 填满并发槽位
    while (heicRunning < HEIC_CONCURRENCY && heicQueue.length > 0) {
      const item = heicQueue.shift()!;
      if (item.signal?.aborted) {
        item.reject(new HeicAbortError());
        continue;
      }
      heicRunning++;
      convertHeicToJpeg(item.file, item.signal)
        .then((jpegBlob) => {
          const jpegName = item.file.name.replace(/\.(heic|heif)$/i, '.jpg');
          const converted = new File([jpegBlob], jpegName, { type: 'image/jpeg' });
          logger.info('[heic] 队列转换完成:', jpegName);
          item.resolve(converted);
        })
        .catch((e) => {
          logger.warn('[heic] 队列转换失败:', item.file.name, e);
          item.reject(e);
        })
        .finally(() => {
          heicRunning--;
          // 触发下一轮检查（不递归调用）
        });
    }
    // 等待至少一个任务完成后再循环
    if (heicRunning > 0 && heicQueue.length > 0) {
      await new Promise<void>(r => setTimeout(r, 10));
    } else {
      break;
    }
  }
}

/**
 * 通过 Tauri Rust 命令调用 Windows WIC 将 HEIC 转换为 JPEG。
 * 仅在有原始文件路径的 Tauri 桌面端使用；失败时由 ensureSupportedFormat 回退到 heic2any。
 */
async function convertHeicToJpegViaRust(file: File, originalPath: string, signal?: AbortSignal): Promise<File> {
  if (signal?.aborted) throw new HeicAbortError();

  logger.info('[heic] 尝试 Rust/WIC 解码:', file.name, originalPath);
  try {
    const bytes: number[] = await invoke('convert_heic_to_jpeg', { filePath: originalPath });
    if (signal?.aborted) throw new HeicAbortError();

    const uint8 = new Uint8Array(bytes);
    const blob = new Blob([uint8], { type: 'image/jpeg' });
    if (blob.size === 0) throw new Error('Rust HEIC 转换结果为空');

    logger.info('[heic] Rust/WIC 解码成功:', file.name, `output=${blob.size}`);
    const jpegName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([blob], jpegName, { type: 'image/jpeg' });
  } catch (e) {
    logger.warn('[heic] Rust/WIC 解码失败:', file.name, e);
    throw e;
  }
}

/**
 * 使用 heif-rs（Rust 静态链接 libheif/libde265）将 HEIC 转换为 JPEG。
 * 作为 WIC 不可用时的第二优先路径，失败时由 ensureSupportedFormat 回退到 heic2any WASM。
 */
async function convertHeicToJpegViaNativeLibheif(file: File, originalPath: string, signal?: AbortSignal): Promise<File> {
  if (signal?.aborted) throw new HeicAbortError();

  logger.info('[heic] 尝试 Rust/libheif 解码:', file.name, originalPath);
  try {
    const bytes: number[] = await invoke('convert_heic_to_jpeg_native', { filePath: originalPath });
    if (signal?.aborted) throw new HeicAbortError();

    const uint8 = new Uint8Array(bytes);
    const blob = new Blob([uint8], { type: 'image/jpeg' });
    if (blob.size === 0) throw new Error('Rust libheif HEIC 转换结果为空');

    logger.info('[heic] Rust/libheif 解码成功:', file.name, `output=${blob.size}`);
    const jpegName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([blob], jpegName, { type: 'image/jpeg' });
  } catch (e) {
    logger.warn('[heic] Rust/libheif 解码失败:', file.name, e);
    throw e;
  }
}

/** 根据文件判断是否为 HEIC，若是则转换为 JPEG File（带全局并发限制） */
export async function ensureSupportedFormat(
  file: File,
  signal?: AbortSignal,
  originalPath?: string,
): Promise<File> {
  if (!isHeicFile(file.name)) return file;
  if (signal?.aborted) throw new HeicAbortError();

  logger.info('[heic] ensureSupportedFormat:', file.name, `isTauri=${isTauri()} originalPath=${originalPath ?? 'none'}`);

  if (isTauri() && originalPath) {
    // 路径 1：WIC（最快，但依赖系统 HEIF Image Extensions）
    try {
      return await convertHeicToJpegViaRust(file, originalPath, signal);
    } catch (e) {
      logger.warn('[heic] Rust/WIC 失败，回退到 Rust/libheif:', file.name, e);
      if (signal?.aborted) throw new HeicAbortError();
    }

    // 路径 2：Rust 原生 libheif（不依赖系统扩展，静态链接，速度与 WIC 接近）
    try {
      return await convertHeicToJpegViaNativeLibheif(file, originalPath, signal);
    } catch (e) {
      logger.warn('[heic] Rust/libheif 失败，回退到 heic2any WASM:', file.name, e);
      if (signal?.aborted) throw new HeicAbortError();
    }
  }

  // 路径 3：heic2any WASM（兜底，跨平台但较慢、内存占用高）
  return new Promise((resolve, reject) => {
    heicQueue.push({ file, resolve, reject, signal });
    processHeicQueue();
  });
}

/** 取消所有等待中的 HEIC 转换任务 */
export function abortHeicQueue() {
  for (const item of heicQueue) {
    item.reject(new HeicAbortError());
  }
  heicQueue = [];
}

/** 将任意 HEIC 文件转换为 JPEG data URL（用于预览等场景） */
export async function convertHeicToDataUrl(file: File): Promise<string | null> {
  try {
    const jpeg = await ensureSupportedFormat(file);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(jpeg);
    });
  } catch (e) {
    logger.warn('HEIC 转换失败:', file.name, e);
    return null;
  }
}
