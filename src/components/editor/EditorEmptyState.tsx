import { useTranslation } from 'react-i18next';

interface EditorEmptyStateProps {
  onAddPage: () => void;
}

export function EditorEmptyState({ onAddPage }: EditorEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      {/* 图标 */}
      <div className="w-20 h-24 mb-6 border-2 border-dashed border-[var(--color-primary-300)] rounded-[var(--radius-2xl)] flex items-center justify-center bg-[image:var(--gradient-brand-soft)] shadow-[var(--shadow-soft)]">
        <svg viewBox="0 0 40 40" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" className="w-10 h-10">
          <rect x="6" y="4" width="28" height="32" rx="3" />
          <line x1="12" y1="12" x2="28" y2="12" strokeWidth="1.2" />
          <line x1="12" y1="18" x2="28" y2="18" strokeWidth="1.2" />
          <line x1="12" y1="24" x2="22" y2="24" strokeWidth="1.2" />
        </svg>
      </div>
      {/* 标题 */}
      <h2 className="text-[var(--text-h2)] font-[700] text-[var(--color-gray-800)] mb-2">
        {t('editor.emptyState.title')}
      </h2>
      {/* 描述 */}
      <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-8 max-w-sm text-center leading-relaxed">
        {t('editor.emptyState.description')}
      </p>
      {/* CTA */}
      <button
        className="inline-flex items-center gap-2 px-6 py-3 rounded-[var(--radius-lg)] text-white text-[var(--text-body-sm)] font-[600] border-none cursor-pointer transition-all duration-200 bg-[image:var(--gradient-brand)] hover:shadow-[var(--shadow-md)] hover:-translate-y-px active:scale-[0.97]"
        onClick={onAddPage}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        {t('editor.emptyState.addFirstPage')}
      </button>
      {/* 提示 */}
      <div className="mt-8 flex items-center gap-4 text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--color-border-light)] text-[10px] font-[500]">Ctrl+Z</kbd>
          {t('editor.emptyState.undo')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--color-border-light)] text-[10px] font-[500]">Space</kbd>
          {t('editor.emptyState.dragPage')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-gray-100)] border border-[var(--color-border-light)] text-[10px] font-[500]">{t('editor.emptyState.scrollWheel')}</kbd>
          {t('editor.emptyState.zoom')}
        </span>
      </div>
    </div>
  );
}
