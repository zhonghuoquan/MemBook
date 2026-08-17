/**
 * MemBook — 网格视图缩略图渲染器
 *
 * 基于 Canvas 2D 直接绘制页面缩略图，与 exportEngine.ts 共享核心渲染逻辑。
 * 输出低分辨率 dataURL，用于网格视图卡片展示。
 */

import { useEditorStore } from '../store';
import {
  shouldShowWatermark,
  getWatermarkText,
  calcWatermarkFontSize,
  calcWatermarkPosition,
  calcPageSafeArea,
  getWatermarkSettings,
} from './watermarkRenderer';
import {
  type AlbumPage,
  type Photo,
  isCoverPage,
} from '../types';
import { SLOT_PALETTE_VERSION } from '../constants/templatePalette';
import { loadImage, readFileAsBlobUrl } from './tauri';
import { isBlobUrlAlive, readPhotoFromDB } from '../engine/storage-engine';
import { LRUCache } from './lruCache';
import { logger } from './logger';
import { drawPageToCanvas, calcThumbSize } from './thumbnailCore';
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from './thumbnail.worker';
import { getThumbnail, saveThumbnail, clearAllThumbnails } from '../db';
import { preloadStickerSrc } from '../hooks/useStickerSrc';
import { getCachedContentInfo, type PhotoContentInfo } from '../engine/content-aware';
import logoLight from '../assets/logo-light.png';

/* ── 常量 ── */
/** 缩略图基准宽度（1.0x 缩放时的逻辑像素宽） */
const BASE_THUMB_W = 200;

/** 书脊 MemBook logo 水印（亮色版，与导出一致）。模块加载即预载，缩略图渲染时若已就绪则绘制。 */
const spineLogoElement = new window.Image();
spineLogoElement.src = logoLight;

/** 书脊 logo 是否已就绪可绘制（主线程路径用 HTMLImageElement） */
function getReadySpineLogo(): HTMLImageElement | undefined {
  return spineLogoElement.complete && spineLogoElement.naturalWidth > 0 ? spineLogoElement : undefined;
}

/** 生成书脊 logo 的 ImageBitmap（供 Worker 转移）。每次调用新建一份，避免同一 bitmap 重复 transfer 报错。 */
async function getSpineLogoBitmap(): Promise<ImageBitmap | null> {
  try {
    const img = getReadySpineLogo() ?? await loadImage(logoLight);
    return await createImageBitmap(img);
  } catch {
    return null;
  }
}

/** 加载背景图片为 ImageBitmap（优先，可 transfer 给 Worker）；失败回退 HTMLImageElement */
export async function loadBackgroundBitmap(src?: string): Promise<ImageBitmap | HTMLImageElement | null> {
  if (!src) return null;
  try {
    const blob = await (await fetch(src)).blob();
    return await createImageBitmap(blob);
  } catch {
    try {
      return await loadImage(src);
    } catch {
      return null;
    }
  }
}

/**
 * 缩略图渲染版本号。包含在 IDB 持久化缓存 key 中，
 * 每次渲染逻辑发生重大变更（如修复照片不显示 bug、新增元素类型渲染）时递增，
 * 使所有旧版本 IDB 缓存条目因 key 不匹配而自然失效（不会被命中），
 * 避免残缺/过期的 dataURL 持续显示。
 */
const RENDER_VERSION = 10;

/* ── 缓存 ──
 * P0-3 优化：从无界 Map 改为 LRU 缓存，容量 80 页。
 * 100+ 页面相册场景下，dataURL 常驻内存从无上限变为可控（约 80 × 30KB ≈ 2.4MB）。
 * 淘汰时无需显式释放（dataURL 是字符串，GC 自动回收），但 LRU 保证了内存上界。
 *
 * P2-1：新增 IndexedDB 二级缓存（持久化），跨重载复用缩略图。
 *   - LRU（内存）= 一级缓存，命中即返回，零延迟
 *   - IDB（磁盘）= 二级缓存，重载后 LRU 为空时回退查询，命中后回填 LRU
 *   - IDB key 基于页面内容哈希，内容变化自然产生新 key，无需主动失效
 */
const THUMBNAIL_CACHE_CAPACITY = 80;
const thumbnailCache = new LRUCache<string, string>(THUMBNAIL_CACHE_CAPACITY);
let cacheVersion = 0;

/** 外部触发缓存失效（page 内容变化时调用）。
 *  P2-1：同时清空 IDB 持久化缓存（全局失效场景如模板色板变更）。
 *  注意：此函数会清空 IDB，仅用于内容真正变化的全局失效场景，
 *        不要在项目切换时调用（IDB 缓存 key 基于内容哈希，跨项目安全复用）。 */
export function invalidateThumbnailCache() {
  thumbnailCache.clear();
  cacheVersion++;
  // 异步清空 IDB 缩略图表，不阻塞调用方
  void clearAllThumbnails();
}

/** 仅清空内存 LRU 缓存，保留 IDB 持久化缓存（用于项目切换/退出编辑器）。
 *  P0-fix: 之前 cleanupProjectResources 调用 invalidateThumbnailCache 清空了 IDB，
 *    导致首次进入新项目时缩略图缓存全部 miss，必须重新渲染（期间空白）。
 *    IDB 缓存 key 基于内容哈希，跨项目复用是安全的，不应清空。 */
export function clearThumbnailMemoryCache() {
  thumbnailCache.clear();
  cacheVersion++;
}

/** 清除单个页面缓存 */
export function invalidatePageThumbnail(pageId: string, cacheSuffix?: string) {
  const suffix = cacheSuffix ? `_${cacheSuffix}` : '';
  // LRU key 现在包含 content hash，无法仅凭 pageId 精确删除。
  // 改用前缀匹配删除所有该 pageId+suffix 的缓存条目（覆盖所有内容版本）。
  const prefix = `${pageId}${suffix}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}`;
  for (const key of thumbnailCache.keys()) {
    if (key.startsWith(prefix)) {
      thumbnailCache.delete(key);
    }
  }
}

/** 清除全屏视图单个页面缓存 */
export function invalidateFullscreenThumbnail(pageId: string) {
  invalidatePageThumbnail(pageId, 'fs');
}

/* ── P2-1: IDB 持久化缓存 key 计算 ──
 * 基于页面内容 + 照片尺寸 + 渲染参数生成稳定哈希 key。
 * 跨重载一致：不包含 cacheVersion（内存态，重载后归零）。
 * 内容变化自然失效：任一渲染相关字段变化 → 哈希变化 → key 变化 → IDB miss → 重新渲染。
 */

/** FNV-1a 32 位哈希（快、足够分散，仅用于缓存 key） */
function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 计算页面渲染内容的哈希（影响缩略图像素的所有字段） */
function computeContentHash(page: AlbumPage, photos: Photo[], margin?: { left: number; right: number; top: number; bottom: number }): string {
  const photoIdSet = new Set(
    page.placements.filter((pl) => pl.photoId).map((pl) => pl.photoId as string),
  );
  // P0-fix: photoDims 必须包含 blobId 状态（thumbBlobId/previewBlobId/blobId）。
  //   之前仅含 id+width+height，底层 blob 变化（如 direct 模式 P2 后台生成 preview、
  //   import 模式重新生成 blob、照片被替换）时哈希不变 → 命中 IDB 中旧的残缺 dataURL →
  //   网格视图部分页面永久空白。加入 blobId 后，底层 blob 变化时哈希自然变化 → 缓存自动失效。
  const photoDims: string[] = [];
  for (const p of photos) {
    if (photoIdSet.has(p.id)) {
      photoDims.push(`${p.id}:${p.width}x${p.height}:${p.thumbBlobId ?? ''}:${p.previewBlobId ?? ''}:${p.blobId ?? ''}`);
    }
  }

  const content = JSON.stringify({
    b: page.background,
    // 背景图片与填充方式影响缩略图渲染，必须包含在哈希中，变化时缓存自动失效
    bi: page.backgroundImage ?? null,
    bif: page.backgroundImageFit ?? null,
    sc: page.slotCornerRadius,
    t: page.templateId,
    // pageMargin 影响槽位渲染位置，必须包含在哈希中，边距变化时缓存自动失效
    pm: margin ? `${margin.left},${margin.right},${margin.top},${margin.bottom}` : null,
    p: page.placements.map((pl) => [
      pl.photoId ?? '',
      pl.slotId,
      pl.rotation ?? 0,
      pl.panX ?? null,
      pl.panY ?? null,
      pl.panScale ?? null,
      pl.panRotation ?? null,
      pl.filter ?? null,
    ]),
    so: page.slotOverrides ?? null,
    sord: page.slotOrder ?? null,
    szi: page.slotZIndices ?? null,
    es: page.extraSlots ?? null,
    te: page.textElements?.map((te) => [
      te.x, te.y, te.width, te.height, te.fontSize,
      te.text, te.color, te.align, te.bold, te.italic, te.fontFamily, te.zIndex,
      te.rotation ?? 0,
    ]) ?? null,
    bs: page.brushStrokes?.map((s) => [
      s.id, s.color, s.strokeWidth, s.opacity, s.tension, s.lineCap, s.zIndex, s.points.length,
      s.brushType,
    ]) ?? null,
    sn: page.stickyNotes?.map((sn) => [
      sn.id, sn.x, sn.y, sn.width, sn.height, sn.color, sn.text,
      sn.fontSize, sn.fontFamily, sn.rotation, sn.style ?? 'rounded', sn.zIndex,
    ]) ?? null,
    st: page.stickerElements?.map((st) => [
      st.id, st.x, st.y, st.width, st.height, st.stickerId,
      st.rotation, st.flipH, st.flipV, st.zIndex,
    ]) ?? null,
    // P-fix: 缩略图缓存哈希必须包含形状，否则添加/修改形状后命中旧缓存，缩略图/网格/全屏不实时同步
    sh: page.shapeElements?.map((sh) => [
      sh.id, sh.type, sh.x, sh.y, sh.width, sh.height,
      sh.fill, sh.stroke, sh.strokeWidth, sh.rotation ?? 0, sh.opacity ?? 1, sh.zIndex,
      sh.cornerRadius ?? 0, sh.cornerCut ?? 0,
      sh.gradient ? JSON.stringify(sh.gradient) : null, sh.gradientAngle ?? null,
      sh.strokeGradient ? JSON.stringify(sh.strokeGradient) : null,
    ]) ?? null,
    pd: photoDims,
  });
  return fnv1aHash(content);
}

/** 生成 IDB 持久化缓存 key（稳定，跨重载一致）。
 *  包含 RENDER_VERSION，渲染逻辑变更后旧 key 不匹配，自然失效。 */
function computeThumbnailDbKey(
  page: AlbumPage,
  photos: Photo[],
  albumSize: { width: number; height: number },
  scale: number,
  baseWidth: number,
  cacheSuffix: string,
  margin?: { left: number; right: number; top: number; bottom: number },
): string {
  const hash = computeContentHash(page, photos, margin);
  return `${page.id}|${cacheSuffix}|${albumSize.width}x${albumSize.height}|${baseWidth}|${scale}|sp${SLOT_PALETTE_VERSION}|rv${RENDER_VERSION}|h${hash}`;
}

/**
 * P2-1：查询缩略图缓存（LRU → IDB），不触发渲染。
 * 供 PageCard 在预加载照片前调用：命中则直接显示，跳过 preload + Worker 渲染。
 * @returns 缓存命中的 dataURL，或 null（未命中）
 */
export async function getCachedThumbnailUrl(
  page: AlbumPage,
  photos: Photo[],
  scale: number,
  options?: RenderOptions,
): Promise<string | null> {
  const baseWidth = options?.baseWidth ?? BASE_THUMB_W;
  const cacheSuffix = options?.cacheSuffix ?? '';
  const pm = useEditorStore.getState().pageMargin;
  // LRU key 必须包含 content hash，否则页面内容变化（如添加贴纸）后仍命中旧 dataURL
  const contentHash = computeContentHash(page, photos, pm);
  const cacheKey = cacheSuffix
    ? `${page.id}_${cacheSuffix}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`
    : `${page.id}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`;

  // 一级缓存：LRU（内存）
  if (!options?.noCache && thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }

  const albumSize = options?.albumSize ?? useEditorStore.getState().albumSize;
  if (!albumSize) return null;

  // 二级缓存：IDB（磁盘，跨重载）
  const dbKey = computeThumbnailDbKey(page, photos, albumSize, scale, baseWidth, cacheSuffix, pm);
  const dbUrl = await getThumbnail(dbKey);
  if (dbUrl) {
    // 回填 LRU，后续命中走一级缓存
    thumbnailCache.set(cacheKey, dbUrl);
    return dbUrl;
  }
  return null;
}

interface RenderOptions {
  /** 自定义基准宽度（默认 BASE_THUMB_W） */
  baseWidth?: number;
  /** 缓存后缀，避免与网格缩略图缓存冲突 */
  cacheSuffix?: string;
  /** 是否跳过缓存 */
  noCache?: boolean;
  /** 页面在相册中的索引；传入时会在缩略图上绘制时间水印 */
  pageIndex?: number;
  /** P0-fix: 传入相册尺寸，优先于全局 store。
   *  主页相册封面需要渲染不同项目的缩略图，全局 store 只有一个 albumSize，
   *  从编辑器返回主页时全局 albumSize 可能不匹配当前相册，导致渲染返回 null。 */
  albumSize?: { width: number; height: number } | null;
}

/**
 * 获取页面缩略图 dataURL。
 * 带缓存：页面内容不变时直接返回缓存结果。
 *
 * @param page 页面数据
 * @param photos 全部照片列表
 * @param scale 缩放倍率（1.0 = baseWidth 宽）
 * @param photoImages 已预加载的照片图像映射（可选，HTMLImageElement 或 ImageBitmap 均可）
 * @param options 渲染选项
 *
 * P1-3：photoImages 同时接受 HTMLImageElement 与 ImageBitmap。
 *       ImageBitmap 可主动 close() 释放内存，ctx.drawImage 对两者均支持。
 */
export function renderPageThumbnail(
  page: AlbumPage,
  photos: Photo[],
  scale: number,
  photoImages?: Map<string, HTMLImageElement | ImageBitmap>,
  options?: RenderOptions,
  stickerImages?: Map<string, HTMLImageElement | ImageBitmap>,
  backgroundImageBitmap?: HTMLImageElement | ImageBitmap,
): string | null {
  const baseWidth = options?.baseWidth ?? BASE_THUMB_W;
  const cacheSuffix = options?.cacheSuffix ?? '';
  const pm = useEditorStore.getState().pageMargin;
  // LRU key 必须包含 content hash，否则页面内容变化后仍命中旧 dataURL
  const contentHash = computeContentHash(page, photos, pm);
  const cacheKey = cacheSuffix
    ? `${page.id}_${cacheSuffix}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`
    : `${page.id}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`;
  if (!options?.noCache && thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }

  const albumSize = options?.albumSize ?? useEditorStore.getState().albumSize;
  if (!albumSize) return null;

  const mmW = albumSize.width;
  const mmH = albumSize.height;
  const size = calcThumbSize(albumSize, { baseWidth, scale });
  if (!size) return null;
  const { thumbW, thumbH, logicalW, logicalH } = size;

  const canvas = document.createElement('canvas');
  canvas.width = thumbW;
  canvas.height = thumbH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const drawScale = thumbW / logicalW;
  ctx.scale(drawScale, drawScale);

  // P1-5：纯绘制核心复用 thumbnailCore.drawPageToCanvas（主线程与 Worker 共用）
  // 主线程传入 margin（pm 已在上方声明用于 content hash），避免 Worker 内无法读取 store 导致 fallback 无边距缩放
  const drawnPhotoCount = drawPageToCanvas(ctx, page, photos, logicalW, logicalH, photoImages, stickerImages, pm, undefined, backgroundImageBitmap);

  // P0-fix: 校验是否完整渲染——若部分照片加载失败（photoImages 缺失），
  //   drawPageToCanvas 会跳过该照片只画背景+槽位，生成"空白但有底色"的残缺 dataURL。
  //   若缓存这种 dataURL，关闭重进后从 IDB 命中残缺图 → 网格视图部分页面永久空白。
  //   校验失败时返回 null，不写 LRU 也不写 IDB，让调用方下次重新尝试。
  const expectedPhotoCount = page.placements.filter((pl) => pl.photoId).length;
  if (drawnPhotoCount < expectedPhotoCount) {
    return null;
  }

  // ── 绘制时间水印（仅在传入 pageIndex 时，如全屏浏览）──
  // 水印依赖 useEditorStore（pages/pageMargin）与 license，仅主线程绘制，Worker 不支持。
  if (options?.pageIndex !== undefined) {
    const state = useEditorStore.getState();
    const pages = state.pages;
    const ws = getWatermarkSettings();
    if (shouldShowWatermark(options.pageIndex, pages, photos, ws)) {
      const text = getWatermarkText(options.pageIndex, pages, photos, ws);
      if (text) {
        const fontSize = calcWatermarkFontSize();
        const pm = state.pageMargin;
        const safe = calcPageSafeArea(page, mmW, mmH, logicalW, logicalH, {
          left: pm.left,
          bottom: pm.bottom,
        });
        const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
        const bg = page.background || '#FFFFFF';
        ctx.font = `${fontSize}px serif`;
        ctx.fillStyle = isDarkBackground(bg) ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text, pos.x, pos.y);
      }
    }
  }

  // try-catch 保护：canvas 被污染（跨域图片）或内存不足时 toDataURL 会抛异常，
  // 避免异常导致整个渲染流程中断、thumbnailUrl 保持 null 导致页面空白
  let dataURL: string;
  try {
    dataURL = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  thumbnailCache.set(cacheKey, dataURL);
  return dataURL;
}

/* ── P1-5：Web Worker 异步渲染 ──
 * 把 PNG 编码（toDataURL，每页 5-20ms）从主线程移到 Worker，100+ 页批量渲染不再卡 UI。
 * 仅用于网格视图 PageCard（无水印）；全屏视图仍用主线程 renderPageThumbnail（需水印）。
 *
 * 位图所有权：photoImages 中的 ImageBitmap 通过 transfer 转移给 Worker，
 *   Worker 绘制完毕后立即 close()。HTMLImageElement 无法转移，遇此回退主线程。
 *   调用方在 await 本函数后，photoImages 中的 ImageBitmap 已被消耗，无需再 release。
 */
let thumbnailWorker: Worker | null = null;
let workerFailed = false; // Worker 崩溃标志，崩溃后直接走主线程渲染
function getThumbnailWorker(): Worker | null {
  // 不支持 OffscreenCanvas 或 Worker 曾崩溃时回退主线程
  if (typeof OffscreenCanvas === 'undefined' || workerFailed) return null;
  if (!thumbnailWorker) {
    try {
      thumbnailWorker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' });
      // 监听 Worker 崩溃（模块求值失败/unhandled error），标记后不再使用
      thumbnailWorker.addEventListener('error', (e) => {
        logger.error('[gridThumbnailRenderer] Worker 崩溃，后续回退主线程渲染:', e.message || e);
        workerFailed = true;
        // 通知所有等待中的 job 返回 null，让调用方走主线程重试
        for (const [id, job] of pendingWorkerJobs) {
          pendingWorkerJobs.delete(id);
          job.resolve(null);
        }
      });
    } catch {
      thumbnailWorker = null;
      workerFailed = true;
    }
  }
  return thumbnailWorker;
}

interface PendingWorkerJob {
  resolve: (url: string | null) => void;
  albumSize: { width: number; height: number };
  /** P2-1: IDB 持久化缓存 key（渲染成功后写入磁盘） */
  dbKey: string;
  /** P2-1: 页面 ID（用于 IDB 孤儿清理） */
  pageId: string;
  /** P0-fix: 期望绘制的照片数（用于校验 Worker 是否完整渲染） */
  expectedPhotoCount: number;
}
const pendingWorkerJobs = new Map<string, PendingWorkerJob>();
/** BUG-3 修复：自增序列号作 job id，避免并发渲染同一 cacheKey 时覆盖丢响应 */
let workerJobSeq = 0;

function attachWorkerListener(worker: Worker): void {
  worker.addEventListener('message', (e: MessageEvent<ThumbnailWorkerResponse>) => {
    const { id, dataURL, drawnPhotoCount } = e.data;
    const job = pendingWorkerJobs.get(id);
    if (!job) return;
    pendingWorkerJobs.delete(id);
    if (dataURL) {
      // cacheKey 从 id 中提取（格式为 `${cacheKey}#${seq}`）
      const sepIdx = id.lastIndexOf('#');
      const cacheKey = sepIdx > 0 ? id.slice(0, sepIdx) : id;
      // P0-fix: 校验是否完整渲染——Worker 端若部分照片 preload 失败（photoImages 缺失），
      //   drawPageToCanvas 会跳过该照片只画背景+槽位，生成"空白但有底色"的残缺 dataURL。
      //   - 校验通过：写 LRU + IDB（跨重载复用）
      //   - 校验失败：不写 LRU 也不写 IDB（与主线程 renderPageThumbnail 一致），让下次重新渲染
      //   P0-fix-2: 移除 drawnPhotoCount === undefined 旁路——Worker 成功路径总是返回数值，
      //   undefined 只在 dataURL 为 null 的失败路径出现（已走 else 分支）。
      //   旧代码把 undefined 当作完整，导致残缺缩略图被缓存到 IDB，主页第一页永久空白。
      const isComplete = drawnPhotoCount !== undefined && drawnPhotoCount >= job.expectedPhotoCount;
      if (isComplete) {
        thumbnailCache.set(cacheKey, dataURL);
        // P2-1: 持久化到 IDB（fire-and-forget，跨重载复用）
        void saveThumbnail(job.dbKey, job.pageId, dataURL);
      } else {
        logger.warn(`[gridThumbnailRenderer] Worker 渲染不完整 pageId=${job.pageId} drawn=${drawnPhotoCount} expected=${job.expectedPhotoCount}，返回 null`);
      }
      // 不完整时 resolve null，让调用方（CanvasPageThumbnail）显示白色兜底并下次重试
      job.resolve(isComplete ? dataURL : null);
    } else {
      job.resolve(dataURL);
    }
  });
}

/**
 * 在 Worker 中渲染页面缩略图（仅网格视图使用，无水印）。
 *
 * 契约：调用后 photoImages 一定被消耗（转移给 Worker 或主线程渲染后释放），
 *       调用方无需也不应再调用 releasePreloadedImages。
 * - photoImages 仅含 ImageBitmap 且支持 OffscreenCanvas → 走 Worker（位图 transfer，Worker 端 close）
 * - 含 HTMLImageElement 或不支持 OffscreenCanvas → 回退主线程同步渲染，渲染后内部 release
 * - 缓存命中 → 直接 release 位图并返回缓存 dataURL
 */
export async function renderPageThumbnailInWorker(
  page: AlbumPage,
  photos: Photo[],
  scale: number,
  photoImages: Map<string, HTMLImageElement | ImageBitmap>,
  options?: RenderOptions,
  stickerImages?: Map<string, HTMLImageElement | ImageBitmap>,
): Promise<string | null> {
  const baseWidth = options?.baseWidth ?? BASE_THUMB_W;
  const cacheSuffix = options?.cacheSuffix ?? '';
  const pm = useEditorStore.getState().pageMargin;
  // LRU key 必须包含 content hash，否则页面内容变化后仍命中旧 dataURL
  const contentHash = computeContentHash(page, photos, pm);
  const cacheKey = cacheSuffix
    ? `${page.id}_${cacheSuffix}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`
    : `${page.id}_v${cacheVersion}_p${SLOT_PALETTE_VERSION}_h${contentHash}`;
  if (!options?.noCache && thumbnailCache.has(cacheKey)) {
    // 缓存命中：位图未使用，立即释放
    releasePreloadedImages(photoImages);
    if (stickerImages) releaseStickerImages(stickerImages);
    return thumbnailCache.get(cacheKey)!;
  }

  const albumSize = options?.albumSize ?? useEditorStore.getState().albumSize;
  if (!albumSize) {
    releasePreloadedImages(photoImages);
    if (stickerImages) releaseStickerImages(stickerImages);
    return null;
  }

  // P2-1: IDB 持久化缓存检查（跨重载复用，命中则跳过渲染）
  const dbKey = computeThumbnailDbKey(page, photos, albumSize, scale, baseWidth, cacheSuffix, pm);
  const dbUrl = await getThumbnail(dbKey);
  if (dbUrl) {
    // 回填 LRU，后续命中走一级缓存
    thumbnailCache.set(cacheKey, dbUrl);
    releasePreloadedImages(photoImages);
    if (stickerImages) releaseStickerImages(stickerImages);
    return dbUrl;
  }

  // 任一图像为 HTMLImageElement 则无法 transfer，回退主线程
  let allBitmaps = true;
  for (const img of photoImages.values()) {
    if (!(img instanceof ImageBitmap)) { allBitmaps = false; break; }
  }

  // 检查贴纸位图是否也都为 ImageBitmap（否则回退主线程）
  let stickerAllBitmaps = true;
  if (stickerImages) {
    for (const img of stickerImages.values()) {
      if (!(img instanceof ImageBitmap)) { stickerAllBitmaps = false; break; }
    }
  }

  // 背景图片位图（可选）：加载为 ImageBitmap 以便 transfer；HTMLImageElement 则无法走 Worker
  const backgroundImg = await loadBackgroundBitmap(page.backgroundImage);
  const backgroundAllBitmap = backgroundImg === null || backgroundImg instanceof ImageBitmap;

  const worker = getThumbnailWorker();
  if (!worker || !allBitmaps || !stickerAllBitmaps || !backgroundAllBitmap) {
    // 回退主线程同步渲染，渲染后释放位图
    const url = renderPageThumbnail(page, photos, scale, photoImages, options, stickerImages, backgroundImg ?? undefined);
    releasePreloadedImages(photoImages);
    if (stickerImages) releaseStickerImages(stickerImages);
    if (backgroundImg instanceof ImageBitmap) try { backgroundImg.close(); } catch { /* ignore */ }
    // P2-1: 持久化到 IDB（fire-and-forget）
    if (url) void saveThumbnail(dbKey, page.id, url);
    return url;
  }

  // 收集本页用到的照片元数据（缩小克隆体积）
  const photoIdSet = new Set(photoImages.keys());
  const pagePhotos = photos.filter((p) => photoIdSet.has(p.id));

  const bitmaps: [string, ImageBitmap][] = [];
  for (const [id, img] of photoImages) {
    bitmaps.push([id, img as ImageBitmap]);
  }
  // 位图已转出，清空主线程引用，避免调用方误用
  photoImages.clear();

  // 收集贴纸 ImageBitmap（可转移）
  const stickerBitmaps: [string, ImageBitmap][] = [];
  if (stickerImages) {
    for (const [id, img] of stickerImages) {
      stickerBitmaps.push([id, img as ImageBitmap]);
    }
    stickerImages.clear();
  }

  // BUG-3 修复：用自增序列号作 job id，避免并发渲染同一 cacheKey 时覆盖丢响应
  const jobId = `${cacheKey}#${++workerJobSeq}`;
  // P0-fix: 计算期望绘制照片数，用于 Worker 返回后校验是否完整渲染
  const expectedPhotoCount = page.placements.filter((pl) => pl.photoId).length;
  // 书脊 logo 水印位图（仅封面页使用；失败返回 null，Worker 端跳过绘制）
  const logoBitmap = isCoverPage(page) ? await getSpineLogoBitmap() : null;
  return new Promise<string | null>((resolve) => {
    // 超时保护：Worker 崩溃或消息处理异常时 10s 超时，回退主线程渲染
    const timeoutId = setTimeout(() => {
      if (pendingWorkerJobs.has(jobId)) {
        pendingWorkerJobs.delete(jobId);
        logger.warn(`[gridThumbnailRenderer] Worker 超时 pageId=${page.id}，回退主线程`);
        // 超时后直接走主线程同步渲染（位图已 transfer 给 Worker 无法回收，主线程重新预加载）
        try {
          const fallbackUrl = renderPageThumbnail(page, photos, scale, undefined, options, undefined);
          if (fallbackUrl) void saveThumbnail(dbKey, page.id, fallbackUrl);
          resolve(fallbackUrl);
        } catch {
          resolve(null);
        }
      }
    }, 10000);
    pendingWorkerJobs.set(jobId, {
      resolve: (url: string | null) => { clearTimeout(timeoutId); resolve(url); },
      albumSize, dbKey, pageId: page.id, expectedPhotoCount,
    });
    // 首次使用 worker 时绑定监听
    if (!(worker as Worker & { _membookListenerAttached?: boolean })._membookListenerAttached) {
      attachWorkerListener(worker);
      (worker as Worker & { _membookListenerAttached?: boolean })._membookListenerAttached = true;
    }
    const req: ThumbnailWorkerRequest = {
      id: jobId,
      page,
      photos: pagePhotos,
      albumSize,
      scale,
      baseWidth,
      bitmaps,
      stickerBitmaps,
      logoBitmap: logoBitmap ?? undefined,
      backgroundImageBitmap: backgroundImg instanceof ImageBitmap ? backgroundImg : undefined,
      // Worker 无法读取主线程 store，显式传入 pageMargin 用于边距感知渲染
      margin: useEditorStore.getState().pageMargin,
      // P1-fix: 传入内容感知信息映射，让 Worker 渲染也能应用主体感知裁切
      contentInfoMap: pagePhotos
        .map(p => {
          const info = getCachedContentInfo(p.id);
          return info ? [p.id, info] as [string, PhotoContentInfo] : null;
        })
        .filter((x): x is [string, PhotoContentInfo] => x !== null),
    };
    // 转移 ImageBitmap 所有权：主线程侧 bitmap 被 detach，Worker 端绘制后 close
    const transferList = bitmaps.map((b) => b[1]).concat(stickerBitmaps.map((b) => b[1]));
    if (logoBitmap) transferList.push(logoBitmap);
    if (backgroundImg instanceof ImageBitmap) transferList.push(backgroundImg);
    worker.postMessage(req, transferList);
  });
}

/**
 * 把照片的 src 解析为可直接加载的 URL。
 * 对 direct 模式使用原文件路径；对 import 模式优先读取 IndexedDB 预览图。
 * 即使 photo.src 是 blob URL，只要 import 模式有 blobId，就优先读库，避免 blob 过期。
 */
async function resolveGridPhotoSrc(
  photo: Photo,
  makeDirectPhotoUrl: (p: Photo) => Promise<string | null>,
  readPhotoFromDB: (id: string) => Promise<string | null>,
): Promise<string | null> {
  if (photo.storageMode === 'import') {
    // P0-3: 优先使用 thumbBlobId（256px）而非 previewBlobId（1200px）
    // 网格/底部导航缩略图尺寸很小（36-128px），加载 1200px 预览图浪费内存与解码开销
    const thumbId = photo.thumbBlobId || photo.previewBlobId || photo.blobId || photo.originalBlobId;
    if (thumbId) {
      const dbUrl = await readPhotoFromDB(thumbId);
      if (dbUrl) return dbUrl;
    }
    if (photo.src?.startsWith('blob:') || photo.src?.startsWith('data:')) {
      return photo.src;
    }
    return photo.src || null;
  }
  if (photo.storageMode === 'direct') {
    // P0-3: 优先用 thumbBlobId（256px）而非 photo.src（1200px preview），
    //   与 import 模式一致，避免网格视图滚动时每页解码 1200px 位图（滚动峰值 300-500MB）
    const thumbId = photo.thumbBlobId || photo.previewBlobId;
    if (thumbId) {
      const dbUrl = await readPhotoFromDB(thumbId);
      if (dbUrl) return dbUrl;
    }
    // thumb 读取失败回退到 photo.src
    if (photo.src?.startsWith('blob:') || photo.src?.startsWith('data:')) {
      return photo.src;
    }
    return makeDirectPhotoUrl(photo);
  }
  return photo.src || null;
}

function loadImageLocal(src: string): Promise<HTMLImageElement> {
  return loadImage(src);
}

/**
 * 将图片 URL 转换为 Canvas 安全的同源 URL。
 * - blob:/data: 与页面同源，直接返回（但 blob URL 可能已失效，需检查 isBlobUrlAlive）
 * - asset://, http://asset.localhost/ → 通过 Tauri fs 读取为 blob URL
 *   避免画到 Canvas 后污染画布导致 toDataURL 抛 SecurityError
 *   同时避免 fetch(asset://) 触发 CSP connect-src 限制
 * - 转换失败时回退原 URL（仍可能加载成功，但 toDataURL 可能失败）
 */
async function ensureCanvasSafeUrl(src: string, photo: Photo): Promise<string> {
  // blob URL 可能已失效（被 LRU 回收），检查并重建
  if (src.startsWith('blob:')) {
    if (isBlobUrlAlive(src)) return src;
    // blob URL 已失效，通过 readPhotoFromDB 重建
    const blobId = photo.thumbBlobId ?? photo.previewBlobId ?? photo.originalBlobId ?? photo.blobId;
    if (blobId) {
      const rebuiltUrl = await readPhotoFromDB(blobId);
      if (rebuiltUrl) return rebuiltUrl;
    }
    // readPhotoFromDB 失败，尝试从文件系统读取
    if (photo.relativePath) {
      const fileBlobUrl = await readFileAsBlobUrl(photo.relativePath);
      if (fileBlobUrl) return fileBlobUrl;
    }
    // 所有重建方式失败，返回原 URL（fetch 会失败，但至少不会污染 Canvas）
    return src;
  }
  if (src.startsWith('data:')) return src;
  // 优先用 photo.relativePath 通过 fs 读取为 blob URL（最可靠，不受 CSP 限制）
  if (photo.relativePath) {
    const blobUrl = await readFileAsBlobUrl(photo.relativePath);
    if (blobUrl) return blobUrl;
  }
  // asset URL 回退：从 URL 反解析文件路径，再通过 fs 读取为 blob URL
  if (src.startsWith('asset:') || src.startsWith('http://asset.localhost/') || src.startsWith('https://asset.localhost/')) {
    try {
      const urlObj = new URL(src);
      let filePath = decodeURIComponent(urlObj.pathname);
      // Windows 路径可能带前导 /，如 /C:/Users/...，去掉前导斜杠
      if (filePath.length > 2 && filePath[0] === '/' && filePath[2] === ':') {
        filePath = filePath.slice(1);
      }
      const blobUrl = await readFileAsBlobUrl(filePath);
      if (blobUrl) return blobUrl;
    } catch {
      // 反解析失败，回退原 URL
    }
  }
  return src;
}

/**
 * 异步预加载页面所需的所有照片。
 * P1-3：优先用 createImageBitmap 加载（可主动 close() 释放），不支持/失败时回退 HTMLImageElement。
 * 返回 photoId → (HTMLImageElement | ImageBitmap) 映射，供 renderPageThumbnail 直接 drawImage 使用。
 *
 * 加载后位图归属调用方：渲染完即可立即释放（ImageBitmap.close()），避免常驻内存。
 * 网格视图 100+ 页 × 每页 N 张照片时，位图峰值内存从"全部常驻"降为"仅当前渲染中"。
 */
export async function preloadPagePhotos(
  page: AlbumPage,
  photos: Photo[],
): Promise<Map<string, HTMLImageElement | ImageBitmap>> {
  const photoMap = new Map(photos.map(p => [p.id, p]));
  const result = new Map<string, HTMLImageElement | ImageBitmap>();
  const { makeDirectPhotoUrl, readPhotoFromDB } = await import('../engine/storage-engine');
  const useBitmap = typeof createImageBitmap === 'function';

  const tasks = page.placements
    .filter(pl => pl.photoId)
    .map(async (pl) => {
      const photo = photoMap.get(pl.photoId!);
      if (!photo) return;
      try {
        const resolvedSrc = await resolveGridPhotoSrc(photo, makeDirectPhotoUrl, readPhotoFromDB);
        if (!resolvedSrc) return;
        // 关键：将可能跨域的 URL（如 Tauri asset://）转为同源 blob URL，
        // 避免 Canvas 2D 污染后 toDataURL 抛 SecurityError 导致网格/全屏视图空白
        let src = await ensureCanvasSafeUrl(resolvedSrc, photo);

        // P1-3：优先 ImageBitmap 路径（一次尝试，失败回退 HTMLImageElement 重试链）
        if (useBitmap) {
          try {
            // P0-fix CSP: data: URL 不能用 fetch（CSP connect-src 不允许 data: 协议）。
            //   data: URL → loadImage → createImageBitmap（绕过 fetch 的 CSP 限制）
            //   blob:/asset:/http(s): 仍用 fetch 获取 Blob。
            let bmp: ImageBitmap;
            if (src.startsWith('data:')) {
              const img = await loadImage(src);
              bmp = await createImageBitmap(img);
            } else {
              const blob = await fetch(src).then((r) => r.ok ? r.blob() : Promise.reject(new Error('fetch fail')));
              bmp = await createImageBitmap(blob);
            }
            if (bmp.width > 0) {
              result.set(pl.photoId!, bmp);
              return;
            }
            bmp.close();
          } catch {
            // 回退到 HTMLImageElement 重试链
          }
        }

        let img: HTMLImageElement | undefined;
        let attempts = 0;
        while (attempts < 2) {
          try {
            img = await loadImageLocal(src);
            break;
          } catch {
            attempts++;
            if (attempts >= 2) break;
            // 首次加载失败时尝试重新解析 URL（例如 blob URL 已过期）后再试一次
            const rebuiltResolved = await resolveGridPhotoSrc(photo, makeDirectPhotoUrl, readPhotoFromDB);
            if (!rebuiltResolved) break;
            const rebuiltSafe = await ensureCanvasSafeUrl(rebuiltResolved, photo);
            if (rebuiltSafe === src) break;
            src = rebuiltSafe;
          }
        }
        if (img && img.naturalWidth > 0) {
          result.set(pl.photoId!, img);
        }
      } catch {
        // 静默忽略加载失败，保持占位
      }
    });

  await Promise.all(tasks);
  return result;
}

/**
 * 预加载页面所需的所有贴纸图片。
 * 返回 blobId → (HTMLImageElement | ImageBitmap) 映射，供 drawPageToCanvas 绘制贴纸。
 * 与 preloadPagePhotos 类似，但贴纸图片通常较小且共享缓存（useStickerSrc 的 LRU）。
 */
export async function preloadStickers(
  page: AlbumPage,
): Promise<Map<string, HTMLImageElement | ImageBitmap>> {
  const result = new Map<string, HTMLImageElement | ImageBitmap>();
  const stickerElements = page.stickerElements || [];
  if (stickerElements.length === 0) return result;

  // 收集唯一 stickerId → blobId
  const blobIds = Array.from(new Set(
    stickerElements.map((s) => s.stickerId).filter((id) => !!id).map((id) => `sticker-blob-${id}`)
  ));

  const useBitmap = typeof createImageBitmap === 'function';
  const tasks = blobIds.map(async (blobId) => {
    try {
      const dataURL = await preloadStickerSrc(blobId);
      if (!dataURL) return;
      // P0-fix CSP: data: URL 不能用 fetch（CSP connect-src 不允许 data: 协议）。
      //   统一用 loadImage(dataURL) 加载（CSP img-src 允许 data:），再按需转 ImageBitmap。
      const img = await loadImage(dataURL);
      if (img.naturalWidth === 0) return;
      if (useBitmap) {
        try {
          const bmp = await createImageBitmap(img);
          if (bmp.width > 0) {
            result.set(blobId, bmp);
            return;
          }
          bmp.close();
        } catch {
          // 回退 HTMLImageElement（已加载的 img）
        }
      }
      result.set(blobId, img);
    } catch {
      // 静默忽略，贴纸渲染缺失不阻塞整体
    }
  });

  await Promise.all(tasks);
  return result;
}

/**
 * 释放 preloadStickers 返回的图像资源（与 releasePreloadedImages 类似）。
 */
export function releaseStickerImages(imgs: Map<string, HTMLImageElement | ImageBitmap>): void {
  for (const img of imgs.values()) {
    try {
      if (img instanceof ImageBitmap) img.close();
      else img.src = '';
    } catch { /* ignore */ }
    }
  imgs.clear();
}

/**
 * P1-3：主动释放 preloadPagePhotos 返回的图像资源。
 * ImageBitmap 调用 close() 立即释放位图内存；HTMLImageElement 置空 src 等 GC。
 * 在 PageCard/FullscreenView 渲染完 dataURL 后调用，避免位图常驻。
 */
export function releasePreloadedImages(imgs: Map<string, HTMLImageElement | ImageBitmap>): void {
  for (const img of imgs.values()) {
    try {
      if (img instanceof ImageBitmap) img.close();
      else img.src = '';
    } catch { /* ignore */ }
  }
  imgs.clear();
}

function isDarkBackground(hex: string): boolean {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 3 && normalized.length !== 6) return false;
  const expand = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  const r = parseInt(expand.slice(0, 2), 16) || 0;
  const g = parseInt(expand.slice(2, 4), 16) || 0;
  const b = parseInt(expand.slice(4, 6), 16) || 0;
  // 感知亮度
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}
