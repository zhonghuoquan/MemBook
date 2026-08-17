import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore, usePhotoStore } from '../../store';
import { renderPageThumbnail, preloadPagePhotos, preloadStickers, invalidateFullscreenThumbnail, releasePreloadedImages, releaseStickerImages, getCachedThumbnailUrl, loadBackgroundBitmap } from '../../utils/gridThumbnailRenderer';
import { useWheel } from '../../hooks/useWheel';
import { logger } from '../../utils/logger';
import { safeUnlisten } from '../../utils/tauri';
import { useTranslation } from 'react-i18next';
import type { AlbumPage, Photo } from '../../types';

interface FullscreenViewProps {
  open: boolean;
  onClose: () => void;
  initialPageIndex?: number;
  /** 可选：外部传入要展示的页面（主页相册卡片入口）。不传时回退到编辑器 store */
  pages?: AlbumPage[];
  /** 可选：相册尺寸（mm）。不传时回退到编辑器 store */
  albumSize?: { width: number; height: number } | null;
  /** 可选：照片列表。不传时回退到全局照片 store */
  photos?: Photo[];
}

const MIN_ZOOM = 100;
const MAX_ZOOM = 300;
const ZOOM_STEP = 10;
const BASE_RENDER_WIDTH = 1600; // 高清渲染基准宽度
const MAX_RENDER_WIDTH = 2400; // 限制最大渲染宽度，避免内存爆炸

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function FullscreenView({ open, onClose, initialPageIndex = 0, pages: pagesProp, albumSize: albumSizeProp, photos: photosProp }: FullscreenViewProps) {
  const { t } = useTranslation();
  const storePages = useEditorStore((s) => s.pages);
  const storeAlbumSize = useEditorStore((s) => s.albumSize);
  const storePhotos = usePhotoStore((s) => s.photos);
  // 外部传入优先（主页卡片入口），否则回退编辑器 store（编辑器内入口）
  const pages = pagesProp ?? storePages;
  const albumSize = albumSizeProp !== undefined ? albumSizeProp : storeAlbumSize;
  const photos = photosProp ?? storePhotos;

  const [pageIndex, setPageIndex] = useState(initialPageIndex);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverZone, setHoverZone] = useState<'left' | 'right' | null>(null);
  const [navVisible, setNavVisible] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [editPageValue, setEditPageValue] = useState('');
  const pageInputRef = useRef<HTMLInputElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const renderRef = useRef(0);
  const wasMaximizedRef = useRef(false);
  const wasMinimizedRef = useRef(false);
  const savedBoundsRef = useRef<{ width: number; height: number } | null>(null);
  const savedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteringRef = useRef(false);
  const manualFullscreenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const page = pages[pageIndex] ?? null;
  const total = pages.length;

  // 打开时同步初始页码并重置视图状态
  useEffect(() => {
    if (open) {
      setPageIndex(Math.max(0, Math.min(initialPageIndex, total - 1)));
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      setDirection('next');
      setHoverZone(null);
    }
  }, [open, initialPageIndex, total]);

  // 全屏期间同步移除应用圆角/clip-path，避免窗口化全屏时四角被裁剪为圆角
  useLayoutEffect(() => {
    if (open) {
      document.documentElement.classList.add('fullscreen-open');
    } else {
      document.documentElement.classList.remove('fullscreen-open');
    }
    return () => {
      document.documentElement.classList.remove('fullscreen-open');
    };
  }, [open]);

  // 进入/退出全屏：Tauri 绕过 JS 的 setSize/setPosition，直接调用 Rust 命令通过 Windows API
  // 的 SetWindowPos 强制窗口铺满当前显示器并置顶（TOPMOST），覆盖任务栏。浏览器回退到 DOM 全屏。
  // 注意：onClose 通过 ref 访问，避免 onClose 引用不稳定导致 effect 重复执行覆盖状态。
  //
  // 修复（2026-08-16）：主页相册卡片入口在关闭全屏时是直接卸载本组件（fullscreenProject 置 null），
  // 而非把 open 置 false。旧实现只在 open===false 分支执行 restore_window（取消 TOPMOST），
  // 组件卸载时 cleanup 只设 cancelled=true 从不恢复，导致窗口永久置顶、遮挡其他应用。
  // 现抽取 restoreFromFullscreen 为共享函数，并在 cleanup 中调用：无论 open 切换还是组件卸载，
  // 只要处于全屏置顶状态就必然恢复窗口（取消 TOPMOST 并还原尺寸/位置）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // 从全屏恢复窗口：取消 TOPMOST 并还原尺寸/位置，按进入前的状态恢复最大化/最小化。
    // 同时被「open 变 false 的分支」与「effect cleanup（含组件卸载）」调用，幂等。
    const restoreFromFullscreen = async () => {
      if (!isTauri) {
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => { /* ignore */ });
        }
        return;
      }
      const { getCurrentWindow, currentMonitor } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const mon = await currentMonitor().catch(() => null);
      const sz = await win.innerSize().catch(() => null);

      // 如果进入全屏前窗口是最小化状态，先恢复到正常状态才能设置尺寸/位置
      if (wasMinimizedRef.current) {
        await win.unminimize().catch(() => { /* ignore */ });
        await sleep(120);
      }

      // 恢复全屏前的尺寸与位置（这些值是在取消最大化/最小化之后、进入全屏之前保存的“还原态”尺寸）
      let x = savedPositionRef.current?.x ?? 0;
      let y = savedPositionRef.current?.y ?? 0;
      let width = savedBoundsRef.current?.width ?? 1440;
      let height = savedBoundsRef.current?.height ?? 900;

      // 兜底：如果保存值丢失且当前仍是全屏尺寸，按显示器一定比例计算一个合理还原尺寸
      if (mon && sz && (!savedBoundsRef.current || !savedPositionRef.current)) {
        if (sz.width >= mon.size.width - 10 && sz.height >= mon.size.height - 10) {
          x = mon.position.x + Math.round(mon.size.width * 0.1);
          y = mon.position.y + Math.round(mon.size.height * 0.1);
          width = Math.round(mon.size.width * 0.8);
          height = Math.round(mon.size.height * 0.8);
        } else {
          x = (await win.innerPosition().catch(() => null))?.x ?? x;
          y = (await win.innerPosition().catch(() => null))?.y ?? y;
          width = sz.width;
          height = sz.height;
        }
      }

      // 调用 Rust 命令移除 TOPMOST 并还原尺寸/位置
      await invoke('restore_window', {
        x,
        y,
        width,
        height,
        maximized: false,
      }).catch((e) => logger.error('[Fullscreen] restore failed', e));
      await sleep(80);

      // 根据进入全屏前的状态恢复最大化或最小化
      if (wasMaximizedRef.current) {
        await win.maximize().catch((e) => logger.error('[Fullscreen] maximize failed', e));
      } else if (wasMinimizedRef.current) {
        await win.minimize().catch((e) => logger.error('[Fullscreen] minimize failed', e));
      }

      wasMaximizedRef.current = false;
      wasMinimizedRef.current = false;
      savedBoundsRef.current = null;
      savedPositionRef.current = null;
    };

    if (!open) {
      // 恢复动作统一由 effect cleanup 负责（open 切换与组件卸载都会触发 cleanup），
      // 这里仅重置状态标记，避免与 cleanup 重复恢复导致 savedBounds/savedPosition
      // 已被重置为 null 后走兜底逻辑把窗口错误还原成固定比例尺寸。
      manualFullscreenRef.current = false;
      return;
    }

    if (isTauri) {
      import('@tauri-apps/api/window').then(async ({ getCurrentWindow, currentMonitor }) => {
        if (cancelled) return;
        // 防止 effect 重复执行导致 wasMaximizedRef/wasMinimizedRef 被覆盖
        if (manualFullscreenRef.current) return;
        enteringRef.current = true;
        manualFullscreenRef.current = true;
        const win = getCurrentWindow();
        wasMaximizedRef.current = await win.isMaximized().catch(() => false);
        wasMinimizedRef.current = await win.isMinimized().catch(() => false);

        // 如果窗口当前是最小化状态，先恢复，否则无法正确获取/设置尺寸
        if (wasMinimizedRef.current) {
          await win.unminimize().catch(() => { /* ignore */ });
          await sleep(120);
        }

        // 如果窗口当前是最大化状态，先取消最大化，以便获取还原态尺寸
        if (wasMaximizedRef.current) {
          await win.unmaximize().catch(() => { /* ignore */ });
          await sleep(250);
        }

        // 记录原尺寸位置（此时已是还原态尺寸），供退出全屏后恢复
        savedBoundsRef.current = await win.innerSize().catch(() => null);
        savedPositionRef.current = await win.innerPosition().catch(() => null);
        logger.log('[Fullscreen] saved state', {
          maximized: wasMaximizedRef.current,
          minimized: wasMinimizedRef.current,
          savedBounds: savedBoundsRef.current,
          savedPosition: savedPositionRef.current,
        });

        await win.setDecorations(false).catch(() => { /* ignore */ });
        await sleep(80);

        // 通过 Rust 命令调用 Windows SetWindowPos 直接铺满显示器
        const monitor = await currentMonitor().catch(() => null);
        if (monitor) {
          // 竞态守卫：若进入全屏过程中组件已被卸载（cleanup 置 cancelled），
          // 立即中止，避免在 cleanup 恢复窗口之后再调用 force_fullscreen 重新置顶
          if (cancelled) return;
          const { x, y } = monitor.position;
          logger.log('[Fullscreen] monitor', { x, y, w: monitor.size.width, h: monitor.size.height, scale: monitor.scaleFactor });
          await invoke('force_fullscreen', {
            x,
            y,
            width: monitor.size.width,
            height: monitor.size.height,
          }).catch((e) => logger.error('[Fullscreen] force_fullscreen failed', e));
          if (cancelled) return;
          await sleep(200);
          // 二次校验：若尺寸仍偏离显示器超过 10px，再次调用
          const size = await win.innerSize().catch(() => null);
          logger.log('[Fullscreen] after resize', size?.width, size?.height);
          if (size && (Math.abs(size.width - monitor.size.width) > 10 || Math.abs(size.height - monitor.size.height) > 10)) {
            if (cancelled) return;
            await invoke('force_fullscreen', {
              x,
              y,
              width: monitor.size.width,
              height: monitor.size.height,
            }).catch((e) => logger.error('[Fullscreen] force_fullscreen retry failed', e));
          }
        }

        // 进入全屏过渡期间忽略 resize 事件，避免误触关闭
        setTimeout(() => { enteringRef.current = false; }, 2000);

        unlisten = await win.onResized(async () => {
          if (enteringRef.current) return;
          const sz = await win.innerSize().catch(() => null);
          const mon = await currentMonitor().catch(() => null);
          // 手动全屏模式下，仅当窗口明显缩小（如用户按系统快捷键退出）时关闭视图
          if (mon && sz && (sz.width < mon.size.width - 100 || sz.height < mon.size.height - 100)) {
            onCloseRef.current();
          }
        });
      }).catch(() => { /* ignore */ });
    } else {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().catch(() => { /* 浏览器可能拒绝自动全屏 */ });
      }
    }

    const onFsChange = () => {
      if (!isTauri && !document.fullscreenElement) {
        onCloseRef.current();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
      unlisten = undefined;
      document.removeEventListener('fullscreenchange', onFsChange);
      // 关键修复：组件被直接卸载（主页入口关闭全屏时卸载 FullscreenView）时，
      // 若窗口仍处于全屏置顶（TOPMOST）状态，必须在 cleanup 中恢复窗口，
      // 否则窗口会永久置顶遮挡其他应用。此为幂等调用。
      if (manualFullscreenRef.current) {
        manualFullscreenRef.current = false;
        restoreFromFullscreen().catch(() => { /* ignore */ });
      }
    };
  }, [open]);

  // 渲染当前页高清图像
  useEffect(() => {
    if (!open || !page) return;
    let cancelled = false;
    const rid = ++renderRef.current;
    setLoading(true);

    const renderScale = Math.min(zoom / 100, MAX_RENDER_WIDTH / BASE_RENDER_WIDTH);
    const options = { baseWidth: BASE_RENDER_WIDTH, cacheSuffix: 'fs' as const, pageIndex, albumSize };

    const render = async () => {
      try {
        // P0-fix: 先查缓存（LRU → IDB），命中则直接显示，避免每次打开都全量渲染导致黑屏
        const cached = await getCachedThumbnailUrl(page, photos, renderScale, options);
        if (cancelled || rid !== renderRef.current) return;
        if (cached) {
          setThumbnailUrl(cached);
          setLoading(false);
          return;
        }

        // 缓存未命中：清除旧缓存（可能是不完整的残缺图），重新渲染
        invalidateFullscreenThumbnail(page.id);
        // 照片、贴纸与背景图片并行预加载，缩短用户等待
        const [imgs, stickers, bgImg] = await Promise.all([
          preloadPagePhotos(page, photos),
          preloadStickers(page),
          loadBackgroundBitmap(page.backgroundImage),
        ]);
        if (cancelled || rid !== renderRef.current) {
          // 已被新渲染取代：立即释放位图
          releasePreloadedImages(imgs);
          releaseStickerImages(stickers);
          if (bgImg instanceof ImageBitmap) try { bgImg.close(); } catch { /* ignore */ }
          return;
        }
        const url = renderPageThumbnail(page, photos, renderScale, imgs, options, stickers, bgImg ?? undefined);
        // P1-3：dataURL 已生成，原始位图立即释放降低峰值内存
        releasePreloadedImages(imgs);
        releaseStickerImages(stickers);
        if (bgImg instanceof ImageBitmap) try { bgImg.close(); } catch { /* ignore */ }
        if (!cancelled && rid === renderRef.current) {
          setThumbnailUrl(url);
        }
      } catch {
        const url = renderPageThumbnail(page, photos, renderScale, undefined, options);
        if (!cancelled && rid === renderRef.current) {
          setThumbnailUrl(url);
        }
      } finally {
        if (!cancelled && rid === renderRef.current) {
          setLoading(false);
        }
      }
    };

    render();

    // 后台预加载相邻页面照片，提升翻页体验。
    // P1-3：预加载产生的 ImageBitmap 必须立即释放，否则翻页时会持续累积位图内存。
    //       预加载的真正收益是预热 blobUrlCache（readPhotoFromDB 已填充），位图本身不被使用。
    const neighborIndices = [pageIndex - 1, pageIndex + 1].filter((i) => i >= 0 && i < pages.length);
    for (const idx of neighborIndices) {
      preloadPagePhotos(pages[idx], photos)
        .then((imgs) => releasePreloadedImages(imgs))
        .catch(() => { /* ignore */ });
    }

    return () => { cancelled = true; };
  }, [open, page, photos, zoom, pageIndex, pages.length, albumSize]);

  // 页面切换
  const goNext = useCallback(() => {
    if (pageIndex < total - 1) {
      setPageIndex((i) => i + 1);
      setDirection('next');
      setPan({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
    }
  }, [pageIndex, total]);

  const goPrev = useCallback(() => {
    if (pageIndex > 0) {
      setPageIndex((i) => i - 1);
      setDirection('prev');
      setPan({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
    }
  }, [pageIndex]);

  const toggleBySpace = useCallback(() => {
    if (direction === 'next') {
      if (pageIndex < total - 1) goNext();
      else { setDirection('prev'); goPrev(); }
    } else {
      if (pageIndex > 0) goPrev();
      else { setDirection('next'); goNext(); }
    }
  }, [direction, pageIndex, total, goNext, goPrev]);

  // 键盘事件：忽略长按重复触发，避免跳页
  const navThrottleRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          if (e.repeat || navThrottleRef.current) return;
          navThrottleRef.current = true;
          goNext();
          setTimeout(() => { navThrottleRef.current = false; }, 250);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          if (e.repeat || navThrottleRef.current) return;
          navThrottleRef.current = true;
          goPrev();
          setTimeout(() => { navThrottleRef.current = false; }, 250);
          break;
        case ' ':
          e.preventDefault();
          if (e.repeat || navThrottleRef.current) return;
          navThrottleRef.current = true;
          toggleBySpace();
          setTimeout(() => { navThrottleRef.current = false; }, 250);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, goNext, goPrev, toggleBySpace]);

  // 滚轮缩放
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta));
      if (next <= MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // React 19 将 onWheel 设为 passive，preventDefault 会报警告；改用原生非 passive 监听
  // deps 含 open：组件 open=false 时返回 null，containerRef 未挂载；
  // open=true 时需重新执行 effect 以附加 wheel 监听器
  useWheel(containerRef, handleWheel, [open]);

  // 鼠标拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= MIN_ZOOM) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [zoom, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  // 鼠标左右切换（仅点击空白背景，不作用于图片/控制栏）
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-fs-ui], [data-fs-image]')) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.25) {
      goPrev();
    } else if (x > rect.width * 0.75) {
      goNext();
    }
  }, [goNext, goPrev]);

  const handleMouseMoveZone = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.25) setHoverZone('left');
    else if (x > rect.width * 0.75) setHoverZone('right');
    else setHoverZone(null);
  }, []);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // 底部控制栏自动隐藏：滑入唤起，滑出 3s 后渐隐
  const showNav = useCallback(() => {
    setNavVisible(true);
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
  }, []);

  const hideNavDelayed = useCallback(() => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    navTimerRef.current = setTimeout(() => {
      setNavVisible(false);
      navTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  // 点击阅读进度条跳转页面
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nextIndex = Math.round(ratio * (total - 1));
    setPageIndex(Math.max(0, Math.min(total - 1, nextIndex)));
  }, [total]);

  // 点击页数进行输入跳转
  const startEditPage = useCallback(() => {
    setEditPageValue(String(pageIndex + 1));
    setEditingPage(true);
  }, [pageIndex]);

  const commitEditPage = useCallback(() => {
    const v = parseInt(editPageValue, 10);
    if (!Number.isNaN(v)) {
      setPageIndex(Math.max(0, Math.min(total - 1, v - 1)));
    }
    setEditingPage(false);
  }, [editPageValue, total]);

  const handlePageInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEditPage();
    if (e.key === 'Escape') setEditingPage(false);
  }, [commitEditPage]);

  useEffect(() => {
    if (editingPage) {
      pageInputRef.current?.focus();
      pageInputRef.current?.select();
    }
  }, [editingPage]);

  if (!open || !page || !albumSize) return null;

  const progress = total > 0 ? ((pageIndex + 1) / total) * 100 : 0;
  const cursor = dragRef.current.active && zoom > MIN_ZOOM ? 'grabbing' : hoverZone ? 'pointer' : 'default';

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-screen h-screen z-[99999] bg-black flex flex-col select-none"
      style={{ cursor }}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => { handleMouseMove(e); handleMouseMoveZone(e); }}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); setHoverZone(null); }}
      onClick={handleBackgroundClick}
    >
      {/* 主显示区 */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        {loading && !thumbnailUrl && (
          <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        )}
        {thumbnailUrl && (
          <img
            data-fs-image
            src={thumbnailUrl}
            alt={t('editor.fullscreen.pageAlt', { n: pageIndex + 1 })}
            className="max-w-full max-h-full object-contain shadow-2xl rounded-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
              transition: dragRef.current.active ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0.2, 1)',
            }}
            draggable={false}
            onClick={handleImageClick}
          />
        )}

        {/* 左右切换提示区 */}
        <div
          className={`absolute inset-y-0 left-0 w-1/4 flex items-center justify-start pl-10 pointer-events-none transition-all duration-300 ${
            hoverZone === 'left' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/95 shadow-[0_8px_32px_rgba(0,0,0,0.35)] transition-transform duration-300 scale-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </div>
        </div>
        <div
          className={`absolute inset-y-0 right-0 w-1/4 flex items-center justify-end pr-10 pointer-events-none transition-all duration-300 ${
            hoverZone === 'right' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/95 shadow-[0_8px_32px_rgba(0,0,0,0.35)] transition-transform duration-300 scale-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>

      {/* 底部控制栏：滑入唤起，滑出 3s 后渐隐 */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[100000] flex flex-col justify-end"
        onMouseEnter={showNav}
        onMouseLeave={hideNavDelayed}
      >
        <div
          data-fs-ui
          className={`shrink-0 h-14 bg-black/60 backdrop-blur-md border-t border-white/10 flex items-center px-5 gap-5 text-white/90 text-[13px] transition-all duration-500 ease-out ${
            navVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <button
            onClick={goPrev}
            disabled={pageIndex === 0}
            className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title={t('editor.fullscreen.prevPage')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>

          {editingPage ? (
            <div className="tabular-nums min-w-[72px] text-center text-[14px] font-medium flex items-center justify-center gap-0.5">
              <input
                ref={pageInputRef}
                type="text"
                inputMode="numeric"
                value={editPageValue}
                onChange={(e) => setEditPageValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitEditPage}
                onKeyDown={handlePageInputKeyDown}
                className="w-9 px-1 py-0.5 bg-white/10 border border-white/20 rounded text-center text-white outline-none focus:border-[var(--color-brand)]"
              />
              <span>/ {total}</span>
            </div>
          ) : (
            <button
              onClick={startEditPage}
              className="tabular-nums min-w-[72px] text-center text-[14px] font-medium hover:bg-white/10 rounded px-2 py-1 transition-colors cursor-pointer"
              title={t('editor.fullscreen.pageJumpHint')}
            >
              {pageIndex + 1} / {total}
            </button>
          )}

          <button
            onClick={goNext}
            disabled={pageIndex === total - 1}
            className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title={t('editor.fullscreen.nextPage')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>

          <div
            className="flex-1 flex items-center gap-3 px-4 cursor-pointer group"
            onClick={handleProgressClick}
            title={t('editor.fullscreen.progressHint')}
          >
            <span className="text-white/50 text-xs">{t('editor.fullscreen.readProgress')}</span>
            <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-[var(--color-brand)] rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="text-white/60 text-xs tabular-nums">{Math.round(progress)}%</span>
          </div>

          <div className="flex items-center gap-3 tabular-nums">
            <span className="text-white/50 text-xs">{t('editor.fullscreen.zoom')}</span>
            <span className="min-w-[44px] text-right font-medium">{zoom}%</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoom(v);
                if (v <= MIN_ZOOM) setPan({ x: 0, y: 0 });
              }}
              className="w-28 accent-[var(--color-brand)]"
            />
          </div>

          <button
            onClick={onClose}
            className="ml-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] font-[500] transition-colors"
            title={t('editor.fullscreen.exitHint')}
          >
            {t('editor.fullscreen.exit')}
          </button>
        </div>
      </div>
    </div>
  );
}
