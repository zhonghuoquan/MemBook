import { THEME_BACKGROUNDS } from '../../types';
import { useEditorStore, useUIStore } from '../../store';

export function ThemePanel() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const updatePageBackground = useEditorStore((s) => s.updatePageBackground);
  const addToast = useUIStore((s) => s.addToast);

  const currentBg = pages[currentPageIndex]?.background || '#FFFFFF';

  const handleSelectColor = (color: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: '请先创建相册页面' });
      return;
    }
    updatePageBackground(currentPageIndex, color);
    addToast({ type: 'success', message: '背景已更新' });
  };

  return (
    <aside className="w-[var(--layout-panel-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                      flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          页面背景
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Preview of current page */}
        <div className="mb-4">
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">
            当前
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-full h-20 rounded-[var(--radius-md)] border border-[var(--color-border)] flex items-center justify-center"
              style={{ backgroundColor: currentBg }}
            >
              {currentBg === '#FFFFFF' && (
                <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">纯白背景</span>
              )}
            </div>
          </div>
        </div>

        {/* Color Grid */}
        <div>
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">
            预设颜色
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {THEME_BACKGROUNDS.map((item) => (
              <div
                key={item.color}
                className={`
                  aspect-square rounded-[var(--radius-md)] cursor-pointer
                  transition-all duration-150
                  ${currentBg === item.color
                    ? 'ring-2 ring-[var(--color-brand)] ring-offset-1'
                    : 'border border-[var(--color-border)] hover:scale-105 hover:shadow-sm'
                  }
                `}
                style={{ backgroundColor: item.color }}
                title={item.name}
                onClick={() => handleSelectColor(item.color)}
              />
            ))}
          </div>
        </div>

        {/* Solid color hint */}
        {currentBg !== '#FFFFFF' && currentBg !== '#F8F9FA' && (
          <button
            className="mt-4 w-full py-2 border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] text-[var(--color-gray-500)] bg-transparent cursor-pointer
                       hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)]
                       transition-colors"
            onClick={() => handleSelectColor('#FFFFFF')}
          >
            重置为白色背景
          </button>
        )}
      </div>
    </aside>
  );
}
