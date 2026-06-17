import { useEditorStore, useUIStore } from '../../store';

export function BottomNav() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const pages = useEditorStore((s) => s.pages);
  const addPage = useEditorStore((s) => s.addPage);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const bottomNav = useUIStore((s) => s.bottomNav);
  const toggleBottomNav = useUIStore((s) => s.toggleBottomNav);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const addToast = useUIStore((s) => s.addToast);

  const collapsed = bottomNav === 'collapsed';

  const handleAddPage = () => {
    addPage();
    addToast({ type: 'success', message: '已添加新页面' });
  };

  const handleMoveLeft = () => {
    if (currentPageIndex > 0) {
      reorderPages(currentPageIndex, currentPageIndex - 1);
      setCurrentPage(currentPageIndex - 1);
    }
  };

  const handleMoveRight = () => {
    if (currentPageIndex < pages.length - 1) {
      reorderPages(currentPageIndex, currentPageIndex + 1);
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
        ${collapsed ? 'h-[var(--layout-bottom-nav-collapsed)]' : 'h-[var(--layout-bottom-nav-height)]'}
      `}
    >
      {/* ── Expanded bar ── */}
      {!collapsed && (
        <div className="flex items-center w-full h-full px-2 gap-2">
          {/* Toggle Collapse Button */}
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-[var(--color-surface-panel)] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
            onClick={toggleBottomNav}
            title="收起页面导航"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M7 2L3 5l4 3" />
            </svg>
          </button>

          {/* Left Move */}
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

          {/* ── Thumbnails Row ── */}
          <div className="flex-1 flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
            {pages.length === 0 ? (
              <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] px-2">暂无页面</div>
            ) : (
              pages.map((page, i) => (
                <div key={page.id} className="flex flex-col items-center gap-0.5 flex-shrink-0">
                  <div
                    className={`
                      w-12 h-[52px] rounded-[var(--radius-xs)] overflow-hidden border-2 cursor-pointer
                      transition-[border-color,transform] duration-150
                      ${i === currentPageIndex
                        ? 'border-[var(--color-brand)] scale-105 shadow-sm'
                        : 'border-transparent hover:border-[var(--color-border-hover)]'
                      }
                    `}
                    style={{ backgroundColor: page.background }}
                    onClick={() => setCurrentPage(i)}
                    title={`第${i + 1}页`}
                  >
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--color-gray-400)]">
                      {i + 1}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--color-gray-500)] leading-tight">{i + 1}</span>
                </div>
              ))
            )}
          </div>

          {/* Right Move */}
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

          {/* Add Page Button */}
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-500)] cursor-pointer shrink-0 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] transition-colors"
            title="添加页面"
            onClick={handleAddPage}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="14" y2="7" />
            </svg>
          </button>

          {/* ── Page Separator ── */}
          <div className="w-px h-8 bg-[var(--color-border)] shrink-0 mx-1" />

          {/* ── Page Indicator ── */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[var(--text-body-sm)] text-[var(--color-gray-600)] font-[500] whitespace-nowrap">
              {currentPageIndex + 1}/{pages.length}
            </span>
          </div>

          {/* ── Zoom Slider ── */}
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

          {/* ── View Buttons ── */}
          <button
            className="flex items-center justify-center w-7 h-7 border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-[var(--color-surface-panel)] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
            title="页面视图"
            onClick={() => addToast({ type: 'info', message: '网格视图即将上线' })}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Collapsed bar ── */}
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
