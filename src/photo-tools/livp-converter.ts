/**
 * 格式转换：多种格式 → JPG
 *
 * - .livp：苹果实况照片（zip 包裹 .heic），用 jszip 解包后 heic2any 转换
 * - .heic / .heif：Tauri 端优先用 Rust/WIC 原生解码，Web 端用 heic2any
 * - .png / .webp / .bmp / .tiff / .gif：通过 Canvas API 转换
 *
 * 注意：heic2any 在本项目中通过 window 全局变量加载（见 heic-converter.ts），
 * 不是 ES 模块，不能用 import 导入。
 */

import { invoke } from '@tauri-apps/api/core';
import JSZip from 'jszip';
import { isTauri } from './platform';
import { readExifFull, embedExifIntoJpeg } from './exif';
import type { ToolProgress } from './types';
import { logger } from '../utils/logger';

declare global {
  interface Window {
    heic2any?: (options: { blob: Blob; toType: string; quality?: number }) => Promise<Blob | Blob[]>;
  }
}

export interface ConvertOptions {
  quality?: number;
  onProgress?: (p: ToolProgress) => void;
  /** 原始文件路径（Tauri 端优先用 Rust/WIC 原生解码，速度远快于 WASM） */
  filePath?: string;
}

export interface ConvertOutput {
  blob: Blob;
  exif?: Record<string, unknown> | null;
}

/** 调用 heic2any（通过 window 全局变量，与现有 heic-converter.ts 保持一致） */
async function callHeic2any(heicBlob: Blob, quality: number): Promise<Blob> {
  const h = window.heic2any;
  if (typeof h !== 'function') {
    throw new Error('heic2any 未加载，请检查网络或安装包完整性');
  }
  const result = await h({ blob: heicBlob, toType: 'image/jpeg', quality });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob || !(blob instanceof Blob) || blob.size === 0) {
    throw new Error('HEIC 转换结果为空');
  }
  return blob;
}

/** Tauri 端通过 Rust/WIC 原生解码 HEIC → JPEG（速度远快于 heic2any WASM） */
async function convertHeicViaRust(filePath: string): Promise<Blob> {
  const bytes: number[] = await invoke('convert_heic_to_jpeg', { filePath });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
  if (blob.size === 0) throw new Error('Rust HEIC 转换结果为空');
  return blob;
}

/** 通过 Canvas 将普通图片格式（png/webp/bmp/tiff/gif）转为 JPG */
async function convertImageViaCanvas(data: ArrayBuffer, quality: number): Promise<Blob> {
  const blob = new Blob([data]);
  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 上下文不可用');
  // JPG 不支持透明通道，用白色填充背景
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  img.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas 转换失败'))),
      'image/jpeg',
      quality,
    );
  });
}

/** 可通过 Canvas 转换的格式 */
const CANVAS_EXTS = new Set(['.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']);

/**
 * 将原始 EXIF 写回已转换好的 JPEG Blob。
 * 失败则原样返回，不影响转换结果（核心修复：避免 HEIC/PNG 等转 JPG 后丢失拍摄日期、GPS、相机参数）。
 */
async function embedResult(blob: Blob, exif: Record<string, unknown> | null): Promise<ConvertOutput> {
  if (!exif) return { blob, exif };
  try {
    const data = await blob.arrayBuffer();
    const finalData = embedExifIntoJpeg(data, exif);
    if (finalData === data) return { blob, exif };
    return { blob: new Blob([finalData], { type: 'image/jpeg' }), exif };
  } catch {
    return { blob, exif };
  }
}

/**
 * 将 .livp 文件转换为 JPG
 * livp 是 zip 包裹 .heic 的格式，解包后内部 heic 无文件路径，只能用 heic2any
 */
export async function convertLivpToJpg(
  data: ArrayBuffer,
  options: ConvertOptions = {},
): Promise<ConvertOutput> {
  const { quality = 0.95, onProgress } = options;

  onProgress?.({ phase: 'unzip', current: 0, total: 1, message: '解包 livp...' });
  const zip = await JSZip.loadAsync(data);

  const heicEntry = Object.values(zip.files).find(
    (f) => !f.dir && f.name.toLowerCase().endsWith('.heic'),
  );
  if (!heicEntry) throw new Error('livp 文件中未找到 HEIC 内容');

  const heicData = await heicEntry.async('arraybuffer');

  onProgress?.({ phase: 'convert', current: 0, total: 1, message: 'HEIC → JPG 转换中...' });

  let exif: Record<string, unknown> | null = null;
  try {
    exif = await readExifFull(heicData);
  } catch {
    // EXIF 读取失败不阻断转换
  }

  const heicBlob = new Blob([heicData], { type: 'image/heic' });
  const jpgBlob = await callHeic2any(heicBlob, quality);

  onProgress?.({ phase: 'done', current: 1, total: 1, message: '转换完成' });
  return embedResult(jpgBlob, exif);
}

/**
 * 将 HEIC/HEIF 数据转换为 JPG
 * Tauri 端优先用 Rust/WIC 原生解码，失败则回退 heic2any
 */
export async function convertHeicToJpg(
  data: ArrayBuffer,
  options: ConvertOptions = {},
): Promise<ConvertOutput> {
  const { quality = 0.95, onProgress, filePath } = options;

  let exif: Record<string, unknown> | null = null;
  try {
    exif = await readExifFull(data);
  } catch {
    // ignore
  }

  onProgress?.({ phase: 'convert', current: 0, total: 1, message: 'HEIC → JPG 转换中...' });

  // Tauri 端优先用 Rust/WIC 原生解码
  if (filePath && isTauri()) {
    try {
      const blob = await convertHeicViaRust(filePath);
      onProgress?.({ phase: 'done', current: 1, total: 1, message: '转换完成' });
      return embedResult(blob, exif);
    } catch (err) {
      logger.warn('[convert] Rust HEIC 转换失败，回退 heic2any:', err);
    }
  }

  // 回退 heic2any
  const heicBlob = new Blob([data], { type: 'image/heic' });
  const jpgBlob = await callHeic2any(heicBlob, quality);

  onProgress?.({ phase: 'done', current: 1, total: 1, message: '转换完成' });
  return embedResult(jpgBlob, exif);
}

/**
 * 将普通图片格式（png/webp/bmp/tiff/gif）通过 Canvas 转换为 JPG
 */
export async function convertImageToJpg(
  data: ArrayBuffer,
  options: ConvertOptions = {},
): Promise<ConvertOutput> {
  const { quality = 0.95, onProgress } = options;

  let exif: Record<string, unknown> | null = null;
  try {
    exif = await readExifFull(data);
  } catch {
    // ignore
  }

  onProgress?.({ phase: 'convert', current: 0, total: 1, message: '图片 → JPG 转换中...' });
  const blob = await convertImageViaCanvas(data, quality);
  onProgress?.({ phase: 'done', current: 1, total: 1, message: '转换完成' });
  return embedResult(blob, exif);
}

/** 统一转换入口：根据文件扩展名选择转换方式 */
export async function convertToJpg(
  data: ArrayBuffer,
  ext: string,
  options: ConvertOptions = {},
): Promise<ConvertOutput> {
  const e = ext.toLowerCase();
  if (e === '.livp') return convertLivpToJpg(data, options);
  if (e === '.heic' || e === '.heif') return convertHeicToJpg(data, options);
  // JPG/JPEG：通过 Canvas 重新编码，清除非标准 EXIF 结构（修复 piexifjs 无法处理的 JPEG）
  // 重编码前先读取原始 EXIF，重编码后写回，避免误杀原始 EXIF 数据
  if (e === '.jpg' || e === '.jpeg') {
    const { quality = 0.95, onProgress } = options;
    let exif: Record<string, unknown> | null = null;
    try {
      exif = await readExifFull(data);
    } catch {
      // EXIF 读取失败不阻断转换
    }
    onProgress?.({ phase: 'convert', current: 0, total: 1, message: 'JPG 重编码修复中...' });
    const blob = await convertImageViaCanvas(data, quality);
    onProgress?.({ phase: 'done', current: 1, total: 1, message: '修复完成' });
    // 有原始 EXIF 时写回（通过 embedResult 用 embedExifIntoJpeg 写入）
    if (exif) {
      return embedResult(blob, exif);
    }
    return { blob, exif: null };
  }
  if (CANVAS_EXTS.has(e)) return convertImageToJpg(data, options);
  throw new Error(`不支持的格式: ${ext}`);
}

/** 判断文件扩展名是否可转换（含 JPG 重编码修复） */
export function isConvertible(ext: string): boolean {
  const e = ext.toLowerCase();
  return e === '.livp' || e === '.heic' || e === '.heif' || e === '.jpg' || e === '.jpeg' || CANVAS_EXTS.has(e);
}
