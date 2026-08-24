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
 *   3. 分辨率特征：精确匹配常见屏幕分辨率，或宽高比接近 16:9 / 19.5:9 / 20:9 等屏占比特征明显的比例
 *
 * 每张照片输出置信度（high 判定为截图 / suspect 疑似）与命中信号列表，
 * UI 上展示判定依据，便于用户快速复核。
 *
 * ⚠️ 误判防护（保证识别准确率）：
 *   「无相机信息」本身是常见情况——很多真实照片（经 App 重存、裁剪、下载、扫描等）
 *   都会丢失相机厂商/型号；且 3:4、4:3、16:10 等同时是相机常见比例，已从屏幕比例列表中剔除。
 *   因此仅凭「无相机信息 + 屏幕分辨率/比例」不足以高置信度判定为截图，
 *   需要多个独立特征叠加（如同时命中文件名、EXIF 软件特征、PNG 无 EXIF 等）才会判定为高置信度，
 *   其余归为「疑似」供用户复核，避免大量误伤正常照片。
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
import { mapWithConcurrency } from './async-utils';

/**
 * EXIF 解析只需读取文件头（EXIF 段位于文件头部），
 * 避免读取整张照片字节——上万张照片时 IO/内存开销巨大。
 */
const HEAD_BYTES = 64 * 1024;

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

/** 常见屏幕宽高比（容差 ±0.03），长边/短边。
 * 仅保留「屏占比特征明显」的比例（16:9 / 19.5:9 / 20:9 等）。
 * 移除 3:4、4:3、16:10 等——这些同时也是相机常见比例，
 * 若纳入会误把真实拍摄照片的宽高比当作截图特征。
 */
const SCREEN_RATIOS = [
  16 / 9,   // 16:9（横向 16:9 屏幕/网页截图）
  19.5 / 9, // 19.5:9（主流全面屏手机）
  20 / 9,   // 20:9
  9 / 16,   // 竖向 16:9
  9 / 19.5,
  9 / 20,
];

const RATIO_TOLERANCE = 0.03;

/** 是否命中文件名关键词 */
function matchFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return FILENAME_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

/** 判断宽高是否为常见屏幕分辨率（导出便于单元测试） */
export function isScreenResolution(w: number, h: number): boolean {
  return SCREEN_RESOLUTIONS.some(
    ([rw, rh]) => (w === rw && h === rh) || (w === rh && h === rw),
  );
}

/** 判断宽高比是否接近常见屏幕比例（导出便于单元测试） */
export function isScreenRatio(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  const ratio = Math.max(w, h) / Math.min(w, h);
  return SCREEN_RATIOS.some((r) => Math.abs(ratio - r) <= RATIO_TOLERANCE);
}

/**
 * 从文件头字节解析图片像素尺寸（宽高）
 *
 * 支持 JPEG / PNG / WebP / GIF / BMP。相比 createImageBitmap 整图解码，
 * 只解析文件头即可获取尺寸：不占用主线程解码、不加载整张照片进内存，
 * 上万张照片识别时避免卡死。解析失败返回 null。
 */
export function getImageSizeFromHeader(buf: ArrayBuffer): { width: number; height: number } | null {
  const b = new Uint8Array(buf);

  // JPEG：扫描 SOF 段（标记 0xC0~0xCF，排除 C4 哈夫曼表 / C8 JPG / CC 差分表）
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (b[i + 5] << 8) | b[i + 6];
        const width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      const segLen = (b[i + 2] << 8) | b[i + 3];
      if (segLen === 0) break;
      i += 2 + segLen;
    }
    return null;
  }

  // PNG：IHDR 位于固定偏移 16~23（宽/高各 4 字节大端）
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const width = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
    const height = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // WebP：RIFF....WEBP + 子块
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === 'VP8 ' && b.length >= 28) {
      // 无损关键帧帧头：偏移 23-25 起始码，24-27 各 14 位宽高
      const width = ((b[24] | ((b[25] & 0x3f) << 8)) & 0x3fff) + 1;
      const height = ((b[26] | ((b[27] & 0x3f) << 8)) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === 'VP8L' && b.length >= 25) {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === 'VP8X' && b.length >= 30) {
      const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    return null;
  }

  // GIF：逻辑屏幕描述符，6-9 各 2 字节小端宽高
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    const width = b[6] | (b[7] << 8);
    const height = b[8] | (b[9] << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // BMP：位图信息头，18-25 各 4 字节小端宽高
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const width = b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24);
    const height = b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

/**
 * 识别单张照片是否为截图
 * @returns 命中信号列表（空数组 = 非截图）
 */
async function analyzePhoto(
  photo: PhotoFileInfo,
  readData: (p: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>,
): Promise<{ signals: ScreenshotSignal[]; readFailed: boolean }> {
  const signals: ScreenshotSignal[] = [];
  let readFailed = false;

  // 信号1：文件名关键词（无需读取数据）
  if (matchFilename(photo.name)) {
    signals.push('filename');
  }

  let data: ArrayBuffer | null = null;
  try {
    // 只读文件头（EXIF 段 + 尺寸解析所需均位于头部），避免读取整张照片字节
    data = await readData(photo, HEAD_BYTES);
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

    // 信号4/5：分辨率特征（EXIF 未提供尺寸时，从文件头解析，无需整图解码）
    let w = typeof exifWidth === 'number' ? exifWidth : 0;
    let h = typeof exifHeight === 'number' ? exifHeight : 0;
    if (w <= 0 || h <= 0) {
      const size = getImageSizeFromHeader(data);
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

/** 根据命中信号计算置信度并生成判定依据文案 key（导出便于单元测试） */
export function classify(signals: ScreenshotSignal[]): { confidence: 'high' | 'suspect'; reasons: ScreenshotSignal[] } | null {
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
  // 精确屏幕分辨率 + 无相机信息 + （PNG 无 EXIF 或软件特征）→ 多个独立特征叠加才判定为高置信度
  if (hasNoCamera && hasExactRes && (hasPng || hasSoftware)) high = true;
  // ⚠️ 注意：仅「无相机信息 + 精确屏幕分辨率」不再单独判为高置信度截图。
  // 很多真实照片（经 App 重存、裁剪、下载、扫描等）会丢失相机厂商/型号，
  // 分辨率也可能恰好落在常见屏幕尺寸上（如 1080×1920）。
  // 若仅凭这两个弱特征就高置信度判定，会大量误伤正常照片，故降级为「疑似」待用户复核。

  return {
    confidence: high ? 'high' : 'suspect',
    reasons: signals,
  };
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
