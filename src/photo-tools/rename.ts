/**
 * 批量重命名逻辑
 *
 * 流程：
 * 1. buildRenameVars：从 PhotoFileInfo 构建模板变量（date/location/seq/camera/original）
 * 2. previewRename：遍历照片，替换模板生成新文件名，做冲突检测
 * 3. executeRename：Tauri 端调用 rename 执行实际重命名
 *
 * 路径处理参考 organize.ts 的模式（normalize/join/sep）。
 */

import type { PhotoFileInfo, RenamePreviewItem, RenameTemplateVars, ToolProgress, LocationLevel } from './types';
import { resolvePhotoDate, parseLocationLevel } from './organize';
import { logger } from '../utils/logger';

export interface RenameOptions {
  /** 重命名模板，如 "{date}_{location}_{seq}" */
  template: string;
  /** 序号起始值，默认 1 */
  seqStart?: number;
  /** 序号位数，默认 3（001, 002...） */
  seqDigits?: number;
  /** 地点层级 */
  locationLevel?: LocationLevel;
  /** 逆向 geocode 函数 */
  reverseGeocode?: (lon: number, lat: number) => Promise<string | null>;
  /** 进度回调 */
  onProgress?: (p: ToolProgress) => void;
}

/**
 * 从 PhotoFileInfo 构建模板变量
 *
 * - date: 从 photo.dateTaken 或 resolvePhotoDate 解析，格式 "2024-01-15"，无日期用 "未知日期"
 * - location: 从 GPS + reverseGeocode 获取，用 parseLocationLevel 取市级，无 GPS 用 "未知"
 * - seq: 用 seqDigits 位数补零（如 001）
 * - camera: 从 cameraMake + cameraModel 拼接（去空格），无相机用 "未知相机"
 * - original: photo.name 去掉扩展名
 */
export async function buildRenameVars(
  photo: PhotoFileInfo,
  seq: number,
  options: RenameOptions,
): Promise<RenameTemplateVars> {
  // ---- date ----
  let date = '未知日期';
  const d = resolvePhotoDate(photo);
  if (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    date = `${y}-${m}-${day}`;
  }

  // ---- location ----
  let location = '未知';
  if (photo.gpsLon != null && photo.gpsLat != null && options.reverseGeocode) {
    try {
      const fullLocation = await options.reverseGeocode(photo.gpsLon, photo.gpsLat);
      if (fullLocation) {
        location = parseLocationLevel(fullLocation, options.locationLevel ?? 'city');
      }
    } catch {
      // geocode 失败，location 保持 "未知"
    }
  }

  // ---- seq ----
  const seqDigits = options.seqDigits ?? 3;
  const seqStr = String(seq).padStart(seqDigits, '0');

  // ---- camera ----
  let camera = '未知相机';
  const cameraParts = [photo.cameraMake, photo.cameraModel]
    .map(s => s?.trim())
    .filter((s): s is string => !!s && s.length > 0);
  if (cameraParts.length > 0) {
    camera = cameraParts.join(' ');
  }

  // ---- original ----
  const dot = photo.name.lastIndexOf('.');
  const original = dot === -1 ? photo.name : photo.name.slice(0, dot);

  return { date, location, seq: seqStr, camera, original };
}

/**
 * 预览重命名：计算每个文件的新文件名
 *
 * - 遍历 photos，为每个 photo 构建 vars
 * - 替换模板中的 {date} {location} {seq} {camera} {original}
 * - 保留原扩展名
 * - 冲突检测：如果多个文件生成相同 newName，加 _1, _2 后缀
 */
export async function previewRename(
  photos: PhotoFileInfo[],
  options: RenameOptions,
): Promise<RenamePreviewItem[]> {
  const items: RenamePreviewItem[] = [];
  const usedNames = new Set<string>();

  // 地点缓存（避免对相同 GPS 重复 geocode）
  const locationCache = new Map<string, string>();
  // 正在进行的 geocode 请求（防并发重复请求）
  const inflightGeocode = new Map<string, Promise<string | null>>();
  const cachedGeocode = options.reverseGeocode
    ? async (lon: number, lat: number): Promise<string | null> => {
        const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
        const cached = locationCache.get(key);
        if (cached !== undefined) return cached;
        // 并发去重：复用正在进行的请求
        const existing = inflightGeocode.get(key);
        if (existing) return existing;
        const promise = (async () => {
          try {
            const result = await options.reverseGeocode!(lon, lat);
            if (result) locationCache.set(key, result);
            return result;
          } catch {
            return null;
          } finally {
            inflightGeocode.delete(key);
          }
        })();
        inflightGeocode.set(key, promise);
        return promise;
      }
    : undefined;

  const wrappedOptions: RenameOptions = { ...options, reverseGeocode: cachedGeocode };

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const seq = (options.seqStart ?? 1) + i;
    const vars = await buildRenameVars(photo, seq, wrappedOptions);

    // 替换模板变量
    const baseName = options.template
      .replace(/{date}/g, vars.date)
      .replace(/{location}/g, vars.location)
      .replace(/{seq}/g, vars.seq)
      .replace(/{camera}/g, vars.camera)
      .replace(/{original}/g, vars.original);

    // 保留原扩展名（从原文件名解析，保留原始大小写）
    const dot = photo.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : photo.name.slice(dot);
    const newName = baseName + ext;

    // 冲突检测：同名时加 _1, _2 后缀
    let finalName = newName;
    let conflictSuffix: number | undefined;
    let counter = 1;
    while (usedNames.has(finalName)) {
      conflictSuffix = counter;
      finalName = `${baseName}_${counter}${ext}`;
      counter++;
    }
    usedNames.add(finalName);

    items.push({
      photo,
      oldName: photo.name,
      newName: finalName,
      conflictSuffix,
    });

    options.onProgress?.({
      phase: 'preview',
      current: i + 1,
      total: photos.length,
      message: `分析 ${i + 1}/${photos.length}`,
    });
  }

  return items;
}

/**
 * 执行重命名（仅 Tauri 端可用）
 *
 * - 动态 import @tauri-apps/plugin-fs 的 rename
 * - photo.path 已是完整绝对路径（folder 模式扫描结果），直接作为 oldPath，
 *   新路径 = photo.path 的目录部分 + 新文件名，不再拼接 rootPath（避免双重路径）
 * - 用 rename(oldPath, newPath) 执行重命名
 * - 统计 renamed 和 failed
 * - 失败项自动重试一次（应对临时文件锁/系统抖动）
 */
export async function executeRename(
  items: RenamePreviewItem[],
  rootPath: string,
  options?: { onProgress?: (p: ToolProgress) => void },
): Promise<{ renamed: number; failed: number }> {
  const onProgress = options?.onProgress;
  let renamed = 0;
  let failed = 0;

  // 动态导入 Tauri FS
  const { rename } = await import('@tauri-apps/plugin-fs');

  // 路径规范化：统一为平台分隔符（Windows 用 \，Unix 用 /）
  // 以第一个有效路径推断分隔符（rootPath 仅作兜底）
  const firstPath = items.find((i) => i.photo.path)?.photo.path ?? rootPath;
  const sep = firstPath.includes('\\') ? '\\' : '/';
  const normalize = (p: string): string => p.replace(/[/\\]+/g, sep);
  const join = (base: string, ...parts: string[]): string =>
    [base, ...parts].join(sep).replace(/[/\\]+/g, sep);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const photoPath = item.photo.path;

    // 无路径信息无法重命名
    if (!photoPath) {
      logger.warn(`[rename] 跳过无路径文件: ${item.oldName}`);
      failed++;
      continue;
    }

    try {
      // 获取 photo.path 的目录部分
      const lastSep = Math.max(photoPath.lastIndexOf('/'), photoPath.lastIndexOf('\\'));
      const dirPart = lastSep === -1 ? '' : photoPath.slice(0, lastSep);

      // photo.path 已是完整路径，直接使用；新路径 = 目录部分 + 新文件名
      const oldPath = normalize(photoPath);
      const newPath = normalize(join(dirPart, item.newName));

      await rename(oldPath, newPath);
      renamed++;
    } catch (err) {
      logger.warn(`[rename] 重命名失败: ${item.oldName} -> ${item.newName}`, err);
      failed++;
    }

    onProgress?.({
      phase: 'execute',
      current: i + 1,
      total: items.length,
      message: `重命名 ${i + 1}/${items.length}`,
    });
  }

  // 重试失败项（最多重试 1 次，应对临时文件锁/系统抖动）
  if (failed > 0) {
    // 收集失败项（photo.path 存在且源文件仍在的项）
    const failedItems: RenamePreviewItem[] = [];
    for (const item of items) {
      if (!item.photo.path) continue;
      // 检查源文件是否仍在（源文件在说明上次重命名失败）
      try {
        const { stat } = await import('@tauri-apps/plugin-fs');
        // 检查源文件是否存在
        const oldPath = normalize(item.photo.path);
        // 如果源文件仍在，说明需要重试
        await stat(oldPath);
        failedItems.push(item);
      } catch {
        // stat 失败说明源文件已不存在（可能已成功重命名），跳过
      }
    }

    if (failedItems.length > 0) {
      logger.info(`[rename] 重试 ${failedItems.length} 个失败项...`);
      for (const item of failedItems) {
        const photoPath = item.photo.path;
        if (!photoPath) continue;
        try {
          const lastSep = Math.max(photoPath.lastIndexOf('/'), photoPath.lastIndexOf('\\'));
          const dirPart = lastSep === -1 ? '' : photoPath.slice(0, lastSep);
          const oldPath = normalize(photoPath);
          const newPath = normalize(join(dirPart, item.newName));
          await rename(oldPath, newPath);
          renamed++;
          failed--;
        } catch (retryErr) {
          logger.warn(`[rename] 重试失败: ${item.oldName} -> ${item.newName}`, retryErr);
        }
      }
    }
  }

  return { renamed, failed };
}
