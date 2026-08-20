import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COVER_TEMPLATES, getTemplateName } from '../../types/cover-templates';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import type { Template } from '../../types';
import { CoverPreview } from '../common/CoverPreview';
import { Modal } from '../common/Modal';

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
 */
export function CoverGallery({ onCreateFromCover }: CoverGalleryProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const sb = useScrollbarVisibility<HTMLDivElement>();
  // 大图预览当前选中的封面模板
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  // 封面预览尺寸：默认方形；弹窗标题右侧切换
  const [sizeKey, setSizeKey] = useState<CoverSizeKey>('square');

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

      {/* 大图预览：展示该款模板封面，点击在封面↔封底间翻转切换 */}
      <Modal open={!!previewTemplate} onClose={() => setPreviewTemplate(null)} maxWidth="860px" height="min(90vh, 780px)" centerContent title={previewTemplate ? t('home.coverGallery.previewTitle') : ''}
        headerRight={
          previewTemplate && <SizeSwitcher value={sizeKey} onChange={setSizeKey} />
        }>
        {previewTemplate && (
          <CoverFlipPreview template={previewTemplate} sizeKey={sizeKey} />
        )}
      </Modal>
    </div>
  );
}

/** 可切换的封面尺寸档位：字段 w×h（mm） */
const COVER_SIZES = [
  { key: 'landscape', w: 280, h: 210 },
  { key: 'square', w: 210, h: 210 },
  { key: 'portrait', w: 210, h: 280 },
] as const;
type CoverSizeKey = (typeof COVER_SIZES)[number]['key'];

/** 线条化尺寸切换器：三个描边矩形示意横向/方形/竖向，纯图形、改用线条风格
 *  （参考封面线条化 icon），固定高度、宽度按各自比例，选中项品牌色描边 + 浅底圈出 */
function SizeSwitcher({ value, onChange }: { value: CoverSizeKey; onChange: (k: CoverSizeKey) => void }) {
  const H = 16; // 图标固定高，宽按比例取
  return (
    <div className="flex items-center gap-1">
      {COVER_SIZES.map((s) => {
        const active = s.key === value;
        const w = Math.round((H * s.w) / s.h);
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            title={`${s.w}×${s.h}`}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer ${
              active
                ? 'bg-[var(--color-brand)]/10 ring-1 ring-[var(--color-brand)]'
                : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-700)] hover:bg-[var(--color-gray-100)]'
            }`}
          >
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
              <rect
                x="1" y="1" width={w - 2} height={H - 2} rx="2"
                fill="none"
                stroke={active ? 'var(--color-brand)' : 'currentColor'}
                strokeWidth={active ? 1.8 : 1.4}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** 封面/封底大图预览：单张真实渲染，点击在封面↔封底间切换。
 *  切换动效对齐「预览功能」封面切换：当前面先 3D 翻开淡出（0.55s）→ 换面 → 新面柔和落定（0.5s）。
 *  尺寸由弹窗标题右侧 SizeSwitcher 受控传入，封面按所选尺寸比例完整显示。 */
function CoverFlipPreview({
  template,
  sizeKey,
}: {
  template: Template;
  sizeKey: CoverSizeKey;
}) {
  const { t } = useTranslation();
  const [face, setFace] = useState<'front' | 'back'>('front');
  // 翻开淡出进行中：仅作用于「当前正在显示」的那一面（face 键不变时本页子节点稳定，切换面时整棵重挂）
  const [flick, setFlick] = useState(false);
  const backTemplate = template.backCover;
  const hasBack = !!backTemplate;
  const isBack = face === 'back' && hasBack;
  const current = isBack ? backTemplate : template;
  const size = COVER_SIZES.find((s) => s.key === sizeKey) ?? COVER_SIZES[1];
  // 弹窗固定尺寸（与 Modal height 一致），封面宽度按所选比例在固定窗口内反推，
  // 保证横向/方形/竖向切换时窗口大小不变、封面始终完整显示。
  const ratio = size.w / size.h;
  const DIALOG_H = 'min(90vh, 780px)';
  const coverWidthCss = `min(660px, calc(${DIALOG_H} - 210px) * ${ratio})`;
  const aspectCss = `${size.w} / ${size.h}`;

  const handleFlip = () => {
    if (!hasBack || flick) return;
    setFlick(true);
    // 先「翻开 → 淡出」0.55s，随后切换封面/封底并重挂落定
    window.setTimeout(() => {
      setFace((f) => (f === 'front' ? 'back' : 'front'));
      setFlick(false);
    }, 550);
  };

  // 翻开方向 / 落定方向均按当前面镜像：封面书脊在左（向左翻开）、封底书脊在右（向右翻开）
  const settleClass = isBack ? 'cover-settle-back' : 'cover-settle-front';
  const awayClass = isBack ? 'cover-flip-away-back' : 'cover-flip-away-front';

  return (
    <div className="flex flex-col items-center justify-center min-h-full select-none">
      {/* 切换动效样式：翻开淡出 + 新面落定（对齐预览功能封面切换） */}
      <style>{`
        @keyframes cover-flip-away-front { to { transform: perspective(1400px) translateX(-38%) rotateY(-34deg); opacity: 0; } }
        @keyframes cover-flip-away-back  { to { transform: perspective(1400px) translateX(38%)  rotateY(34deg);  opacity: 0; } }
        .cover-flip-away-front { transform-origin: left center; animation: cover-flip-away-front 0.55s cubic-bezier(0.5,0,0.8,0.4) forwards; }
        .cover-flip-away-back  { transform-origin: right center; animation: cover-flip-away-back 0.55s cubic-bezier(0.5,0,0.8,0.4) forwards; }
        @keyframes cover-settle-front { from { opacity: 0.5; transform: perspective(1600px) rotateY(-20deg); } to { opacity: 1; transform: perspective(1600px) rotateY(0deg); } }
        @keyframes cover-settle-back  { from { opacity: 0.5; transform: perspective(1600px) rotateY(20deg); } to { opacity: 1; transform: perspective(1600px) rotateY(0deg); } }
        .cover-settle-front { transform-origin: left center; animation: cover-settle-front 0.5s cubic-bezier(0.22,1,0.36,1); }
        .cover-settle-back  { transform-origin: right center; animation: cover-settle-back 0.5s cubic-bezier(0.22,1,0.36,1); }
      `}</style>

      <div onClick={handleFlip} title={t('home.coverGallery.previewBtn')} className="group relative cursor-pointer border-none bg-transparent p-6 outline-none">
        {/* 悬浮放大：在稳定的外层应用 scale 上浮 + 强化投影，不与翻面/落定的 transform 冲突 */}
        <div className="relative transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-hover:-translate-y-2">
          {/* face 键：切换面时整棵重挂 → 触发新面的落定动画；flick 变化不重挂 */}
          <div key={face} className={settleClass}>
            {/* 翻开淡出：仅影响当前面自身，翻完换面后旧面卸载、新面不带此态 */}
            <div className={flick ? awayClass : ''} style={{ width: coverWidthCss, transition: 'transform 0.55s cubic-bezier(0.4,0.2,0.2,1), opacity 0.55s ease' }}>
              <div className="w-full" style={{ aspectRatio: aspectCss }}>
                <CoverPreview template={current} variant={isBack ? 'back' : 'front'} aspectRatio={aspectCss} />
              </div>
            </div>
          </div>
        </div>
      </div>
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
