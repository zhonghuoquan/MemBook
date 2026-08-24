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
import type { PhotoFileInfo, OrganizePreviewItem, ToolProgress, OrganizeMode, LocationLevel } from './types';
import { logger } from '../utils/logger';
import { mapWithConcurrency, yieldToMain } from './async-utils';

/** EXIF 时间解析只需读取文件头（EXIF 段位于文件头部），避免读取整张照片字节 */
const EXIF_HEAD_BYTES = 64 * 1024;

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

/**
 * 从 location 字符串中解析指定层级的地名
 * location 格式："省-市-区县" 或 "省-市" 或 "市" 等（由 reverse_geocode 生成）
 *
 * @param location 完整 location 字符串
 * @param level 'province'=省级, 'city'=市级, 'district'=区县级, 'full'=省/市/区县三级路径
 * @returns 地名（如 "上海" / "浦东新区"），full 返回路径（如 "浙江省/杭州市/西湖区"），无 GPS 返回 "未知"
 */
export function parseLocationLevel(location: string | undefined, level: LocationLevel = 'city'): string {
  if (!location || !location.trim()) return '未知';
  const parts = location.split(/[-—·\s]+/).filter(Boolean);
  if (parts.length === 0) return '未知';

  // 去除常见的省/市/区/县后缀用于匹配
  const isProvince = (s: string) => /省$|自治区$|特别行政区$/.test(s) && s.length > 2;
  const isCity = (s: string) => /市$/.test(s);
  const isDistrict = (s: string) => /区$|县$|市$|镇$/.test(s);

  // 找省级
  const provincePart = parts.find((p) => isProvince(p));
  // 找市级
  const cityPart = parts.find((p) => isCity(p));
  // 找区县级（从后往前找）
  let districtPart: string | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isDistrict(parts[i]) && parts[i] !== cityPart) { districtPart = parts[i]; break; }
  }

  if (level === 'province') {
    return provincePart || parts[0] || '未知';
  }

  if (level === 'city') {
    if (cityPart) return cityPart;
    // 直辖市场景：第一个就是直辖市名（如 "上海-浦东新区"）
    return parts[0] || '未知';
  }

  if (level === 'district') {
    if (districtPart) return districtPart;
    // 没有区县后缀，取最后一个
    return parts[parts.length - 1] || '未知';
  }

  // full: 省/市/区县 三级完整路径
  if (level === 'full') {
    const segs: string[] = [];
    if (provincePart) segs.push(provincePart);
    if (cityPart && cityPart !== provincePart) segs.push(cityPart);
    if (districtPart) segs.push(districtPart);
    // 如果没匹配到标准后缀，退化为用所有 parts 拼接
    if (segs.length === 0) segs.push(...parts);
    return segs.length > 0 ? segs.join('/') : '未知';
  }

  return '未知';
}

/**
 * 计算目标目录路径（支持多模式）
 *
 * @param date 拍摄日期
 * @param mode 归类模式：time / location / time-location
 * @param location 完整 location 字符串（mode 含 location 时需要）
 * @param level 地点层级
 */
export function getTargetDirEx(
  date: Date | null,
  mode: OrganizeMode = 'time',
  location?: string,
  level: LocationLevel = 'city',
): string {
  const year = date ? date.getFullYear() : 0;
  const month = date ? String(date.getMonth() + 1).padStart(2, '0') : '00';
  const place = parseLocationLevel(location, level);

  switch (mode) {
    case 'location':
      return `MemBook照片整理/地点/${place}`;
    case 'time-location':
      // 旅行场景：地点在前，时间在后
      return `MemBook照片整理/地点/${place}/${year}年/${month}月`;
    case 'time':
    default:
      // 原有时间归类
      if (!date) return `MemBook照片整理/未知时间`;
      return `MemBook照片整理/${year}年/${month}月`;
  }
}

export interface PreviewOrganizeOptions {
  onProgress?: (p: ToolProgress) => void;
  /** 异步读取照片数据（length 可选：只读文件头取 EXIF，避免整图读取），不传则仅用 dateTaken + 文件名 */
  readData?: (photo: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>;
  /** 无 EXIF 和文件名时间时，是否使用文件修改日期归类 */
  useFileDate?: boolean;
  /** 获取文件修改日期（Tauri 端用 stat 实现） */
  getFileDate?: (photo: PhotoFileInfo) => Promise<Date | null>;
  /** 排除已在"MemBook照片整理/"目录中的文件（已整理过） */
  excludeSorted?: boolean;
  /** 归类模式（功能2） */
  mode?: OrganizeMode;
  /** 地点层级（功能2） */
  locationLevel?: LocationLevel;
  /** 逆向 geocode：将 GPS 坐标转为地名（功能2，mode 含 location 时需要） */
  reverseGeocode?: (lon: number, lat: number) => Promise<string | null>;
}

/**
 * 预览归类：计算每个文件的目标路径（支持时间/地点/时间+地点模式）
 *
 * 大批量优化（上万张照片不卡死）：
 *   1. 只读文件头（EXIF 段位于头部）取拍摄时间，避免读取整张照片字节
 *   2. EXIF 时间读取用 mapWithConcurrency 并发（IO 密集，串行会极慢）
 *   3. 顺序构建归类项时分批 + yieldToMain，UI 保持响应
 */
export async function previewOrganize(
  photos: PhotoFileInfo[],
  options: PreviewOrganizeOptions = {},
): Promise<OrganizePreviewItem[]> {
  const { onProgress, readData, useFileDate, getFileDate, excludeSorted } = options;
  const mode = options.mode ?? 'time';
  const locationLevel = options.locationLevel ?? 'city';
  const reverseGeocode = options.reverseGeocode;
  const items: OrganizePreviewItem[] = [];

  // location 缓存（避免对相同 GPS 重复 geocode）
  const locationCache = new Map<string, string>();
  // 正在进行的 geocode 请求（防并发重复请求）
  const inflightGeocode = new Map<string, Promise<string | null>>();

  // ── Step 1: 同步预筛（排除已整理）+ 收集需要读数据取时间的照片 ──
  const filtered: PhotoFileInfo[] = [];
  const needData: PhotoFileInfo[] = [];
  for (const photo of photos) {
    if (excludeSorted) {
      const relPath = (photo.relativePath || photo.path || '').replace(/\\/g, '/');
      if (relPath.startsWith('MemBook照片整理/') || relPath.includes('/MemBook照片整理/')) {
        continue;
      }
    }
    filtered.push(photo);
    // 已有 dateTaken 或文件名可解析出时间 → 无需读数据
    if (!resolvePhotoDate(photo) && readData) {
      needData.push(photo);
    }
  }

  // ── Step 2: 并发读取文件头取 EXIF 时间（IO 密集，并发加速） ──
  const dateByData = new Map<string, Date | null>(); // photoId → 时间
  if (needData.length > 0) {
    let doneCount = 0;
    await mapWithConcurrency(
      needData,
      async (p) => {
        try {
          const data = await readData!(p, EXIF_HEAD_BYTES);
          let d: Date | null = null;
          if (data && data.byteLength > 0) {
            d = await readExifDate(data);
          }
          dateByData.set(p.id, d ?? parseFilenameDate(p.name));
        } catch {
          dateByData.set(p.id, parseFilenameDate(p.name));
        }
        doneCount++;
        try {
          onProgress?.({
            phase: 'preview',
            current: doneCount,
            total: photos.length,
            message: `读取拍摄时间 ${doneCount}/${photos.length}`,
          });
        } catch {
          // 忽略进度回调错误
        }
      },
      8,
      undefined,
      undefined,
    );
  }

  // ── Step 3: 顺序构建归类项（含 geocode 缓存 + 分批让出主线程） ──
  const PROCESS_BATCH = 50;
  for (let b = 0; b < filtered.length; b += PROCESS_BATCH) {
    const end = Math.min(b + PROCESS_BATCH, filtered.length);
    for (let i = b; i < end; i++) {
      const photo = filtered[i];

      let date: Date | null = null;

      // 尝试从已有元数据或文件名解析
      date = resolvePhotoDate(photo);
      // 从 Step 2 并发读取的 EXIF 时间补全
      if (!date) date = dateByData.get(photo.id) ?? null;

      // 文件日期回退（无 EXIF 和文件名时间时，使用文件修改日期）
      if (!date && useFileDate && getFileDate) {
        try {
          date = await getFileDate(photo);
        } catch {
          // ignore
        }
      }

      // 地点模式下无日期也可以继续；时间模式无日期则跳过
      if (!date && mode === 'time') continue;

      // 解析地点（mode 含 location 时）
      let locationStr: string | undefined;
      if (mode !== 'time' && photo.gpsLon != null && photo.gpsLat != null && reverseGeocode) {
        const cacheKey = `${photo.gpsLon.toFixed(4)},${photo.gpsLat.toFixed(4)}`;
        locationStr = locationCache.get(cacheKey);
        if (!locationStr) {
          const existing = inflightGeocode.get(cacheKey);
          if (existing) {
            locationStr = await existing ?? undefined;
          } else {
            const promise = reverseGeocode(photo.gpsLon, photo.gpsLat)
              .then(r => { if (r) locationCache.set(cacheKey, r); return r; })
              .finally(() => inflightGeocode.delete(cacheKey));
            inflightGeocode.set(cacheKey, promise);
            try {
              locationStr = await promise ?? undefined;
            } catch {
              // geocode 失败，location 保持 undefined
            }
          }
        }
      }

      const targetDir = getTargetDirEx(date, mode, locationStr, locationLevel);
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
    }
    // 批间让出主线程，UI 可响应；进度按批次更新（平滑、不逐张刷屏）
    if (end < filtered.length) await yieldToMain();
    try {
      onProgress?.({
        phase: 'preview',
        current: end,
        total: photos.length,
        message: `分析 ${end}/${photos.length}`,
      });
    } catch {
      // 忽略进度回调错误
    }
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
 * 失败项自动重试一次（应对临时文件锁/系统抖动）
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
      // Tauri rename 可能报错但文件实际已移动（Windows 文件锁等），验证目标文件是否存在
      try {
        // 重新计算 finalTargetPath（catch 块中无法访问 try 内的变量）
        const targetDirPath = join(rootPath, item.targetDir);
        const targetPath = join(targetDirPath, item.fileName);
        let finalTargetPath = targetPath;
        let counter = 1;
        while (await exists(finalTargetPath)) {
          const dot = item.fileName.lastIndexOf('.');
          const stem = dot === -1 ? item.fileName : item.fileName.slice(0, dot);
          const ext = dot === -1 ? '' : item.fileName.slice(dot);
          finalTargetPath = join(targetDirPath, `${stem}_${counter}${ext}`);
          counter++;
        }
        const targetExists = await exists(normalize(finalTargetPath));
        if (targetExists) {
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

  // 重试失败项（最多重试 1 次，应对临时文件锁/系统抖动）
  if (failed > 0) {
    // 收集实际失败的项（conflictAction 为 move 且未被标记为 moved 的源文件存在的项）
    const retryItems: OrganizePreviewItem[] = [];
    for (const item of items) {
      if (item.conflictAction !== 'skip') {
        try {
          const sourceExists = await exists(normalize(item.sourcePath));
          if (sourceExists) retryItems.push(item);
        } catch { /* skip */ }
      }
    }

    if (retryItems.length > 0) {
      logger.info(`[organize] 重试 ${retryItems.length} 个失败项...`);
      let retryOk = 0;
      for (const item of retryItems) {
        try {
          const targetDirPath = join(rootPath, item.targetDir);
          if (!(await exists(targetDirPath))) {
            await mkdir(targetDirPath, { recursive: true });
          }
          const targetPath = join(targetDirPath, item.fileName);
          let finalTargetPath = targetPath;
          let counter = 1;
          while (await exists(finalTargetPath)) {
            const dot = item.fileName.lastIndexOf('.');
            const stem = dot === -1 ? item.fileName : item.fileName.slice(0, dot);
            const ext = dot === -1 ? '' : item.fileName.slice(dot);
            finalTargetPath = join(targetDirPath, `${stem}_${counter}${ext}`);
            counter++;
          }
          await rename(normalize(item.sourcePath), normalize(finalTargetPath));
          retryOk++;
          failed--;
        } catch (retryErr) {
          logger.warn(`[organize] 重试失败: ${item.sourcePath}`, retryErr);
        }
      }
      if (retryOk > 0) {
        moved += retryOk;
        logger.info(`[organize] 重试成功 ${retryOk} 个`);
      }
    }
  }

  return { moved, skipped, failed };
}
