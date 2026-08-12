import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { COVER_TEMPLATES, BACK_COVER_TEMPLATES } from '../../types/cover-templates';
import { isCoverPage, isBackCoverPage } from '../../types';

/**
 * CoverLibraryPanel —— 编辑器左侧「封面」面板
 * ─────────────────────────────────────────
 * 展示所有封面 / 封底模板（类似布局模板），点击即可应用/切换：
 *   - 当前页已是封面：点封面模板 → switchCoverTemplate（保留照片与文字）
 *   - 当前页已是封底：点封底模板 → switchBackCoverTemplate（保留文案）
 *   - 当前页是普通页：点封面模板 → 插入新封面页（addCoverPage）
 *                      点封底模板 → 插入新封底页（addBackCoverPage）
 * 封面/封底模板的槽位使用百分比坐标，自动适应页面尺寸。
 */
export function CoverLibraryPanel() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const addToast = useUIStore((s) => s.addToast);
  const addCoverPage = useEditorStore((s) => s.addCoverPage);
  const addBackCoverPage = useEditorStore((s) => s.addBackCoverPage);
  const switchCoverTemplate = useEditorStore((s) => s.switchCoverTemplate);
  const switchBackCoverTemplate = useEditorStore((s) => s.switchBackCoverTemplate);

  const currentPage = pages[currentPageIndex];
  const currentIsCover = currentPage ? isCoverPage(currentPage) : false;
  const currentIsBackCover = currentPage ? isBackCoverPage(currentPage) : false;

  const handleSelect = (templateId: string) => {
    const isCover = templateId.startsWith('cover-');
    const isBack = templateId.startsWith('backcover-');

    if (isCover) {
      if (currentIsCover) {
        // 当前页已是封面 → 切换版式（保留主图与文字）
        switchCoverTemplate(currentPageIndex, templateId);
        addToast({ type: 'success', message: t('editor.coverLibrary.switched') });
      } else {
        // 普通页 → 插入新封面页
        addCoverPage({ templateId });
        addToast({ type: 'success', message: t('editor.coverLibrary.coverAdded') });
      }
      return;
    }
    if (isBack) {
      if (currentIsBackCover) {
        switchBackCoverTemplate(currentPageIndex, templateId);
        addToast({ type: 'success', message: t('editor.coverLibrary.switched') });
      } else {
        addBackCoverPage({ templateId });
        addToast({ type: 'success', message: t('editor.coverLibrary.backCoverAdded') });
      }
      return;
    }
  };

  const isActive = (templateId: string) => currentPage?.templateId === templateId;

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          {t('editor.coverLibrary.title')}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 space-y-4">
        {/* 当前页面类型提示 */}
        {currentPage && (
          <div className="text-[11px] leading-relaxed text-[var(--color-gray-500)] px-1">
            {currentIsCover || currentIsBackCover
              ? t('editor.coverLibrary.onCoverPageHint')
              : t('editor.coverLibrary.onNormalPageHint')}
          </div>
        )}

        {/* 封面模板 */}
        <Section label={t('editor.coverLibrary.coverSection')}>
          <div className="grid grid-cols-2 gap-2">
            {COVER_TEMPLATES.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                name={tmpl.name}
                slots={tmpl.slots}
                active={isActive(tmpl.id)}
                badge={t('editor.coverLibrary.coverBadge')}
                onClick={() => handleSelect(tmpl.id)}
              />
            ))}
          </div>
        </Section>

        {/* 封底模板 */}
        <Section label={t('editor.coverLibrary.backCoverSection')}>
          <div className="grid grid-cols-2 gap-2">
            {BACK_COVER_TEMPLATES.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                name={tmpl.name}
                slots={tmpl.slots}
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

function TemplateCard({
  name, slots, active, badge, onClick,
}: {
  name: string;
  slots: { id: string; x: number; y: number; width: number; height: number }[];
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
      {/* 迷你版式预览 */}
      <div className="w-full aspect-[3/4] rounded-[6px] relative overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
        {slots.map((s) => (
          <div
            key={s.id}
            className="absolute rounded-[2px]"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.width}%`, height: `${s.height}%`,
              backgroundColor: active ? 'var(--color-brand)' : 'var(--color-gray-400)',
              opacity: 0.75,
            }}
          />
        ))}
      </div>
      {/* 角标 */}
      <span
        className="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-[600] rounded-full
                   bg-black/50 text-white backdrop-blur-sm"
      >
        {badge}
      </span>
      <span className="text-[11px] text-[var(--color-gray-700)] text-center leading-tight px-1">{name}</span>
    </button>
  );
}
