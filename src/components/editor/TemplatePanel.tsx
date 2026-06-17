import { useEditorStore, useUIStore } from '../../store';
import { TEMPLATES } from '../../types';

export function TemplatePanel() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const addToast = useUIStore((s) => s.addToast);

  const handleSelect = (templateId: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: '请先创建相册页面' });
      return;
    }
    setPageTemplate(currentPageIndex, templateId);
    addToast({ type: 'success', message: '模板已应用' });
  };

  const classicTemplates = TEMPLATES.filter((t) => t.category === 'classic');
  const creativeTemplates = TEMPLATES.filter((t) => t.category === 'creative');

  return (
    <aside className="w-[var(--layout-panel-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                      flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">模板</span>
      </div>

      {/* Template Grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        <TemplateGroup
          title="经典布局"
          templates={classicTemplates}
          currentPageIndex={currentPageIndex}
          pages={pages}
          onSelect={handleSelect}
        />
        <TemplateGroup
          title="创意布局"
          templates={creativeTemplates}
          currentPageIndex={currentPageIndex}
          pages={pages}
          onSelect={handleSelect}
        />
      </div>
    </aside>
  );
}

function TemplateGroup({
  title,
  templates,
  currentPageIndex,
  pages,
  onSelect,
}: {
  title: string;
  templates: typeof TEMPLATES;
  currentPageIndex: number;
  pages: { templateId: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        {templates.map((tmpl) => {
          const isActive = pages[currentPageIndex]?.templateId === tmpl.id;
          return (
            <div
              key={tmpl.id}
              className={`
                aspect-[3/4] bg-white border rounded-[var(--radius-lg)]
                flex flex-col items-center justify-center gap-1 cursor-pointer
                text-[var(--text-caption)] text-[var(--color-gray-500)]
                transition-all duration-150
                ${isActive
                  ? 'border-2 border-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-xs)] active:border-[var(--color-primary-600)]'
                }
              `}
              onClick={() => onSelect(tmpl.id)}
            >
              {/* Mini layout indicator */}
              <div className="w-10 h-10 p-1">
                <TemplateMiniPreview templateId={tmpl.id} />
              </div>
              <span>{tmpl.name}</span>
              <span className="text-[var(--text-nano)] text-[var(--color-gray-400)]">
                {tmpl.slots.length}位
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Minimal template slot preview — dynamically renders from actual slot positions */
function TemplateMiniPreview({ templateId }: { templateId: string }) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template || template.slots.length === 0) {
    return <div className="w-full h-full rounded-[1px] bg-[var(--color-gray-200)]" />;
  }
  return (
    <div className="w-full h-full relative">
      {template.slots.map((slot, i) => (
        <div
          key={slot.id}
          className="absolute rounded-[1px]"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.width}%`,
            height: `${slot.height}%`,
            backgroundColor: `hsl(250, ${50 + (i * 8) % 30}%, ${60 + (i * 5) % 25}%)`,
          }}
        />
      ))}
    </div>
  );
}
