/**
 * 照片渲染组件（滤镜/旋转/编辑模式 + 旋转图标）+ 拖拽预览组件
 * 从 Canvas.tsx 提取，共享模块级图像缓存
 */
import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Image as KonvaImage, Rect } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, useUIStore } from '../../../store';
import { calcCoverFitWithRotation, clampPhotoToSlotBounds } from '../../../utils/photoGeometry';
import { makeDirectPhotoUrl } from '../../../engine/storage-engine';
import { acquirePhotoUrl, releasePhotoUrl } from '../../../engine/storage/import-store';
import { usePhotoSrc } from '../../../hooks/usePhotoSrc';
import { DEFAULT_SLOT_CORNER_RADIUS } from '../../../types';
import type { PhotoPlacement, Photo } from '../../../types';
import { LRUCache } from '../../../utils/lruCache';
import { isImageBitmapSupported } from '../../../utils/imageBitmapLoader';
import { logger } from '../../../utils/logger';
import { getCachedContentInfo, ensurePhotoAnalyzed, computeSmartObjectPosition } from '../../../engine/content-aware';
import { consumePhotoJustPlaced, hasPhotoJustPlaced } from './photoJustPlaced';

// ── 模块级图像缓存：避免进入编辑模式时照片闪烁/漂移 ──
// 非编辑和编辑模式使用不同的 CanvasPhotoRenderer 实例，
// 切换时旧实例销毁、新实例创建，cachedImage(useRef) 丢失。
// 通过缓存共享已加载的图像，新实例可以立即使用。
//
// 改造为 LRU 缓存：限制 40 个条目，避免导入上千张照片时内存无限增长。
// 编辑器画布同时可见的照片数量有限（单页最多 8-12 张），40 足够覆盖当前页+相邻页。
//
// P1-3：缓存值类型扩展为 HTMLImageElement | ImageBitmap。
//   - 优先用 createImageBitmap 加载：可主动 close() 立即释放位图内存（HTMLImageElement.src=''
//     依赖 GC，时机不确定），且加载时即降采样（本场景用原尺寸，保留编辑清晰度）。
//   - 旧 WebView2 不支持 createImageBitmap 时回退到 HTMLImageElement。
//   - Konva.Image 接受 CanvasImageSource，两者均可直接传入。
type CachedImage = HTMLImageElement | ImageBitmap;
// P0-fix: 容量从 16 提升到 40（与注释一致）。
//   16 太小：编辑器画布单页 8-12 张照片 + 相邻页预加载 + 缩略图，
//   轻易超 16 条导致 LRU 淘汰正在使用的 ImageBitmap → evictImage close() 位图 →
//   组件 cachedImage.current 仍指向已 close 的位图 → Konva drawImage 报
//   "The image source is detached" 错误。
const IMAGE_CACHE_CAPACITY = 40;
function evictImage(_key: string, img: CachedImage) {
  // P0-fix: ImageBitmap 不再主动 close()。
  //   close() 会立即释放位图像素内存，但组件可能仍通过 cachedImage.current 引用该位图。
  //   Konva 在下一次 batchDraw 时尝试 drawImage(已 close 的 ImageBitmap) 会抛出
  //   InvalidStateError: "The image source is detached"。
  //   改为仅清理 HTMLImageElement.src（HTMLImageElement 无 detached 问题），
  //   ImageBitmap 交由 GC 回收（组件释放引用后自动回收）。
  //   内存影响：40 条缓存 + 少量已淘汰未回收位图，峰值可控。
  try {
    if (!(img instanceof ImageBitmap)) {
      img.src = '';
    }
  } catch { /* ignore */ }
}
export const imageCache = new LRUCache<string, CachedImage>(IMAGE_CACHE_CAPACITY, evictImage);

// ── 拖拽放置动效：抽到 photoJustPlaced.ts（零依赖），
// 被 useDragDrop（照片列表拖入槽位）与重排服务（pageLayoutService）共用。
export { markPhotoJustPlaced } from './photoJustPlaced';

/** 统一的图像就绪检查：HTMLImageElement 看 complete+naturalWidth，ImageBitmap 看 width
 *  P0-fix: ImageBitmap close() 后 width 返回 0，某些实现访问属性可能抛异常，用 try-catch 兜底 */
function isImageReady(img: CachedImage | null | undefined): img is CachedImage {
  if (!img) return false;
  try {
    if (img instanceof ImageBitmap) return img.width > 0;
    return img.complete && img.naturalWidth > 0;
  } catch { return false; }
}

/**
 * P1-3：优先用 createImageBitmap 加载（失败/不支持时回退到 HTMLImageElement）。
 * 返回的图像已存入 imageCache，调用方直接使用即可。
 */
/** 检测 Tauri asset 协议 URL（跨平台：Windows 用 http://asset.localhost，其他用 asset://） */
function isAssetUrl(src: string): boolean {
  return src.startsWith('asset://') || src.startsWith('http://asset.localhost') || src.startsWith('https://asset.localhost');
}

/** P0-fix: 从 asset:// URL 提取文件路径（逆向 convertFileSrc）
 *  必须与 ensureCanvasSafeUrl 的路径解析保持一致：
 *  Windows 路径去掉前导斜杠（/C:/... → C:/...），否则 readFile 会失败。 */
function assetUrlToPath(src: string): string | null {
  try {
    // Windows: http://asset.localhost/C:/path → C:/path
    if (src.startsWith('http://asset.localhost/') || src.startsWith('https://asset.localhost/')) {
      let path = decodeURIComponent(src.replace(/^https?:\/\/asset\.localhost\//, ''));
      // Windows 路径可能带前导 /，如 /C:/Users/...，去掉前导斜杠
      if (path.length > 2 && path[0] === '/' && path[2] === ':') {
        path = path.slice(1);
      }
      return path;
    }
    // Linux/macOS: asset://path → /path
    if (src.startsWith('asset://')) {
      return decodeURIComponent(src.replace(/^asset:\/\//, '/'));
    }
  } catch { /* ignore */ }
  return null;
}

async function loadCachedImage(src: string): Promise<CachedImage> {
  // 1. 优先 ImageBitmap（显式内存管理）
  if (isImageBitmapSupported()) {
    try {
      // P0-fix CSP: data: URL 不能用 fetch（CSP connect-src 不允许 data: 协议）。
      //   dataURL → Image.src 加载（CSP img-src 允许）→ createImageBitmap 转换。
      //   提前处理 data: URL，避免后续 fetch 触发 CSP 违规。
      if (src.startsWith('data:')) {
        const { loadImage } = await import('../../../utils/tauri');
        const img = await loadImage(src);
        const bmp = await createImageBitmap(img);
        imageCache.set(src, bmp);
        return bmp;
      }

      // P0-fix: asset:// URL 改用 readFile + createObjectURL，绕过 WebView2 的 HTTP 缓存
      //   和 decoded image cache。fetch(asset://) 会让 WebView2 缓存原文件解码位图
      //   （5000x3000 × 4 = 60MB/张），500 张累积 500MB-1GB，无法从 JS 侧清理。
      //   改用 readFile 读取文件字节 → new Blob → createObjectURL → createImageBitmap，
      //   blob URL 不进 HTTP 缓存，createImageBitmap 后立即 revoke blob URL 释放引用。
      let blob: Blob;
      let tempBlobUrl: string | null = null;
      try {
        if (isAssetUrl(src)) {
          const filePath = assetUrlToPath(src);
          if (filePath) {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(filePath);
            // 按文件扩展名推断 MIME，避免 PNG 被标记为 image/jpeg
            const ext = filePath.toLowerCase().split('.').pop() || '';
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
            blob = new Blob([bytes], { type: mimeMap[ext] || 'image/jpeg' });
            tempBlobUrl = URL.createObjectURL(blob);
          } else {
            blob = await fetch(src).then((r) => r.blob());
          }
        } else {
          blob = await fetch(src).then((r) => {
            if (!r.ok) throw new Error(`bitmap 加载失败: ${src.slice(0, 80)}`);
            return r.blob();
          });
        }
      } catch {
        // readFile 失败（非 Tauri 环境、文件被移动等），回退到 fetch
        blob = await fetch(src).then((r) => {
          if (!r.ok) throw new Error(`bitmap 加载失败: ${src.slice(0, 80)}`);
          return r.blob();
        });
      }

      // asset:// 原文件降采样到 1200px，避免 5000x3000 原图占 ~60MB 位图内存
      const opts: ImageBitmapOptions = isAssetUrl(src)
        ? { resizeWidth: 1200, resizeQuality: 'medium' }
        : {};
      const bmp = await createImageBitmap(blob, opts);

      // P0-fix: 立即 revoke 临时 blob URL，释放 blob 引用。
      //   createImageBitmap 已完成位图拷贝，不再需要 blob 数据。
      if (tempBlobUrl) {
        URL.revokeObjectURL(tempBlobUrl);
      }

      imageCache.set(src, bmp);
      return bmp;
    } catch {
      // 回退到 HTMLImageElement（例如某些 asset:// URL fetch 失败）
    }
  }
  // 2. 回退：HTMLImageElement
  const { loadImage } = await import('../../../utils/tauri');
  const img = await loadImage(src);
  imageCache.set(src, img);
  return img;
}

export function CanvasPhotoRenderer({
  placement,
  photo,
  slotW,
  slotH,
  isEditing,
  imageRef,
  coverFitRef,
  ignoreStoredPan,
  onUpdatePan: _onUpdatePan,
  onRotate90: _onRotate90,
  onFreeRotate: _onFreeRotate,
  onDragUpdate,
  onDragEndUpdate,
}: {
  placement?: PhotoPlacement;
  photo: Photo;
  slotW: number;
  slotH: number;
  isEditing?: boolean;
  /** 多选缩放预览时忽略存储的 panX/panY，使用默认居中位置确保照片铺满新槽位（提交时由 computePanForResizedSlot 计算最终值） */
  ignoreStoredPan?: boolean;
  imageRef?: React.MutableRefObject<Konva.Image | null>;
  coverFitRef?: React.MutableRefObject<{ w: number; h: number }>;
  onUpdatePan?: (slotId: string, panX: number, panY: number, panScale?: number) => void;
  onRotate90?: () => void;
  onFreeRotate?: (angle: number) => void;
  onDragUpdate?: () => void;
  onDragEndUpdate?: () => void;
}) {
  const internalRef = useRef<Konva.Image>(null);
  const cachedImage = useRef<CachedImage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const slotCornerRadius = useEditorStore((s) => s.pages[s.currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS);
  const adj = placement?.adjustments;
  const filterName = placement?.filter;
  const filterIntensity = placement?.filterIntensity ?? 100;
  const baseRotation = placement?.rotation || 0;     // 基础旋转（非编辑模式）
  const panRotation = placement?.panRotation;           // 编辑模式旋转偏移（面板/拖拽旋转）
  const totalRotation = panRotation ?? baseRotation;
  const hasRotation = Math.abs(totalRotation) > 0.01;
  const flipH = placement?.flipH ?? false;
  const flipV = placement?.flipV ?? false;
  const isComparingOriginal = useUIStore((s) => s.isComparingOriginal);

  // ── 照片 src 解析：使用 usePhotoSrc hook（与底部缩略图/全屏一致的多级回退）──
  // P0-fix: 之前直接用 photo.src + fetch()，在首次智能编排后画布空白：
  //   1. direct 模式 photo.src 可能是 asset://（Tauri）或已失效的 blob://
  //   2. import 模式 photo.src 可能是已被 releasePhotoUrl 回收的 blob://
  //   3. retrySrcRef 用 readDirectPhoto（FSA API）在 Tauri 下必然失败
  // usePhotoSrc 提供 photo.src → IndexedDB → 文件系统的完整回退链。
  const effectiveSrc = usePhotoSrc(photo, { level: 'preview' });

  // ── 加载失败时的 URL 重建（从 IndexedDB / 文件系统重建可用 URL）──
  const [errorRetry, setErrorRetry] = useState(0);
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const retrySrcRef = useRef<() => Promise<void>>(async () => {});
  // P0-fix: 记录 retry acquire 的 blobId，用于 retry URL 变化/组件卸载时配对 release。
  //   acquirePhotoUrl 会 pin 住 URL（refCount+1），不 release 则 URL 永远不被回收，
  //   LRU 无法淘汰 → blobUrlCache 60 条全被 pin → 内存泄漏。
  const acquiredBlobIdRef = useRef<string | null>(null);

  // P0-fix: 实际加载源 = retry 重建的 URL || usePhotoSrc 解析的 URL
  const loadSrc = retrySrc || effectiveSrc;

  // P0-fix: retry 逻辑修复——之前 direct 模式用 readDirectPhoto（FSA API）在 Tauri 下
  //   必然返回 null（无 directoryHandle），导致重试失败、画布永久空白。
  //   修复：优先从 IndexedDB 获取 blob URL（最可靠，fetch 必定成功），
  //         direct 模式回退到 makeDirectPhotoUrl（Tauri 下 convertFileSrc → asset 协议）。
  //   移除 2 次重试上限，改为 5 次，给多级回退足够机会。
  retrySrcRef.current = async () => {
    if (errorRetry >= 5) return; // 最多重试5次
    let rebuiltUrl: string | null = null;
    let newAcquiredBlobId: string | null = null;
    try {
      // 策略1：两种模式都先尝试从 IndexedDB 获取 blob URL（最可靠）
      const previewId = photo.previewBlobId || photo.originalBlobId || photo.blobId;
      if (previewId) {
        rebuiltUrl = await acquirePhotoUrl(previewId);
        if (rebuiltUrl) newAcquiredBlobId = previewId;
      }
      // 策略2：direct 模式无 IDB blob 或读取失败，回退到 asset 协议
      if (!rebuiltUrl && photo.storageMode === 'direct') {
        rebuiltUrl = await makeDirectPhotoUrl(photo);
      }
    } catch (err) {
      logger.warn(`[CanvasPhotoRenderer] retry 重建 URL 失败 (retry=${errorRetry}):`, err);
    }
    if (rebuiltUrl && rebuiltUrl !== loadSrc) {
      // P0-fix: release 上一次 acquire 的 blobId（若有），避免引用计数失衡
      if (acquiredBlobIdRef.current) {
        releasePhotoUrl(acquiredBlobIdRef.current);
      }
      acquiredBlobIdRef.current = newAcquiredBlobId;
      setErrorRetry((prev) => prev + 1);
      setRetrySrc(rebuiltUrl); // 触发 Konva Image 重载
      setLoaded(false);
    } else {
      // acquire 失败或 URL 未变化，release 刚 acquire 的（若有）
      if (newAcquiredBlobId) releasePhotoUrl(newAcquiredBlobId);
      logger.warn(`[CanvasPhotoRenderer] retry 无法重建有效 URL (retry=${errorRetry}, photo=${photo.id}, src=${loadSrc?.slice(0, 60)})`);
    }
  };

  // photo 变化时重置 retry 状态，并 release 上一次 acquire 的 blobId
  useEffect(() => {
    if (acquiredBlobIdRef.current) {
      releasePhotoUrl(acquiredBlobIdRef.current);
      acquiredBlobIdRef.current = null;
    }
    setErrorRetry(0);
    setRetrySrc(null);
  }, [photo.id, effectiveSrc]);

  // 阶段4-2 主体感知：photo 变化时触发内容分析，结果写入 photoContentCache
  // P0-fix: 之前是 fire-and-forget，分析完成后 React 不知道 → 永远居中
  //   现在 await 后 setState 触发重渲染，让智能偏移在分析完成后立即生效
  // P1-fix: 放宽触发条件——不仅人脸检测（hasFaces），能量分析（source='energy'）
  //   也能产生有效焦点。只要 focusX/Y 偏离中心就触发重渲染
  const [contentVersion, setContentVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    ensurePhotoAnalyzed(photo).then((info) => {
      if (cancelled || !info) return;
      // 焦点偏离中心时触发重渲染（涵盖人脸检测和能量分析两种来源）
      if (Math.abs(info.focusX - 0.5) > 0.02 || Math.abs(info.focusY - 0.5) > 0.02) {
        setContentVersion((v) => v + 1);
      }
    });
    return () => { cancelled = true; };
  }, [photo.id, photo.width, photo.height]);

  // P0-fix: 组件卸载时 release acquire 的 blobId，避免内存泄漏
  useEffect(() => {
    return () => {
      if (acquiredBlobIdRef.current) {
        releasePhotoUrl(acquiredBlobIdRef.current);
        acquiredBlobIdRef.current = null;
      }
    };
  }, []);

  // ── 计算旋转后的 cover-fit 参数 ──
  const valid = photo.width > 0 && photo.height > 0;

  const coverFitResult = valid
    ? calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, totalRotation)
    : { imgW: slotW, imgH: slotH, boundingW: slotW, boundingH: slotH, scale: 1 };
  // 同步更新 coverFitRef（确保 boundBoxFunc 缩放下限始终有效）
  if (coverFitRef && valid) {
    coverFitRef.current = { w: coverFitResult.boundingW, h: coverFitResult.boundingH };
  }

  // 兜底：防止之前写入的 NaN/Infinity 把照片渲染坏
  const rawPanScale = placement?.panScale;
  const rawPanX = placement?.panX;
  const rawPanY = placement?.panY;
  const panScale = rawPanScale !== undefined && Number.isFinite(rawPanScale) ? Math.max(rawPanScale, 1) : 1;

  // 照片渲染尺寸（原始尺寸 × coverScale × panScale）
  const imgW = coverFitResult.imgW * panScale;
  const imgH = coverFitResult.imgH * panScale;

  // 旋转后的可见边界尺寸
  const boundingW = coverFitResult.boundingW * panScale;
  const boundingH = coverFitResult.boundingH * panScale;

  // 照片位置：编辑或手动调整后使用存储值，否则按主体感知或居中
  // 阶段4-2 主体感知：无手动 pan 且无旋转时，若缓存中存在人脸焦点，按焦点对齐槽位中心
  // P0-fix: 引用 contentVersion 让分析完成后（setContentVersion）触发 defaultPx/Py 重算
  const useSmartPosition =
    !hasRotation &&
    rawPanX === undefined &&
    rawPanY === undefined &&
    panScale === 1;
  let defaultPx: number;
  let defaultPy: number;
  if (useSmartPosition) {
    // contentVersion 变化时重新读取缓存（分析完成后触发）
    void contentVersion;
    const info = getCachedContentInfo(photo.id);
    // P1-fix: 接受人脸检测和能量分析两种来源，只要焦点偏离中心即启用智能定位
    if (info &&
        (Math.abs(info.focusX - 0.5) > 0.02 || Math.abs(info.focusY - 0.5) > 0.02)) {
      // 主体感知：基于焦点计算偏移（cover-fit 后的照片坐标系）
      const smart = computeSmartObjectPosition(photo.width, photo.height, slotW, slotH, info);
      // smart.offsetX/Y 是相对槽位左上角的偏移，照片边界左上角 = smart 偏移
      // boundingW = imgW (panScale=1, 无旋转)，需对齐到边界左上角
      defaultPx = Math.round(smart.offsetX);
      defaultPy = Math.round(smart.offsetY);
    } else {
      defaultPx = Math.round((slotW - boundingW) / 2);
      defaultPy = Math.round((slotH - boundingH) / 2);
    }
  } else {
    defaultPx = Math.round((slotW - boundingW) / 2);
    defaultPy = Math.round((slotH - boundingH) / 2);
  }
  // 多选缩放预览时忽略存储的 panX/panY，使用默认居中位置确保照片铺满新槽位
  // 提交时由 computePanForResizedSlot 计算最终正确的 pan 值
  const px = (!ignoreStoredPan && rawPanX !== undefined && Number.isFinite(rawPanX)) ? rawPanX : defaultPx;
  const py = (!ignoreStoredPan && rawPanY !== undefined && Number.isFinite(rawPanY)) ? rawPanY : defaultPy;

  // ── Konva Image 定位 ──
  // 无旋转/无翻转：offset=(0,0)，x/y=可见边界左上角
  // 有旋转或翻转：以中心为轴，offset=(imgW/2, imgH/2)
  const centerAligned = hasRotation || flipH || flipV;
  // 仅旋转/水平翻转时改变 X 轴原点，仅旋转/垂直翻转时改变 Y 轴原点
  const offsetX = hasRotation || flipH ? imgW / 2 : 0;
  const offsetY = hasRotation || flipV ? imgH / 2 : 0;
  const imgX = hasRotation ? (px + boundingW / 2) : flipH ? (px + imgW / 2) : px;
  const imgY = hasRotation ? (py + boundingH / 2) : flipV ? (py + imgH / 2) : py;

  // ── 拖拽约束：用 onDragMove 手动 clamp（比 dragBoundFunc 更可靠）──
  const clampPos = useCallback((pos: { x: number; y: number }) => {
    let topLeftX: number, topLeftY: number;
    if (centerAligned) {
      topLeftX = pos.x - boundingW / 2;
      topLeftY = pos.y - boundingH / 2;
    } else {
      topLeftX = pos.x;
      topLeftY = pos.y;
    }
    const clamped = clampPhotoToSlotBounds(
      photo.width, photo.height, slotW, slotH, totalRotation, panScale,
      topLeftX, topLeftY
    );
    if (centerAligned) {
      return { x: clamped.panX + boundingW / 2, y: clamped.panY + boundingH / 2 };
    }
    return { x: clamped.panX, y: clamped.panY };
  }, [photo.width, photo.height, slotW, slotH, totalRotation, panScale, boundingW, boundingH, centerAligned]);

  // ── 拖拽结束：存储可见边界左上角（panX/panY）──
  const handlePhotoDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (!placement?.slotId) return;
    const { currentPageIndex } = useEditorStore.getState();
    const ps = placement && placement.panScale !== undefined && Number.isFinite(placement.panScale) ? Math.max(placement.panScale, 1) : 1;
    let pxVal: number, pyVal: number;
    if (centerAligned) {
      pxVal = e.target.x() - boundingW / 2;
      pyVal = e.target.y() - boundingH / 2;
    } else {
      pxVal = e.target.x();
      pyVal = e.target.y();
    }
    const clamped = clampPhotoToSlotBounds(
      photo.width, photo.height, slotW, slotH, totalRotation, ps,
      pxVal, pyVal
    );
    useEditorStore.getState().updatePlacementPan(currentPageIndex, placement.slotId, clamped.panX, clamped.panY, ps, true);
    onDragEndUpdate?.();
  }, [placement?.slotId, placement?.panScale, photo.width, photo.height, slotW, slotH, totalRotation, boundingW, boundingH, centerAligned, onDragEndUpdate]);

  // ── 加载照片图像（使用模块级缓存，消除模式切换时的闪烁）──
  // P1-3：优先用 ImageBitmap（可 close() 释放），失败回退 HTMLImageElement。
  useEffect(() => {
    if (!loadSrc) {
      // P0-fix: loadSrc 变为空时清除旧位图引用，避免 KonvaImage 渲染已失效的 ImageBitmap
      cachedImage.current = null;
      setLoaded(false);
      return;
    }

    // 检查缓存：如果已有相同 URL 的已加载图像，直接使用
    const cached = imageCache.get(loadSrc);
    if (isImageReady(cached)) {
      cachedImage.current = cached;
      setLoaded(true);
      if (internalRef.current) {
        internalRef.current.image(cached);
        internalRef.current.getLayer()?.batchDraw();
      }
      return;
    }

    // P0-fix: 缓存 miss 时立即清除旧位图引用。
    //   loadSrc 变化（如 P2 后台任务更新 photo.src，或编排返回后 imageCache 被清空）时，
    //   cachedImage.current 可能仍指向已 close/失效的旧 ImageBitmap。
    //   KonvaImage 的 image={cachedImage.current} 会继续渲染已 close 的位图 → 黑块/空白。
    //   清除后 KonvaImage image=null，异步加载完成后再设置新位图。
    cachedImage.current = null;
    let cancelled = false;
    setLoaded(false);
    loadCachedImage(loadSrc)
      .then((img) => {
        if (cancelled) return;
        // P0-fix: 并发加载同一 src 时，后完成的 loadCachedImage 可能已覆盖缓存，
        //   先完成的返回值可能已被 LRU 淘汰 close()。校验 isImageReady 防止黑块。
        if (!isImageReady(img)) {
          // 位图已失效，从缓存重新取（可能是另一个并发加载的结果）
          const rechecked = imageCache.get(loadSrc);
          if (isImageReady(rechecked)) {
            cachedImage.current = rechecked;
          } else {
            // 缓存中也无有效位图，触发重试从 IndexedDB/文件系统重建
            setLoaded(false);
            retrySrcRef.current();
            return;
          }
        } else {
          cachedImage.current = img;
        }
        setLoaded(true);
        if (internalRef.current) {
          internalRef.current.image(cachedImage.current);
          internalRef.current.getLayer()?.batchDraw();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(false);
          retrySrcRef.current();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadSrc]);

  useEffect(() => {
    const node = internalRef.current;
    if (!node || !loaded) return;
    // 按住查看原图时，跳过所有滤镜
    if (isComparingOriginal) {
      if (node.isCached()) { node.clearCache(); node.filters([]); }
      node.filters([]);
      node.opacity(1);
      node.getLayer()?.batchDraw();
      return;
    }

    // ── 1. 合并参数：调整 + 滤镜 = 最终滤镜数值（避免同类型覆盖）──
    let b = 0, e = 0, h = 0, s = 1, sepVal = -1;
    let needGray = false;

    if (adj) {
      const totalBrig = (adj.exposure || 0) + (adj.brightness || 0);
      if (Math.abs(totalBrig) > 0.01) b += totalBrig / 100;
      if (Math.abs(adj.contrast || 0) > 0.01) e += (adj.contrast || 0) / 100;
      h += (adj.temperature || 0) / 100 * 0.3; // 色温→色相偏移
      s *= 1 + (adj.saturation || 0) / 100;
    }

    // 滤镜贡献（累加到已有参数，而非覆盖）
    const FILTER_PARAMS: Record<string, { b?: number; e?: number; h?: number; s?: number; sep?: number; gray?: boolean }> = {
      '暖阳': { b: 0.05, s: 1.2, sep: 0.3 },
      '复古': { b: -0.05, s: 1.1, sep: 0.4 },
      '黑白': { b: 0.05, gray: true },
      '清新': { b: 0.08, e: -0.05, s: 1.1 },
      '胶片': { b: -0.1, e: 0.1, sep: 0.2 },
      '日系': { b: 0.12, h: -0.05, s: 0.85 },
      '电影': { b: -0.15, e: 0.2, s: 1.3 },
    };
    if (filterName && FILTER_PARAMS[filterName]) {
      const fp = FILTER_PARAMS[filterName];
      if (fp.b !== undefined) b += fp.b;
      if (fp.e !== undefined) e += fp.e;
      if (fp.h !== undefined) h += fp.h;
      if (fp.s !== undefined) s *= fp.s;
      if (fp.sep !== undefined) sepVal = fp.sep;
      if (fp.gray) needGray = true;
    }

    // ── 2. 构建唯一 filter 列表 ──
    const filters: any[] = [];
    if (Math.abs(b) > 0.001) filters.push(Konva.Filters.Brighten);
    if (Math.abs(e) > 0.001) filters.push(Konva.Filters.Enhance);
    if (Math.abs(h) > 0.001 || Math.abs(s - 1) > 0.001) filters.push(Konva.Filters.HSL);
    if (sepVal >= 0) filters.push(Konva.Filters.Sepia);
    if (needGray) filters.push(Konva.Filters.Grayscale);

    // ── 3. 滤镜强度：通过透明度降低滤镜效果（会露出白色背景，V2 改进为双节点叠加）──
    if (filterName && filterName !== '原图') {
      node.opacity(filterIntensity / 100);
    } else {
      node.opacity(1);
    }

    if (filters.length > 0) {
      if (node.isCached()) node.clearCache();
      node.filters(filters); // ← 先绑定 filter 实例
      // filter 参数 setter 必须在 node.filters() 之后调用才生效
      if (Math.abs(b) > 0.001) node.brightness(b);
      if (Math.abs(e) > 0.001) node.enhance(e);
      if (Math.abs(h) > 0.001 || Math.abs(s - 1) > 0.001) { node.hue(h); node.saturation(s); }
      if (sepVal >= 0) node.value(sepVal);
      node.cache();           // ← 最后缓存
    } else if (node.isCached()) {
      node.clearCache();
      node.filters([]);
    } else {
      node.filters([]);
    }
    node.getLayer()?.batchDraw();
  }, [loaded, adj, filterName, filterIntensity, slotW, slotH, isComparingOriginal]);

  // ── 拖拽放置入场动效（Q弹弹簧效果）──
  // 仅在拖拽 drop 后触发（由 useDragDrop 调用 markPhotoJustPlaced 标记）。
  //
  // 关键设计要点：
  //   1. 用 useLayoutEffect（非 useEffect）：在浏览器 paint 前同步设置 opacity(0)，
  //      避免照片先显示一帧再消失的"爆闪"现象。
  //   2. 临时设置 offset 为 (imgW/2, imgH/2) 实现中心缩放：
  //      无旋转时原 offset=0（左上角缩放），动画期间临时改为中心。
  //   3. 用 BackEaseOut 缓动 + 起始 scale 0.7 实现 Q弹效果。
  //   4. P0-fix: 动画结束后必须重置 imperative 值到 react-konva prop 值！
  //      react-konva 用 prop 缓存决定是否更新节点。如果 imperative 值与 prop 不同步，
  //      后续 prop 变化时 react-konva 只更新变化的 prop，未变化的 prop 不更新，
  //      导致 offsetX/x 不匹配 → 照片位置偏移（编辑后显示不一致的根因）。
  //      用 propValuesRef 跟踪最新 prop 值，在 onFinish 和 cleanup 中重置。
  //   5. P1-fix: 动画启动前等待内容分析完成（最多 200ms），避免智能定位在动画
  //      中途改变 imgX/imgY prop → offset 与 x/y 不同步 → 偏移抖动。
  //      - 缓存命中：立即启动动画（0ms 延迟）
  //      - 缓存未命中：opacity=0 等待分析，完成后用最终位置启动动画
  //        （能量分析 ~5-12ms，face-api ~50-200ms，200ms 超时兜底）
  const propValuesRef = useRef({ offsetX, offsetY, imgX, imgY });
  propValuesRef.current = { offsetX, offsetY, imgX, imgY };
  // P1-fix: cleanupRef 存放动画清理函数，供 useLayoutEffect 返回的 cleanup 调用
  const cleanupRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (!loaded || !placement?.slotId) return;
    const key = `${placement.slotId}-${photo.id}`;
    if (!hasPhotoJustPlaced(placement.slotId, photo.id)) return;

    const node = internalRef.current;
    if (!node) return;

    const targetOpacity = filterName && filterName !== '原图' ? filterIntensity / 100 : 1;
    const targetScaleX = flipH ? -1 : 1;
    const targetScaleY = flipV ? -1 : 1;
    const startScale = 0.7;

    /** 重置 imperative 值到最新 react-konva prop 值，确保 prop 同步 */
    const resetToProps = () => {
      const { offsetX: ox, offsetY: oy, imgX: ix, imgY: iy } = propValuesRef.current;
      node.offsetX(ox);
      node.offsetY(oy);
      node.x(ix);
      node.y(iy);
      node.scaleX(targetScaleX);
      node.scaleY(targetScaleY);
      node.opacity(targetOpacity);
      node.getLayer()?.batchDraw();
    };

    /** 启动 Q弹入场动画（使用当前最新 prop 值作为目标位置） */
    const playAnimation = () => {
      // 读取最新 prop 值（可能在等待分析期间已更新为智能定位值）
      const { offsetX: propOffsetX, offsetY: propOffsetY, imgX: propImgX, imgY: propImgY } = propValuesRef.current;

      // 设置中心缩放：offset 改为 (imgW/2, imgH/2)，x/y 相应调整保持位置不变
      const cx = propImgX - propOffsetX + imgW / 2;
      const cy = propImgY - propOffsetY + imgH / 2;
      node.offsetX(imgW / 2);
      node.offsetY(imgH / 2);
      node.x(cx);
      node.y(cy);

      // 初始状态：透明 + 缩小
      node.opacity(0);
      node.scaleX(targetScaleX * startScale);
      node.scaleY(targetScaleY * startScale);
      node.getLayer()?.batchDraw();

      const tween = new Konva.Tween({
        node,
        duration: 0.4,
        opacity: targetOpacity,
        scaleX: targetScaleX,
        scaleY: targetScaleY,
        easing: Konva.Easings.BackEaseOut,
        onFinish: () => {
          consumePhotoJustPlaced(key);
          resetToProps();
        },
      });
      tween.play();

      cleanupRef.current = () => {
        tween.destroy();
        resetToProps();
      };
    };

    // P1-fix: 检查内容分析是否已完成（缓存命中 → 立即启动动画）
    const info = getCachedContentInfo(photo.id);
    if (info || !useSmartPosition) {
      // 已缓存或无需智能定位 → 立即启动
      playAnimation();
    } else {
      // 缓存未命中：先设为透明（避免爆闪），等待分析完成后再启动
      node.opacity(0);
      node.getLayer()?.batchDraw();

      let done = false;
      const onReady = () => {
        if (done) return;
        done = true;
        // 读取最新 prop（分析完成后 setContentVersion 触发重渲染，prop 已更新）
        // 用 requestAnimationFrame 确保 React 已完成 DOM 提交
        requestAnimationFrame(() => {
          if (done) playAnimation();
        });
      };

      // 等待分析完成（共享同一 Promise，不会重复触发分析）
      ensurePhotoAnalyzed(photo).then(onReady);
      // 200ms 超时兜底：分析太慢时直接启动（用居中位置）
      const timeout = setTimeout(onReady, 200);

      cleanupRef.current = () => {
        done = true;
        clearTimeout(timeout);
        resetToProps();
      };
    }

    return () => {
      cleanupRef.current();
    };
  }, [photo.id, loaded, placement?.slotId, filterName, filterIntensity, flipH, flipV, imgW, imgH, useSmartPosition]);



  // coverFitRef 已在渲染阶段同步更新（见上方），此处无需重复

  // ── 晕影效果：叠加径向渐变 Rect ──
  const vignetteOpacity = ((adj?.vignette || 0) / 100) * 0.6; // 最大值 0.6 不透明度
  const vignetteGradKey = `vig-${slotW.toFixed(0)}-${slotH.toFixed(0)}-${(adj?.vignette || 0).toFixed(0)}`;

  // P0-fix: 渲染前校验位图是否仍可用，避免向 Konva 传入已 detached 的 ImageBitmap
  //   （close 后的 ImageBitmap drawImage 会抛 InvalidStateError）
  const safeRenderImage = isImageReady(cachedImage.current) ? cachedImage.current : null;

  return (
    <>
      <KonvaImage
        ref={(node) => {
          internalRef.current = node;
          if (imageRef) imageRef.current = node;
          if (coverFitRef) {
            coverFitRef.current = { w: coverFitResult.boundingW, h: coverFitResult.boundingH };
          }
          if (node && isImageReady(cachedImage.current)) {
            node.image(cachedImage.current);
          }
        }}
        image={safeRenderImage as CanvasImageSource}
        x={imgX}
        y={imgY}
        width={imgW}
        height={imgH}
        offsetX={offsetX}
        offsetY={offsetY}
        rotation={totalRotation}
        scaleX={flipH ? -1 : 1}
        scaleY={flipV ? -1 : 1}
        cornerRadius={isEditing ? 0 : slotCornerRadius}
        draggable={isEditing}
        onDragMove={isEditing ? (e: Konva.KonvaEventObject<DragEvent>) => {
          const np = clampPos({ x: e.target.x(), y: e.target.y() });
          e.target.x(np.x);
          e.target.y(np.y);
          onDragUpdate?.();
        } : undefined}
        onDragEnd={isEditing ? handlePhotoDragEnd : undefined}
        name="editableImage"
      />
      {/* 晕影覆盖层：仅在非编辑模式且 vignette > 0 时显示 */}
      {!isEditing && !isComparingOriginal && vignetteOpacity > 0.01 && (
        <Rect
          x={0} y={0} width={slotW} height={slotH}
          listening={false}
          fillRadialGradientStartPoint={{ x: slotW / 2, y: slotH / 2 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndPoint={{ x: slotW / 2, y: slotH / 2 }}
          fillRadialGradientEndRadius={Math.max(slotW, slotH) * 0.75}
          fillRadialGradientColorStops={[
            0, 'rgba(0,0,0,0)',
            0.5, `rgba(0,0,0,0)`,
            1, `rgba(0,0,0,${vignetteOpacity})`,
          ]}
          cornerRadius={slotCornerRadius}
          key={vignetteGradKey}
        />
      )}
    </>
  );
}

/* ── 拖拽槽位预览组件：加载照片并以 cover-fit 填满槽位 ── */
export function DragPreviewPhoto({ photo, slotW, slotH }: { photo: Photo; slotW: number; slotH: number }) {
  const imgRef = useRef<CachedImage | null>(null);
  const [loaded, setLoaded] = useState(false);
  // P0-fix: 使用 usePhotoSrc 替代直接 photo.src，与 CanvasPhotoRenderer 一致
  const dragSrc = usePhotoSrc(photo, { level: 'preview' });

  useEffect(() => {
    if (!dragSrc) return;
    let cancelled = false;
    // 优先使用缓存
    const cached = imageCache.get(dragSrc);
    if (isImageReady(cached)) {
      imgRef.current = cached;
      setLoaded(true);
      return;
    }
    loadCachedImage(dragSrc)
      .then((img) => {
        if (cancelled) return;
        imgRef.current = img;
        setLoaded(true);
      })
      .catch(() => { /* 静默忽略，保持占位 */ });
    return () => { cancelled = true; };
  }, [dragSrc]);

  if (!loaded || photo.width <= 0 || photo.height <= 0) return null;

  const cv = calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, 0);
  return (
    <KonvaImage
      image={imgRef.current as CanvasImageSource}
      x={Math.round((slotW - cv.boundingW) / 2)}
      y={Math.round((slotH - cv.boundingH) / 2)}
      width={Math.round(cv.boundingW)}
      height={Math.round(cv.boundingH)}
      cornerRadius={(() => { const es = useEditorStore.getState(); return es.pages[es.currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS; })()}
      listening={false}
    />
  );
}
