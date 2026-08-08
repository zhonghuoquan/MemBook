/**
 * PhotoQuickView — 轻量照片预览模态框
 *
 * 用于照片整理工具（去重/归类/改EXIF/转换）中查看照片大图。
 * 不依赖 editor store，仅基于 PhotoFileInfo + readPhotoData 读取图片字节。
 *
 * UI 风格参考相册编辑模式 PhotoPreview.tsx：
 * - 关闭按钮：顶部居中（毛玻璃圆形）
 * - 翻页按钮：左右垂直居中（毛玻璃圆形，仅边界时隐藏）
 * - 底部工具栏：胶囊形，含信息区 + 缩放控件 + 旋转
 *
 * 交互：
 * - 键盘：← / → 翻页，Esc 关闭，+ / - 缩放，0 复位，R 旋转
 * - 鼠标：滚轮缩放，双击切换 1x/2x，拖拽平移
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoFileInfo } from '../../../photo-tools';
import { formatBytes } from '../../../photo-tools';

interface PhotoQuickViewProps {
  /** 当前组的所有照片 */
  photos: PhotoFileInfo[];
  /** 初始打开的照片索引 */
  initialIndex: number;
  /** 关闭回调 */
  onClose: () => void;
  /** 读取照片二进制（统一入口，屏蔽 Tauri/Web/库内差异） */
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 3;

export function PhotoQuickView({
  photos,
  initialIndex,
  onClose,
  readPhotoData,
}: PhotoQuickViewProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, photos.length - 1)));
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 缩放/位移/旋转
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [rotation, setRotation] = useState(0);

  // 拖拽状态
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // ── 性能优化：blob URL 缓存 + 预加载相邻照片 ──
  // 缓存 photo.id → objectUrl，切换时命中缓存秒切（无 loading 闪烁）
  // thumbUrl 不入缓存（由外部管理生命周期）
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  const photo = photos[index];
  const isReset = scale === 1 && tx === 0 && ty === 0 && rotation === 0;

  /** 获取照片 URL（带缓存，避免重复 IPC 读取 + 重复创建 Blob URL） */
  const getPhotoUrl = useCallback(async (p: PhotoFileInfo): Promise<string | null> => {
    // 优先用 thumbUrl（Web 模式有值，免重复读取，不入缓存）
    if (p.thumbUrl) return p.thumbUrl;
    // 查缓存
    const cached = urlCacheRef.current.get(p.id);
    if (cached) return cached;
    // 读取文件数据
    const buf = await readPhotoData(p);
    if (!buf) return null;
    // await 期间可能已被其他并发调用填充，再次检查避免重复创建
    const cached2 = urlCacheRef.current.get(p.id);
    if (cached2) return cached2;
    // 创建 Blob URL 并缓存
    const blob = new Blob([buf], { type: p.mimeType || 'image/jpeg' });
    const objectUrl = URL.createObjectURL(blob);
    urlCacheRef.current.set(p.id, objectUrl);
    return objectUrl;
  }, [readPhotoData]);

  // 加载当前图片
  useEffect(() => {
    let cancelled = false;

    // 查缓存，命中则秒切（不显示 loading，无闪烁）
    const cachedUrl = photo.thumbUrl ?? urlCacheRef.current.get(photo.id) ?? null;

    // 重置变换状态（每次切换都重置缩放/旋转）
    setScale(1);
    setTx(0);
    setTy(0);
    setRotation(0);

    if (cachedUrl) {
      setUrl(cachedUrl);
      setLoading(false);
      setError(null);
      return;
    }

    // 未命中缓存，显示 loading 异步加载
    setLoading(true);
    setError(null);
    setUrl(null);

    getPhotoUrl(photo)
      .then((u) => {
        if (cancelled) return;
        if (u) {
          setUrl(u);
          setLoading(false);
        } else {
          setError(t('home.organize.dedupe.previewLoadFail'));
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('home.organize.dedupe.previewLoadFail'));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [photo, getPhotoUrl, t]);

  // 预加载相邻照片（当前图加载完后，异步预读下一张/上一张，切换时直接命中缓存）
  useEffect(() => {
    const nextIdx = index + 1;
    const prevIdx = index - 1;
    for (const i of [nextIdx, prevIdx]) {
      if (i < 0 || i >= photos.length || i === index) continue;
      const p = photos[i];
      // 有 thumbUrl 或已在缓存中的跳过
      if (p.thumbUrl || urlCacheRef.current.has(p.id)) continue;
      // 异步预读，不阻塞 UI，错误静默
      getPhotoUrl(p).catch(() => {});
    }
  }, [index, photos, getPhotoUrl]);

  // 组件卸载时统一释放所有缓存的 blob URL（避免内存泄漏）
  useEffect(() => {
    return () => {
      urlCacheRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlCacheRef.current.clear();
    };
  }, []);

  // 翻页
  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => Math.min(photos.length - 1, i + 1));
  }, [photos.length]);

  // 缩放
  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s * 1.2));
  }, []);
  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, s / 1.2));
  }, []);
  const resetView = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setRotation(0);
  }, []);

  // 旋转
  const rotateLeft = useCallback(() => setRotation((r) => r - 90), []);
  const rotateRight = useCallback(() => setRotation((r) => r + 90), []);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' && index < photos.length - 1) {
        e.preventDefault();
        goNext();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateRight();
      }
    },
    [index, photos.length, onClose, goPrev, goNext, zoomIn, zoomOut, resetView, rotateRight],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    // 阻止背景滚动
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [handleKeyDown]);

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!url) return;
      const delta = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * delta)));
    },
    [url],
  );

  // 双击切换缩放
  const handleDoubleClick = useCallback(() => {
    if (scale > 1.5) {
      resetView();
    } else {
      setScale(2);
    }
  }, [scale, resetView]);

  // 拖拽平移
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return;
      draggingRef.current = true;
      dragMovedRef.current = false;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [scale],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragMovedRef.current = true;
      }
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      setTx((x) => x + dx);
      setTy((y) => y + dy);
    },
    [],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  // 点击背景关闭（拖拽过则不触发）
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      onClose();
    },
    [onClose],
  );

  // 图片 transform 样式（直接应用到 img，避免嵌套 transform 容器）
  const imgStyle: React.CSSProperties = {
    transform: `translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale})`,
    transition: draggingRef.current ? 'none' : 'transform 220ms cubic-bezier(0.2, 0, 0.2, 1)',
    transformOrigin: 'center center',
    willChange: 'transform',
    cursor: scale > 1 ? (draggingRef.current ? 'grabbing' : 'grab') : 'default',
  };

  // 拍摄日期格式化
  const dateStr = photo.dateTaken
    ? new Date(photo.dateTaken).toLocaleString()
    : null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 select-none animate-[fadeIn_200ms_ease-out] overflow-hidden"
      onClick={handleBackgroundClick}
      onWheel={handleWheel}
      role="dialog"
      aria-modal="true"
    >
      {/* ── 图片层：flex 居中，transform 直接在 img 上 ── */}
      {/* pointer-events-none 让点击穿透到背景遮罩（点击灰色区域可关闭），图片本身用 pointer-events-auto 恢复交互 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {loading && (
          <div className="text-white/60 text-sm flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
            {t('home.organize.dedupe.loading')}
          </div>
        )}
        {error && (
          <div className="text-red-400 text-sm">{error}</div>
        )}
        {url && !loading && !error && (
          <img
            src={url}
            alt={photo.name}
            className="max-w-[90vw] max-h-[80vh] object-contain rounded-[var(--radius-md)] select-none pointer-events-auto"
            style={imgStyle}
            draggable={false}
            onDoubleClick={handleDoubleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </div>

      {/* ── 关闭按钮：顶部居中（固定位置，不随图片变换） ── */}
      <button
        className="absolute top-6 left-1/2 -translate-x-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title={t('home.organize.dedupe.close') + ' (Esc)'}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
          <line x1="4" y1="4" x2="16" y2="16" />
          <line x1="16" y1="4" x2="4" y2="16" />
        </svg>
      </button>

      {/* ── 上一张：左侧垂直居中（固定位置） ── */}
      {index > 0 && (
        <button
          className="absolute left-5 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          title={t('home.organize.dedupe.prev')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}

      {/* ── 下一张：右侧垂直居中（固定位置） ── */}
      {index < photos.length - 1 && (
        <button
          className="absolute right-5 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-[8px] text-white/70 hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 z-30 border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          title={t('home.organize.dedupe.next')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* ── 底部工具栏：信息 + 缩放 + 旋转（胶囊形，固定位置） ── */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-2 rounded-full bg-black/50 backdrop-blur-[12px] border border-white/10 z-30 max-w-[calc(100vw-32px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 信息区 */}
        <div className="flex items-center gap-2 px-2 text-white/90 text-[12px] whitespace-nowrap">
          <span className="font-[500] truncate max-w-[160px]" title={photo.name}>{photo.name}</span>
          <span className="text-white/30">·</span>
          <span className="tabular-nums text-white/60">{formatBytes(photo.size)}</span>
          {dateStr && (
            <>
              <span className="text-white/30">·</span>
              <span className="tabular-nums text-white/60 truncate max-w-[180px]">{dateStr}</span>
            </>
          )}
          <span className="text-white/30">·</span>
          <span className="tabular-nums text-white/60">{index + 1}/{photos.length}</span>
        </div>

        <div className="w-px h-5 bg-white/15 mx-1" />

        {/* 缩小 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer disabled:cursor-default"
          onClick={(e) => { e.stopPropagation(); zoomOut(); }}
          title={t('home.organize.dedupe.zoomOut')}
          disabled={!url || scale <= MIN_SCALE}
          style={{ opacity: !url || scale <= MIN_SCALE ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>

        {/* 缩放百分比 */}
        <span className="text-white/80 text-[11px] tabular-nums w-[42px] text-center select-none">
          {Math.round(scale * 100)}%
        </span>

        {/* 放大 */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors border-none cursor-pointer disabled:cursor-default"
          onClick={(e) => { e.stopPropagation(); zoomIn(); }}
          title={t('home.organize.dedupe.zoomIn')}
          disabled={!url || scale >= MAX_SCALE}
          style={{ opacity: !url || scale >= MAX_SCALE ? 0.4 : 1 }}
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
          title={t('home.organize.dedupe.reset')}
          disabled={!url || isReset}
          style={{ opacity: !url || isReset ? 0.4 : 1 }}
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
          title={t('home.organize.dedupe.rotateLeft')}
          disabled={!url}
          style={{ opacity: !url ? 0.4 : 1 }}
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
          title={t('home.organize.dedupe.rotateRight')}
          disabled={!url}
          style={{ opacity: !url ? 0.4 : 1 }}
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
