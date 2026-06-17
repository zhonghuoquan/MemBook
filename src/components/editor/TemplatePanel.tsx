import { useState, useCallback } from 'react';
import { useEditorStore, useUIStore, usePhotoStore } from '../../store';
import { TEMPLATES } from '../../types';
import { TemplateSwitchDialog } from './TemplateSwitchDialog';

export function TemplatePanel() {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const addToast = useUIStore((s) => s.addToast);
  const photos = usePhotoStore((s) => s.photos);

  // 模板切换弹窗状态
  const [switchDialog, setSwitchDialog] = useState<{
    targetTemplateId: string;
    filledPhotos: { id: string; src: string; name: string }[];
  } | null>(null);

  const currentPage = pages[currentPageIndex];

  const handleSelect = useCallback((templateId: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: '请先创建相册页面' });
      return;
    }

    const page = pages[currentPageIndex];
    if (!page) return;

    // 获取已填充的照片
    const filledPlacements = page.placements.filter((p) => p.photoId !== null);
    const N = filledPlacements.length;
    const targetTemplate = TEMPLATES.find((t) => t.id === templateId);
    if (!targetTemplate) return;
    const M = targetTemplate.slots.length;

    if (N > M) {
      // 场景 2：新模板更少 → 弹出选择对话框
      const filledPhotoList = filledPlacements
        .map((p) => {
          const photo = photos.find((ph) => ph.id === p.photoId);
          return photo ? { id: photo.id, src: photo.src, name: photo.name } : null;
        })
        .filter(Boolean) as { id: string; src: string; name: string }[];

      setSwitchDialog({ targetTemplateId: templateId, filledPhotos: filledPhotoList });
    } else {
      // 场景 1 & 3：N ≤ M → 直接切换，已有照片按序迁移
      setPageTemplate(currentPageIndex, templateId);
      addToast({ type: 'success', message: `已切换至「${targetTemplate.name}」` });
    }
  }, [pages, currentPageIndex, setPageTemplate, addToast, photos]);

  const handleSwitchConfirm = useCallback((selectedIds: string[]) => {
    if (switchDialog) {
      setPageTemplate(currentPageIndex, switchDialog.targetTemplateId, selectedIds);
      const targetTemplate = TEMPLATES.find((t) => t.id === switchDialog.targetTemplateId);
      addToast({ type: 'success', message: `已切换至「${targetTemplate?.name}」` });
    }
    setSwitchDialog(null);
  }, [switchDialog, currentPageIndex, setPageTemplate, addToast]);

  const handleSwitchCancel = useCallback(() => {
    setSwitchDialog(null);
  }, []);

  const classicTemplates = TEMPLATES.filter((t) => t.category === 'classic');
  const creativeTemplates = TEMPLATES.filter((t) => t.category === 'creative');

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
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

      {/* 模板切换选择对话框（N > M） */}
      {switchDialog && currentPage && (
        <TemplateSwitchDialog
          open
          currentPage={currentPage}
          targetTemplateId={switchDialog.targetTemplateId}
          filledPhotos={switchDialog.filledPhotos.map((fp) => {
            const full = photos.find((p) => p.id === fp.id);
            return full || { ...fp, date: '', width: 0, height: 0, orientation: 'square' as const };
          })}
          onConfirm={handleSwitchConfirm}
          onCancel={handleSwitchCancel}
        />
      )}
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
