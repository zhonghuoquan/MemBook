/**
 * MemBook — 导出引擎 v5（Canvas 2D 直接绘制）
 *
 * 核心策略：
 *   1. 滑动窗口加载照片：仅缓存当前页 ±N 页的位图，逐页推进淘汰，
 *      避免大项目导出时同时持有全部照片导致内存暴涨
 *   2. 超大图降采样：超过页面最长边 ×2 的照片先等比缩小再绘制
 *   3. 用原生 Canvas 2D API 直接绘制每一页（drawImage + clip）
 *   4. 不依赖 Konva Stage / React 渲染时序，完全同步可控
 *   5. 导出任务实例化（ExportTask）：取消标志与警告随任务销毁，
 *      避免模块级可变单例在热更新/多次导出场景下状态残留
 *
 * 参考：Word/PPT 的渲染引擎是纯函数，不依赖 UI 状态。
 *       本方案用 Canvas 2D API 实现等价的纯函数式渲染。
 */

import { useEditorStore, usePhotoStore } from '../store';
import { makeDirectPhotoUrl, readPhotoFromDB } from '../engine/storage-engine';
import { invalidateBlobUrlCache } from '../engine/storage/import-store';
import { SLOT_CANVAS_PALETTE, SLOT_BORDER_COLORS } from '../constants/templatePalette';
import { toRgba, linearGradientEndpoints } from '../constants/colorPalette';
import { isTauri, loadImage, readFileAsBlobUrl, saveFile, type SaveFileResult } from './tauri';
import {
  MM_TO_PX,
  getSlotRect,
  type SlotRect,
  type PhotoRenderParams,
  getTextureBaseColor,
  SPINE_LOGO_TOP_MM,
  resolveSpineLogoColor,
  tintMonochromeImage,
} from './sharedRender';
import { createTextureCanvas, MIN_STROKE_WIDTH } from '../components/editor/canvas/constants';
import {
  resolveTemplate,
  isCoverPage,
  isBackCoverPage,
} from '../types';
import {
  shouldShowWatermark,
  getWatermarkText,
  calcWatermarkFontSize,
  calcWatermarkPosition,
  calcPageSafeArea,
  getWatermarkSettings,
  WATERMARK_FONT_STACK,
} from './watermarkRenderer';
import type { AlbumPage, Photo, PhotoPlacement, StickerElement, StickyNote, PageTextElement, BrushStroke, ShapeElement } from '../types';
import { buildPhotoPlacementPlan, buildShapePaintSpec, buildTextLayout } from './thumbnailCore';
import { getShapePolygonPoints, getRectCornerRadii } from './shapeGeometry';
import { pageExportWidthMm, calcExportCanvasSize, calcExportMaxDim } from './exportGeometry';
// re-export：保持 printEngine 等外部调用方从 exportEngine 引用 calcExportMaxDim 兼容
export { calcExportMaxDim };
import { preloadStickerSrc } from '../hooks/useStickerSrc';
import { ensurePhotoAnalyzed } from '../engine/content-aware';
import { logger } from './logger';
import logoLight from '../assets/logo-light.png';
// 静态导入 jsPDF：避免动态 import 在 Vite dev 环境下偶发 "Failed to fetch dynamically imported module" 错误
import jsPDF from 'jspdf';

/* ══════════════════════════ 类型 ══════════════════════════ */

/** 书脊 MemBook logo 水印基础位图（单色黑线版），模块级缓存避免重复加载 */
let spineBaseLogoPromise: Promise<HTMLImageElement> | null = null;
function loadSpineBaseLogo(): Promise<HTMLImageElement> {
  if (!spineBaseLogoPromise) spineBaseLogoPromise = loadImage(logoLight);
  return spineBaseLogoPromise;
}

export type ExportFormat = 'pdf' | 'png' | 'jpg';

export interface ExportOptions {
  format: ExportFormat;
  quality: number;
  dpi: number;
  pageRange: { start: number; end: number };
  projectName: string;
  outputPath?: string;
  /** 内容页起始页码（默认 1，手动填）：跨相册连续编号续接用。
   *  仅普通内容页参与累加，封面/封底固定命名为「封面/封底」不占用页码。 */
  pageNumberStart?: number;
  onProgress?: (current: number, total: number) => void;
  /** 印刷级出血（mm，默认 0）：导出 PDF 时四周扩展出血边，供印刷裁切 */
  bleed?: number;
  /** 书脊宽度（mm，默认 0）：封面向右偏移半个书脊、封底向左偏移，模拟装订翻阅观感 */
  spineWidth?: number;
}

interface ExportWarning {
  pageIndex: number;
  pageLabel: string;
  message: string;
}

/* ══════════════════════════ 导出任务（实例化状态） ══════════════════════════ */

/**
 * 单次导出任务的状态载体：取消标志与警告列表随任务实例销毁，
 * 避免模块级可变单例在热更新或连续多次导出时状态残留。
 */
export class ExportTask {
  private cancelled = false;
  private warnings: ExportWarning[] = [];

  cancel(): void { this.cancelled = true; }
  get isCancelled(): boolean { return this.cancelled; }
  addWarning(w: ExportWarning): void { this.warnings.push(w); }
  getWarnings(): ExportWarning[] { return this.warnings; }
}

/** 当前进行中的导出任务（供对话框取消按钮等 UI 使用） */
let currentTask: ExportTask | null = null;

function beginTask(): ExportTask {
  const task = new ExportTask();
  currentTask = task;
  return task;
}

export function getLastExportWarnings(): ExportWarning[] {
  return currentTask?.getWarnings() ?? [];
}

export function cancelExport(): void { currentTask?.cancel(); }
export function isExportCancelled(): boolean { return currentTask?.isCancelled ?? false; }

/**
 * P1-fix: 导出前预热内容感知缓存。
 * 之前导出时不预热，getCachedContentInfo 全部 miss → 所有照片导出时居中。
 * 现在批量 await ensurePhotoAnalyzed，确保导出时（drawPage → calcPhotoRenderParams）
 * 能读到主体感知焦点。
 *
 * 并发限制 6 路，避免大量照片同时解码导致内存暴涨。
 */
const PREHEAT_CONCURRENCY = 6;
async function preheatContentAnalysis(photos: Photo[]): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(PREHEAT_CONCURRENCY, photos.length) },
    async () => {
      while (nextIndex < photos.length) {
        const photo = photos[nextIndex++];
        try {
          await ensurePhotoAnalyzed(photo);
        } catch {
          /* ignore，失败时导出走居中回退 */
        }
      }
    },
  );
  await Promise.all(workers);
  logger.info(`[Export] 内容感知缓存预热完成，共 ${photos.length} 张照片`);
}

/* ══════════════════════════ 工具 ══════════════════════════ */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * P0-fix CSP: data: URL → Blob 转换（用 atob 解码，不触发 CSP connect-src 限制）。
 *   fetch(dataURL) 会被 CSP connect-src 拦截（不允许 data: 协议），
 *   atob 解码在 JS 内存中完成，不发起网络请求，绕过 CSP。
 */
function dataURLtoBlob(dataURL: string): Blob {
  try {
    const [header, b64] = dataURL.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch { return new Blob([], { type: 'image/png' }); }
}

function getPageSizeMM() {
  const s = useEditorStore.getState().albumSize;
  return { w: s?.width || 210, h: s?.height || 280 };
}

/**
 * 判断 URL 是否可以直接用于 Canvas 而不污染画布。
 * blob: 和 data: 与当前页面同源，因此安全。
 */
function isCanvasSafeUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/**
 * 将任意图片源转换为可用于 Canvas 的安全 blob URL。
 * - blob:/data: 直接返回
 * - asset:/file:/http:/https: 或本地绝对路径 → 读取为 blob URL
 * - 纯文件名/相对路径 → 尝试用 photo.relativePath 读取
 * - 失败时返回 null
 */
async function ensureCanvasSafeUrl(src: string, photo?: Photo): Promise<string | null> {
  if (isCanvasSafeUrl(src)) return src;

  // Tauri 桌面端：本地绝对路径或 asset:// 文件，用 fs 读取为 blob
  if (isTauri()) {
    // asset://xxx 转换为实际路径
    let filePath = src;
    if (src.startsWith('asset://')) {
      try {
        // asset URL 反向解析：去掉协议头取 pathname 作为本地路径
        // Tauri v2 asset URL 形如 asset://localhost/C:/Users/.../a.jpg
        const urlObj = new URL(src);
        let pathname = decodeURIComponent(urlObj.pathname);
        // Windows 路径可能带前导 /，如 /C:/Users/...，去掉前导斜杠
        if (pathname.length > 2 && pathname[0] === '/' && pathname[2] === ':') {
          pathname = pathname.slice(1);
        }
        filePath = pathname;
      } catch {
        // 部分旧数据 asset URL 格式异常，回退到 photo.relativePath
        filePath = photo?.relativePath || '';
      }
    } else if (!src.includes('://') && photo?.relativePath) {
      // src 可能是纯文件名或相对路径，优先用 relativePath 中的绝对路径兜底
      filePath = photo.relativePath;
    }

    // 如果解析出的是相对路径，而 photo.relativePath 是绝对路径，则优先使用后者
    if (filePath && !/^[a-zA-Z]:[\\/]|^\//.test(filePath) && photo?.relativePath && /^[a-zA-Z]:[\\/]|^\//.test(photo.relativePath)) {
      filePath = photo.relativePath;
    }

    if (/^[a-zA-Z]:[\\/]|^\//.test(filePath)) {
      const blobUrl = await readFileAsBlobUrl(filePath);
      if (blobUrl) return blobUrl;
    }
  }

  // 浏览器端 http/https：尝试 fetch 并转为 blob URL
  if (src.startsWith('http://') || src.startsWith('https://')) {
    try {
      const resp = await fetch(src, { mode: 'cors' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (blob.size === 0) return null;
      return URL.createObjectURL(blob);
    } catch {
      logger.warn(`[Export] 无法获取远程图片: ${src.slice(0, 80)}`);
      return null;
    }
  }

  // file: 协议：浏览器中无法直接读取，跳过
  logger.warn(`[Export] 不支持的图片 URL scheme: ${src.slice(0, 80)}`);
  return null;
}

// loadImage / readFileAsBlobUrl / saveFile 已提取到 utils/tauri.ts

/* ══════════════════════════ 照片预加载 ══════════════════════════ */

async function resolvePhotoSrc(photo: Photo): Promise<string | null> {
  // 导出优先使用高清原图；旧数据没有 originalBlobId 时回退到 blobId/previewBlobId/src
  if (photo.storageMode === 'import') {
    const originalId = photo.originalBlobId || photo.blobId;
    if (originalId) {
      const url = await readPhotoFromDB(originalId);
      if (url) {
        logger.debug(`[Export] resolvePhotoSrc import 使用原图 blob: ${photo.name}`);
        return url;
      }
    }
    // 没有原图时尝试预览图（Tauri onlyPreview 模式常见）
    const previewId = photo.previewBlobId;
    if (previewId) {
      const url = await readPhotoFromDB(previewId);
      if (url) {
        logger.debug(`[Export] resolvePhotoSrc import 使用预览图 blob: ${photo.name}`);
        return url;
      }
    }
    // Tauri 桌面端：import 模式未存原图时，尝试用 fs 读取为 blob URL（避免跨域污染 canvas）
    if (isTauri() && photo.relativePath) {
      const blobUrl = await readFileAsBlobUrl(photo.relativePath);
      if (blobUrl) {
        logger.debug(`[Export] resolvePhotoSrc import 使用本地文件 blob: ${photo.name}`);
        return blobUrl;
      }
      logger.warn(`[Export] import 模式 fs 读取失败，尝试回退 src: ${photo.name}, path=${photo.relativePath}`);
    }
    // 兜底：回退到已缓存的 src blob URL 或 asset URL（后续 ensureCanvasSafeUrl 会再次处理）
    if (photo.src?.startsWith('blob:')) {
      logger.debug(`[Export] resolvePhotoSrc import 回退 photo.src blob: ${photo.name}`);
      return photo.src;
    }
    if (photo.src) {
      logger.debug(`[Export] resolvePhotoSrc import 回退 photo.src: ${photo.name}`);
      return photo.src;
    }
    return null;
  }
  if (photo.storageMode === 'direct') {
    // Tauri 直接访问模式：优先用 fs 读取为 blob URL（避免 asset 协议跨域污染 canvas）
    if (isTauri() && photo.relativePath) {
      const blobUrl = await readFileAsBlobUrl(photo.relativePath);
      if (blobUrl) {
        logger.debug(`[Export] resolvePhotoSrc direct 使用本地文件 blob: ${photo.name}`);
        return blobUrl;
      }
      logger.warn(`[Export] direct 模式 fs 读取失败，尝试回退 src: ${photo.name}, path=${photo.relativePath}`);
    }
    // 优先回退 photo.src：可能是 blob URL、asset URL 或文件名
    if (photo.src) {
      logger.debug(`[Export] resolvePhotoSrc direct 回退 photo.src: ${photo.name}`);
      return photo.src;
    }
    // 浏览器 File System Access 模式：makeDirectPhotoUrl 返回 blob URL
    const directUrl = await makeDirectPhotoUrl(photo);
    if (directUrl) {
      logger.debug(`[Export] resolvePhotoSrc direct 使用 direct URL: ${photo.name}`);
      return directUrl;
    }
    return null;
  }
  // storageMode 为空/未知时的兜底
  if (photo.src?.startsWith('blob:')) return photo.src;
  return photo.src || null;
}

/** 导出可用的图片源：原始 Image 或降采样后的 Canvas（drawImage 均接受） */
type ExportImage = HTMLImageElement | HTMLCanvasElement;

/** 照片加载并发限制，避免大量照片同时解码导致内存暴涨 */
const EXPORT_PRELOAD_CONCURRENCY = 6;
/** 滑动窗口半径：仅缓存当前页 ±N 页范围内的照片位图 */
const SLIDING_WINDOW_RADIUS = 2;
/** 降采样阈值 = 页面最长边像素 × 该倍数（仅在远超需求时触发，保证导出质量），实现见 exportGeometry.calcExportMaxDim */

/** 收集指定页码区间（含两端）内使用到的照片 ID */
function collectPagePhotoIds(pages: AlbumPage[], fromIdx: number, toIdx: number): Set<string> {
  const ids = new Set<string>();
  const from = Math.max(0, fromIdx);
  const to = Math.min(pages.length - 1, toIdx);
  for (let i = from; i <= to; i++) {
    for (const pl of pages[i]?.placements ?? []) {
      if (pl.photoId) ids.add(pl.photoId);
    }
  }
  return ids;
}

/** 超大图等比降采样到 maxDim 以内（返回 Canvas），未超限则原样返回 */
function downscaleIfNeeded(img: HTMLImageElement, maxDim: number): ExportImage {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const longest = Math.max(w, h);
  if (longest <= maxDim || longest === 0) return img;
  const scale = maxDim / longest;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 加载单张照片（含 URL 重建重试与 Canvas 安全转换） */
async function loadOnePhoto(photo: Photo, maxDim: number): Promise<ExportImage | null> {
  try {
    let src = await resolvePhotoSrc(photo);
    if (!src) {
      logger.warn(`[Export] 无法解析照片源: ${photo.name} (id=${photo.id}, mode=${photo.storageMode})`);
      return null;
    }

    // 关键：导出用 Canvas 必须避免跨域污染，强制转换为同源 blob URL
    const safeSrc = await ensureCanvasSafeUrl(src, photo);
    if (!safeSrc) {
      logger.warn(`[Export] 照片 URL 无法转为 Canvas 安全 URL: ${photo.name}, src=${src.slice(0, 80)}`);
      return null;
    }
    src = safeSrc;

    let img: HTMLImageElement | undefined;
    let attempts = 0;
    while (attempts < 2) {
      try {
        // blob URL 同源，无需 crossOrigin；loadImage 的 auto 模式已自动处理
        img = await loadImage(src);
        break;
      } catch (err) {
        attempts++;
        logger.warn(`[Export] 照片加载尝试 ${attempts} 失败: ${photo.name}, src=${src.slice(0, 80)}`, err);
        if (attempts >= 2) break;
        // 若之前使用的是 IndexedDB blob URL，先清除缓存再重建，避免 stale URL 重复失败
        if (photo.storageMode === 'import') {
          if (photo.originalBlobId) invalidateBlobUrlCache(photo.originalBlobId);
          if (photo.previewBlobId) invalidateBlobUrlCache(photo.previewBlobId);
        }
        // 尝试重新解析 URL（例如缓存的 blob URL 已失效）
        const rebuilt = await resolvePhotoSrc(photo);
        if (!rebuilt) {
          logger.warn(`[Export] 照片 URL 重建失败，停止重试: ${photo.name}`);
          break;
        }
        const rebuiltSafe = await ensureCanvasSafeUrl(rebuilt, photo);
        if (!rebuiltSafe || rebuiltSafe === src) {
          logger.warn(`[Export] 照片 URL 重建无变化，停止重试: ${photo.name}`);
          break;
        }
        src = rebuiltSafe;
      }
    }
    if (!img) {
      logger.warn(`[Export] 照片最终加载失败: ${photo.name}`);
      return null;
    }
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      logger.warn(`[Export] 照片尺寸异常: ${photo.name} (${img.naturalWidth}×${img.naturalHeight})`);
      return null;
    }
    if (img.decode) {
      try { await img.decode(); } catch { /* decode optional */ }
    }
    return downscaleIfNeeded(img, maxDim);
  } catch (err) {
    logger.warn(`[Export] loadOnePhoto 异常: ${photo.name}`, err);
    return null;
  }
}

/**
 * 滑动窗口照片缓存：逐页加载、淘汰窗口外位图。
 * 位图是导出内存大头（12MP ≈ 48MB/张），淘汰引用后由 GC 回收；
 * blob URL 字符串不占多少内存，且 readPhotoFromDB 的 URL 被全局缓存，不可撤销。
 */
export class SlidingPhotoCache {
  private cache = new Map<string, ExportImage>();
  private readonly maxDim: number;

  constructor(maxDim: number) {
    this.maxDim = maxDim;
  }

  /**
   * 准备指定页的照片：淘汰滑动窗口外缓存，并发加载缺失项。
   * @returns 当前缓存映射（含窗口内所有已加载照片）
   */
  async preparePage(
    pages: AlbumPage[],
    pageIndex: number,
    photoDataMap: Map<string, Photo>,
  ): Promise<Map<string, ExportImage>> {
    const keepIds = collectPagePhotoIds(
      pages,
      pageIndex - SLIDING_WINDOW_RADIUS,
      pageIndex + SLIDING_WINDOW_RADIUS,
    );
    for (const id of [...this.cache.keys()]) {
      if (!keepIds.has(id)) this.cache.delete(id);
    }

    const needIds = collectPagePhotoIds(pages, pageIndex, pageIndex);
    const queue = [...needIds]
      .filter((id) => !this.cache.has(id))
      .map((id) => photoDataMap.get(id))
      .filter((p): p is Photo => !!p);

    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(EXPORT_PRELOAD_CONCURRENCY, queue.length) },
      async () => {
        while (nextIndex < queue.length) {
          const photo = queue[nextIndex++];
          const img = await loadOnePhoto(photo, this.maxDim);
          if (img) this.cache.set(photo.id, img);
        }
      },
    );
    await Promise.all(workers);
    return this.cache;
  }

  clear(): void {
    this.cache.clear();
  }
}

/* ══════════════════════════ Canvas 2D 页面渲染 ══════════════════════════ */

/** 绘制导出用的模板风格空槽位背景（与 gridThumbnailRenderer 保持一致） */
function drawExportTemplateSlot(
  ctx: CanvasRenderingContext2D,
  slot: SlotRect,
  index: number,
  cornerRadius: number | [number, number, number, number],
): void {
  ctx.save();
  const [startColor, endColor] = SLOT_CANVAS_PALETTE[index % SLOT_CANVAS_PALETTE.length];
  const gradient = ctx.createLinearGradient(slot.x, slot.y, slot.x + slot.width, slot.y + slot.height);
  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = SLOT_BORDER_COLORS[index % SLOT_BORDER_COLORS.length];
  ctx.lineWidth = 1;
  if (hasRadius(cornerRadius)) {
    roundRect(ctx, slot.x, slot.y, slot.width, slot.height, cornerRadius);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
  }
  ctx.restore();
}

/** 判断十六进制颜色是否为深色背景（亮度感知加权） */
function isDarkColor(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

/** 解析 CSS linear-gradient 中的颜色为 [offset, color, ...] 色标（与画布 PageBackgroundRect 一致） */
function parseCssGradientColors(css: string): (string | number)[] {
  const match = css.match(/linear-gradient\(([^)]+)\)/);
  if (!match) return [];
  const inner = match[1];
  const colors: string[] = [];
  const colorRegex = /#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)/g;
  let m: RegExpExecArray | null;
  while ((m = colorRegex.exec(inner)) !== null) {
    colors.push(m[0]);
  }
  if (colors.length < 2) return [];
  const stops: (string | number)[] = [];
  colors.forEach((c, i) => {
    stops.push(i / (colors.length - 1));
    stops.push(c);
  });
  return stops;
}

/**
 * 绘制页面背景，与画布端 PageBackgroundRect 保持一致：
 * 支持纯色 / CSS linear-gradient / texture- 前缀纹理（取基础色）。
 */
function drawPageBackground(
  ctx: CanvasRenderingContext2D,
  bg: string | undefined,
  w: number,
  h: number,
): void {
  const value = bg || '#FFFFFF';
  // 纯色（以 # 开头的短字符串）
  if (value.startsWith('#') || (value.length <= 7 && !value.includes('(') && !value.startsWith('texture'))) {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // CSS linear-gradient → Canvas 2D 线性渐变（左上→右下，与画布一致）
  if (value.startsWith('linear-gradient')) {
    const colorStops = parseCssGradientColors(value);
    if (colorStops.length >= 2) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      for (let i = 0; i < colorStops.length; i += 2) {
        grad.addColorStop(colorStops[i] as number, colorStops[i + 1] as string);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }
  }
  // 纹理：底色 + Canvas 图案填充（与画布 PageBackgroundRect 一致）
  if (value.startsWith('texture-')) {
    ctx.fillStyle = getTextureBaseColor(value);
    ctx.fillRect(0, 0, w, h);
    const textureCanvas = createTextureCanvas(value);
    if (textureCanvas) {
      const pattern = ctx.createPattern(textureCanvas, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
    return;
  }
  // 回退纯白
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
}

/** 在页面背景之上叠加背景图片（cover=铺满裁剪 / contain=完整居中，与画布 PageBackgroundRect 一致） */
async function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  page: AlbumPage,
  w: number,
  h: number,
): Promise<void> {
  if (!page.backgroundImage) return;
  try {
    const img = await loadImage(page.backgroundImage);
    if (!img || !img.width || !img.height) return;
    const fit = page.backgroundImageFit ?? 'cover';
    if (fit === 'contain') {
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale;
      const sh = h / scale;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    }
  } catch {
    // 背景图片加载失败时忽略，仅保留底色
  }
}

/**
 * 用 Canvas 2D API 绘制单个页面。
 * 与编辑器 Canvas.tsx 的 globalLayerElements 渲染顺序保持一致：
 *   背景 → 模板空槽位 → [合并排序: 槽位(z,typeOrder=0) + 笔触/文字/便利贴/贴纸(typeOrder=1)] → 水印
 * 贴纸需要异步加载图片，因此本函数为 async。
 *
 * @param photoDataMap 预建的照片数据 Map（photoId → Photo），避免循环内 O(n) 查找
 */
async function drawPage(
  ctx: CanvasRenderingContext2D,
  page: AlbumPage,
  canvasW: number,
  canvasH: number,
  photoImages: Map<string, CanvasImageSource>,
  photoDataMap: Map<string, Photo>,
): Promise<void> {
  const albumW = useEditorStore.getState().albumSize?.width || 210;
  const _isCoverLike = isCoverPage(page);
  // 导出封面为印刷一体设计：书脊背面 + 封面正面连续，无编辑器视觉间隙（SPINE_GAP_MM）
  // 故画布宽度 = 页面宽 + 书脊（不含间隙），mmToPx 基准与之匹配
  const _spineMm = _isCoverLike ? (page.spineWidth ?? 0) : 0;
  // 书脊偏移锚点（mm）= 内容烘焙的书脊偏移量。书脊宽度变化时封面区内容数据不移动，
  // renderPage 整体平移 (书脊宽-锚点)；书脊自动文字（spine-text-*）数据已按新书脊宽居中，
  // 需在此逆补偿 delta，抵消整体平移使其与画布一致居中于书脊（与 logo 补偿同理）。
  const _spineAnchorMm = _isCoverLike ? (page.spineAnchorMm ?? page.spineWidth ?? 0) : 0;
  const _spineDeltaMm = _spineMm - _spineAnchorMm;
  const mmToPx = canvasW / (albumW + _spineMm);
  // 导出引擎在主线程运行，可直接读取 store 的 pageMargin 传给 getSlotRect
  const exportMargin = useEditorStore.getState().pageMargin;

  // ── 1. 页面背景（纯色 / CSS 渐变 / 纹理，与画布 PageBackgroundRect 一致）──
  drawPageBackground(ctx, page.background, canvasW, canvasH);
  // ── 1.1 背景图片叠加（可选，用户上传）──
  await drawBackgroundImage(ctx, page, canvasW, canvasH);

  // ── 1.5 模板风格空槽位背景（与网格缩略图/模板面板风格一致） ──
  const cornerScale = canvasW / ((albumW + _spineMm) * MM_TO_PX);
  const rawCorner = page.slotCornerRadius ?? 5;
  const slotCornerRadius: number | [number, number, number, number] = typeof rawCorner === 'number'
    ? rawCorner * cornerScale
    : [rawCorner[0] * cornerScale, rawCorner[1] * cornerScale, rawCorner[2] * cornerScale, rawCorner[3] * cornerScale];
  const template = resolveTemplate(page);
  const allSlots = template?.slots ?? [];
  const filledSlotIds = new Set(page.placements.filter(pl => pl.photoId).map(pl => pl.slotId));

  // 先绘制所有空槽位的模板渐变背景
  allSlots.forEach((slotDef, i) => {
    if (filledSlotIds.has(slotDef.id)) return; // 有照片的槽位跳过，由照片覆盖
    const slotRect = getSlotRect(slotDef.id, page, canvasW, canvasH, exportMargin);
    if (!slotRect) return;
    drawExportTemplateSlot(ctx, slotRect, i, slotCornerRadius);
  });

  // ── 2. 预检：对缺失位图的照片打警告（诊断用）。排序/坐标/层级统一由
  //    共享 buildPhotoPlacementPlan 计算（与画布/缩略图/预览同源，四端一致）
  for (const pl of page.placements) {
    if (pl.photoId && !photoImages.has(pl.photoId)) {
      const photo = photoDataMap.get(pl.photoId);
      logger.warn(
        `[Export] drawPage 跳过缺失位图的照片: page=${page.id ?? '?'}, slot=${pl.slotId}, photoId=${pl.photoId}, name=${photo?.name ?? 'unknown'}`
      );
    }
  }

  // ── 3. 预加载本页所有贴纸图片（异步并行） ──
  const stickerImageCache = new Map<string, HTMLImageElement | null>();
  const stickerList = page.stickerElements || [];
  if (stickerList.length > 0) {
    const blobIds = Array.from(new Set(
      stickerList.map(s => s.stickerId).filter(id => !!id).map(id => `sticker-blob-${id}`)
    ));
    const loadedImages = await Promise.all(
      blobIds.map(async (blobId) => {
        try {
          const dataURL = await preloadStickerSrc(blobId);
          if (!dataURL) return { blobId, img: null };
          const img = await loadImage(dataURL);
          return { blobId, img };
        } catch (err) {
          logger.warn(`[Export] 贴纸加载失败: ${blobId}`, err);
          return { blobId, img: null };
        }
      })
    );
    for (const { blobId, img } of loadedImages) {
      stickerImageCache.set(blobId, img);
    }
  }

  // ── 4. 统一图层排序（与 Canvas.tsx globalLayerElements 一致） ──
  // typeOrder: z 相同时决定渲染先后，小的渲染在下方（槽位=0，装饰元素=1）
  type RenderItem = { z: number; typeOrder: number; draw: () => void };
  const items: RenderItem[] = [];

  // 4.1 槽位（typeOrder=0）—— 照片布局判定走共享 buildPhotoPlacementPlan（与缩略图/预览同源）
  for (const planItem of buildPhotoPlacementPlan(page, Array.from(photoDataMap.values()), canvasW, canvasH, exportMargin)) {
    const img = photoImages.get(planItem.photoId);
    const params = planItem.params;
    if (!img || !params) continue;
    items.push({
      z: planItem.z,
      typeOrder: 0,
      draw: () => drawPlacement(ctx, planItem.placement, img, planItem.slot, params, slotCornerRadius),
    });
  }

  // 4.2 笔触（typeOrder=1）
  (page.brushStrokes || []).forEach((stroke: BrushStroke) => {
    items.push({
      z: stroke.zIndex || 0,
      typeOrder: 1,
      draw: () => drawBrushStroke(ctx, stroke, mmToPx),
    });
  });

  // 4.3 文字元素（typeOrder=1）
  (page.textElements || []).forEach((te: PageTextElement) => {
    // 书脊文字（spine-text-*）：renderPage 已整体平移 (书脊宽-锚点)，此处逆补偿 delta，
    // 使书脊文字在导出的最终坐标系中与画布一致居中于书脊（数据坐标已按新书脊宽居中）。
    const teForDraw: PageTextElement = te.id.startsWith('spine-text-') && _spineDeltaMm
      ? { ...te, x: te.x - _spineDeltaMm }
      : te;
    items.push({
      z: te.zIndex || 0,
      typeOrder: 1,
      draw: () => drawTextElement(ctx, teForDraw, mmToPx),
    });
  });

  // 4.4 便利贴（typeOrder=1）
  (page.stickyNotes || []).forEach((sn: StickyNote) => {
    items.push({
      z: sn.zIndex || 0,
      typeOrder: 1,
      draw: () => drawStickyNote(ctx, sn, mmToPx),
    });
  });

  // 4.5 贴纸（typeOrder=1）
  (page.stickerElements || []).forEach((st: StickerElement) => {
    items.push({
      z: st.zIndex || 0,
      typeOrder: 1,
      draw: () => drawSticker(ctx, st, mmToPx, stickerImageCache),
    });
  });

  // 4.5b 形状（typeOrder=1）
  (page.shapeElements || []).forEach((sh: ShapeElement) => {
    items.push({
      z: sh.zIndex || 0,
      typeOrder: 1,
      draw: () => drawShape(ctx, sh, mmToPx),
    });
  });

  // 排序：先按 z 升序（z 小的渲染在下层），z 相同时 typeOrder 小的（槽位）排前（渲染在装饰下方）
  items.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.typeOrder - b.typeOrder;
  });

  // 页面边界裁剪：装饰元素（贴纸/便利贴/文字/笔触）超出页面边界的部分不显示，
  // 与编辑器 Stage clip + 网格缩略图 drawPageToCanvas 的 clip 行为保持一致。
  // 照片槽位本身已有圆角裁剪（drawPlacement 内 clip），此处再次裁剪无副作用，
  // 但 shadowBlur/shadowOffset 会被裁掉（与编辑器一致：阴影超出页面也不显示）。
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.clip();
  for (const item of items) {
    item.draw();
  }

  ctx.restore();

  // ── 5. 时间水印（绘制在最上层） ──
  try {
    const photos = usePhotoStore.getState().photos;
    const settings = getWatermarkSettings();
    const allPages = useEditorStore.getState().pages;
    const pageIndex = allPages.indexOf(page);
    if (pageIndex >= 0 && shouldShowWatermark(pageIndex, allPages, photos, settings)) {
      const text = getWatermarkText(pageIndex, allPages, photos, settings);
      if (text) {
        const fontSize = calcWatermarkFontSize();
        const pm = useEditorStore.getState().pageMargin;
        const pageMM = getPageSizeMM();
        const safe = calcPageSafeArea(page, pageMM.w, pageMM.h, canvasW, canvasH, pm);
        const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
        const bgForCheck = (() => {
          const bg = page.background || '#FFFFFF';
          if (bg.startsWith('texture-')) return getTextureBaseColor(bg);
          if (bg.startsWith('#')) return bg;
          if (bg.startsWith('linear-gradient')) {
            const stops = parseCssGradientColors(bg);
            if (stops.length >= 2) return stops[1] as string;
          }
          return '#FFFFFF';
        })();
        const isDark = isDarkColor(bgForCheck);
        const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)';
        ctx.save();
        ctx.font = `italic ${fontSize}px ${WATERMARK_FONT_STACK}`;
        if (ctx.measureText(text).width === 0) {
          ctx.font = `italic ${fontSize}px sans-serif`;
        }
        ctx.fillStyle = textColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text, pos.x, pos.y);
        ctx.restore();
      }
    }
  } catch { /* 水印渲染失败不影响导出 */ }
}

/* ══════════════════════════ 各元素类型独立绘制函数 ══════════════════════════ */

/** 绘制照片槽位（含圆角裁剪、滤镜、翻转、旋转、晕影） */
function drawPlacement(
  ctx: CanvasRenderingContext2D,
  placement: PhotoPlacement,
  img: CanvasImageSource,
  slot: SlotRect,
  params: PhotoRenderParams,
  slotCornerRadius: number | [number, number, number, number],
): void {
  // 用户可配置阴影：仅 placement.shadow=true 时绘制，在 clip 之前
  if (placement.shadow) {
    ctx.save();
    const shadowBlur = Math.max(4, Math.min(slot.width, slot.height) * 0.04);
    const shadowOffsetY = Math.max(2, Math.min(slot.width, slot.height) * 0.02);
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shadowOffsetY;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (hasRadius(slotCornerRadius)) {
      roundRect(ctx, slot.x, slot.y, slot.width, slot.height, slotCornerRadius);
    } else {
      ctx.rect(slot.x, slot.y, slot.width, slot.height);
    }
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  if (hasRadius(slotCornerRadius)) {
    roundRect(ctx, slot.x, slot.y, slot.width, slot.height, slotCornerRadius);
  } else {
    ctx.rect(slot.x, slot.y, slot.width, slot.height);
  }
  ctx.clip();

  // ── 滤镜（CSS filter 字符串） ──
  const adj = placement.adjustments;
  const filterName = placement.filter;
  const filterIntensity = placement.filterIntensity ?? 100;
  const cssFilters: string[] = [];
  if (adj) {
    const totalBrig = (adj.exposure || 0) + (adj.brightness || 0);
    if (Math.abs(totalBrig) > 0.5) {
      cssFilters.push(`brightness(${(1 + totalBrig / 100).toFixed(3)})`);
    }
    if (Math.abs(adj.contrast) > 0.5) {
      cssFilters.push(`contrast(${(1 + adj.contrast / 100).toFixed(3)})`);
    }
    if (Math.abs(adj.saturation) > 0.5) {
      cssFilters.push(`saturate(${(1 + adj.saturation / 100).toFixed(3)})`);
    }
    if (Math.abs(adj.temperature) > 0.5) {
      const hueDeg = adj.temperature * 0.3;
      cssFilters.push(`hue-rotate(${hueDeg.toFixed(1)}deg)`);
    }
  }
  const FILTER_CSS_MAP: Record<string, string> = {
    '暖阳': 'sepia(0.3) saturate(1.2) brightness(1.05)',
    '清新': 'saturate(1.1) brightness(1.08) contrast(0.95)',
    '复古': 'sepia(0.4) saturate(1.1) brightness(0.95)',
    '黑白': 'grayscale(1) brightness(1.05)',
    '胶片': 'sepia(0.2) contrast(1.1) brightness(0.9)',
    '日系': 'saturate(0.85) brightness(1.12) hue-rotate(-10deg)',
    '电影': 'contrast(1.2) brightness(0.85) saturate(1.3)',
  };
  if (filterName && FILTER_CSS_MAP[filterName]) {
    cssFilters.push(FILTER_CSS_MAP[filterName]);
  }
  if (cssFilters.length > 0) {
    ctx.filter = cssFilters.join(' ');
  }
  const useFilterOpacity = filterName && filterName !== '原图' && filterIntensity < 99;
  if (useFilterOpacity) {
    ctx.globalAlpha = filterIntensity / 100;
  }

  // ── 翻转 ──
  const flipH = placement.flipH ?? false;
  const flipV = placement.flipV ?? false;
  if (flipH || flipV) {
    const scx = flipH ? -1 : 1;
    const scy = flipV ? -1 : 1;
    const cx = slot.x + slot.width / 2;
    const cy = slot.y + slot.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(scx, scy);
    ctx.translate(-cx, -cy);
  }

  // 绘制照片（应用旋转）
  if (Math.abs(params.rotation) > 0.01) {
    const cx = slot.x + params.drawX;
    const cy = slot.y + params.drawY;
    ctx.translate(cx, cy);
    ctx.rotate((params.rotation * Math.PI) / 180);
    ctx.drawImage(img, -params.offsetX, -params.offsetY, params.drawW, params.drawH);
  } else {
    ctx.drawImage(img, slot.x + params.drawX, slot.y + params.drawY, params.drawW, params.drawH);
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── 晕影 ──
  const vignetteVal = adj?.vignette || 0;
  if (vignetteVal > 1) {
    const vigAlpha = (vignetteVal / 100) * 0.6;
    ctx.save();
    ctx.beginPath();
    if (hasRadius(slotCornerRadius)) {
      roundRect(ctx, slot.x, slot.y, slot.width, slot.height, slotCornerRadius);
    } else {
      ctx.rect(slot.x, slot.y, slot.width, slot.height);
    }
    ctx.clip();
    const cx = slot.x + slot.width / 2;
    const cy = slot.y + slot.height / 2;
    const r = Math.max(slot.width, slot.height) * 0.75;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${vigAlpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    ctx.restore();
  }
}

/** 绘制画笔笔迹 */
function drawBrushStroke(ctx: CanvasRenderingContext2D, stroke: BrushStroke, mmToPx: number): void {
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.strokeWidth * (mmToPx / MM_TO_PX);
  ctx.globalAlpha = stroke.opacity;
  ctx.lineCap = stroke.lineCap;
  ctx.lineJoin = 'round';
  // 荧光笔使用 multiply 混合模式（与编辑器 Canvas.tsx 一致）
  ctx.globalCompositeOperation = stroke.brushType === 'highlighter' ? 'multiply' : 'source-over';

  const pts = stroke.points;
  if (pts.length < 4) {
    ctx.globalAlpha = 1;
    return;
  }

  ctx.moveTo(pts[0] * mmToPx, pts[1] * mmToPx);
  for (let i = 2; i < pts.length; i += 2) {
    if (i + 2 < pts.length && stroke.tension > 0) {
      const xc = (pts[i] * mmToPx + pts[i + 2] * mmToPx) / 2;
      const yc = (pts[i + 1] * mmToPx + pts[i + 3] * mmToPx) / 2;
      ctx.quadraticCurveTo(pts[i] * mmToPx, pts[i + 1] * mmToPx, xc, yc);
    } else {
      ctx.lineTo(pts[i] * mmToPx, pts[i + 1] * mmToPx);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** 绘制文字元素（与编辑器 TextElementNode.tsx 一致：含竖排文字 + 任意角度旋转支持） */
function drawTextElement(ctx: CanvasRenderingContext2D, te: PageTextElement, mmToPx: number): void {
  const scale = mmToPx / MM_TO_PX;
  const tx = te.x * mmToPx;
  const ty = te.y * mmToPx;
  const tw = te.width * mmToPx;
  const th = (te.height ?? 0) * mmToPx;
  const fs = te.fontSize * scale;
  const rotation = te.rotation ?? 0;

  // 空文本处理（与 TextElementNode.tsx 一致：灰色斜体占位文字）
  const hasText = te.text && te.text.length > 0;
  let fontStyle = '';
  if (te.bold) fontStyle += 'bold ';
  if (te.italic || !hasText) fontStyle += 'italic ';
  ctx.font = `${fontStyle}${fs}px ${te.fontFamily || 'sans-serif'}`;
  ctx.textBaseline = 'top';
  // 渐变填充（与画布 TextElementNode 一致：线性=左上→右下，径向=中心向外）
  let fillValue: string | CanvasGradient = hasText ? te.color : '#999';
  if (hasText && te.gradient && te.gradient.length >= 2) {
    if (te.gradientType === 'radial') {
      const cx = tx + tw / 2;
      const cy = ty + th / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(tw, th) / 2);
      for (const s of te.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      fillValue = grad;
    } else {
      const { startX, startY, endX, endY } = linearGradientEndpoints(tw, th, te.gradientAngle ?? 45);
      const cxx = tx + tw / 2;
      const cyy = ty + th / 2;
      const grad = ctx.createLinearGradient(cxx + startX, cyy + startY, cxx + endX, cyy + endY);
      for (const s of te.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      fillValue = grad;
    }
  }
  ctx.fillStyle = fillValue;

  // 排版指令（横排断行/对齐/垂直对齐 + 竖排逐字）统一由共享 buildTextLayout 计算
  // （与画布/缩略图/预览同源）。buildTextLayout 基于逻辑坐标（×MM_TO_PX）返回锚点，
  // 乘 scale 映射回导出像素（×mmToPx），行为与旧实现一致。
  ctx.save();
  // 任意角度（含 0°）：绕文字框中心旋转，绘于页面绝对坐标（与编辑器 TextElementNode.tsx 一致）
  if (rotation !== 0) {
    const centerX = tx + tw / 2;
    const centerY = ty + th / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
  // 先设 letterSpacing 以便 measureText 计入字距（与编辑器 / 缩略图一致）
  ctx.letterSpacing = `${(te.letterSpacing ?? 0) * scale}px`;
  for (const w of buildTextLayout(te, (s) => ctx.measureText(s).width)) {
    ctx.textAlign = w.textAlign;
    ctx.fillText(w.text, w.x * scale, w.y * scale);
  }
  ctx.letterSpacing = '0px';
  ctx.restore();
}

/** 绘制便利贴（按 style 字段渲染，与 StickyNoteNode.tsx 美化版一致） */
function drawStickyNote(ctx: CanvasRenderingContext2D, sn: StickyNote, mmToPx: number): void {
  const scale = mmToPx / MM_TO_PX;
  const sx = sn.x * mmToPx;
  const sy = sn.y * mmToPx;
  // 与 StickyNoteNode.tsx 一致的 Math.max 最小尺寸限制
  const sw = Math.max(sn.width * mmToPx, 40 * scale);
  const sh = Math.max(sn.height * mmToPx, 40 * scale);
  const fs = sn.fontSize * scale;
  const style = sn.style || 'rounded';

  // 与 StickyNoteNode.tsx 美化版一致的圆角/阴影参数
  const cornerRadius = (style === 'square' ? 3 : style === 'rounded' ? 10 : 8) * scale;
  const shadowBlur = (style === 'shadow' ? 18 : 8) * scale;
  const shadowOffsetY = (style === 'shadow' ? 10 : 4) * scale;
  const shadowOpacity = style === 'shadow' ? 0.32 : 0.18;
  const foldSize = Math.min(sw, sh) * 0.14;
  // 本地坐标系：中心 (0, 0)，左上角 (-sw/2, -sh/2)
  const left = -sw / 2;
  const top = -sh / 2;

  ctx.save();
  // 与 StickyNoteNode.tsx 一致：Group x=cx, y=cy, rotation=θ（中心定位，无 offset）
  // 旋转中心 = 便利贴中心，与编辑器完全一致
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.rotate((sn.rotation * Math.PI) / 180);

  // 背景矩形（纸张底色 + 柔和阴影）
  ctx.fillStyle = sn.color;
  ctx.shadowColor = `rgba(0,0,0,${shadowOpacity})`;
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowOffsetY;
  roundRect(ctx, left, top, sw, sh, cornerRadius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 边框（细微描边）
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 0.5 * scale;
  roundRect(ctx, left, top, sw, sh, cornerRadius);
  ctx.stroke();

  // 顶部高光层：半透明白色渐变（从上到下淡出，增强纸张质感）
  const topGrad = ctx.createLinearGradient(0, top, 0, top + sh * 0.35);
  topGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
  topGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topGrad;
  roundRect(ctx, left, top, sw, sh * 0.35, cornerRadius);
  ctx.fill();

  // 底部阴影渐变：透明到淡黑（增强深度）
  const bottomGrad = ctx.createLinearGradient(0, top + sh * 0.65, 0, top + sh);
  bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
  bottomGrad.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = bottomGrad;
  roundRect(ctx, left, top, sw, sh, cornerRadius);
  ctx.fill();

  // rounded 样式：右上角折角（模拟便签纸撕开效果）
  if (style === 'rounded') {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.moveTo(left + sw - foldSize, top);
    ctx.lineTo(left + sw, top);
    ctx.lineTo(left + sw, top + foldSize);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5 * scale;
    ctx.beginPath();
    ctx.moveTo(left + sw - foldSize, top);
    ctx.lineTo(left + sw, top + foldSize);
    ctx.stroke();
  }

  // shadow 样式：对角渐变（右上到左下，增强3D投影）
  if (style === 'shadow') {
    const diagGrad = ctx.createLinearGradient(left + sw, top, left, top + sh);
    diagGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
    diagGrad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = diagGrad;
    roundRect(ctx, left, top, sw, sh, cornerRadius);
    ctx.fill();
  }

  // tape 样式：米黄色胶带，对角倾斜（更真实）
  if (style === 'tape') {
    ctx.save();
    ctx.translate(0, top - 7 * scale); // 胶带中心在顶部边缘上方
    ctx.rotate((-4 * Math.PI) / 180);
    const tapeW = sw * 0.36;
    const tapeH = 16 * scale;
    ctx.fillStyle = 'rgba(255, 224, 160, 0.72)';
    ctx.strokeStyle = 'rgba(180, 140, 60, 0.18)';
    ctx.lineWidth = 0.5 * scale;
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetY = 1 * scale;
    roundRect(ctx, -tapeW / 2, 0, tapeW, tapeH, 1 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // 胶带边缘锯齿（细虚线模拟撕开边缘）
    ctx.strokeStyle = 'rgba(180, 140, 60, 0.2)';
    ctx.lineWidth = 0.5 * scale;
    ctx.setLineDash([1.5 * scale, 1.5 * scale]);
    ctx.beginPath();
    ctx.moveTo(-tapeW / 2, 0);
    ctx.lineTo(tapeW / 2, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 文字（内边距 8px，行高 1.4，与 StickyNoteNode.tsx 美化版一致）
  const pad = 8 * scale;
  const textWrapW = sw - pad * 2;
  const textH = sh - pad * 2;
  const hasText = sn.text && sn.text.length > 0;
  ctx.fillStyle = hasText ? '#2c2c2c' : '#999';
  ctx.font = `${hasText ? 'normal' : 'italic'} ${fs}px ${sn.fontFamily || 'sans-serif'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const displayText = hasText ? sn.text : '';
  const lines = wrapText(ctx, displayText, textWrapW);
  const lineHeight = fs * 1.4;
  let y = top + pad;
  for (const line of lines) {
    // 高度限制：超出便利贴底部的文字不绘制（与 Konva Text height + ellipsis 行为一致）
    if (y + fs > top + pad + textH) break;
    ctx.fillText(line, left + pad, y);
    y += lineHeight;
  }
  ctx.restore();
}

/** 绘制贴纸元素（与 StickerNode.tsx 一致的中心点定位、旋转、翻转） */
function drawSticker(
  ctx: CanvasRenderingContext2D,
  st: StickerElement,
  mmToPx: number,
  stickerImageCache: Map<string, HTMLImageElement | null>,
): void {
  const blobId = st.stickerId ? `sticker-blob-${st.stickerId}` : null;
  const img = blobId ? stickerImageCache.get(blobId) : null;
  if (!img) {
    logger.warn(`[Export] 贴纸图片缺失，跳过: stickerId=${st.stickerId}, page=${st.id}`);
    return;
  }

  const scale = mmToPx / MM_TO_PX;
  const px = st.x * mmToPx;
  const py = st.y * mmToPx;
  const pw = Math.max(st.width * mmToPx, 20 * scale);
  const ph = Math.max(st.height * mmToPx, 20 * scale);

  ctx.save();
  // 完整复刻 Konva Group transform: T(x,y) * R(θ)
  // Group: x=px, y=py, rotation=θ（无 offset，旋转中心 = Group 原点 = 图片中心）
  // Image: x=-pw/2, y=-ph/2（在 Group 自身坐标系中），中心在 Group(0,0) = 旋转枢轴
  // 旋转时图片中心保持不变，与编辑器 StickerNode.tsx 完全一致
  ctx.translate(px, py);
  ctx.rotate((st.rotation * Math.PI) / 180);

  // 翻转（与 StickerNode.tsx 的 scaleX/scaleY 一致，围绕 Image 中心 (0,0) 翻转）
  const scaleX = st.flipH ? -1 : 1;
  const scaleY = st.flipV ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // 阴影（与 StickerNode.tsx 默认值一致，固定像素值按 scale 缩放）
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4 * scale;
  ctx.shadowOffsetY = 2 * scale;
  ctx.shadowOffsetX = 0;

  // 绘制贴纸图片（在 Group 自身坐标系中从 (-pw/2, -ph/2) 开始，中心在 (0,0)）
  ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

/** 绘制圆角矩形路径（每角独立半径，兼容不支持原生 roundRect 的 WebView2）。radii 顺序：左上、右上、右下、左下 */
function roundRectPerCorner(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radii: [number, number, number, number],
): void {
  const [tl, tr, br, bl] = radii;
  const maxR = Math.min(w / 2, h / 2);
  const r = (v: number) => Math.max(0, Math.min(v, maxR));
  ctx.beginPath();
  // 左上
  ctx.moveTo(x + r(tl), y);
  ctx.lineTo(x + w - r(tr), y);
  ctx.arcTo(x + w, y, x + w, y + r(tr), r(tr)); // 右上
  ctx.lineTo(x + w, y + h - r(br));
  ctx.arcTo(x + w, y + h, x + w - r(br), y + h, r(br)); // 右下
  ctx.lineTo(x + r(bl), y + h);
  ctx.arcTo(x, y + h, x, y + h - r(bl), r(bl)); // 左下
  ctx.lineTo(x, y + r(tl));
  ctx.arcTo(x, y, x + r(tl), y, r(tl)); // 左上
  ctx.closePath();
}

/** 把共享 spec 的扁平 stop 数组 [offset,color,...] 写入 CanvasGradient */
function applyGradientStops(grad: CanvasGradient, stops: (string | number)[]): void {
  for (let i = 0; i + 1 < stops.length; i += 2) {
    grad.addColorStop(stops[i] as number, stops[i + 1] as string);
  }
}

/** 绘制形状元素（复刻 ShapeNode.tsx 的 Konva transform） */
function drawShape(ctx: CanvasRenderingContext2D, sh: ShapeElement, mmToPx: number): void {
  // 画刷（填充/描边/渐变解析）、尺寸/描边下限、透明度/旋转等确定性判定统一由
  // 共享 buildShapePaintSpec 给出（与画布/缩略图/预览同源），本函数仅做导出像素映射 + 路径构造。
  const spec = buildShapePaintSpec(sh);
  const scale = mmToPx / MM_TO_PX;
  // spec 值基于逻辑坐标（×MM_TO_PX）给出，乘 scale 映射回导出像素（×mmToPx），保证行为不变
  const px = spec.x * scale;
  const py = spec.y * scale;
  // 最小尺寸下限已由 spec 内部按 MIN_SHAPE_SIZE_MM 抬升，此处直接映射
  const pw = spec.pw * scale;
  const ph = spec.ph * scale;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((spec.rotation * Math.PI) / 180);
  ctx.globalAlpha = spec.opacity;

  ctx.lineWidth = spec.lineWidth * scale;

  const halfW = pw / 2;
  const halfH = ph / 2;

  // 填充画刷：纯色 / 线/径向渐变（stop 解析均来自 spec）
  if (spec.fill) {
    if (spec.fill.kind === 'solid') {
      ctx.fillStyle = spec.fill.color;
    } else if (spec.fill.kind === 'radial') {
      const grad = ctx.createRadialGradient(
        spec.fill.start.x * scale, spec.fill.start.y * scale, 0,
        spec.fill.end.x * scale, spec.fill.end.y * scale, spec.fill.radius * scale,
      );
      applyGradientStops(grad, spec.fill.stops);
      ctx.fillStyle = grad;
    } else {
      const grad = ctx.createLinearGradient(
        spec.fill.start.x * scale, spec.fill.start.y * scale,
        spec.fill.end.x * scale, spec.fill.end.y * scale,
      );
      applyGradientStops(grad, spec.fill.stops);
      ctx.fillStyle = grad;
    }
  }
  // 描边画刷：纯色 / 线性渐变
  if (spec.stroke) {
    if (spec.stroke.kind === 'solid') {
      ctx.strokeStyle = spec.stroke.color;
    } else {
      const grad = ctx.createLinearGradient(
        spec.stroke.start.x * scale, spec.stroke.start.y * scale,
        spec.stroke.end.x * scale, spec.stroke.end.y * scale,
      );
      applyGradientStops(grad, spec.stroke.stops);
      ctx.strokeStyle = grad;
    }
  }

  const beginShape = () => {
    if (spec.fill) ctx.fill();
    if (spec.stroke && spec.lineWidth > 0) ctx.stroke();
  };

  switch (sh.type) {
    case 'circle':
    case 'ellipse':
      // 圆形/椭圆都填满 pw×ph 盒子（与 ShapeGlyph 一致）
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
      beginShape();
      break;
    case 'triangle':
    case 'diamond':
    case 'pentagon':
    case 'hexagon':
    case 'star':
    case 'parallelogram':
    case 'trapezoid':
    case 'cutCornerRect':
    case 'cutDiagonalRect': {
      // 多边形/星形/切角矩形：用共享顶点填满 pw×ph（最外边缘贴合控制盒）
      ctx.beginPath();
      const pts = getShapePolygonPoints(sh.type, pw, ph, sh.cornerCut);
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      beginShape();
      break;
    }
    case 'rectangle':
    case 'roundedRect':
    case 'singleRoundRect':
    case 'diagonalRoundRect': {
      // 矩形类：每角圆角半径由共享 getRectCornerRadii 计算（支持 cornerRadius 调节）
      const radii = getRectCornerRadii(sh.type, pw, ph, sh.cornerRadius) as [number, number, number, number];
      roundRectPerCorner(ctx, -halfW, -halfH, pw, ph, radii);
      beginShape();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.rect(-halfW, -halfH, pw, ph);
      beginShape();
      break;
    }
    case 'arrow': {
      // 水平箭头
      const tip = halfW;
      const tail = -halfW;
      const headLen = Math.min(24 * scale, pw / 3);
      const headW = Math.min(18 * scale, ph / 2);
      ctx.beginPath();
      ctx.moveTo(tail, 0);
      ctx.lineTo(tip - headLen, 0);
      // 箭头头部（下半）
      ctx.lineTo(tip - headLen, -headW);
      ctx.lineTo(tip, 0);
      ctx.lineTo(tip - headLen, headW);
      ctx.lineTo(tip - headLen, 0);
      ctx.closePath();
      beginShape();
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(-halfW, 0);
      ctx.lineTo(halfW, 0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = sh.stroke || sh.fill || '#6C63FF';
      ctx.lineWidth = Math.max(MIN_STROKE_WIDTH, (sh.strokeWidth || 2) * scale);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue; }
    let current = '';
    for (const char of para) {
      const test = current + char;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** 判断圆角值是否有实际圆角（number > 0 或数组任一元素 > 0） */
function hasRadius(r: number | [number, number, number, number] | undefined): boolean {
  if (r == null) return false;
  if (typeof r === 'number') return r > 0;
  return r.some((v) => v > 0);
}

/** 绘制圆角矩形路径 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const radii = typeof r === 'number' ? [r, r, r, r] : r;
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/* ══════════════════════════ 页面渲染 → dataURL ══════════════════════════ */

/**
 * 渲染单页为 JPEG dataURL。
 *
 * @param page 页面数据
 * @param dpi 目标 DPI
 * @param photoImages 预加载的照片映射
 * @returns JPEG dataURL
 */
export interface RenderPageOptions {
  /** 出血边（mm）：四周扩展出血，页面内容偏移到出血区外沿 */
  bleed?: number;
  /** 书脊宽度（mm）：封面向右偏移半书脊、封底向左偏移半书脊，模拟装订翻阅观感 */
  spineWidth?: number;
}

/** 页面导出的物理宽度（mm）计算来自共享 pageExportWidthMm（exportGeometry.ts，与测试同源） */

export async function renderPage(
  page: AlbumPage,
  dpi: number,
  photoImages: Map<string, CanvasImageSource>,
  photoDataMap: Map<string, Photo>,
  opts: RenderPageOptions = {},
): Promise<string> {
  const pageMM = getPageSizeMM();
  const bleed = opts.bleed ?? 0;
  const bindingSpine = opts.spineWidth ?? 0;
  // 封面页：书脊背面 + 封面正面 印刷一体排布（无编辑器视觉间隙 SPINE_GAP_MM），
  // 画布逻辑宽度 += 书脊宽；封底无书脊
  const isCoverLike = isCoverPage(page);
  const spineMm = isCoverLike ? (page.spineWidth ?? 0) : 0;
  // 书脊偏移锚点（mm）= 内容烘焙的书脊偏移量（折线位置）。书脊宽度变化时内容数据不再移动，
  // 导出整体平移 (书脊宽 - 锚点)，使封面正面内容位于书脊之后（书脊向左扩展、封面内容视口固定），与画布一致。
  const spineAnchorMm = isCoverPage(page) ? (page.spineAnchorMm ?? page.spineWidth ?? 0) : 0;
  // 出血时画布四周扩展出血边；尺寸数学来自共享 calcExportCanvasSize（exportGeometry.ts，与测试同源）
  const geom = calcExportCanvasSize(pageMM, { spineMm, bleed, dpi });
  const logicalW = geom.logicalW;
  const logicalH = geom.logicalH;
  const canvasW = geom.canvasW;
  const canvasH = geom.canvasH;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // 先铺满画布底色（含出血区），书脊背面与封面正面为同一页面整体，避免四周露白
  ctx.fillStyle = page.background || '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 封面印刷一体：内容数据烘焙偏移为锚点，这里整体平移 (书脊宽 - 锚点) 使封面正面内容落到书脊之后，
  // 与 书脊背面 + 封面正面 连续渲染（无视觉间隙）；锚点 == 书脊宽（旧数据）时平移为 0，行为不变。

  // 编辑器逻辑坐标 → 导出像素坐标的缩放因子（基于内容区 = 页面尺寸 + 书脊）
  const scale = canvasW / (logicalW + bleed * 2 * MM_TO_PX);

  ctx.scale(scale, scale);

  // 出血偏移：内容在内容区内绘制，出血边留空（由上方底色铺满）
  const bleedPx = bleed * MM_TO_PX;
  ctx.translate(bleedPx, bleedPx);

  // 装订偏移：封面向右、封底向左偏移半书脊（仅竖版书刊有意义，横版不偏移）
  const bindingSpinePx = bindingSpine * MM_TO_PX;
  if (bindingSpine > 0 && pageMM.w < pageMM.h) {
    if (isCoverPage(page)) {
      ctx.translate(bindingSpinePx / 2, 0);
    } else if (isBackCoverPage(page)) {
      ctx.translate(-bindingSpinePx / 2, 0);
    }
  }

  // 书脊偏移（书脊向左扩展、封面内容固定）：整体平移 (书脊宽 - 锚点)，
  // 背景、书脊底色、内容、logo 同坐标系连续（背景铺满 [0, logicalW]，内容落于书脊之后）
  ctx.translate((spineMm - spineAnchorMm) * MM_TO_PX, 0);

  // 书脊底色：独立色块覆盖书脊区域（与 logo/书脊文字同坐标系，最终落在逻辑坐标 0..spineMm），与封面正面背景区分。
  // 当前坐标系已整体平移 (书脊宽-锚点)，故绘制的 x = 0 - 平移 = 锚点 - 书脊宽，
  // 使书脊底色恰好填满 [0, spineMm]，与画布叠层一致（书脊向左扩展、封面内容固定）。
  // 仅在封面页设置了 spineColor 时生效；未设置时书脊沿用整页背景（与编辑器缺省行为一致）。
  if (isCoverPage(page) && spineMm > 0 && page.spineColor) {
    ctx.fillStyle = page.spineColor;
    ctx.fillRect((spineAnchorMm - spineMm) * MM_TO_PX, 0, spineMm * MM_TO_PX, logicalH);
  }

  await drawPage(ctx, page, logicalW, logicalH, photoImages, photoDataMap);

  // 书脊 MemBook logo 水印（封面页书脊背面顶部，半透明，颜色可自定义）
  // logo 居中于书脊（与编辑器一致）、尺寸随书脊自适应（min(书脊宽×0.6, 12) 封顶）、顶部距页边固定 SPINE_LOGO_TOP_MM=15mm。
  // 当前坐标系已整体平移 (spineMm-锚点)，故绘制的 x = 居中位置 - 平移 = 锚点 - 书脊宽/2 - logoW/2。
  // 坐标须为逻辑像素（mm × MM_TO_PX，与编辑器/缩略图一致），直接用 mm 会导致 logo 极小且错位
  if (isCoverPage(page) && spineMm > 0) {
    try {
      // 单色位图按书脊 logo 颜色重着色：用户设置了 spineLogoColor 用其值，否则按书脊底色深浅自动黑/白
      const baseLogo = await loadSpineBaseLogo();
      const tinted = tintMonochromeImage(baseLogo, resolveSpineLogoColor(page.spineColor, page.spineLogoColor));
      // logo 尺寸随书脊宽自适应（min(书脊宽×0.6, 12) 封顶）
      const logoWmm = Math.min(spineMm * 0.6, 12);
      const logoW = logoWmm * MM_TO_PX;
      const logoH = logoW * (tinted.height / tinted.width);
      const logoX = (spineAnchorMm - spineMm / 2 - logoWmm / 2) * MM_TO_PX;
      const logoY = SPINE_LOGO_TOP_MM * MM_TO_PX;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(tinted, logoX, logoY, logoW, logoH);
      ctx.globalAlpha = 1;
    } catch { /* logo 水印加载失败忽略 */ }
  }

  try {
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (err) {
    logger.error('[Export] Canvas toDataURL 失败（可能被跨域图片污染）', err);
    throw new Error(`页面渲染失败：${(err as Error).message}`);
  }
}

/* ══════════════════════════ 导出函数 ══════════════════════════ */

export interface ExportResult {
  success: boolean;
  path: string | null;
  fileName: string;
  warnings: ExportWarning[];
  cancelled: boolean;
}

export async function exportToPDF(options: ExportOptions): Promise<ExportResult> {
  const { pageRange, dpi, projectName, outputPath, onProgress } = options;
  const bleed = options.bleed ?? 0;
  const spine = options.spineWidth ?? 0;
  const pageMM = getPageSizeMM();
  const pdfH = pageMM.h + bleed * 2;
  const total = pageRange.end - pageRange.start + 1;

  const task = beginTask();

  const { pages } = useEditorStore.getState();
  const { photos } = usePhotoStore.getState();
  // 导出页面物理宽度（封面/封底含设计书脊），用于 PDF 页尺寸与照片缓存上限
  let maxExportW = pageMM.w + bleed * 2;
  const pageExportW: number[] = [];
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    const w = pageExportWidthMm(pages[i], pageMM, bleed);
    pageExportW.push(w);
    if (w > maxExportW) maxExportW = w;
  }
  // 预建 photoId → Photo 的 Map，避免 drawPage 循环内 O(n) 查找
  const photoDataMap = new Map(photos.map(p => [p.id, p]));
  // P1-fix: 导出前预热内容感知缓存（人脸检测/主体焦点），确保导出时应用主体感知裁切
  const exportPhotos = pages
    .slice(pageRange.start - 1, pageRange.end)
    .flatMap(p => p.placements)
    .filter(p => p.photoId)
    .map(p => photoDataMap.get(p.photoId!))
    .filter((p): p is Photo => !!p);
  const uniqueExportPhotos = Array.from(new Map(exportPhotos.map(p => [p.id, p])).values());
  await preheatContentAnalysis(uniqueExportPhotos);
  // 滑动窗口加载：仅缓存当前页 ±N 页的照片位图，控制内存峰值
  const photoCache = new SlidingPhotoCache(calcExportMaxDim({ w: maxExportW, h: pdfH }, dpi));
  const pdf = new jsPDF({
    orientation: pageExportW[0] > pdfH ? 'landscape' : 'portrait',
    unit: 'mm', format: [pageExportW[0], pdfH], compress: true,
  });
  logger.info('[Export] jsPDF 实例创建完成');

  let current = 0;
  let pageAdded = false;
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    if (task.isCancelled) break;
    const page = pages[i];
    if (!page) {
      current++;
      onProgress?.(current, total);
      continue;
    }

    try {
      logger.info(`[Export] 开始渲染第 ${i + 1}/${total} 页`);
      current++;
      onProgress?.(current - 1, total);
      // 让出主线程，确保进度 UI 能及时更新
      await sleep(0);

      const photoImages = await photoCache.preparePage(pages, i, photoDataMap);
      const jpgURL = await renderPage(page, dpi, photoImages, photoDataMap, { bleed, spineWidth: spine });

      // 直接用 data URL 添加到 PDF，避免 jsPDF 处理 HTMLImageElement 时同步阻塞或挂起
      const effW = pageExportWidthMm(page, pageMM, bleed);
      if (pageAdded) {
        pdf.addPage([effW, pdfH], effW > pdfH ? 'landscape' : 'portrait');
      }
      pdf.addImage(jpgURL, 'JPEG', 0, 0, effW, pdfH);
      pageAdded = true;

      onProgress?.(current, total);
      // 让出主线程，避免长时间阻塞
      await sleep(0);
    } catch (err) {
      logger.warn(`[Export] PDF page ${i + 1} failed:`, err);
      task.addWarning({ pageIndex: i, pageLabel: `第 ${i + 1} 页`, message: `异常: ${(err as Error).message}` });
      onProgress?.(current, total);
    }
  }
  photoCache.clear();

  if (task.isCancelled) { return { success: false, path: null, fileName: `${projectName}.pdf`, warnings: task.getWarnings(), cancelled: true }; }

  const arrBuf = pdf.output('arraybuffer') as ArrayBuffer;
  const result = await saveFile(new Blob([arrBuf], { type: 'application/pdf' }), `${projectName}.pdf`, outputPath);
  return {
    success: true,
    path: result.path,
    fileName: `${projectName}.pdf`,
    warnings: task.getWarnings(),
    cancelled: false,
  };
}

/**
 * 生成打印用的 PDF Blob（不弹保存对话框）。
 * 与 exportToPDF 复用同一套渲染管线，可额外应用灰度。
 */
export interface PdfOptions {
  grayscale?: boolean;
  bleed?: number;
  spineWidth?: number;
  onProgress?: (current: number, total: number) => void;
}

export async function generatePdfBlob(
  pageRange: { start: number; end: number },
  dpi: number,
  grayscale = false,
  onProgress?: (current: number, total: number) => void,
  printOpts?: PdfOptions,
): Promise<Blob> {
  const pageMM = getPageSizeMM();
  const bleed = printOpts?.bleed ?? 0;
  const spine = printOpts?.spineWidth ?? 0;
  // 有出血时 PDF 页面向四周扩展出血边（印刷裁切用）
  const pdfH = pageMM.h + bleed * 2;
  const total = pageRange.end - pageRange.start + 1;

  const { pages } = useEditorStore.getState();
  const { photos } = usePhotoStore.getState();
  // 导出页面物理宽度（封面/封底含设计书脊），用于 PDF 页尺寸与照片缓存上限
  let maxExportW = pageMM.w + bleed * 2;
  const pageExportW: number[] = [];
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    const w = pageExportWidthMm(pages[i], pageMM, bleed);
    pageExportW.push(w);
    if (w > maxExportW) maxExportW = w;
  }
  const photoDataMap = new Map(photos.map(p => [p.id, p]));
  const photoCache = new SlidingPhotoCache(calcExportMaxDim({ w: maxExportW, h: pdfH }, dpi));
  const pdf = new jsPDF({
    orientation: pageExportW[0] > pdfH ? 'landscape' : 'portrait',
    unit: 'mm', format: [pageExportW[0], pdfH], compress: true,
  });

  let current = 0;
  let pageAdded = false;
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    const page = pages[i];
    if (!page) {
      current++;
      onProgress?.(current, total);
      continue;
    }

    try {
      logger.info(`[Print PDF] 开始渲染第 ${i + 1}/${total} 页`);
      current++;
      onProgress?.(current - 1, total);
      await sleep(0);

      const photoImages = await photoCache.preparePage(pages, i, photoDataMap);
      let jpgURL = await renderPage(page, dpi, photoImages, photoDataMap, { bleed, spineWidth: spine });
      if (grayscale) {
        jpgURL = await applyGrayscale(jpgURL);
      }

      if (pageAdded) {
        const effW = pageExportWidthMm(page, pageMM, bleed);
        pdf.addPage([effW, pdfH], effW > pdfH ? 'landscape' : 'portrait');
      }
      const effW = pageExportWidthMm(page, pageMM, bleed);
      pdf.addImage(jpgURL, 'JPEG', 0, 0, effW, pdfH);
      pageAdded = true;

      onProgress?.(current, total);
      await sleep(0);
    } catch (err) {
      logger.warn(`[Print PDF] page ${i + 1} failed:`, err);
      current++;
      onProgress?.(current, total);
    }
  }
  photoCache.clear();

  const arrBuf = pdf.output('arraybuffer') as ArrayBuffer;
  return new Blob([arrBuf], { type: 'application/pdf' });
}

/** 将 JPEG data URL 转为灰度图 */
async function applyGrayscale(src: string): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'grayscale(100%)';
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

export async function exportToPNG(options: ExportOptions): Promise<ExportResult> {
  const { pageRange, dpi, projectName, outputPath, onProgress, pageNumberStart } = options;
  const pageStart = pageNumberStart ?? 1;
  const bleed = options.bleed ?? 0;
  const spine = options.spineWidth ?? 0;
  const total = pageRange.end - pageRange.start + 1;
  const task = beginTask();
  const pageMM = getPageSizeMM();

  const { pages } = useEditorStore.getState();
  const { photos } = usePhotoStore.getState();
  const photoDataMap = new Map(photos.map(p => [p.id, p]));
  // P1-fix: 导出前预热内容感知缓存
  const exportPhotosPng = pages
    .slice(pageRange.start - 1, pageRange.end)
    .flatMap(p => p.placements)
    .filter(p => p.photoId)
    .map(p => photoDataMap.get(p.photoId!))
    .filter((p): p is Photo => !!p);
  await preheatContentAnalysis(Array.from(new Map(exportPhotosPng.map(p => [p.id, p])).values()));
  const photoCache = new SlidingPhotoCache(calcExportMaxDim(pageMM, dpi));
  const blobs: Blob[] = [];
  const names: string[] = [];
  // 内容页编号计数（封面/封底固定命名、不占用页码）
  let contentIndex = 0;

  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    if (task.isCancelled) break;
    try {
      const page = pages[i];
      if (!page) continue;
      const kind = page.pageKind ?? 'content';
      const name = kind === 'cover'
        ? `${projectName}_封面`
        : kind === 'backCover'
          ? `${projectName}_封底`
          : `${projectName}_第${pageStart + contentIndex++}页`;
      const photoImages = await photoCache.preparePage(pages, i, photoDataMap);
      const jpgURL = await renderPage(page, dpi, photoImages, photoDataMap, { bleed, spineWidth: spine });
      // 转 PNG
      const img = await loadImage(jpgURL);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(r => c.toBlob(b => r(b), 'image/png'));
      if (!blob) throw new Error('Canvas toBlob 返回 null（可能被污染）');
      blobs.push(blob);
      names.push(name);
    } catch (err) {
      task.addWarning({ pageIndex: i, pageLabel: `第 ${i + 1} 页`, message: `${(err as Error).message}` });
    }
    onProgress?.(i - pageRange.start + 1, total);
    await sleep(0);
  }
  photoCache.clear();

  if (task.isCancelled) { return { success: false, path: null, fileName: '', warnings: task.getWarnings(), cancelled: true }; }
  if (blobs.length === 0) { return { success: false, path: null, fileName: '', warnings: task.getWarnings(), cancelled: false }; }

  let result: SaveFileResult;
  let fileName: string;
  if (blobs.length === 1) {
    fileName = `${names[0]}.png`;
    result = await saveFile(blobs[0], fileName, outputPath);
  } else {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    blobs.forEach((b, idx) => zip.file(`${names[idx]}.png`, b));
    fileName = `${projectName}_导出.zip`;
    result = await saveFile(await zip.generateAsync({ type: 'blob' }), fileName, outputPath);
  }
  return { success: true, path: result.path, fileName, warnings: task.getWarnings(), cancelled: false };
}

export async function exportToJPG(options: ExportOptions): Promise<ExportResult> {
  const { pageRange, dpi, quality, projectName, outputPath, onProgress, pageNumberStart } = options;
  const pageStart = pageNumberStart ?? 1;
  const bleed = options.bleed ?? 0;
  const spine = options.spineWidth ?? 0;
  const total = pageRange.end - pageRange.start + 1;
  const task = beginTask();
  const pageMM = getPageSizeMM();

  const { pages } = useEditorStore.getState();
  const { photos } = usePhotoStore.getState();
  const photoDataMap = new Map(photos.map(p => [p.id, p]));
  // P1-fix: 导出前预热内容感知缓存
  const exportPhotosJpg = pages
    .slice(pageRange.start - 1, pageRange.end)
    .flatMap(p => p.placements)
    .filter(p => p.photoId)
    .map(p => photoDataMap.get(p.photoId!))
    .filter((p): p is Photo => !!p);
  await preheatContentAnalysis(Array.from(new Map(exportPhotosJpg.map(p => [p.id, p])).values()));
  const photoCache = new SlidingPhotoCache(calcExportMaxDim(pageMM, dpi));
  const blobs: Blob[] = [];
  const names: string[] = [];
  // 内容页编号计数（封面/封底固定命名、不占用页码）
  let contentIndex = 0;

  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    if (task.isCancelled) break;
    try {
      const page = pages[i];
      if (!page) continue;
      const kind = page.pageKind ?? 'content';
      const name = kind === 'cover'
        ? `${projectName}_封面`
        : kind === 'backCover'
          ? `${projectName}_封底`
          : `${projectName}_第${pageStart + contentIndex++}页`;
      const photoImages = await photoCache.preparePage(pages, i, photoDataMap);
      const jpgURL = await renderPage(page, dpi, photoImages, photoDataMap, { bleed, spineWidth: spine });
      if (Math.abs(quality - 92) > 1) {
        const img = await loadImage(jpgURL);
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        const jpegBlob = await new Promise<Blob | null>(r => c.toBlob(b => r(b), 'image/jpeg', quality / 100));
        if (!jpegBlob) throw new Error('Canvas toBlob 返回 null（可能被污染）');
        blobs.push(jpegBlob);
        names.push(name);
      } else {
        // P0-fix CSP: jpgURL 是 data: URL，fetch(dataURL) 会触发 CSP connect-src 违规。
        //   用 atob 解码替代 fetch（JS 内存操作，不发起网络请求）。
        blobs.push(dataURLtoBlob(jpgURL));
        names.push(name);
      }
    } catch (err) {
      task.addWarning({ pageIndex: i, pageLabel: `第 ${i + 1} 页`, message: `${(err as Error).message}` });
    }
    onProgress?.(i - pageRange.start + 1, total);
    await sleep(0);
  }
  photoCache.clear();

  if (task.isCancelled) { return { success: false, path: null, fileName: '', warnings: task.getWarnings(), cancelled: true }; }
  if (blobs.length === 0) { return { success: false, path: null, fileName: '', warnings: task.getWarnings(), cancelled: false }; }

  let result: SaveFileResult;
  let fileName: string;
  if (blobs.length === 1) {
    fileName = `${names[0]}.jpg`;
    result = await saveFile(blobs[0], fileName, outputPath);
  } else {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    blobs.forEach((b, idx) => zip.file(`${names[idx]}.jpg`, b));
    fileName = `${projectName}_导出.zip`;
    result = await saveFile(await zip.generateAsync({ type: 'blob' }), fileName, outputPath);
  }
  return { success: true, path: result.path, fileName, warnings: task.getWarnings(), cancelled: false };
}
