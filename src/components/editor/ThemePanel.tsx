import { THEME_BACKGROUNDS } from '../../types';
import { useEditorStore, useUIStore } from '../../store';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useTranslation } from 'react-i18next';

export function ThemePanel() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const updatePageBackground = useEditorStore((s) => s.updatePageBackground);
  const addToast = useUIStore((s) => s.addToast);
  const sb = useScrollbarVisibility<HTMLDivElement>();

  const currentBg = pages[currentPageIndex]?.background || '#FFFFFF';

  const handleSelectColor = (color: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: t('editor.themePanel.noPage') });
      return;
    }
    updatePageBackground(currentPageIndex, color);
    addToast({ type: 'success', message: t('editor.themePanel.bgUpdated') });
  };

  return (
    <aside className="w-[var(--layout-panel-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                      flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          {t('editor.themePanel.title')}
        </span>
      </div>

      {/* Content */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 ${sb.className}`} {...sb.handlers}>
        {/* Preview of current page */}
        <div className="mb-4">
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">
            {t('editor.themePanel.current')}
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-full h-20 rounded-[var(--radius-md)] border border-[var(--color-border)] flex items-center justify-center"
              style={{ backgroundColor: currentBg }}
            >
              {currentBg === '#FFFFFF' && (
                <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">{t('editor.themePanel.pureWhite')}</span>
              )}
            </div>
          </div>
        </div>

        {/* Color Grid */}
        <div>
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">
            {t('editor.themePanel.presets')}
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
            {t('editor.themePanel.resetWhite')}
          </button>
        )}
      </div>
    </aside>
  );
}
