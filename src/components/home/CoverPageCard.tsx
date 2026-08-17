/**
 * CoverPageCard — 相册项目封面卡片（精装硬壳相册实物效果）
 * ─────────────────────────────────────────
 * 硬壳物理效果统一由共享 HardcoverFrame 承载（与封面模板库/编辑器面板/翻页预览一致），
 * 此处渲染相册「真实第一页」（用户已保存的封面），而非模板设计稿。
 */
import { useEffect, useRef, useState } from 'react';
import { resolveTemplate } from '../../types';
import type { AlbumPage, Photo, AlbumSize } from '../../types';
import { SLOT_PALETTE } from '../../constants/templatePalette';
import CanvasPageThumbnail from '../common/CanvasPageThumbnail';
import { HardcoverFrame } from '../common/HardcoverFrame';

interface CoverPageCardProps {
  page: AlbumPage;
  photos: Photo[];
  /** 相册尺寸（mm），用于缩略图渲染 */
  albumSize?: AlbumSize;
}

export function CoverPageCard({ page, photos, albumSize }: CoverPageCardProps) {
  const template = resolveTemplate(page);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 测量容器像素尺寸，传给 CanvasPageThumbnail 作为渲染画布大小
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setBox({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!template) {
    return (
      <div
        className="w-full h-full flex items-center justify-center rounded-[1px]"
        style={{ backgroundImage: SLOT_PALETTE[0] }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-[var(--color-brand)]/60">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="9" y2="9" />
        </svg>
      </div>
    );
  }

  if (template.slots.length === 0) {
    return (
      <div
        className="w-full h-full rounded-[1px]"
        style={{ backgroundImage: SLOT_PALETTE[1] }}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <HardcoverFrame className="w-full h-full" backgroundColor={page.background || '#FFFFFF'}>
        {/* 真实封面内容 */}
        {box.w > 0 && box.h > 0 && (
          <CanvasPageThumbnail
            page={page}
            photos={photos}
            width={box.w}
            height={box.h}
            cacheSuffix="home"
            albumSize={albumSize}
          />
        )}
      </HardcoverFrame>
    </div>
  );
}