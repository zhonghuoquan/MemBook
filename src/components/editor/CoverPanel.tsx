import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store';
import { COVER_TEMPLATES, BACK_COVER_TEMPLATES } from '../../types/cover-templates';
import { isCoverPage, isBackCoverPage } from '../../types';

/**
 * CoverPanel —— 封面/封底专属编辑面板
 * ─────────────────────────────────────────
 * 当编辑器当前页为封面（cover）或封底（backCover）时，在画布右侧叠加显示，
 * 提供：
 *   1. 一键换设计（重新智能生成下一款设计，切换版式/主图/配色）
 *   2. 封面版式切换（6 款封面 + 2 款封底模板，保留主图与文案）
 *   3. 结构化字段编辑（标题/副标题/作者/日期 / 封底文案/日期/作者）
 */
export function CoverPanel() {
  const { t } = useTranslation();
  const pages = useEditorStore((s) => s.pages);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const page = pages[currentPageIndex];

  if (!page || (!isCoverPage(page) && !isBackCoverPage(page))) {
    return null;
  }

  const isCover = isCoverPage(page);
  const templates = isCover ? COVER_TEMPLATES : BACK_COVER_TEMPLATES;
  const switchTemplate = (templateId: string) => {
    useEditorStore.getState().switchCoverTemplate(currentPageIndex, templateId);
  };

  return (
    <div
      className="absolute top-16 right-4 z-30 w-[280px] max-h-[calc(100%-5rem)] overflow-y-auto
        bg-white/95 backdrop-blur-sm border border-[var(--color-border)] rounded-[var(--radius-lg)]
        shadow-[var(--shadow-lg)] p-3 space-y-3"
    >
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-[600] text-[var(--color-gray-800)]">
          {isCover ? '📕 封面编辑' : '📗 封底编辑'}
        </span>
      </div>

      {/* 封面：版式切换缩略 */}
      {isCover && (
        <div>
          <div className="text-[11px] font-[500] text-[var(--color-gray-500)] mb-1.5">
            {t('editor.coverPanel.template')}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {templates.map((tmpl) => {
              const active = page.templateId === tmpl.id;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => switchTemplate(tmpl.id)}
                  className={`
                    flex flex-col items-center gap-1 p-1 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                    ${active
                      ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)]'
                      : 'border-[var(--color-border-light)] hover:border-[var(--color-primary-300)]'
                    }
                  `}
                >
                  {/* 迷你版式预览：用小方块示意主图位置 */}
                  <div className="w-full h-10 rounded-[4px] relative" style={{ backgroundColor: active ? 'var(--color-primary-100)' : 'var(--color-surface-hover)' }}>
                    {tmpl.slots.map((s) => (
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
                  <span className="text-[10px] text-[var(--color-gray-600)] leading-tight text-center">{tmpl.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 自由文字编辑提示 */}
      <div className="text-[11px] leading-relaxed text-[var(--color-gray-500)] p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
        {t('editor.coverPanel.freeTextHint')}
      </div>
    </div>
  );
}
