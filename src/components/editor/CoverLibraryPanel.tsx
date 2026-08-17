import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { COVER_TEMPLATES, getTemplateName } from '../../types/cover-templates';
import type { Template } from '../../types';
import { CoverPreview } from '../common/CoverPreview';
import { Modal } from '../common/Modal';

/**
 * CoverLibraryPanel —— 编辑器左侧「封面」面板
 * ─────────────────────────────────────────
 * 展示封面模板（含书脊 + 真实图片占位 + 预设文字/形状的真实预览）：
 *   - 卡片左上角眼睛图标：点击弹出大图，同时查看封面页与配套封底页。
 *   - 卡片本体点击：进入编辑——
 *       * 当前页是封面：切换封面模板（保留已填照片）
 *       * 当前页是普通页：插入封面页
 *   - 卡片右上角：淡绿色对勾角标，表示当前选中的封面模板。
 * 每款封面都内置配套封底（template.backCover），应用封面时自动同步应用封底，整体成套、不拆分开。
 */
export function CoverLibraryPanel() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const addToast = useUIStore((s) => s.addToast);
  const applyCoverTemplate = useEditorStore((s) => s.applyCoverTemplate);

  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const currentPage = pages[currentPageIndex];
  const currentPageKind = currentPage?.pageKind;

  const handleSelect = async (templateId: string) => {
    await applyCoverTemplate(templateId);
    addToast({ type: 'success', message: currentPageKind === 'cover' ? t('editor.coverLibrary.switched') : t('editor.coverLibrary.coverAdded') });
  };

  const isActive = (templateId: string) => currentPage?.templateId === templateId;

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto ps-scroll pl-4 pr-2 py-4 space-y-6">

        <Section label={t('editor.coverLibrary.coverSection')}>
          <div className="grid grid-cols-2 gap-x-5 gap-y-7">
            {COVER_TEMPLATES.map((tmpl) => (
              <CoverTemplateCard
                key={tmpl.id}
                template={tmpl}
                name={getTemplateName(tmpl, isZh)}
                active={isActive(tmpl.id)}
                previewLabel={t('editor.coverLibrary.previewTitle')}
                onClick={() => handleSelect(tmpl.id)}
                onPreview={() => setPreviewTemplate(tmpl)}
              />
            ))}
          </div>
        </Section>

        <div className="text-[11px] leading-relaxed text-[var(--color-gray-400)] px-1 pb-2">
          {t('editor.coverLibrary.hint')}
        </div>
      </div>

      {/* 封面大图预览：同时展示封面页与配套封底页 */}
      <Modal open={!!previewTemplate} onClose={() => setPreviewTemplate(null)} maxWidth="960px" title={previewTemplate ? t('editor.coverLibrary.previewTitle') : ''}>
        {previewTemplate && (
          <div className="grid grid-cols-2 gap-10 py-4">
            <PreviewPair
              label={t('editor.coverLibrary.previewCover')}
              template={previewTemplate}
            />
            {previewTemplate.backCover ? (
              <PreviewPair
                label={t('editor.coverLibrary.previewBack')}
                template={previewTemplate.backCover}
              />
            ) : (
              <div />
            )}
          </div>
        )}
      </Modal>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-3 px-1">{label}</div>
      {children}
    </div>
  );
}

/** 大图预览对：单张封面/封底缩略预览 + 底部说明 */
function PreviewPair({ label, template }: { label: string; template: Template }) {
  return (
    <div>
      <div className="grid place-items-center">
        <div className="w-full">
          <CoverPreview template={template} />
        </div>
      </div>
      <div className="mt-4 text-center text-[12px] font-[600] text-[var(--color-gray-700)]">{label}</div>
    </div>
  );
}

/** 封面模板卡片：正方形封面预览 + 左上角眼睛(查看大图) + 右上角对勾(选中) + 底部模板名 */
function CoverTemplateCard({
  template, name, active, previewLabel, onClick, onPreview,
}: {
  template: Template;
  name: string;
  active: boolean;
  previewLabel: string;
  onClick: () => void;
  onPreview: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex flex-col items-stretch cursor-pointer"
    >
      <div
        className={`relative rounded-[1px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] group-hover:-translate-y-1 ${
          active ? 'group-hover:shadow-[0_18px_36px_-10px_rgba(0,0,0,0.30)]' : 'group-hover:shadow-[0_18px_36px_-10px_rgba(0,0,0,0.24)]'
        }`}
        onClick={onClick}
      >
        <div
          className="rounded-[1px] transition-shadow duration-300"
          style={{
            boxShadow: active
              ? '0 4px 18px rgba(0,0,0,0.22)'
              : '0 2px 8px rgba(0,0,0,0.14)',
          }}
        >
          <CoverPreview template={template} />
        </div>

        {/* 左上角眼睛图标：查看封面/封底大图（悬浮显示） */}
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          title={previewLabel}
          className={`absolute top-1.5 left-1.5 z-10 w-7 h-7 flex items-center justify-center rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-all duration-150 hover:scale-110 ${hovered ? 'opacity-100' : 'opacity-0'}`}
          style={{ backgroundColor: 'rgba(31,31,30,0.6)' }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="1.8" />
          </svg>
        </button>

        {/* 右上角对勾角标：选中态（始终显示） */}
        {active && (
          <span
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-bl-[1px] pointer-events-none"
            style={{ backgroundColor: 'rgba(82,196,132,0.85)' }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
      <span className={`mt-2 text-center text-[11px] leading-snug transition-colors ${active ? 'text-[var(--color-brand)] font-[600]' : 'text-[var(--color-gray-600)] group-hover:text-[var(--color-gray-800)]'}`}>{name}</span>
    </div>
  );
}