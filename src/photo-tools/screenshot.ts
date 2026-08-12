/**
 * 截图识别引擎
 *
 * 从照片库中自动识别出「手机/电脑屏幕截图」（聊天截图、网页截图、验证码截图等），
 * 与真实拍摄照片分离，便于用户筛选、归类、清理。
 *
 * 识别策略（多级规则判定，零 AI 依赖、保持安装包体积）：
 *   1. 文件名关键词（快路径，无需解码）：Screenshot / 截图 / 屏幕截图 / 截屏 / 微信图片 …
 *   2. EXIF 元数据：真实相机照片几乎必有相机厂商/型号；截图通常无相机信息，
 *      且部分机型会在 Software 字段写入截图特征
 *   3. 分辨率特征：精确匹配常见屏幕分辨率，或宽高比接近 16:9 / 19.5:9 等屏幕比例
 *
 * 每张照片输出置信度（high 判定为截图 / suspect 疑似）与命中信号列表，
 * UI 上展示判定依据，便于用户快速复核。
 */

import type {
  PhotoFileInfo,
  ScreenshotDetectOptions,
  ScreenshotDetectResult,
  ScreenshotItem,
  ScreenshotSignal,
} from './types';
import { readExifFull } from './exif';
import { logger } from '../utils/logger';

// ── 文件名截图关键词（大小写不敏感，匹配文件名主体） ──
const FILENAME_KEYWORDS = [
  'screenshot',
  'screen shot',
  'screencapture',
  '截图',
  '屏幕截图',
  '截屏',
  '截圖',
  '屏幕截圖',
  '微信图片',
  'weixin image',
  'tim screenshot',
  'capture',
];

// ── EXIF Software 字段的截图特征 ──
const SOFTWARE_KEYWORDS = ['screenshot', 'capture', 'snipping', '截屏', '截图', 'snip'];

/** 常见屏幕分辨率（精确匹配，宽高可横竖） */
const SCREEN_RESOLUTIONS: Array<[number, number]> = [
  [640, 480],
  [720, 1280], [1280, 720],
  [800, 1280], [1280, 800],
  [960, 1280], [1280, 960],
  [1080, 1920], [1920, 1080],
  [1080, 2160], [2160, 1080],
  [1080, 2340], [2340, 1080],
  [1080, 2400], [2400, 1080],
  [1170, 2532], [2532, 1170],
  [1179, 2556], [2556, 1179],
  [1200, 1920], [1920, 1200],
  [1284, 2778], [2778, 1284],
  [1290, 2796], [2796, 1290],
  [1440, 2560], [2560, 1440],
  [1440, 3120], [3120, 1440],
  [1440, 3200], [3200, 1440],
  [1536, 2048], [2048, 1536],
  [1920, 2560], [2560, 1920],
  [750, 1334], [1334, 750],
  [828, 1792], [1792, 828],
  [1125, 2436], [2436, 1125],
];

/** 常见屏幕宽高比（容差 ±0.03），长边/短边 */
const SCREEN_RATIOS = [
  16 / 9,   // 16:9
  16 / 10,  // 16:10
  19.5 / 9, // 19.5:9（主流全面屏手机）
  20 / 9,   // 20:9
  3 / 4,    // 4:3（旧手机/平板截图）
  4 / 3,
  9 / 16,   // 竖向 16:9
  9 / 19.5,
  10 / 16,
];

const RATIO_TOLERANCE = 0.03;

/** 是否命中文件名关键词 */
function matchFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return FILENAME_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

/** 判断宽高是否为常见屏幕分辨率 */
function isScreenResolution(w: number, h: number): boolean {
  return SCREEN_RESOLUTIONS.some(
    ([rw, rh]) => (w === rw && h === rh) || (w === rh && h === rw),
  );
}

/** 判断宽高比是否接近常见屏幕比例 */
function isScreenRatio(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  const ratio = Math.max(w, h) / Math.min(w, h);
  return SCREEN_RATIOS.some((r) => Math.abs(ratio - r) <= RATIO_TOLERANCE);
}

/**
 * 解码图片并获取其像素尺寸（宽高）
 * 通过 createImageBitmap 读取原始尺寸，失败返回 null。
 */
async function getImageSize(data: ArrayBuffer): Promise<{ width: number; height: number } | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([data]));
    return { width: bitmap.width, height: bitmap.height };
  } catch (err) {
    logger.debug('[screenshot] 图片解码失败', err);
    return null;
  } finally {
    if (bitmap) {
      try { bitmap.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 识别单张照片是否为截图
 * @returns 命中信号列表（空数组 = 非截图）
 */
async function analyzePhoto(
  photo: PhotoFileInfo,
  readData: (p: PhotoFileInfo) => Promise<ArrayBuffer | null>,
): Promise<{ signals: ScreenshotSignal[]; readFailed: boolean }> {
  const signals: ScreenshotSignal[] = [];
  let readFailed = false;

  // 信号1：文件名关键词（无需读取数据）
  if (matchFilename(photo.name)) {
    signals.push('filename');
  }

  let data: ArrayBuffer | null = null;
  try {
    data = await readData(photo);
  } catch (err) {
    logger.warn(`[screenshot] 读取 ${photo.name} 失败:`, err);
  }
  if (!data || data.byteLength === 0) {
    readFailed = true;
  }

  // 已有读取数据时，解析 EXIF 与分辨率
  if (data && data.byteLength > 0) {
    // 信号2/3：EXIF 元数据
    let make: unknown, model: unknown, software: unknown, exifWidth: unknown, exifHeight: unknown;
    let hasExif = false;
    try {
      const exif = await readExifFull(data);
      if (exif) {
        hasExif = true;
        make = exif.Make;
        model = exif.Model;
        software = exif.Software;
        exifWidth = exif.ImageWidth ?? exif.ExifImageWidth;
        exifHeight = exif.ImageHeight ?? exif.ExifImageHeight;
      }
    } catch (err) {
      logger.debug(`[screenshot] EXIF 解析失败 ${photo.name}:`, err);
    }

    const hasCameraInfo = Boolean(make) || Boolean(model);
    if (!hasCameraInfo && hasExif) {
      signals.push('noCamera');
    }
    if (typeof software === 'string' && SOFTWARE_KEYWORDS.some((k) => software!.toLowerCase().includes(k))) {
      signals.push('software');
    }

    // 信号4/5：分辨率特征
    let w = typeof exifWidth === 'number' ? exifWidth : 0;
    let h = typeof exifHeight === 'number' ? exifHeight : 0;
    if (w <= 0 || h <= 0) {
      // EXIF 未提供尺寸时，解码获取
      const size = await getImageSize(data);
      if (size) {
        w = size.width;
        h = size.height;
      }
    }
    // 真实相机照片（有 Make/Model 等拍摄信息）绝不判为截图分辨率/比例，避免误判正常照片
    if (w > 0 && h > 0 && !hasCameraInfo) {
      if (isScreenResolution(w, h)) signals.push('screenRes');
      else if (isScreenRatio(w, h)) signals.push('screenRatio');
    }

    // 信号6：PNG 且完全无 EXIF 段（截图多为 PNG 格式且无 EXIF）
    const ext = photo.ext || '';
    if ((ext === '.png' || ext === '.webp') && !hasExif) {
      signals.push('pngNoExif');
    }
  }

  return { signals, readFailed };
}

/** 根据命中信号计算置信度并生成判定依据文案 key */
function classify(signals: ScreenshotSignal[]): { confidence: 'high' | 'suspect'; reasons: ScreenshotSignal[] } | null {
  if (signals.length === 0) return null;

  // 高置信度：文件名命中，或 EXIF 软件特征 + 分辨率特征组合命中
  const hasFilename = signals.includes('filename');
  const hasSoftware = signals.includes('software');
  // 精确匹配常见屏幕分辨率是强信号；仅宽高比接近（screenRatio）是弱信号，不单独用于高置信度判定
  const hasExactRes = signals.includes('screenRes');
  const hasRatio = signals.includes('screenRatio');
  const hasNoCamera = signals.includes('noCamera');
  const hasPng = signals.includes('pngNoExif');

  let high = hasFilename;
  // 软件特征 + 精确屏幕分辨率 → 截图特征明显
  if (hasSoftware && hasExactRes) high = true;
  // 软件特征 + 屏幕比例（弱信号，仅与软件特征组合时提升到高置信度）
  if (hasSoftware && hasRatio) high = true;
  // 精确屏幕分辨率 + 无相机信息 + （PNG 无 EXIF 或软件特征）→ 大概率截图
  if (hasNoCamera && hasExactRes && (hasPng || hasSoftware)) high = true;
  // 精确屏幕分辨率 + 无相机信息 → 大概率截图（比例接近不再提升到高置信度，避免正常照片误判）
  if (signals.includes('screenRes') && hasNoCamera) high = true;

  return {
    confidence: high ? 'high' : 'suspect',
    reasons: signals,
  };
}

/**
 * 并发执行异步任务（与 hash.ts 保持一致的工作池模式）
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];
  const results: R[] = new Array(total);
  let nextIndex = 0;
  let doneCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const idx = nextIndex++;
      if (idx >= total) break;
      results[idx] = await fn(items[idx], idx);
      doneCount++;
      onProgress?.(doneCount, total);
    }
  }

  const workerCount = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * 识别一批照片中的截图
 *
 * @param photos 待识别照片
 * @param options 读取函数 / 进度回调 / 中止信号
 * @returns 截图识别结果（截图组 / 疑似组 / 正常照片）
 */
export async function detectScreenshots(
  photos: PhotoFileInfo[],
  options: ScreenshotDetectOptions,
): Promise<ScreenshotDetectResult> {
  const { readData, onProgress, signal } = options;
  const totalPhotos = photos.length;

  onProgress?.({ phase: 'scan', current: 0, total: totalPhotos, message: '开始识别截图...' });

  const results = await mapWithConcurrency(
    photos,
    async (p) => {
      if (signal?.aborted) return { signals: [] as ScreenshotSignal[], readFailed: false };
      try {
        return await analyzePhoto(p, readData);
      } catch (err) {
        logger.warn(`[screenshot] 识别 ${p.name} 失败:`, err);
        return { signals: [] as ScreenshotSignal[], readFailed: true };
      }
    },
    8,
    (done, total) => {
      onProgress?.({ phase: 'scan', current: done, total, message: `正在识别截图 ${done}/${total}` });
    },
    signal,
  );

  const screenshots: ScreenshotItem[] = [];
  const suspects: ScreenshotItem[] = [];
  const normalPhotos: PhotoFileInfo[] = [];
  let failedPhotos = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const { signals, readFailed } = results[i];
    if (readFailed) failedPhotos++;
    if (signals.length === 0) {
      // 读取失败且无文件名命中的，归入正常照片（无法判定，避免误删）
      normalPhotos.push(photo);
      continue;
    }
    const cls = classify(signals);
    if (!cls) {
      normalPhotos.push(photo);
      continue;
    }
    const item: ScreenshotItem = {
      photo,
      confidence: cls.confidence,
      reasons: cls.reasons,
    };
    if (cls.confidence === 'high') screenshots.push(item);
    else suspects.push(item);
  }

  if (failedPhotos > 0) {
    logger.warn(`[screenshot] ${failedPhotos} 张照片识别失败`);
  }

  return {
    screenshots,
    suspects,
    normalPhotos,
    totalPhotos,
    failedPhotos,
  };
}
