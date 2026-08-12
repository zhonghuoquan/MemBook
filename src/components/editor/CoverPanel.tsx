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
  const cf = page.coverFields ?? {};

  const setField = (field: string, value: string) => {
    useEditorStore.getState().updateCoverFields(currentPageIndex, { [field]: value });
  };

  const switchTemplate = (templateId: string) => {
    useEditorStore.getState().switchCoverTemplate(currentPageIndex, templateId);
  };

  const regenerate = () => {
    useEditorStore.getState().regenerateCoverPage(1);
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
        {/* 一键换设计 */}
        {isCover && (
          <button
            onClick={regenerate}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-[500] rounded-[var(--radius-sm)]
              bg-[var(--color-primary-50)] text-[var(--color-brand)] hover:bg-[var(--color-primary-100)]
              border-none cursor-pointer transition-colors"
            title={t('editor.coverPanel.regenerateHint')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M14 8a6 6 0 1 1-1.8-4.3" />
              <path d="M14 2v3.5h-3.5" />
            </svg>
            {t('editor.coverPanel.regenerate')}
          </button>
        )}
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

      {/* 字段编辑区 */}
      <div className="space-y-2">
        {isCover ? (
          <>
            <Field
              label={t('editor.coverPanel.title')}
              value={cf.title ?? ''}
              placeholder={t('editor.coverPanel.titlePlaceholder')}
              onChange={(v) => setField('title', v)}
            />
            <Field
              label={t('editor.coverPanel.subtitle')}
              value={cf.subtitle ?? ''}
              placeholder={t('editor.coverPanel.subtitlePlaceholder')}
              onChange={(v) => setField('subtitle', v)}
            />
            <Field
              label={t('editor.coverPanel.author')}
              value={cf.author ?? ''}
              placeholder={t('editor.coverPanel.authorPlaceholder')}
              onChange={(v) => setField('author', v)}
            />
            <Field
              label={t('editor.coverPanel.date')}
              value={cf.dateText ?? ''}
              placeholder={t('editor.coverPanel.datePlaceholder')}
              onChange={(v) => setField('dateText', v)}
            />
          </>
        ) : (
          <>
            <Field
              label={t('editor.coverPanel.backText')}
              value={cf.backText ?? ''}
              placeholder={t('editor.coverPanel.backTextPlaceholder')}
              onChange={(v) => setField('backText', v)}
            />
            <Field
              label={t('editor.coverPanel.date')}
              value={cf.dateText ?? ''}
              placeholder={t('editor.coverPanel.datePlaceholder')}
              onChange={(v) => setField('dateText', v)}
            />
            <Field
              label={t('editor.coverPanel.author')}
              value={cf.author ?? ''}
              placeholder={t('editor.coverPanel.authorPlaceholder')}
              onChange={(v) => setField('author', v)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-[500] text-[var(--color-gray-500)] mb-0.5">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-[12px] text-[var(--color-gray-800)] rounded-[var(--radius-sm)]
          border border-[var(--color-border)] bg-white focus:border-[var(--color-brand)] focus:ring-1
          focus:ring-[var(--color-primary-200)] outline-none transition-colors"
      />
    </label>
  );
}
