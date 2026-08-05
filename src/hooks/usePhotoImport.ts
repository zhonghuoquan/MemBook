import { useCallback, useEffect, useRef, useState } from 'react';
import exifr from 'exifr';
import i18n from '../i18n';
import { usePhotoStore, useUIStore } from '../store';
import { photoService } from '../services/photoService';
import { isTauri, processOneFile, makeDirectPhotoUrl, restoreDirectoryHandle } from '../engine/storage-engine';
import { parseBigDataCloudLocation } from '../utils/locationParser';
import { abortHeicQueue, HeicAbortError } from '../engine/storage/heic-converter';
import { savePhotoChanges, getCurrentProjectId } from '../db';
import { terminateWorkerPool } from '../engine/storage/image-compressor';
import type { Photo } from '../types';
import { logger } from '../utils/logger';

export interface UsePhotoImportResult {
  isImporting: boolean;
  importProgress: number;
  importCurrent: number;
  importTotal: number;
  /** Tauri 路径读取阶段（用户选择存储模式后，读取文件内容到 File 对象） */
  isReading: boolean;
  readingProgress: number;
  readingCurrent: number;
  readingTotal: number;
  /** 缩略图加载阶段：processOneFile 完成后，浏览器仍在解码图像。
   *  usePhotoImport 跟踪待加载缩略图数量，供 UI 显示"正在加载缩略图"提示。 */
  thumbnailsTotal: number;
  thumbnailsLoaded: number;
  /** 注册某张照片的缩略图加载完成（由 PhotoThumbImg 的 onLoad 调用） */
  registerThumbnailLoaded: (photoId: string) => void;
  handleFiles: (files: FileList | File[], options?: { fallbackTimes?: Map<string, number>; originalPaths?: Map<string, string> }) => Promise<void>;
  /** Tauri 模式下：接收文件路径，若已有存储模式则直接读取并导入，否则弹窗让用户先选择模式 */
  handlePaths: (paths: string[]) => void;
  cancelImport: () => void;
}

const CONCURRENCY = 4; // 同时处理的最大照片数，避免一次性创建过多 Worker
const EXIF_CONCURRENCY = 12; // EXIF 解析并发数，避免主线程阻塞
const GEOCODE_CONCURRENCY = 6; // GPS 逆地理编码并发数
const SAVE_BATCH_SIZE = 20; // 每处理多少张照片增量持久化一次元数据
const PATH_READ_CONCURRENCY = 8; // Tauri 文件路径读取并发数

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.gif']);

// EXIF 日期标签优先级（越靠前越优先）
const EXIF_DATE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateTime', 'ModifyDate'] as const;

/** 判断年份是否合理：不能早于 1990，不能晚于明年 */
function isYearPlausible(date: Date): boolean {
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  return year >= 1990 && year <= currentYear + 1;
}

/** 解析 EXIF 时间字符串（兼容 2023:10:01 12:00:00 / 2023-10-01T12:00:00 等格式） */
function parseExifDate(raw: string | Date | undefined): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    return isYearPlausible(raw) ? raw : null;
  }
  try {
    const normalized = String(raw)
      .trim()
      .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      .replace(' ', 'T');
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return null;
    return isYearPlausible(date) ? date : null;
  } catch {
    return null;
  }
}

/** 生成文件在批量处理中的唯一 key（避免不同文件夹同名文件冲突） */
function getFileKey(file: File): string {
  return `${file.name}|${file.size}`;
}

/** 加载单张图片的 EXIF 日期和 GPS */
async function loadExifDate(file: File): Promise<{
  date: Date | null;
  dateSource: 'exif' | 'modified' | 'unknown';
  latitude?: number;
  longitude?: number;
}> {
  let latitude: number | undefined;
  let longitude: number | undefined;
  let date: Date | null = null;
  let dateSource: 'exif' | 'modified' | 'unknown' = 'unknown';

  try {
    // 1. 解析日期（独立请求，确保能读取到日期标签）
    const dateResult = await exifr.parse(file, [...EXIF_DATE_TAGS]);
    if (dateResult) {
      for (const tag of EXIF_DATE_TAGS) {
        const raw = dateResult[tag] ?? dateResult[tag.charAt(0).toLowerCase() + tag.slice(1)];
        const parsed = parseExifDate(raw);
        if (parsed) {
          date = parsed;
          dateSource = 'exif';
          break;
        }
      }
    }
  } catch { /* date parse failed */ }

  // 2. 独立解析 GPS（使用 exifr.gps 专用方法，确保正确读取 GPS 子 IFD）
  try {
    const gps = await exifr.gps(file);
    if (gps) {
      let lat = gps.latitude;
      let lng = gps.longitude;
      if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
        // 部分设备会把 GPSLatitude/GPSLongitude 标签写反，导致纬度绝对值超过 90。
        // 校验范围并自动交换，确保 lat ∈ [-90,90], lng ∈ [-180,180]。
        if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
          [lat, lng] = [lng, lat];
        }
        latitude = lat;
        longitude = lng;
      }
    }
  } catch { /* GPS parse failed */ }

  // 3. 兜底：exifr.gps 偶尔在打包版 WebView 中返回空，尝试完整解析原始 GPS 标签
  if (latitude == null || longitude == null) {
    try {
      const full = await exifr.parse(file, true);
      if (full?.GPSLatitude && full?.GPSLongitude) {
        const dmsToDecimal = (dms: [number, number, number]): number => {
          const [deg, min, sec] = dms;
          return deg + min / 60 + sec / 3600;
        };
        const latArr = full.GPSLatitude as [number, number, number] | undefined;
        const lngArr = full.GPSLongitude as [number, number, number] | undefined;
        const latRef = full.GPSLatitudeRef as string | undefined;
        const lngRef = full.GPSLongitudeRef as string | undefined;
        if (latArr && lngArr) {
          let lat = dmsToDecimal(latArr);
          if (latRef === 'S' || latRef === 's') lat = -lat;
          let lng = dmsToDecimal(lngArr);
          if (lngRef === 'W' || lngRef === 'w') lng = -lng;
          if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
            [lat, lng] = [lng, lat];
          }
          latitude = lat;
          longitude = lng;
        }
      }
    } catch { /* fallback GPS parse failed */ }
  }

  if (date) {
    return { date, dateSource, latitude, longitude };
  }

  return { date: null, dateSource: 'unknown', latitude, longitude };
}

/** 通用并发限制执行器（单个任务失败不中断整体流程，错误记录在结果中） */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let running = 0;
  return new Promise((resolve) => {
    const maybeResolve = () => {
      if (running === 0 && nextIndex >= items.length) resolve(results);
    };
    const pump = () => {
      while (running < concurrency && nextIndex < items.length) {
        const i = nextIndex++;
        running++;
        fn(items[i], i)
          .then((r) => { results[i] = r; })
          .catch((err) => {
            // 单个任务失败不中断整体流程，记录错误后继续
            logger.warn(`[concurrency] 任务 ${i} 失败:`, err);
          })
          .finally(() => { running--; maybeResolve(); pump(); });
      }
    };
    pump();
  });
}

/** BigDataCloud 逆地理编码
 *  - Tauri 桌面端：调用 Rust command，完全绕过浏览器 CORS 和 HTTP 权限限制
 *  - 浏览器/开发模式：使用原生 fetch（带 10 秒超时）
 */
const GEOCODE_TIMEOUT = 10000;

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const location = await invoke<string | null>('reverse_geocode', { latitude: lat, longitude: lng });
      return location;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT);
    const resp = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    return parseBigDataCloudLocation(data);
  } catch {
    return null;
  }
}

/** 批量读取 EXIF 元数据（日期 + GPS），带并发限制 */
async function batchLoadExifMeta(
  files: File[],
  fallbackTimes?: Map<string, number>,
): Promise<Map<string, {
  date: string;
  dateSource: 'exif' | 'modified' | 'unknown';
  latitude?: number;
  longitude?: number;
}>> {
  const map = new Map<string, { date: string; dateSource: 'exif' | 'modified' | 'unknown'; latitude?: number; longitude?: number }>();
  await runWithConcurrency(files, EXIF_CONCURRENCY, async (file) => {
    const result = await loadExifDate(file);
    const key = getFileKey(file);
    if (result.date) {
      map.set(key, {
        date: result.date.toISOString(),
        dateSource: 'exif',
        latitude: result.latitude,
        longitude: result.longitude,
      });
    } else {
      // 无 EXIF 时，优先使用外部提供的文件真实时间（如 Tauri fs.stat），再降级到 file.lastModified
      const fallback = fallbackTimes?.get(key);
      const date = fallback != null ? new Date(fallback) : new Date(file.lastModified);
      map.set(key, {
        date: date.toISOString(),
        dateSource: 'modified',
        latitude: result.latitude,
        longitude: result.longitude,
      });
    }
  });
  return map;
}

/** Tauri 模式下：扩展名 → MIME 类型映射，用于将文件路径转换为 File 对象 */
const PATH_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
  bmp: 'image/bmp', gif: 'image/gif',
};

/**
 * Tauri 模式下：从文件路径数组并行读取文件内容到 File 对象。
 * 使用并发限制避免主线程长时间阻塞，并通过 onProgress 回调反馈进度。
 * 返回结果中包含 originalPaths 与 fallbackTimes，供后续 doImport 使用。
 */
async function readFilesFromPaths(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<{
  files: File[];
  originalPaths: Map<string, string>;
  fallbackTimes: Map<string, number>;
}> {
  const { readFile, stat } = await import('@tauri-apps/plugin-fs');
  const files: File[] = [];
  const originalPaths = new Map<string, string>();
  const fallbackTimes = new Map<string, number>();
  let done = 0;

  await runWithConcurrency(paths, PATH_READ_CONCURRENCY, async (rawPath) => {
    const path = decodeURIComponent(rawPath.replace(/^file:\/\//i, ''));
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (!PATH_MIME_MAP[ext]) return;
    try {
      const name = path.split(/[/\\]/).pop() || 'photo';
      const [content, info] = await Promise.all([
        readFile(path),
        stat(path).catch(() => null),
      ]);
      const file = new File([content], name, { type: PATH_MIME_MAP[ext] });
      files.push(file);
      const key = `${file.name}|${file.size}`;
      originalPaths.set(key, path);
      const mtime = info?.mtime?.getTime();
      const birthtime = info?.birthtime?.getTime();
      const earliest = mtime != null && birthtime != null
        ? Math.min(mtime, birthtime)
        : (mtime ?? birthtime ?? null);
      if (earliest != null) fallbackTimes.set(key, earliest);
    } catch (err) {
      logger.warn('[usePhotoImport] 读取文件失败，跳过:', path, err);
    } finally {
      done++;
      onProgress?.(done, paths.length);
    }
  });

  return { files, originalPaths, fallbackTimes };
}

export function usePhotoImport(): UsePhotoImportResult {
  const addPhotos = usePhotoStore((s) => s.addPhotos);
  const addToast = useUIStore((s) => s.addToast);
  const storageMode = useUIStore((s) => s.storageMode);
  const pendingImportFiles = useUIStore((s) => s.pendingImportFiles);
  const pendingImportOptions = useUIStore((s) => s.pendingImportOptions);
  const pendingImportPaths = useUIStore((s) => s.pendingImportPaths);
  const requestStorageModeForImport = useUIStore((s) => s.requestStorageModeForImport);
  const clearPendingImport = useUIStore((s) => s.clearPendingImport);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  /* Tauri 路径读取阶段状态（用户选择存储模式后，读取文件内容到 File 对象） */
  const [isReading, setIsReading] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [readingCurrent, setReadingCurrent] = useState(0);
  const [readingTotal, setReadingTotal] = useState(0);
  /* 缩略图加载阶段状态：跟踪 processOneFile 完成后浏览器的图像解码进度。
   * thumbnailsTotal 在 addPhotos 时设为本次导入照片总数；
   * thumbnailsLoaded 在每张缩略图 onLoad 时递增；
   * 当 thumbnailsLoaded === thumbnailsTotal 时表示所有缩略图已就绪。 */
  const [thumbnailsTotal, setThumbnailsTotal] = useState(0);
  const [thumbnailsLoaded, setThumbnailsLoaded] = useState(0);
  const thumbnailsLoadedRef = useRef(0);
  const thumbnailsTotalRef = useRef(0);

  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importingKeysRef = useRef<Set<string>>(new Set());
  /** 读取阶段取消标志 */
  const readingAbortRef = useRef(false);

  /** 用于去重/防重入的 key（按文件名去掉扩展名 + 文件大小，兼容不同扩展名的同源文件） */
  const getDupKey = (file: File) => file.name.replace(/\.[^/.]+$/, '') + '|' + file.size;
  /** 从已存储的 Photo 生成去重 key（Photo.name 已去掉扩展名） */
  const getPhotoDupKey = (photo: { name: string; fileSize?: number }) => photo.name + '|' + (photo.fileSize ?? 0);

  /** 核心导入逻辑 */
  const doImport = useCallback(async (files: File[], mode: 'direct' | 'import', options?: { fallbackTimes?: Map<string, number>; originalPaths?: Map<string, string> }) => {
    abortRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    setIsImporting(true);
    setImportProgress(0);
    setImportCurrent(0);
    setImportTotal(0);

    const projectId = getCurrentProjectId() || undefined;
    let tempUrls: string[] = [];
    let placeholders: Photo[] = [];

    try {
      const imageFiles = Array.from(files).filter((f) => {
        if (f.type.startsWith('image/')) return true;
        const ext = '.' + f.name.split('.').pop()?.toLowerCase();
        return IMAGE_EXTS.has(ext);
      });

      // 去重：跳过已存在的照片（按文件名去掉扩展名 + 尺寸匹配，用 Map 避免 O(n²)）
      const existingPhotos = usePhotoStore.getState().photos;
      const existingMap = new Map(existingPhotos.map((p) => [getPhotoDupKey(p), true]));
      const newFiles: File[] = [];
      const skippedNames: string[] = [];
      for (const f of imageFiles) {
        if (existingMap.has(getDupKey(f))) {
          skippedNames.push(f.name);
        } else {
          newFiles.push(f);
        }
      }

      if (skippedNames.length > 0) {
        addToast({ type: 'info', message: i18n.t('hooks.photoImport.skippedDuplicates', { count: skippedNames.length }) });
      }
      if (newFiles.length === 0) {
        addToast({ type: skippedNames.length > 0 ? 'info' : 'warning', message: skippedNames.length > 0 ? i18n.t('hooks.photoImport.allExist') : i18n.t('hooks.photoImport.noValidImages') });
        setIsImporting(false);
        return;
      }

      const exifMetas = await batchLoadExifMeta(newFiles, options?.fallbackTimes);
      const total = newFiles.length;
      setImportTotal(total);

      // P0: tempUrls 延迟创建——不再一次性为 1000 个 File 创建 blob URL（峰值 5GB）。
      //   占位照片 src 设为空字符串，processing=true 时 PhotoThumbImg 显示 spinner 不渲染 <img>。
      //   Phase 2 处理完成后再设置真实 src（preview blob URL 或 asset://）。
      //   仅在 direct 模式解析失败需要兜底时，才按需为该单张创建 blob URL。
      tempUrls = new Array(total).fill('');
      placeholders = newFiles.map((f) => {
        const meta = exifMetas.get(getFileKey(f));
        return {
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src: '',  // P0: 不再持有 blob URL，避免 1000 个 File 同时驻留内存
          name: f.name.replace(/\.[^/.]+$/, ''),
          date: meta?.date || new Date(f.lastModified).toISOString(),
          dateSource: meta?.dateSource ?? 'unknown',
          location: undefined,
          latitude: meta?.latitude,
          longitude: meta?.longitude,
          locationStatus: meta?.latitude != null ? 'pending' : undefined,
          width: 0,
          height: 0,
          orientation: 'square' as const,
          fileSize: f.size,
          processing: true,
          albumId: projectId,
        };
      });
      addPhotos(placeholders);

      // 初始化缩略图加载跟踪：本次导入的所有照片都需要等待图像解码完成
      thumbnailsLoadedRef.current = 0;
      thumbnailsTotalRef.current = total;
      setThumbnailsLoaded(0);
      setThumbnailsTotal(total);

      // GPS → 逆地理编码：不阻塞导入主流程，后台限流执行
      // P0 修复：仅传 placeholderId/latitude/longitude，不传 file 字段。
      //   之前 gpsItems 包含 file: newFiles[i]，回调从未使用 file，
      //   但 runWithConcurrency 闭包持有整个 gpsItems 数组 → 持有所有原文件 File 对象（2GB+），
      //   且后台任务未 await，doImport 返回后仍运行数分钟，导致删除照片后内存不释放。
      const gpsItems = placeholders
        .map((p, i) => {
          const meta = exifMetas.get(getFileKey(newFiles[i]));
          return {
            placeholderId: p.id,
            latitude: meta?.latitude,
            longitude: meta?.longitude,
          };
        })
        .filter((item) => item.latitude != null && item.longitude != null);
      if (gpsItems.length > 0) {
        runWithConcurrency(gpsItems, GEOCODE_CONCURRENCY, async ({ placeholderId, latitude, longitude }) => {
          const location = await reverseGeocode(latitude!, longitude!);
          if (abortRef.current) return;
          usePhotoStore.getState().updatePhoto(placeholderId, {
            location: location ?? undefined,
            locationStatus: location ? 'success' : 'failed',
          });
          // 持久化 location 到 IndexedDB，避免刷新后丢失
          if (location) {
            const updated = usePhotoStore.getState().photoMap.get(placeholderId);
            if (updated) {
              savePhotoChanges([updated], projectId).catch(() => {});
            }
          }
        }).catch(() => { /* 单个失败不影响整体 */ });
      }
      addToast({ type: 'info', message: i18n.t('hooks.photoImport.processing', { count: total }) });

      // Phase 2: 限流并发后台处理（避免一次性创建过多 Worker，支持取消）
      const failedNames: string[] = [];
      const exifDateMap = new Map(newFiles.map((f) => [getFileKey(f), exifMetas.get(getFileKey(f))?.date ?? new Date(f.lastModified).toISOString()]));
      let completed = 0;
      const urlRevoked = new Array(total).fill(false);
      const pendingSavedPhotos: Photo[] = [];
      const flushPhotoChanges = async () => {
        if (pendingSavedPhotos.length === 0) return;
        const batch = pendingSavedPhotos.splice(0, pendingSavedPhotos.length);
        try {
          await savePhotoChanges(batch, projectId);
        } catch (e) {
          logger.error('增量保存失败:', e);
        }
      };

      await new Promise<void>((resolve) => {
        let nextIndex = 0;
        let running = 0;

        const maybeResolve = () => {
          // 取消时不再派发新任务，等所有正在运行的任务结束后立即 resolve
          if (running === 0 && (abortRef.current || nextIndex >= total)) {
            resolve();
          }
        };

        const pump = () => {
          if (abortRef.current) {
            // 取消后不再派发新任务，等正在运行的结束
            maybeResolve();
            return;
          }
          while (running < CONCURRENCY && nextIndex < total) {
            const i = nextIndex++;
            running++;
            processOneFile(newFiles[i], mode, exifDateMap, { originalPath: options?.originalPaths?.get(getFileKey(newFiles[i])), signal })
              .then(async (result) => {
                if (abortRef.current) return;
                if (result) {
                  let displaySrc = result.src;
                  let keepTempUrl = false;

                  // direct 模式下 result.src 可能只是文件名（非可加载 URL）。
                  // 必须先解析出真实可加载地址，再写入 photo.src；否则缩略图会短暂/长期空白。
                  if (result.storageMode === 'direct' && !result.blobId) {
                    if (isTauri()) {
                      // Tauri 桌面端：storage-engine 已根据 originalPath 生成 asset URL，直接使用
                      displaySrc = result.src;
                      // 如果 result.src 不是可加载 URL，回退到临时 blob URL
                      if (!result.src.startsWith('asset://') && !result.src.startsWith('blob:')) {
                        keepTempUrl = true;
                      }
                    } else {
                      // 浏览器 File System Access 模式：需要目录授权
                      try {
                        const handleReady = await restoreDirectoryHandle();
                        if (handleReady) {
                          const directUrl = await makeDirectPhotoUrl({
                            id: placeholders[i].id,
                            src: result.src,
                            name: result.name,
                            date: result.date,
                            width: result.width,
                            height: result.height,
                            orientation: result.orientation,
                            storageMode: 'direct',
                            relativePath: result.relativePath,
                            fileSize: result.fileSize,
                          } as Photo);
                          if (directUrl && !abortRef.current) {
                            displaySrc = directUrl;
                          } else {
                            keepTempUrl = true;
                          }
                        } else {
                          keepTempUrl = true;
                        }
                      } catch {
                        keepTempUrl = true;
                      }
                    }
                    if (keepTempUrl) {
                      // P0: 按需为单张创建 blob URL（而非预创建 1000 个），处理完成即 revoke
                      const onDemandUrl = URL.createObjectURL(newFiles[i]);
                      tempUrls[i] = onDemandUrl;
                      displaySrc = onDemandUrl;
                    }
                  }

                  usePhotoStore.getState().updatePhoto(placeholders[i].id, {
                    src: displaySrc,
                    width: result.width,
                    height: result.height,
                    orientation: result.orientation,
                    storageMode: result.storageMode,
                    relativePath: result.relativePath,
                    blobId: result.blobId,
                    originalBlobId: result.originalBlobId,
                    previewBlobId: result.previewBlobId,
                    processing: false,
                  });
                  const savedPhoto = usePhotoStore.getState().photoMap.get(placeholders[i].id);
                  if (savedPhoto) {
                    pendingSavedPhotos.push(savedPhoto);
                    if (pendingSavedPhotos.length >= SAVE_BATCH_SIZE) {
                      flushPhotoChanges();
                    }
                  }
                } else {
                  photoService.removePhoto(placeholders[i].id);
                  failedNames.push(newFiles[i].name);
                }
              })
              .catch((err) => {
                if (abortRef.current || err instanceof HeicAbortError) return;
                photoService.removePhoto(placeholders[i].id);
                failedNames.push(newFiles[i].name);
              })
              .finally(() => {
                if (!urlRevoked[i]) {
                  // direct 模式解析失败并回退到 blob 预览时，保留该临时 URL，避免缩略图变空白
                  const currentPhoto = usePhotoStore.getState().photoMap.get(placeholders[i].id);
                  if (currentPhoto?.src !== tempUrls[i]) {
                    URL.revokeObjectURL(tempUrls[i]);
                    urlRevoked[i] = true;
                  }
                }
                completed++;
                setImportCurrent(completed);
                setImportProgress(Math.round((completed / total) * 100));
                running--;
                maybeResolve();
                if (!abortRef.current) pump();
              });
          }
        };

        pump();
      });

      // 取消时清理未完成的占位符和剩余临时 URL
      if (abortRef.current) {
        for (let i = 0; i < total; i++) {
          if (!urlRevoked[i]) {
            URL.revokeObjectURL(tempUrls[i]);
            urlRevoked[i] = true;
          }
          const photo = usePhotoStore.getState().photoMap.get(placeholders[i]?.id ?? '');
          if (photo?.processing) {
            photoService.removePhoto(placeholders[i].id);
          }
        }
        addToast({ type: 'info', message: i18n.t('hooks.photoImport.cancelled') });
      } else {
        // 持久化剩余未批量保存的完成照片
        try {
          await flushPhotoChanges();
        } catch (e) {
          logger.error('照片持久化失败:', e);
          addToast({ type: 'warning', message: i18n.t('hooks.photoImport.persistFailed') });
        }

        const successCount = total - failedNames.length;
        if (failedNames.length > 0) {
          const names = failedNames.slice(0, 3).join(', ') + (failedNames.length > 3 ? i18n.t('hooks.photoImport.moreCount', { count: failedNames.length }) : '');
          addToast({ type: 'warning', message: i18n.t('hooks.photoImport.importedWithFailures', { successCount, failedCount: failedNames.length, names }) });
        } else {
          addToast({ type: 'success', message: i18n.t('hooks.photoImport.imported', { count: successCount }) });
        }

        // P0-fix: P2 后台任务已删除——Phase 1 现在一次性生成 thumb + preview，
        //   导入完成后 photo.src 已是 preview blob URL，无需二次读取原文件。
        //   终止 Worker 池释放 160-400MB 常驻内存。
        terminateWorkerPool();
      }
    } catch (err) {
      addToast({ type: 'error', message: i18n.t('hooks.photoImport.importFailed', { message: (err as Error)?.message }) });
      // 出错时清理临时资源
      for (const url of tempUrls) URL.revokeObjectURL(url);
      for (const p of placeholders) {
        if (usePhotoStore.getState().photoMap.get(p.id)) {
          photoService.removePhoto(p.id);
        }
      }
      // 出错时重置缩略图跟踪
      thumbnailsLoadedRef.current = 0;
      thumbnailsTotalRef.current = 0;
      setThumbnailsLoaded(0);
      setThumbnailsTotal(0);
    }
    setIsImporting(false);
    setImportProgress(0);
    setImportCurrent(0);
    setImportTotal(0);
    // 兜底：导入主流程完成后，若 15 秒内缩略图仍未全部加载完成（如折叠分组中的照片
    // 未进入视口），自动标记完成，避免进度提示长期停留
    setTimeout(() => {
      if (thumbnailsTotalRef.current > 0 && thumbnailsLoadedRef.current < thumbnailsTotalRef.current) {
        thumbnailsLoadedRef.current = thumbnailsTotalRef.current;
        setThumbnailsLoaded(thumbnailsLoadedRef.current);
        setTimeout(() => {
          setThumbnailsTotal(0);
          setThumbnailsLoaded(0);
          thumbnailsLoadedRef.current = 0;
          thumbnailsTotalRef.current = 0;
        }, 500);
      }
    }, 15000);
  }, [addPhotos, addToast]);

  /** 从路径数组读取文件并立即导入（用户已选择存储模式后调用） */
  const readAndImport = useCallback(async (paths: string[], mode: 'direct' | 'import') => {
    readingAbortRef.current = false;
    setIsReading(true);
    setReadingProgress(0);
    setReadingCurrent(0);
    setReadingTotal(paths.length);
    addToast({ type: 'info', message: i18n.t('hooks.photoImport.reading', { count: paths.length }) });
    try {
      const { files, originalPaths, fallbackTimes } = await readFilesFromPaths(paths, (current, total) => {
        if (readingAbortRef.current) return;
        setReadingCurrent(current);
        setReadingProgress(Math.round((current / total) * 100));
      });
      if (readingAbortRef.current) {
        addToast({ type: 'info', message: i18n.t('hooks.photoImport.readCancelled') });
        return;
      }
      if (files.length === 0) {
        addToast({ type: 'warning', message: i18n.t('hooks.photoImport.noValidFilesRead') });
        return;
      }
      await doImport(files, mode, { originalPaths, fallbackTimes });
    } catch (err) {
      logger.error('[usePhotoImport] 路径读取失败:', err);
      addToast({ type: 'error', message: i18n.t('hooks.photoImport.readFailed', { message: (err as Error)?.message }) });
    } finally {
      setIsReading(false);
      setReadingProgress(0);
      setReadingCurrent(0);
      setReadingTotal(0);
    }
  }, [addToast, doImport]);

  /** 消费弹窗选择后的 pending 文件/路径：用户 resolveStorageModePrompt 设置了 storageMode 后，
   *  立即用该模式继续导入。
   *  - 优先消费 pendingImportPaths（Tauri 模式：用户选模式后再读取文件，避免阻塞对话框）
   *  - 否则消费 pendingImportFiles（浏览器模式：File 已就绪） */
  useEffect(() => {
    if (!storageMode) return;
    // Tauri 路径模式：先弹窗让用户选模式，选完后再读取文件
    if (pendingImportPaths && pendingImportPaths.length > 0) {
      const paths = pendingImportPaths;
      const options = pendingImportOptions;
      clearPendingImport();
      // options 在路径模式下由 readFilesFromPaths 内部生成，此处忽略外部 options
      void options;
      readAndImport(paths, storageMode);
      return;
    }
    // 浏览器 File 模式：File 已就绪，直接导入
    if (!pendingImportFiles || pendingImportFiles.length === 0) return;
    const files = pendingImportFiles;
    const options = pendingImportOptions;
    clearPendingImport();
    doImport(files, storageMode, options ?? undefined);
  }, [storageMode, pendingImportFiles, pendingImportPaths, pendingImportOptions, clearPendingImport, doImport, readAndImport]);

  /** 处理导入文件入口（浏览器模式：已有 File 对象） */
  const handleFiles = useCallback(async (files: FileList | File[], options?: { fallbackTimes?: Map<string, number>; originalPaths?: Map<string, string> }) => {
    const imageFiles = Array.from(files).filter((f) => {
      if (f.type.startsWith('image/')) return true;
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return IMAGE_EXTS.has(ext);
    });
    if (imageFiles.length === 0) {
      addToast({ type: 'warning', message: i18n.t('hooks.photoImport.noValidImagesSelected') });
      return;
    }

    // 防重入：正在导入或读取中时直接跳过
    if (isImporting || isReading) return;

    // 如果尚未选择存储模式，弹出选择提示，由用户决定 import / direct。
    if (!storageMode) {
      requestStorageModeForImport(imageFiles, options);
      return;
    }

    // 防重入：同一次物理拖拽可能触发多个 drop 事件，按文件名+大小去重
    const uniqueFiles = imageFiles.filter((f) => {
      const key = getDupKey(f);
      if (importingKeysRef.current.has(key)) return false;
      importingKeysRef.current.add(key);
      return true;
    });
    if (uniqueFiles.length === 0) return;

    try {
      await doImport(uniqueFiles, storageMode, options);
    } finally {
      for (const f of uniqueFiles) importingKeysRef.current.delete(getDupKey(f));
    }
  }, [storageMode, isImporting, isReading, doImport, addToast, requestStorageModeForImport]);

  /** Tauri 模式下：处理文件路径入口
   *  - 已有存储模式：立即读取文件并导入
   *  - 未选存储模式：先弹窗让用户选择，选完后再读取并导入 */
  const handlePaths = useCallback((paths: string[]) => {
    if (paths.length === 0) {
      addToast({ type: 'warning', message: i18n.t('hooks.photoImport.noValidImagesSelected') });
      return;
    }
    if (isImporting || isReading) return;
    if (!storageMode) {
      // 传递空 files 数组 + paths，弹窗后由 effect 消费 paths
      requestStorageModeForImport([], undefined, paths);
      return;
    }
    readAndImport(paths, storageMode);
  }, [storageMode, isImporting, isReading, addToast, requestStorageModeForImport, readAndImport]);

  /** 取消当前导入（同时取消读取阶段） */
  const cancelImport = useCallback(() => {
    if (isReading) {
      readingAbortRef.current = true;
      return;
    }
    if (!isImporting) return;
    abortRef.current = true;
    abortControllerRef.current?.abort();
    abortHeicQueue();
  }, [isImporting, isReading]);

  /** 注册某张照片的缩略图加载完成（由 PhotoThumbImg 的 onLoad 调用）。
   *  使用 ref 避免 PhotoThumbImg 频繁 setState 导致的渲染抖动。 */
  const registerThumbnailLoaded = useCallback((photoId: string) => {
    void photoId;
    thumbnailsLoadedRef.current++;
    // 限制不超过 total，防止计数异常
    if (thumbnailsLoadedRef.current > thumbnailsTotalRef.current) {
      thumbnailsLoadedRef.current = thumbnailsTotalRef.current;
    }
    setThumbnailsLoaded(thumbnailsLoadedRef.current);
    // 全部加载完成后重置计数，为下次导入做准备
    if (thumbnailsLoadedRef.current >= thumbnailsTotalRef.current && thumbnailsTotalRef.current > 0) {
      // 延迟重置，让 UI 有时间显示"完成"状态
      setTimeout(() => {
        setThumbnailsTotal(0);
        setThumbnailsLoaded(0);
        thumbnailsLoadedRef.current = 0;
        thumbnailsTotalRef.current = 0;
      }, 500);
    }
  }, []);

  return {
    isImporting,
    importProgress,
    importCurrent,
    importTotal,
    isReading,
    readingProgress,
    readingCurrent,
    readingTotal,
    thumbnailsTotal,
    thumbnailsLoaded,
    registerThumbnailLoaded,
    handleFiles,
    handlePaths,
    cancelImport,
  };
}
