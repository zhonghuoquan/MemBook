import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COVER_TEMPLATES, getTemplateName } from '../../types/cover-templates';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import type { Template } from '../../types';
import { CoverPreview } from '../common/CoverPreview';
import { CoverPreviewOverlay } from '../common/CoverPreviewOverlay';

interface CoverGalleryProps {
  /** 用封面模板新建相册并进入编辑器（templateId 为封面前端模板 id） */
  onCreateFromCover: (templateId: string) => void;
}

/**
 * CoverGallery —— 主页「封面」设计库
 * ─────────────────────────────────────────
 * 预设多款 Mixbook 风格封面前端模板（含书脊 + 真实图片占位 + 预设文字/形状）。
 * 用户点选某款封面 → 以该封面新建相册进入编辑器，之后只改照片、改文字即可完成封面制作。
 * 每款封面都内置配套封底（template.backCover），应用时自动同步生成封底，整体成套、不拆分开。
 * 左上角眼睛预览弹窗与编辑器左侧封面面板共用 CoverPreviewOverlay。
 */
export function CoverGallery({ onCreateFromCover }: CoverGalleryProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const sb = useScrollbarVisibility<HTMLDivElement>();
  // 大图预览当前选中的封面模板
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-light)]">
        <div>
          <h2 className="text-[15px] font-[600] text-[var(--color-gray-800)]">{t('home.coverGallery.title')}</h2>
          <p className="text-[11px] text-[var(--color-gray-400)] mt-0.5">{t('home.coverGallery.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll px-5 py-4 space-y-8 ${sb.className}`} {...sb.handlers}>
        {/* 封面模板 */}
        <section>
          <h3 className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-3">{t('home.coverGallery.coverSection')}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-14 gap-y-12">
            {COVER_TEMPLATES.map((tmpl) => (
              <CoverCard
                key={tmpl.id}
                template={tmpl}
                name={getTemplateName(tmpl, isZh)}
                useLabel={t('home.coverGallery.use')}
                previewLabel={t('home.coverGallery.previewBtn')}
                onClick={() => onCreateFromCover(tmpl.id)}
                onPreview={() => setPreviewTemplate(tmpl)}
              />
            ))}
          </div>
        </section>

        <p className="text-[11px] leading-relaxed text-[var(--color-gray-400)] pb-4">
          {t('home.coverGallery.hint')}
        </p>
      </div>

      {/* 大图预览：共用 - 展示该款模板封面，点击在封面↔封底间翻转切换 */}
      <CoverPreviewOverlay
        open={!!previewTemplate}
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        title={t('home.coverGallery.previewTitle')}
      />
    </div>
  );
}

function CoverCard({
  template, name, useLabel, previewLabel, onClick, onPreview,
}: {
  template: Template;
  name: string;
  useLabel: string;
  previewLabel: string;
  onClick: () => void;
  onPreview: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex flex-col items-stretch cursor-default"
    >
      <div className="relative transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] group-hover:-translate-y-1.5 group-hover:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.28)]">
        <CoverPreview template={template} />
        {/* 左上角眼睛按钮 — 大图预览封面/封底（悬浮显示；不进入新建/编辑） */}
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          title={previewLabel}
          className={`absolute top-2 left-2 z-10 w-8 h-8 flex items-center justify-center rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-all duration-150 hover:scale-110 ${hovered ? 'opacity-100' : 'opacity-0'}`}
          style={{ backgroundColor: 'rgba(31,31,30,0.6)' }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="1.8" />
          </svg>
        </button>
        {/* 编辑按钮 — 悬浮显示在封面右上角，仅点击此按钮进入编辑 */}
        <button
          onClick={onClick}
          title={useLabel}
          className={`absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full text-white bg-[var(--color-brand)] shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-all duration-150 hover:scale-110 ${hovered ? 'opacity-100' : 'opacity-0'}`}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
          </svg>
        </button>
      </div>
      <span className="mt-2 text-[12px] text-[var(--color-gray-600)] text-center leading-snug">{name}</span>
    </div>
  );
}