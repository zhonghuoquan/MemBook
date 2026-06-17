import { useMemo, useState, useCallback, useRef, useEffect, forwardRef } from 'react';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { AlbumPage, Template } from '../../types';

const THUMB_W = 96;
const THUMB_H = 128;
const MIN_NAV_HEIGHT = 90;
const MAX_NAV_HEIGHT = 280;
const NAV_STORAGE_KEY = 'membook-bottom-nav-height';

function loadSavedHeight(): number {
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (saved) {
      const h = parseInt(saved, 10);
      if (!isNaN(h) && h >= MIN_NAV_HEIGHT && h <= MAX_NAV_HEIGHT) return h;
    }
  } catch { /* ignore */ }
  return 150;
}

export function BottomNav() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const pages = useEditorStore((s) => s.pages);
  const addPage = useEditorStore((s) => s.addPage);
  const insertPage = useEditorStore((s) => s.insertPage);
  const copyPage = useEditorStore((s) => s.copyPage);
  const removePage = useEditorStore((s) => s.removePage);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const photos = usePhotoStore((s) => s.photos);
  const bottomNav = useUIStore((s) => s.bottomNav);
  const toggleBottomNav = useUIStore((s) => s.toggleBottomNav);
  const navHeight = useUIStore((s) => s.bottomNavHeight);
  const setBottomNavHeight = useUIStore((s) => s.setBottomNavHeight);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const addToast = useUIStore((s) => s.addToast);

  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [showThumbnails, setShowThumbnails] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const collapsed = bottomNav === 'collapsed';

  // ── 初始化时从 localStorage 读入 store ──
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    setBottomNavHeight(loadSavedHeight());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 垂直拖拽调整高度（同步到 store）──
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startY.current = e.clientY;
    startH.current = useUIStore.getState().bottomNavHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY.current;
      setBottomNavHeight(Math.min(MAX_NAV_HEIGHT, Math.max(MIN_NAV_HEIGHT, startH.current - delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(NAV_STORAGE_KEY, String(useUIStore.getState().bottomNavHeight)); } catch { /* */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setBottomNavHeight]);
  useEffect(() => {
    if (menuOpenIndex === null) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenIndex(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenIndex]);

  const handleAddPage = () => {
    const lastTemplate = pages.length > 0 ? pages[pages.length - 1].templateId : undefined;
    addPage(lastTemplate);
    addToast({ type: 'success', message: '已添加新页面' });
  };

  const handleInsertPage = useCallback((index: number) => {
    // Insert at position `index` → copy previous page's template (not photos)
    const prevPage = index > 0 ? pages[index - 1] : undefined;
    insertPage(index, prevPage?.templateId);
    addToast({ type: 'success', message: '已插入新页面' });
    setInsertIndex(null);
  }, [pages, insertPage, addToast]);

  // ── Page menu actions ──
  const handleCopyPage = useCallback((index: number) => {
    copyPage(index);
    addToast({ type: 'success', message: '页面已复制' });
    setMenuOpenIndex(null);
  }, [copyPage, addToast]);

  const handleCopyStyle = useCallback((index: number) => {
    if (pages[index]) {
      setPageTemplate(currentPageIndex, pages[index].templateId);
      addToast({ type: 'success', message: '页面样式已应用' });
    }
    setMenuOpenIndex(null);
  }, [pages, currentPageIndex, setPageTemplate, addToast]);

  const handleDeletePage = useCallback((index: number) => {
    if (pages.length <= 1) {
      addToast({ type: 'warning', message: '至少保留一个页面' });
      return;
    }
    // If deleting current page, navigate to a safe page first
    if (index === currentPageIndex) {
      const target = index > 0 ? index - 1 : 0;
      setCurrentPage(target);
    } else if (index < currentPageIndex) {
      // Adjust currentPageIndex when deleting a page before it
      setCurrentPage(currentPageIndex - 1);
    }
    removePage(index);
    addToast({ type: 'info', message: '页面已删除' });
    setMenuOpenIndex(null);
  }, [pages, currentPageIndex, removePage, setCurrentPage, addToast]);

  const handleMoveLeft = () => {
    if (currentPageIndex > 0) {
      useEditorStore.getState().reorderPages(currentPageIndex, currentPageIndex - 1);
      setCurrentPage(currentPageIndex - 1);
    }
  };

  const handleMoveRight = () => {
    if (currentPageIndex < pages.length - 1) {
      useEditorStore.getState().reorderPages(currentPageIndex, currentPageIndex + 1);
      setCurrentPage(currentPageIndex + 1);
    }
  };

  const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

  // ── 切换缩略图显示时同步调整高度 ──
  const handleToggleThumbnails = useCallback(() => {
    const next = !showThumbnails;
    setShowThumbnails(next);
    if (next) {
      // 显示缩略图 → 恢复到之前保存的高度
      setBottomNavHeight(loadSavedHeight());
    } else {
      // 隐藏缩略图 → 折叠到仅控制栏高度
      setBottomNavHeight(48);
    }
  }, [showThumbnails, setBottomNavHeight]);

  return (
    <nav
      className="bg-white border-t border-[var(--color-border)] flex flex-col shrink-0 relative transition-[height] duration-200 ease-out"
      style={{ height: collapsed ? 'var(--layout-bottom-nav-collapsed)' : navHeight }}
    >
      {/* Drag handle (top edge) */}
      {!collapsed && showThumbnails && (
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize z-10 group"
          onMouseDown={handleResizeMouseDown}
        >
          <div className="w-8 h-0.5 mx-auto mt-0.5 rounded-full bg-[var(--color-border)] opacity-0 group-hover:opacity-60 group-active:opacity-100 transition-opacity" />
        </div>
      )}

      {/* ══════════ Row 1: Thumbnails ══════════ */}
      {showThumbnails && !collapsed && (
        <div className="flex items-center px-2 py-1 min-h-0 flex-1 border-b border-[var(--color-border)]">
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-[var(--color-surface-panel)] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors shrink-0 mr-1"
            onClick={toggleBottomNav}
            title="收起页面导航"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M7 2L3 5l4 3" />
            </svg>
          </button>

          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)] disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed mr-1"
            onClick={handleMoveLeft}
            disabled={currentPageIndex === 0}
            title="左移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M6 2L3 5l3 3" />
            </svg>
          </button>

          {/* Thumbnails scroll area */}
          <div className="flex-1 flex items-center overflow-x-auto no-scrollbar py-1" onMouseLeave={() => setInsertIndex(null)}>
            {pages.length === 0 ? (
              <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] px-2">暂无页面</div>
            ) : (
              <div className="flex items-center">
                {pages.map((page, i) => {
                  let shiftX = 0;
                  if (insertIndex !== null) {
                    if (insertIndex === i) shiftX = 8;
                    if (insertIndex === i + 1) shiftX = -8;
                  }
                  return (
                  <div key={page.id} className="flex items-center">
                    <InsertZone index={i} isActive={insertIndex === i}
                      onActivate={() => setInsertIndex(i)} onDeactivate={() => setInsertIndex(null)}
                      onInsert={() => handleInsertPage(i)} />
                    <div className="flex flex-col items-center gap-0.5 flex-shrink-0 relative transition-transform duration-200 ease-out"
                      style={{ transform: shiftX !== 0 ? `translateX(${shiftX}px)` : undefined }}>
                      <div className="relative group/thumb">
                        <button
                          className={`rounded-[var(--radius-xs)] overflow-hidden border-2 cursor-pointer transition-[border-color,transform] duration-150 p-0 relative block ${
                            i === currentPageIndex
                              ? 'border-[var(--color-brand)] scale-105 shadow-[0_2px_8px_rgba(108,99,255,0.2)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-gray-400)]'
                          }`}
                          style={{ backgroundColor: page.background, width: THUMB_W, height: THUMB_H }}
                          onClick={() => setCurrentPage(i)}
                          title={`第${i + 1}页`}
                        >
                          <PageThumbnail page={page} template={TEMPLATES.find((t) => t.id === page.templateId)} photos={photos} />
                        </button>
                        <button
                          ref={(el) => { if (el) moreBtnRefs.current.set(i, el); }}
                          className="absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center bg-black/40 border border-white/20 rounded-full text-white opacity-0 group-hover/thumb:opacity-100 hover:bg-black/60 hover:scale-110 transition-all duration-150 cursor-pointer z-10 backdrop-blur-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (menuOpenIndex === i) { setMenuOpenIndex(null); return; }
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setMenuStyle({ right: window.innerWidth - rect.right + 8, top: rect.top - 4, transform: 'translateY(-100%)' });
                            setMenuOpenIndex(i);
                          }}
                          title="页面操作"
                        >
                          <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                            <circle cx="6" cy="2.5" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="6" cy="9.5" r="1.2" />
                          </svg>
                        </button>
                        {menuOpenIndex === i && (
                          <PageMenu ref={menuRef} style={menuStyle} pageIndex={i} pageCount={pages.length}
                            onCopy={() => handleCopyPage(i)} onCopyStyle={() => handleCopyStyle(i)}
                            onDelete={() => handleDeletePage(i)} onClose={() => setMenuOpenIndex(null)} />
                        )}
                      </div>
                      <span className={`text-[10px] leading-tight ${i === currentPageIndex ? 'text-[var(--color-brand)] font-[600]' : 'text-[var(--color-gray-500)]'}`}>{i + 1}</span>
                    </div>
                  </div>
                );})}
                <InsertZone index={pages.length} isActive={insertIndex === pages.length}
                  onActivate={() => setInsertIndex(pages.length)} onDeactivate={() => setInsertIndex(null)}
                  onInsert={() => handleInsertPage(pages.length)} />
              </div>
            )}
          </div>

          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)] disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed ml-1"
            onClick={handleMoveRight}
            disabled={currentPageIndex >= pages.length - 1}
            title="右移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M4 2l3 3-3 3" />
            </svg>
          </button>

          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-500)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] transition-colors ml-1"
            title="添加页面" onClick={handleAddPage}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="14" y2="7" />
            </svg>
          </button>
        </div>
      )}

      {/* ══════════ Row 2: Control Bar ══════════ */}
      {!collapsed && (
        <div className="flex items-center justify-center gap-4 px-3 py-2 shrink-0">
          {/* Zoom slider */}
          <div className="flex items-center gap-2">
            <input
              type="range" min="0.3" max="3" step="0.05" value={canvasZoom}
              onChange={(e) => setCanvasZoom(parseFloat(e.target.value))}
              className="w-32 h-1.5 cursor-pointer accent-[var(--color-brand)]"
              title="缩放"
            />
            <span className="text-[var(--text-caption)] text-[var(--color-gray-600)] min-w-[2.5em] tabular-nums select-none">
              {formatPercent(canvasZoom)}
            </span>
            <button
              className="flex items-center justify-center w-5 h-5 border-none rounded-[var(--radius-xs)] bg-transparent text-[10px] text-[var(--color-gray-400)] cursor-pointer hover:text-[var(--color-brand)] hover:bg-[var(--color-primary-50)] transition-colors shrink-0 font-[600]"
              title="重置缩放为 100%"
              onClick={() => setCanvasZoom(1)}
            >
              ⟳
            </button>
          </div>

          {/* Page / Thumbnails toggle */}
          <button
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border cursor-pointer transition-colors ${
              showThumbnails
                ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)]'
                : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
            }`}
            onClick={handleToggleThumbnails}
            title={showThumbnails ? '隐藏页面缩略图' : '显示页面缩略图'}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <rect x="1" y="1" width="12" height="12" rx="1.5" />
              <rect x="3" y="3" width="3.5" height="3.5" rx="0.5" />
              <rect x="7.5" y="3" width="3.5" height="3.5" rx="0.5" />
              <rect x="3" y="7.5" width="3.5" height="3.5" rx="0.5" />
            </svg>
            <span className="text-[var(--text-caption)] font-[500]">页面</span>
          </button>

          {/* Page counter */}
          <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)] font-[500] whitespace-nowrap tabular-nums">
            {currentPageIndex + 1}/{pages.length}
          </span>

          {/* Grid view */}
          <button
            className="flex items-center justify-center w-7 h-7 border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-white text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
            title="网格视图"
            onClick={() => addToast({ type: 'info', message: '网格视图即将上线' })}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" />
            </svg>
          </button>

          {/* Fullscreen */}
          <button
            className="flex items-center justify-center w-7 h-7 border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-white text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
            title="全屏"
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
              } else {
                document.exitFullscreen?.();
              }
            }}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M2 6V3a1 1 0 0 1 1-1h3" /><path d="M8 2h3a1 1 0 0 1 1 1v3" />
              <path d="M2 8v3a1 1 0 0 0 1 1h3" /><path d="M12 8v3a1 1 0 0 1-1 1H8" />
            </svg>
          </button>
        </div>
      )}

      {collapsed && (
        <div className="flex items-center w-full h-full px-3 justify-between">
          <button
            className="flex items-center gap-1 text-[var(--text-caption)] text-[var(--color-gray-500)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-700)]"
            onClick={toggleBottomNav}
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M3 2l4 3-4 3" />
            </svg>
            页面 {currentPageIndex + 1}/{pages.length}
          </button>
          <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
            {formatPercent(canvasZoom)}
          </span>
        </div>
      )}
    </nav>
  );
}

/* ═══════════════════════════════════════
   插入区域 — 两个页面之间的「+」按钮
   ═══════════════════════════════════════ */

function InsertZone({
  isActive,
  onActivate,
  onDeactivate,
  onInsert,
}: {
  index: number;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onInsert: () => void;
}) {
  return (
    <div
      className="flex items-center justify-center shrink-0 relative"
      style={{ width: 14, height: THUMB_H }}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
    >
      {/* Divider line */}
      <div
        className={`
          absolute w-px h-full
          transition-all duration-200
          ${isActive
            ? 'bg-[var(--color-primary-400)] scale-y-75'
            : 'bg-[var(--color-border)] scale-y-50'
          }
        `}
      />

      {/* Insert button */}
      <button
        className={`
          absolute flex items-center justify-center gap-0.5
          rounded-full border-none cursor-pointer
          transition-all duration-200 ease-out z-10 shadow-sm
          ${isActive
            ? 'w-5 h-5 bg-[var(--color-primary-600)] text-white opacity-100 scale-100'
            : 'w-0 h-0 bg-transparent text-transparent opacity-0 scale-0'
          }
        `}
        onClick={onInsert}
        title="在此处插入页面"
      >
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3 h-3">
          <line x1="5" y1="2" x2="5" y2="8" /><line x1="2" y1="5" x2="8" y2="5" />
        </svg>
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════
   页面操作菜单 — 仿项目卡片 ⋮ 下拉菜单
   ═══════════════════════════════════════ */

const PageMenu = forwardRef(function PageMenu(
  {
    style,
    onCopy,
    onCopyStyle,
    onDelete,
    onClose,
  }: {
    style?: React.CSSProperties;
    pageIndex: number;
    pageCount: number;
    onCopy: () => void;
    onCopyStyle: () => void;
    onDelete: () => void;
    onClose: () => void;
  },
  ref: React.Ref<HTMLDivElement>,
) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      {/* Menu - fixed to screen, positioned via style */}
      <div
        ref={ref}
        style={style}
        className="fixed z-[9999] bg-white
                   border border-[var(--color-border)] rounded-[var(--radius-md)]
                   shadow-[var(--shadow-md)] py-1 min-w-[140px] animate-in fade-in zoom-in-95
                   duration-150 origin-bottom-right"
      >
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M9.5 2.5v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v1" />
            <path d="M6.5 6.5h-1a1 1 0 0 0-1 1v1" />
            <path d="M7.5 6.5h1a1 1 0 0 1 1 1v1" />
          </svg>
          复制页面
        </button>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onCopyStyle(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0">
            <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
            <rect x="1" y="8" width="5" height="5" rx="1" />
          </svg>
          复制页面样式
        </button>
        <div className="h-px bg-[var(--color-border-light)] my-1" />
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-error)] hover:bg-[var(--color-error-light)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
            <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
          </svg>
          删除页面
        </button>
      </div>
    </>
  );
});

/* ═══════════════════════════════════════
   PageThumbnail — SVG 缩略图渲染
   ═══════════════════════════════════════ */

function PageThumbnail({
  page,
  template,
  photos,
}: {
  page: AlbumPage;
  template?: Template;
  photos: { id: string; src: string }[];
}) {
  const svgContent = useMemo(() => {
    if (!template) return null;
    const pad = 2;
    const w = THUMB_W - pad * 2;
    const h = THUMB_H - pad * 2;
    return (
      <svg width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} style={{ position: 'absolute', inset: 0 }}>
        <rect x={pad} y={pad} width={w} height={h} fill={page.background} rx={1} />
        {template.slots.map((slot) => {
          const sx = pad + (slot.x / 100) * w;
          const sy = pad + (slot.y / 100) * h;
          const sw = (slot.width / 100) * w;
          const sh = (slot.height / 100) * h;
          const placement = page.placements.find((p) => p.slotId === slot.id);
          const photo = placement?.photoId ? photos.find((p) => p.id === placement.photoId) : undefined;
          return (
            <g key={slot.id}>
              <rect x={sx} y={sy} width={Math.max(sw, 1)} height={Math.max(sh, 1)}
                fill={photo ? 'transparent' : page.background === '#FFFFFF' ? '#E9ECEF' : 'rgba(255,255,255,0.12)'}
                stroke={photo ? 'transparent' : '#CED4DA'} strokeWidth={0.5} rx={1} />
              {photo && <image href={photo.src} x={sx} y={sy} width={sw} height={sh} preserveAspectRatio="xMidYMid slice" crossOrigin="anonymous" />}
              {!photo && <text x={sx + sw / 2} y={sy + sh / 2} textAnchor="middle" dominantBaseline="central" fill="#ADB5BD" fontSize={6}>+</text>}
            </g>
          );
        })}
      </svg>
    );
  }, [page, template, photos]);
  return <>{svgContent}</>;
}
