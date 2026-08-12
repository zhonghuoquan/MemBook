import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COVER_TEMPLATES, BACK_COVER_TEMPLATES } from '../../types/cover-templates';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';

interface CoverGalleryProps {
  /** 用封面模板新建相册并进入编辑器（templateId 为封面/封底模板 id） */
  onCreateFromCover: (templateId: string) => void;
}

/**
 * CoverGallery —— 主页「封面」设计库
 * ─────────────────────────────────────────
 * 预设多款好看实用的封面/封底模板（类似布局模板，槽位百分比坐标自动适应页面尺寸）。
 * 用户点选某款封面 → 以该封面新建相册进入编辑器，之后只改照片、改文字即可完成封面制作。
 */
export function CoverGallery({ onCreateFromCover }: CoverGalleryProps) {
  const { t } = useTranslation();
  const sb = useScrollbarVisibility<HTMLDivElement>();

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
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll px-5 py-4 space-y-6 ${sb.className}`} {...sb.handlers}>
        {/* 封面模板 */}
        <section>
          <h3 className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-3">{t('home.coverGallery.coverSection')}</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {COVER_TEMPLATES.map((tmpl) => (
              <CoverCard
                key={tmpl.id}
                name={tmpl.name}
                slots={tmpl.slots}
                badge={t('home.coverGallery.coverBadge')}
                useLabel={t('home.coverGallery.use')}
                onClick={() => onCreateFromCover(tmpl.id)}
              />
            ))}
          </div>
        </section>

        {/* 封底模板 */}
        <section>
          <h3 className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-3">{t('home.coverGallery.backCoverSection')}</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {BACK_COVER_TEMPLATES.map((tmpl) => (
              <CoverCard
                key={tmpl.id}
                name={tmpl.name}
                slots={tmpl.slots}
                badge={t('home.coverGallery.backCoverBadge')}
                useLabel={t('home.coverGallery.use')}
                onClick={() => onCreateFromCover(tmpl.id)}
              />
            ))}
          </div>
        </section>

        <p className="text-[11px] leading-relaxed text-[var(--color-gray-400)] pb-4">
          {t('home.coverGallery.hint')}
        </p>
      </div>
    </div>
  );
}

function CoverCard({
  name, slots, badge, useLabel, onClick,
}: {
  name: string;
  slots: { id: string; x: number; y: number; width: number; height: number }[];
  badge: string;
  useLabel: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex flex-col items-stretch gap-1.5 p-2 rounded-[var(--radius-lg)] border
                 bg-white cursor-pointer transition-all duration-150 hover:-translate-y-0.5
                 border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:shadow-[var(--shadow-soft)]"
    >
      <div className="w-full aspect-[3/4] rounded-[8px] relative overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
        {slots.map((s) => (
          <div
            key={s.id}
            className="absolute rounded-[3px]"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.width}%`, height: `${s.height}%`,
              backgroundColor: hovered ? 'var(--color-brand)' : 'var(--color-gray-400)',
              opacity: 0.75,
            }}
          />
        ))}
        {/* 悬浮操作 */}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}>
          <span className="px-3 py-1.5 text-[11px] font-[600] text-white bg-[var(--color-brand)] rounded-full shadow">
            {useLabel}
          </span>
        </div>
      </div>
      <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-[600] rounded-full bg-black/50 text-white">{badge}</span>
      <span className="text-[11px] text-[var(--color-gray-700)] text-center leading-tight px-1">{name}</span>
    </button>
  );
}
