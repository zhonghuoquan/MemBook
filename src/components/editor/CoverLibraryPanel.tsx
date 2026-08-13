import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { COVER_TEMPLATES, BACK_COVER_TEMPLATES } from '../../types/cover-templates';
import { isCoverPage, isBackCoverPage } from '../../types';
import type { Template } from '../../types';
import { CoverPreview } from '../common/CoverPreview';

/**
 * CoverLibraryPanel —— 编辑器左侧「封面」面板
 * ─────────────────────────────────────────
 * 展示所有封面 / 封底模板（含书脊 + 真实图片占位 + 预设文字/形状的真实预览），点击即应用：
 *   - 当前页是封面：切换封面模板（保留已填照片）
 *   - 当前页是封底：切换封底模板
 *   - 当前页是普通页：插入封面页
 * 应用后所有元素（照片/文字/形状/书脊）皆为独立可编辑元素，可用工具栏继续自由编辑。
 */
export function CoverLibraryPanel() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const addToast = useUIStore((s) => s.addToast);
  const applyCoverTemplate = useEditorStore((s) => s.applyCoverTemplate);
  const applyBackCoverTemplate = useEditorStore((s) => s.applyBackCoverTemplate);

  const currentPage = pages[currentPageIndex];
  const currentIsCover = currentPage ? isCoverPage(currentPage) : false;
  const currentIsBackCover = currentPage ? isBackCoverPage(currentPage) : false;

  const handleSelect = (templateId: string) => {
    if (templateId.startsWith('cover-')) {
      applyCoverTemplate(templateId);
      addToast({ type: 'success', message: currentIsCover ? t('editor.coverLibrary.switched') : t('editor.coverLibrary.coverAdded') });
      return;
    }
    if (templateId.startsWith('backcover-')) {
      applyBackCoverTemplate(templateId);
      addToast({ type: 'success', message: currentIsBackCover ? t('editor.coverLibrary.switched') : t('editor.coverLibrary.backCoverAdded') });
    }
  };

  const isActive = (templateId: string) => currentPage?.templateId === templateId;

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          {t('editor.coverLibrary.title')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 space-y-4">
        {currentPage && (
          <div className="text-[11px] leading-relaxed text-[var(--color-gray-500)] px-1">
            {currentIsCover || currentIsBackCover
              ? t('editor.coverLibrary.onCoverPageHint')
              : t('editor.coverLibrary.onNormalPageHint')}
          </div>
        )}

        <Section label={t('editor.coverLibrary.coverSection')}>
          <div className="grid grid-cols-2 gap-2">
            {COVER_TEMPLATES.map((tmpl) => (
              <CoverTemplateCard
                key={tmpl.id}
                template={tmpl}
                active={isActive(tmpl.id)}
                badge={t('editor.coverLibrary.coverBadge')}
                onClick={() => handleSelect(tmpl.id)}
              />
            ))}
          </div>
        </Section>

        <Section label={t('editor.coverLibrary.backCoverSection')}>
          <div className="grid grid-cols-2 gap-2">
            {BACK_COVER_TEMPLATES.map((tmpl) => (
              <CoverTemplateCard
                key={tmpl.id}
                template={tmpl}
                active={isActive(tmpl.id)}
                badge={t('editor.coverLibrary.backCoverBadge')}
                onClick={() => handleSelect(tmpl.id)}
              />
            ))}
          </div>
        </Section>

        <div className="text-[11px] leading-relaxed text-[var(--color-gray-400)] px-1 pb-2">
          {t('editor.coverLibrary.hint')}
        </div>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-2 px-1">{label}</div>
      {children}
    </div>
  );
}

/** 封面模板卡片：正方形预览 + 名称 + 角标，点击应用 */
function CoverTemplateCard({
  template, active, badge, onClick,
}: {
  template: Template;
  active: boolean;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex flex-col items-stretch gap-1 p-1.5 rounded-[var(--radius-md)] border cursor-pointer transition-colors relative
        ${active
          ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] ring-1 ring-[var(--color-primary-200)]'
          : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-300)]'
        }
      `}
    >
      <CoverPreview template={template} active={active} />
      <span
        className="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-[600] rounded-full
                   bg-black/55 text-white backdrop-blur-sm"
      >
        {badge}
      </span>
      <span className="text-[11px] text-[var(--color-gray-700)] text-center leading-tight px-1">{template.name}</span>
    </button>
  );
}
