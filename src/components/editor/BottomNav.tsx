import { useEditorStore, useUIStore } from '../../store';

export function BottomNav() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const pages = useEditorStore((s) => s.pages);
  const addPage = useEditorStore((s) => s.addPage);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const bottomNav = useUIStore((s) => s.bottomNav);
  const toggleBottomNav = useUIStore((s) => s.toggleBottomNav);
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

  return (
    <nav
      className={`
        bg-[var(--color-surface-panel)] border-t border-[var(--color-border)]
        flex items-center gap-2 px-3 shrink-0 relative
        transition-[height] duration-200 ease-in-out
        ${collapsed ? 'h-[var(--layout-bottom-nav-collapsed)]' : 'h-[var(--layout-bottom-nav-height)]'}
      `}
    >
      {/* Toggle button */}
      <button
        className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)]
                   bg-transparent text-[var(--color-gray-500)] cursor-pointer
                   hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
        onClick={toggleBottomNav}
        title={collapsed ? '展开页面导航' : '收起页面导航'}
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`w-3 h-3 transition-transform duration-200 ${collapsed ? 'rotate-0' : 'rotate-180'}`}
        >
          <path d="M2 8l4-4 4 4" />
        </svg>
      </button>

      {/* Page thumbnails */}
      {!collapsed && (
        <>
          {/* Move Left */}
          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)]
                       bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0
                       hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)]
                       disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed"
            onClick={handleMoveLeft}
            disabled={currentPageIndex === 0}
            title="左移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M6 2L3 5l3 3" />
            </svg>
          </button>

          <div className="flex-1 flex items-center gap-2 overflow-x-auto py-2">
            {pages.length === 0 ? (
              <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] px-3">
                暂无页面，点击 + 添加
              </div>
            ) : (
              pages.map((page, i) => (
                <div
                  key={page.id}
                  className={`
                    relative flex-shrink-0 w-12 h-16
                    rounded-[var(--radius-xs)] overflow-hidden
                    border-2 cursor-pointer
                    transition-[border-color,transform] duration-150
                    ${i === currentPageIndex
                      ? 'border-[var(--color-brand)] scale-105'
                      : 'border-transparent hover:border-[var(--color-border-hover)]'
                    }
                  `}
                  style={{ backgroundColor: page.background }}
                  onClick={() => setCurrentPage(i)}
                  title={`第${i + 1}页`}
                >
                  {/* Mini preview of template */}
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-nano)] text-[var(--color-gray-400)]">
                    第{i + 1}页
                  </div>
                  {/* Page number */}
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[var(--text-nano)] text-[var(--color-gray-500)] bg-white/60 px-1 rounded-t-[2px] leading-tight">
                    {i + 1}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Move Right */}
          <button
            className="flex items-center justify-center w-6 h-6 border-none rounded-[var(--radius-xs)]
                       bg-transparent text-[var(--color-gray-400)] cursor-pointer shrink-0
                       hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)]
                       disabled:text-[var(--color-gray-200)] disabled:cursor-not-allowed"
            onClick={handleMoveRight}
            disabled={currentPageIndex >= pages.length - 1}
            title="右移页面"
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M4 2l3 3-3 3" />
            </svg>
          </button>

          {/* Add page button */}
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)]
                       bg-transparent text-[var(--color-gray-500)] cursor-pointer shrink-0
                       hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)]
                       transition-colors"
            title="添加页面"
            onClick={handleAddPage}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="14" y2="7" />
            </svg>
          </button>
        </>
      )}
    </nav>
  );
}
