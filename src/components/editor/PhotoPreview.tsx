import { useEffect, useCallback, useState, useRef } from 'react';
import type { Photo } from '../../types';
import { readPhotoFromDB, readDirectPhoto } from '../../engine/storage-engine';
import { usePhotoSrc, preloadPhotoSrc } from '../../hooks/usePhotoSrc';
import { useWheel } from '../../hooks/useWheel';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

// ── 缩放/旋转常量 ──
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;          // 滚轮每格缩放步长
const DOUBLE_CLICK_ZOOM = 2;     // 双击切换的目标缩放
const ROTATION_STEP = 90;
const DRAG_THRESHOLD = 3;        // 拖拽阈值（px）

/* ── 照片大图组件：使用 preview 档（1200px），避免加载 4096px 原图导致内存暴涨 ──
 * transform / 鼠标交互透传到 img，避免嵌套 transform 容器导致的渲染问题。
 */
function PhotoFullImg({
  photo,
  imgStyle,
  onMouseDown,
  onDoubleClick,
}: {
  photo: Photo;
  imgStyle?: CSSProperties;
  onMouseDown?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement>(null);
  const [errorRetry, setErrorRetry] = useState(0);
  const [showBroken, setShowBroken] = useState(false);

  // P1-2 LOD：用 preview 档（1200px）替代直接 photo.src（可能是 4096px 原图）。
  // 单张 4K JPEG 解码位图 40-60MB，preview 档仅 ~10MB，连续翻看内存占用降 80%。
  const resolvedSrc = usePhotoSrc(photo, { level: 'preview' });

  // resolvedSrc 变化时重置重试状态
  useEffect(() => {
    setErrorRetry(0);
    setShowBroken(false);
  }, [resolvedSrc, photo.id]);

  const handleError = useCallback(async () => {
    if (errorRetry >= 1) { setShowBroken(true); return; }
    let rebuiltUrl: string | null = null;
    if (photo.storageMode === 'import') {
      const previewId = photo.previewBlobId || photo.blobId;
      if (previewId) rebuiltUrl = await readPhotoFromDB(previewId);
    } else if (photo.storageMode === 'direct' && photo.relativePath) {
      rebuiltUrl = await readDirectPhoto(photo.relativePath);
    }
    if (rebuiltUrl && imgRef.current) {
      imgRef.current.src = rebuiltUrl;
      setErrorRetry(1);
      setShowBroken(false);
    } else {
      setShowBroken(true);
    }
  }, [photo.storageMode, photo.previewBlobId, photo.blobId, photo.relativePath, errorRetry]);

  const handleRetryError = useCallback(() => { setShowBroken(true); }, []);

  if (!resolvedSrc) return null;

  if (showBroken) {
    return (
      <div className="w-[200px] h-[150px] flex items-center justify-center bg-[var(--color-gray-100)] rounded-[var(--radius-md)]">
        <div className="text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-[var(--color-gray-400)] mx-auto">
            <rect x="2" y="2" width="20" height="20" rx="2" strokeDasharray="2 2" />
            <circle cx="10" cy="9" r="1.5" fill="currentColor" stroke="none" />
            <path d="M3 18l6-6 3 3 4-4 5 7" strokeLinecap="round" />
            <line x1="4" y1="4" x2="20" y2="20" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="text-[11px] text-[var(--color-gray-500)] mt-1">{t('editor.photoPreview.loadFailed')}</p>
        </div>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={resolvedSrc}
      alt={photo.name}
      className="max-w-[90vw] max-h-[80vh] object-contain rounded-[var(--radius-md)] select-none"
      style={imgStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onError={errorRetry === 0 ? handleError : handleRetryError}
    />
  );
}

interface PhotoPreviewProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}

export function PhotoPreview({ photos, initialIndex, onClose }: PhotoPreviewProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoomState] = useState(1);
  const [pan, setPanState] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isPanning, setIsPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // 用 ref 镜像 zoom/pan，让 wheel/drag 处理函数稳定（避免快速连续事件读到旧 state）
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
    moved: false,
  });

  const current = photos[index];

  // 同步 state 与 ref 的稳定 setter
  const setZoom = useCallback((z: number) => {
    zoomRef.current = z;
    setZoomState(z);
  }, []);

  const setPan = useCallback((p: { x: number; y: number }) => {
    panRef.current = p;
    setPanState(p);
  }, []);

  // 切换照片时重置视图（缩放、平移、旋转）
  useEffect(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoomState(1);
    setPanState({ x: 0, y: 0 });
    setRotation(0);
  }, [index]);

  // ── 缩放核心：微信风格 ──
  // 放大时以鼠标位置为原点；缩小时以画面中心为原点。
  // 数学推导（transform-origin: center，等价于"图像中心 = 视口中心 + pan"）：
  //   new_pan = pan * r + d * (1 - r), 其中 r = new_zoom / old_zoom, d = 鼠标到视口中心的偏移
  const applyZoom = useCallback((delta: number, focalX?: number, focalY?: number) => {
    const z = zoomRef.current;
    const p = panRef.current;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(z + delta).toFixed(3)));
    if (newZoom === z) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setZoom(newZoom);
      return;
    }

    const isZoomIn = delta > 0;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    // 放大用鼠标位置作为原点；缩小用画面中心作为原点（微信风格）
    const fx = isZoomIn && focalX !== undefined ? focalX : cx;
    const fy = isZoomIn && focalY !== undefined ? focalY : cy;

    const dx = fx - cx;
    const dy = fy - cy;
    const r = newZoom / z;

    const newPan = newZoom <= MIN_ZOOM
      ? { x: 0, y: 0 }
      : { x: p.x * r + dx * (1 - r), y: p.y * r + dy * (1 - r) };

    setZoom(newZoom);
    setPan(newPan);
  }, [setZoom, setPan]);

  const zoomIn = useCallback(() => applyZoom(ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(-ZOOM_STEP), [applyZoom]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, [setZoom, setPan]);

  const rotateLeft = useCallback(() => {
    setRotation((r) => (r - ROTATION_STEP + 360) % 360);
  }, []);
  const rotateRight = useCallback(() => {
    setRotation((r) => (r + ROTATION_STEP) % 360);
  }, []);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(photos.length - 1, i + 1)), [photos.length]);

  // ── 键盘导航 + 快捷键 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { setIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'ArrowRight') { setIndex((i) => Math.min(photos.length - 1, i + 1)); return; }
      if (e.key === '+' || e.key === '=') { zoomIn(); return; }
      if (e.key === '-' || e.key === '_') { zoomOut(); return; }
      if (e.key === '0') { resetView(); return; }
      if (e.key === 'r' || e.key === 'R') { rotateRight(); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, photos.length, zoomIn, zoomOut, resetView, rotateRight]);

  // ── 锁 body 滚动 ──
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // ── P1-2 预加载相邻 ±2 张到 blobUrlCache ──
  // 用户按 → 键快速翻看时，相邻照片已在缓存中，切换零延迟。
  useEffect(() => {
    for (const i of [index - 2, index - 1, index + 1, index + 2]) {
      if (i >= 0 && i < photos.length && i !== index) {
        preloadPhotoSrc(photos[i], 'preview').catch(() => {});
      }
    }
  }, [index, photos]);

  // ── 滚轮缩放（非 passive，阻止默认滚动） ──
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const rect = containerRef.current?.getBoundingClientRect();
    const fx = rect ? e.clientX - rect.left : undefined;
    const fy = rect ? e.clientY - rect.top : undefined;
    applyZoom(delta, fx, fy);
  }, [applyZoom]);

  useWheel(containerRef, handleWheel);

  // ── 鼠标拖拽平移（仅放大时启用） ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || zoomRef.current <= MIN_ZOOM) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
      moved: false,
    };
    setIsPanning(true);
  }, []);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
      }
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    };
    const onUp = () => {
      dragRef.current.active = false;
      setIsPanning(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, setPan]);

  // ── 双击切换缩放（1x ↔ 2x，以双击点为原点） ──
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoomRef.current > MIN_ZOOM) {
      resetView();
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      const fx = rect ? e.clientX - rect.left : undefined;
      const fy = rect ? e.clientY - rect.top : undefined;
      applyZoom(DOUBLE_CLICK_ZOOM - 1, fx, fy);
    }
  }, [applyZoom, resetView]);

  // ── 点击背景关闭（拖拽过则不触发） ──
  const handleBackgroundClick = useCallback(() => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    onClose();
  }, [onClose]);

  if (!current) return null;

  const cursorStyle = zoom > MIN_ZOOM ? (isPanning ? 'grabbing' : 'grab') : 'default';
  const isReset = zoom === 1 && pan.x === 0 && pan.y === 0 && rotation === 0;

  // transform 直接应用到 img 元素，避免嵌套 transform 容器
  const imgStyle: CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
    transition: isPanning ? 'none' : 'transform 220ms cubic-bezier(0.2, 0, 0.2, 1)',
    transformOrigin: 'center center',
    willChange: 'transform',
    cursor: cursorStyle,
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black/90 select-none animate-[fadeIn_200ms_ease-out] overflow-hidden"
      onClick={handleBackgroundClick}
    >
      {/* ── 图片层：flex 居中，transform 直接在 img 上 ── */}
      <div className="absolute inset-0 flex items-center justify-center">
        <PhotoFullImg
          photo={current}
          imgStyle={imgStyle}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        />
      </div>

      {/* ── 关闭按钮：顶部居中（固定位置，不随图片变换） ── */}
      <button
        className="absolute top-6 left-1/2 -translate-x-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title={t('editor.photoPreview.close')}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
          <line x1="4" y1="4" x2="16" y2="16" />
          <line x1="16" y1="4" x2="4" y2="16" />
        </svg>
      </button>

      {/* ── 上一张：左侧垂直居中（固定位置） ── */}
      {index > 0 && (
        <button
          className="absolute left-5 top-1/2 -translate-y-1/2 w-36 h-36 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          title={t('editor.photoPreview.prev')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-18 h-18">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}

      {/* ── 下一张：右侧垂直居中（固定位置） ── */}
      {index < photos.length - 1 && (
        <button
          className="absolute right-5 top-1/2 -translate-y-1/2 w-36 h-36 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          title={t('editor.photoPreview.next')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-18 h-18">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* ── 底部工具栏：信息 + 缩放 + 旋转（固定位置） ── */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-2 rounded-full bg-black/50 backdrop-blur-[12px] border border-white/10 z-30 max-w-[calc(100vw-32px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 信息区 */}
        <div className="flex items-center gap-2 px-2 text-white/90 text-[12px] whitespace-nowrap">
          <span className="font-[500] truncate max-w-[140px]" title={current.name}>{current.name}</span>
          <span className="text-white/30">·</span>
          <span className="tabular-nums text-white/60">{current.width}×{current.height}</span>
          <span className="text-white/30">·</span>
          <span className="tabular-nums text-white/60">{index + 1}/{photos.length}</span>
        </div>

        <div className="w-px h-5 bg-white/15 mx-1" />

        {/* 缩小 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer disabled:cursor-default"
          onClick={(e) => { e.stopPropagation(); zoomOut(); }}
          title={t('editor.photoPreview.zoomOut')}
          disabled={zoom <= MIN_ZOOM}
          style={{ opacity: zoom <= MIN_ZOOM ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>

        {/* 缩放百分比 */}
        <span className="text-white/80 text-[11px] tabular-nums w-[42px] text-center select-none">
          {Math.round(zoom * 100)}%
        </span>

        {/* 放大 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer disabled:cursor-default"
          onClick={(e) => { e.stopPropagation(); zoomIn(); }}
          title={t('editor.photoPreview.zoomIn')}
          disabled={zoom >= MAX_ZOOM}
          style={{ opacity: zoom >= MAX_ZOOM ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <line x1="10" y1="4" x2="10" y2="16" />
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>

        {/* 重置视图 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer disabled:cursor-default"
          onClick={(e) => { e.stopPropagation(); resetView(); }}
          title={t('editor.photoPreview.reset')}
          disabled={isReset}
          style={{ opacity: isReset ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M3 10a7 7 0 1 1 2.5 5.4" />
            <path d="M3 4v6h6" />
          </svg>
        </button>

        <div className="w-px h-5 bg-white/15 mx-1" />

        {/* 向左旋转 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); rotateLeft(); }}
          title={t('editor.photoPreview.rotateLeft')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M3 10a7 7 0 1 1 2.5 5.4" />
            <path d="M3 4v6h6" />
          </svg>
        </button>

        {/* 向右旋转 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); rotateRight(); }}
          title={t('editor.photoPreview.rotateRight')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M17 10a7 7 0 1 0-2.5 5.4" />
            <path d="M17 4v6h-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
