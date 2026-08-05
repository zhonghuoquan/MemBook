/**
 * PageThumbnail — 相册页面缩略图
 * 基于 Canvas 2D 渲染所有元素类型（照片/文本/便签/贴纸/画笔笔触），
 * 与编辑器画布渲染保持一致。用于项目列表中的封面展示。
 */
import { useEffect, useRef, useState } from 'react';
import { resolveTemplate } from '../../types';
import type { AlbumPage, Photo, AlbumSize } from '../../types';
import { SLOT_PALETTE } from '../../constants/templatePalette';
import CanvasPageThumbnail from '../common/CanvasPageThumbnail';

interface PageThumbnailProps {
  page: AlbumPage;
  photos: Photo[];
  /** 乘机缩放比例，默认 1（实际像素） */
  scale?: number;
  /** 是否在无照片时显示空槽位轮廓，默认 true */
  showSlots?: boolean;
  /** 相册尺寸（mm），有 slotOverrides 时需要用于将像素坐标转百分比 */
  albumSize?: AlbumSize;
}

export function PageThumbnail({ page, photos, albumSize }: PageThumbnailProps) {
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
        className="w-full h-full flex items-center justify-center rounded-[2px]"
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
        className="w-full h-full rounded-[2px]"
        style={{ backgroundImage: SLOT_PALETTE[1] }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden rounded-[2px]"
      style={{ backgroundColor: page.background || '#FFFFFF' }}
    >
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
    </div>
  );
}
