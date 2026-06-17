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

/** Minimal template slot preview inside each template card */
function TemplateMiniPreview({ templateId }: { templateId: string }) {
  const colors: Record<string, string[]> = {
    single: ['#6C63FF'],
    dual: ['#6C63FF', '#A8A2FF'],
    triple: ['#6C63FF', '#A8A2FF', '#C4C0FF'],
    quad: ['#6C63FF', '#A8A2FF', '#C4C0FF', '#E0DEFF'],
    full: ['#6C63FF'],
    'top-bottom': ['#6C63FF', '#A8A2FF'],
    collage: ['#6C63FF', '#A8A2FF', '#C4C0FF'],
    circle: ['#6C63FF'],
    overlap: ['#6C63FF', '#A8A2FF'],
  };

  const palettes = colors[templateId] || ['#6C63FF'];

  const previews: Record<string, React.ReactNode> = {
    single: <div className="w-full h-full rounded-[1px]" style={{ background: palettes[0] }} />,
    dual: (
      <div className="flex gap-0.5 w-full h-full">
        <div className="flex-1 rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="flex-1 rounded-[1px]" style={{ background: palettes[1] }} />
      </div>
    ),
    triple: (
      <div className="flex flex-col gap-0.5 w-full h-full">
        <div className="flex-1 rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="flex gap-0.5 flex-1">
          <div className="flex-1 rounded-[1px]" style={{ background: palettes[1] }} />
          <div className="flex-1 rounded-[1px]" style={{ background: palettes[2] }} />
        </div>
      </div>
    ),
    quad: (
      <div className="grid grid-cols-2 gap-0.5 w-full h-full">
        <div className="rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="rounded-[1px]" style={{ background: palettes[1] }} />
        <div className="rounded-[1px]" style={{ background: palettes[2] }} />
        <div className="rounded-[1px]" style={{ background: palettes[3] }} />
      </div>
    ),
    full: <div className="w-full h-full rounded-[1px]" style={{ background: palettes[0] }} />,
    'top-bottom': (
      <div className="flex flex-col gap-0.5 w-full h-full">
        <div className="flex-1 rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="flex-1 rounded-[1px]" style={{ background: palettes[1] }} />
      </div>
    ),
    collage: (
      <div className="flex gap-0.5 w-full h-full">
        <div className="flex-[3] rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="flex-[2] flex flex-col gap-0.5">
          <div className="flex-1 rounded-[1px]" style={{ background: palettes[1] }} />
          <div className="flex-1 rounded-[1px]" style={{ background: palettes[2] }} />
        </div>
      </div>
    ),
    circle: (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-3/4 h-3/4 rounded-full" style={{ background: palettes[0] }} />
      </div>
    ),
    overlap: (
      <div className="w-full h-full relative">
        <div className="absolute inset-0 w-[65%] h-full rounded-[1px]" style={{ background: palettes[0] }} />
        <div className="absolute right-0 top-[20%] w-[55%] h-[70%] rounded-[1px]" style={{ background: palettes[1] }} />
      </div>
    ),
  };

  return <>{previews[templateId] || previews.single}</>;
}
