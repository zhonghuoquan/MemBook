import { TEMPLATES } from '../../types';
import { useEditorStore, useUIStore } from '../../store';
import { templatePreview } from '../../utils/templatePreview';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useTranslation } from 'react-i18next';

export function MarketPanel() {
  const { t } = useTranslation();
  const pages = useEditorStore((s) => s.pages);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const addToast = useUIStore((s) => s.addToast);
  const sb = useScrollbarVisibility<HTMLDivElement>();

  const handleApply = (templateId: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: t('editor.marketPanel.noPage') });
      return;
    }
    setPageTemplate(currentPageIndex, templateId);
    addToast({ type: 'success', message: t('editor.marketPanel.applied') });
  };

  return (
    <aside className="w-[var(--layout-panel-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                      flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          {t('editor.marketPanel.title')}
        </span>
      </div>

      {/* Categories */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 space-y-6 ${sb.className}`} {...sb.handlers}>
        <TemplateCategory
          title={t('editor.marketPanel.classicTitle')}
          description={t('editor.marketPanel.classicDesc')}
          category="classic"
          onApply={handleApply}
        />
        <TemplateCategory
          title={t('editor.marketPanel.creativeTitle')}
          description={t('editor.marketPanel.creativeDesc')}
          category="creative"
          onApply={handleApply}
        />
      </div>
    </aside>
  );
}

function TemplateCategory({
  title,
  description,
  category,
  onApply,
}: {
  title: string;
  description: string;
  category: string;
  onApply: (templateId: string) => void;
}) {
  const { t } = useTranslation();
  const templates = TEMPLATES.filter((tmpl) => tmpl.category === category);

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-800)]">{title}</h3>
        <p className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {templates.map((tmpl) => (
          <div
            key={tmpl.id}
            className="group bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                       overflow-hidden cursor-pointer
                       hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-card-hover)]
                       active:border-[var(--color-primary-600)] active:border-2
                       transition-all duration-150"
            onClick={() => onApply(tmpl.id)}
          >
            {/* Template preview mini rendering */}
            <div className="aspect-[4/3] bg-white relative flex items-center justify-center p-3">
              <div className="w-full h-full relative bg-[var(--color-gray-50)] rounded-[var(--radius-xs)] p-1">
                {templatePreview(tmpl.id)}
              </div>
            </div>
            {/* Template name */}
            <div className="px-3 py-2 border-t border-[var(--color-border-light)]">
              <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-700)]">{tmpl.name}</div>
              <div className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-0.5">
                {t('editor.marketPanel.slotsCount', { count: tmpl.slots.length })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
