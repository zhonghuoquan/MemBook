/**
 * 按时间归类逻辑
 *
 * 流程（移植自 Python 脚本 1-整理相册.py）：
 * 1. 读取拍摄时间：EXIF → 文件名解析 → 跳过
 * 2. 计算目标路径：MemBook照片整理/{年}年/{月}月/文件名
 * 3. 预览：列出每个文件的目标路径
 * 4. 执行：Tauri 端 mkdir + rename 移动文件
 */

import { readExifDate } from './exif';
import { parseFilenameDate } from './filename-time';
import type { PhotoFileInfo, OrganizePreviewItem, ToolProgress } from './types';
import { logger } from '../utils/logger';

/**
 * 解析照片的拍摄时间
 * 优先使用已有 dateTaken，其次文件名解析
 */
export function resolvePhotoDate(photo: PhotoFileInfo): Date | null {
  // 已有 EXIF 时间
  if (photo.dateTaken) {
    const d = new Date(photo.dateTaken);
    if (!isNaN(d.getTime())) return d;
  }
  // 文件名解析
  return parseFilenameDate(photo.name);
}

/** 从数据中读取 EXIF 时间（需读取文件内容时使用） */
export async function resolvePhotoDateWithData(
  photo: PhotoFileInfo,
  data: ArrayBuffer,
): Promise<Date | null> {
  // 先尝试已有 dateTaken
  if (photo.dateTaken) {
    const d = new Date(photo.dateTaken);
    if (!isNaN(d.getTime())) return d;
  }
  // EXIF 读取
  const exifDate = await readExifDate(data);
  if (exifDate) return exifDate;
  // 文件名兜底
  return parseFilenameDate(photo.name);
}

/** 计算目标目录路径：MemBook照片整理/2024年/03月 */
export function getTargetDir(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `MemBook照片整理/${year}年/${month}月`;
}

export interface PreviewOrganizeOptions {
  onProgress?: (p: ToolProgress) => void;
  /** 异步读取照片数据（用于 EXIF 时间读取），不传则仅用 dateTaken + 文件名 */
  readData?: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 无 EXIF 和文件名时间时，是否使用文件修改日期归类 */
  useFileDate?: boolean;
  /** 获取文件修改日期（Tauri 端用 stat 实现） */
  getFileDate?: (photo: PhotoFileInfo) => Promise<Date | null>;
  /** 排除已在"MemBook照片整理/"目录中的文件（已整理过） */
  excludeSorted?: boolean;
}

/**
 * 预览时间归类：计算每个文件的目标路径
 */
export async function previewOrganize(
  photos: PhotoFileInfo[],
  options: PreviewOrganizeOptions = {},
): Promise<OrganizePreviewItem[]> {
  const { onProgress, readData, useFileDate, getFileDate, excludeSorted } = options;
  const items: OrganizePreviewItem[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];

    // 排除已整理的文件（已在"MemBook照片整理/"目录下）
    if (excludeSorted) {
      const relPath = (photo.relativePath || photo.path || '').replace(/\\/g, '/');
      if (relPath.startsWith('MemBook照片整理/') || relPath.includes('/MemBook照片整理/')) {
        continue;
      }
    }

    let date: Date | null = null;

    // 尝试从已有元数据或文件名解析
    date = resolvePhotoDate(photo);

    // 如果没有时间且有 readData，尝试读 EXIF
    if (!date && readData) {
      try {
        const data = await readData(photo);
        if (data) {
          date = await readExifDate(data);
          if (!date) date = parseFilenameDate(photo.name);
        }
      } catch {
        // 读取失败，跳过
      }
    }

    // 文件日期回退（无 EXIF 和文件名时间时，使用文件修改日期）
    if (!date && useFileDate && getFileDate) {
      try {
        date = await getFileDate(photo);
      } catch {
        // ignore
      }
    }

    if (!date) continue;

    const targetDir = getTargetDir(date);
    const sourcePath = photo.path || photo.name;

    // 检查是否已在目标位置
    const expectedPath = `${targetDir}/${photo.name}`;
    const conflictAction: OrganizePreviewItem['conflictAction'] =
      sourcePath.replace(/\\/g, '/') === expectedPath.replace(/\\/g, '/')
        ? 'skip'
        : 'move';

    items.push({
      sourcePath,
      targetDir,
      fileName: photo.name,
      conflictAction,
    });

    onProgress?.({
      phase: 'preview',
      current: i + 1,
      total: photos.length,
      message: `分析 ${i + 1}/${photos.length}`,
    });
  }

  return items;
}

export interface ExecuteOrganizeOptions {
  /** 根目录路径（目标路径将拼接在此目录下） */
  rootPath: string;
  onProgress?: (p: ToolProgress) => void;
}

/**
 * 执行时间归类（仅 Tauri 端可用）
 * 在 rootPath 下创建 年/月 目录结构并移动文件
 */
export async function executeOrganize(
  items: OrganizePreviewItem[],
  options: ExecuteOrganizeOptions,
): Promise<{ moved: number; skipped: number; failed: number }> {
  const { rootPath, onProgress } = options;
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  // 动态导入 Tauri FS
  const { rename, mkdir } = await import('@tauri-apps/plugin-fs');
  const { exists } = await import('@tauri-apps/plugin-fs');

  // 路径规范化：统一为平台分隔符（Windows 用 \，Unix 用 /）
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const normalize = (p: string): string => p.replace(/[/\\]+/g, sep);
  const join = (base: string, ...parts: string[]): string =>
    [base, ...parts].join(sep).replace(/[/\\]+/g, sep);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.conflictAction === 'skip') {
      skipped++;
      continue;
    }

    try {
      const targetDirPath = join(rootPath, item.targetDir);
      // 创建目标目录（递归）
      if (!(await exists(targetDirPath))) {
        await mkdir(targetDirPath, { recursive: true });
      }

      const targetPath = join(targetDirPath, item.fileName);

      // 同名冲突处理：加 _1 后缀
      let finalTargetPath = targetPath;
      let counter = 1;
      while (await exists(finalTargetPath)) {
        const dot = item.fileName.lastIndexOf('.');
        const stem = dot === -1 ? item.fileName : item.fileName.slice(0, dot);
        const ext = dot === -1 ? '' : item.fileName.slice(dot);
        finalTargetPath = join(targetDirPath, `${stem}_${counter}${ext}`);
        counter++;
      }

      // 规范化路径：sourcePath 可能含混合分隔符（如 G:\...\dir/file.png），需统一
      await rename(normalize(item.sourcePath), normalize(finalTargetPath));
      moved++;
    } catch (err) {
      // Tauri rename 可能报错但文件实际已移动（Windows 文件锁等），验证源文件是否还在
      try {
        const sourceExists = await exists(normalize(item.sourcePath));
        if (!sourceExists) {
          moved++;
          continue;
        }
      } catch { /* ignore */ }
      logger.warn(`[organize] 移动失败: ${item.sourcePath}`, err);
      failed++;
    }

    onProgress?.({
      phase: 'execute',
      current: i + 1,
      total: items.length,
      message: `移动 ${i + 1}/${items.length}`,
    });
  }

  return { moved, skipped, failed };
}
