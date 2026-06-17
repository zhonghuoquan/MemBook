import { useMemo, useState, useCallback, useRef, useEffect, forwardRef } from 'react';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { AlbumPage, Template } from '../../types';

const THUMB_W = 96;
const THUMB_H = 128;

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
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const addToast = useUIStore((s) => s.addToast);

  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const collapsed = bottomNav === 'collapsed';

  // Close menu on outside click
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
    addPage();
    addToast({ type: 'success', message: '已添加新页面' });
  };

  const handleInsertPage = useCallback((index: number) => {
    insertPage(index);
    addToast({ type: 'success', message: '已插入新页面' });
    setInsertIndex(null);
  }, [insertPage, addToast]);

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

  return (
    <nav
      className={`
        bg-white border-t border-[var(--color-border)]
        flex items-stretch shrink-0 relative
        transition-[height] duration-200 ease-in-out
        ${collapsed ? 'h-[var(--layout-bottom-nav-collapsed)]' : 'h-[150px]'}
      `}
    >
      {!collapsed && (
        <div className="flex items-center w-full h-full px-2 gap-2">
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-[var(--color-surface-panel)] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
            onClick={toggleBottomNav}
            title="收起页面导航"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M7 2L3 5l4 3" />
            </svg>
          </button>

          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)] disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed"
            onClick={handleMoveLeft}
            disabled={currentPageIndex === 0}
            title="左移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M6 2L3 5l3 3" />
            </svg>
          </button>

          {/* ── Thumbnails Row with insert zones ── */}
          <div
            className="flex-1 flex items-center overflow-x-auto py-1 no-scrollbar"
            onMouseLeave={() => setInsertIndex(null)}
          >
            {pages.length === 0 ? (
              <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] px-2">暂无页面</div>
            ) : (
              <div className="flex items-center">
                {pages.map((page, i) => (
                  <div key={page.id} className="flex items-center">
                    {/* Insert zone before this page */}
                    <InsertZone
                      index={i}
                      isActive={insertIndex === i}
                      onActivate={() => setInsertIndex(i)}
                      onDeactivate={() => setInsertIndex(null)}
                      onInsert={() => handleInsertPage(i)}
                    />

                    {/* Thumbnail with ⋮ menu */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 relative">
                      <div className="relative group/thumb">
                        <button
                          className={`
                            rounded-[var(--radius-xs)] overflow-hidden border-2 cursor-pointer
                            transition-[border-color,transform] duration-150 p-0 relative block
                            ${i === currentPageIndex
                              ? 'border-[var(--color-brand)] scale-105 shadow-[0_2px_8px_rgba(108,99,255,0.2)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-gray-400)]'
                            }
                          `}
                          style={{ backgroundColor: page.background, width: THUMB_W, height: THUMB_H }}
                          onClick={() => setCurrentPage(i)}
                          title={`第${i + 1}页`}
                        >
                          <PageThumbnail page={page} template={TEMPLATES.find((t) => t.id === page.templateId)} photos={photos} />
                        </button>

                        {/* ⋮ More button (shows on hover) */}
                        <button
                          className="absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center
                                     bg-black/40 border border-white/20 rounded-full
                                     text-white opacity-0 group-hover/thumb:opacity-100
                                     hover:bg-black/60 hover:scale-110
                                     transition-all duration-150 cursor-pointer z-10 backdrop-blur-sm"
                          onClick={(e) => { e.stopPropagation(); setMenuOpenIndex(menuOpenIndex === i ? null : i); }}
                          title="页面操作"
                        >
                          <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                            <circle cx="6" cy="2.5" r="1.2" />
                            <circle cx="6" cy="6" r="1.2" />
                            <circle cx="6" cy="9.5" r="1.2" />
                          </svg>
                        </button>

                        {/* Dropdown menu */}
                        {menuOpenIndex === i && (
                          <PageMenu
                            ref={menuRef}
                            pageIndex={i}
                            pageCount={pages.length}
                            onCopy={() => handleCopyPage(i)}
                            onCopyStyle={() => handleCopyStyle(i)}
                            onDelete={() => handleDeletePage(i)}
                            onClose={() => setMenuOpenIndex(null)}
                          />
                        )}
                      </div>

                      {/* Page number */}
                      <span className={`text-[10px] leading-tight ${i === currentPageIndex ? 'text-[var(--color-brand)] font-[600]' : 'text-[var(--color-gray-500)]'}`}>
                        {i + 1}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Insert zone after last page */}
                <InsertZone
                  index={pages.length}
                  isActive={insertIndex === pages.length}
                  onActivate={() => setInsertIndex(pages.length)}
                  onDeactivate={() => setInsertIndex(null)}
                  onInsert={() => handleInsertPage(pages.length)}
                />
              </div>
            )}
          </div>

          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)] disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed"
            onClick={handleMoveRight}
            disabled={currentPageIndex >= pages.length - 1}
            title="右移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M4 2l3 3-3 3" />
            </svg>
          </button>

          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-500)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] transition-colors"
            title="添加页面"
            onClick={handleAddPage}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="14" y2="7" />
            </svg>
          </button>

          <div className="w-px h-8 bg-[var(--color-border)] shrink-0 mx-1" />

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[var(--text-body-sm)] text-[var(--color-gray-600)] font-[500] whitespace-nowrap">
              {currentPageIndex + 1}/{pages.length}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[var(--text-caption)] text-[var(--color-gray-500)] min-w-[2.5em] text-right select-none">
              {formatPercent(canvasZoom)}
            </span>
            <input
              type="range"
              min="0.3"
              max="3"
              step="0.05"
              value={canvasZoom}
              onChange={(e) => setCanvasZoom(parseFloat(e.target.value))}
              className="w-20 h-1.5 cursor-pointer accent-[var(--color-brand)]"
              title="缩放"
            />
          </div>

          <button
            className="flex items-center justify-center w-7 h-7 border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-[var(--color-surface-panel)] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
            title="网格视图"
            onClick={() => addToast({ type: 'info', message: '网格视图即将上线' })}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" />
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
    onCopy,
    onCopyStyle,
    onDelete,
    onClose,
  }: {
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
      <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={onClose} />
      {/* Menu */}
      <div
        ref={ref}
        className="absolute top-[-4px] right-[-8px] z-[calc(var(--z-overlay)+1)] bg-white
                   border border-[var(--color-border)] rounded-[var(--radius-md)]
                   shadow-[var(--shadow-md)] py-1 min-w-[140px] animate-in fade-in zoom-in-95
                   duration-150 origin-top-right"
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
