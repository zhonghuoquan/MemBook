/**
 * MemBook — 双轨存储引擎 (PRD 1.4)
 *
 * 两种模式：
 * 1. direct  — 直接访问模式 (File System Access API)
 *    用户授权一个文件夹，直接从原路径读取照片，不复制到浏览器。
 * 2. import  — 导入存储模式 (IndexedDB)
 *    照片压缩后存入 IndexedDB/Dexie，完全离线可用。
 */

import type { Photo, StorageMode } from '../types';

/* ════════════════════════════════════════════════
   Direct Access Engine — File System Access API
   ════════════════════════════════════════════════ */

let directoryHandle: FileSystemDirectoryHandle | null = null;

/** 检测浏览器是否支持 File System Access API */
export function supportsDirectAccess(): boolean {
  return 'showDirectoryPicker' in window &&
         'FileSystemFileHandle' in window &&
         typeof window.showDirectoryPicker === 'function';
}

/** 请求用户选择一个照片文件夹，保存句柄 */
export async function pickPhotoDirectory(): Promise<boolean> {
  try {
    directoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
    // 持久化句柄（IndexedDB 可序列化 FileSystemDirectoryHandle）
    const { setDirectHandle } = await import('./handle-store');
    await setDirectHandle(directoryHandle!);
    return true;
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return false;
    console.error('选择文件夹失败:', err);
    return false;
  }
}

/** 恢复之前保存的目录句柄 */
export async function restoreDirectoryHandle(): Promise<boolean> {
  try {
    const { getDirectHandle } = await import('./handle-store');
    const handle = await getDirectHandle();
    if (handle) {
      // 验证权限
      const opts = { mode: 'read' } as any;
      if ((await (handle as any).queryPermission(opts)) === 'granted' ||
          (await (handle as any).requestPermission(opts)) === 'granted') {
        directoryHandle = handle;
        return true;
      }
    }
  } catch { /* handle invalid or revoked */ }
  return false;
}

/** 从直接访问模式读取图片文件 */
export async function readDirectPhoto(filePath: string): Promise<string | null> {
  if (!directoryHandle) {
    const ok = await restoreDirectoryHandle();
    if (!ok) return null;
  }
  try {
    // 路径格式: "subfolder/filename.jpg"
    const parts = filePath.split('/');
    let handle: FileSystemDirectoryHandle | FileSystemFileHandle = directoryHandle!;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await (handle as FileSystemDirectoryHandle).getDirectoryHandle(parts[i]);
    }
    const fileHandle = await (handle as FileSystemDirectoryHandle).getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/** 读取目录下的所有图片文件（直接访问模式） */
export async function scanDirectPhotos(): Promise<{ file: File; relativePath: string }[]> {
  if (!directoryHandle) {
    const ok = await restoreDirectoryHandle();
    if (!ok) return [];
  }
  const results: { file: File; relativePath: string }[] = [];
  await scanDirRecursive(directoryHandle!, '', results);
  return results;
}

async function scanDirRecursive(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  results: { file: File; relativePath: string }[],
) {
  const imageExts = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.bmp', '.gif']);
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      // 跳过隐藏目录和node_modules
      if (!name.startsWith('.')) {
        await scanDirRecursive(handle as FileSystemDirectoryHandle, fullPath, results);
      }
    } else if (handle.kind === 'file') {
      const ext = '.' + name.split('.').pop()?.toLowerCase();
      if (imageExts.has(ext)) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          results.push({ file, relativePath: fullPath });
        } catch { /* skip unreadable files */ }
      }
    }
  }
}

/* ════════════════════════════════════════════════
   Import Store Engine — IndexedDB (Dexie)
   ════════════════════════════════════════════════ */

const MAX_IMPORT_WIDTH = 2048; // 最大宽度，超过则缩小

/** 压缩图片并存入 IndexedDB */
export async function importPhotoToDB(file: File, maxWidth = MAX_IMPORT_WIDTH): Promise<string> {
  const blob = await compressImage(file, maxWidth);
  const id = `photo-blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { savePhotoBlob } = await import('./handle-store');
  await savePhotoBlob(id, blob);

  return id; // 返回 blob ID 用于读取
}

/** 从 IndexedDB 读取已导入的图片 */
export async function readPhotoFromDB(blobId: string): Promise<string | null> {
  try {
    const { getPhotoBlob } = await import('./handle-store');
    const blob = await getPhotoBlob(blobId);
    if (blob) return URL.createObjectURL(blob);
  } catch { /* not found */ }
  return null;
}

/** 压缩图片至目标宽度，保持宽高比 */
function compressImage(file: File, maxWidth: number): Promise<Blob> {
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
      }, 'image/jpeg', 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ════════════════════════════════════════════════
   统一导入入口
   ════════════════════════════════════════════════ */

export type ImportResult = {
  id: string;
  src: string;
  name: string;
  date: string;
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait' | 'square';
  storageMode: StorageMode;
  relativePath?: string;  // direct 模式的文件路径
};

/** 根据存储模式导入一组文件 */
export async function importFilesByMode(
  files: File[],
  mode: StorageMode,
  exifDates: Map<string, string>,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const file of files) {
    try {
      const tempSrc = URL.createObjectURL(file);
      const dims = await loadImageDimensions(tempSrc);
      URL.revokeObjectURL(tempSrc);

      const isoDate = exifDates.get(file.name) || new Date(file.lastModified).toISOString();

      if (mode === 'direct') {
        // 直接访问模式：只保留引用
        results.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src: file.name,
          name: file.name.replace(/\.[^/.]+$/, ''),
          date: isoDate,
          width: dims.width,
          height: dims.height,
          orientation: dims.width > dims.height ? 'landscape' : dims.width < dims.height ? 'portrait' : 'square',
          storageMode: 'direct',
          relativePath: file.name,
        });
      } else {
        // 导入模式：压缩并存入 IndexedDB
        const blobId = await importPhotoToDB(file);
        const blobUrl = await readPhotoFromDB(blobId);
        results.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src: blobUrl || tempSrc,
          name: file.name.replace(/\.[^/.]+$/, ''),
          date: isoDate,
          width: dims.width,
          height: dims.height,
          orientation: dims.width > dims.height ? 'landscape' : dims.width < dims.height ? 'portrait' : 'square',
          storageMode: 'import',
        });
      }
    } catch {
      // skip failed images
    }
  }

  return results;
}

/** 从 direct 模式的 src (文件路径) 生成 blob URL */
export function makeDirectPhotoUrl(photo: Photo): Promise<string | null> {
  if (photo.storageMode === 'import') return Promise.resolve(photo.src);
  if (photo.storageMode === 'direct') return readDirectPhoto(photo.src);
  return Promise.resolve(photo.src);
}

/* ── 内部工具 ── */

function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = src;
  });
}
