/**
 * PageThumbnail — 相册页面缩略图
 * 渲染页面背景色 + 模板槽位 + 已放置的照片（object-cover 撑满）
 * 用于项目列表中的封面展示
 */
import { useMemo } from 'react';
import { TEMPLATES } from '../../types';
import type { AlbumPage, Photo } from '../../types';

interface PageThumbnailProps {
  page: AlbumPage;
  photos: Photo[];
  /** 乘机缩放比例，默认 1（实际像素） */
  scale?: number;
  /** 是否在无照片时显示空槽位轮廓，默认 true */
  showSlots?: boolean;
}

export function PageThumbnail({ page, photos, scale = 1, showSlots = true }: PageThumbnailProps) {
  const template = useMemo(() => TEMPLATES.find((t) => t.id === page.templateId), [page.templateId]);

  // 构建 photoId → Photo 快速查找表
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    photos.forEach((p) => map.set(p.id, p));
    return map;
  }, [photos]);

  if (!template) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--color-gray-50)] rounded-[2px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-[var(--color-gray-300)]">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="9" y2="9" />
        </svg>
      </div>
    );
  }

  if (template.slots.length === 0) {
    return <div className="w-full h-full bg-[var(--color-primary-100)] rounded-[2px]" />;
  }

  return (
    <div
      className="w-full h-full relative overflow-hidden rounded-[2px]"
      style={{ backgroundColor: page.background || '#FFFFFF' }}
    >
      {template.slots.map((slot, i) => {
        const placement = page.placements.find((p) => p.slotId === slot.id);
        const photo = placement?.photoId ? photoMap.get(placement.photoId) : undefined;

        return (
          <div
            key={slot.id}
            className="absolute overflow-hidden"
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width: `${slot.width}%`,
              height: `${slot.height}%`,
              borderRadius: `${1 * scale}px`,
            }}
          >
            {photo ? (
              <img
                src={photo.src}
                alt=""
                className="w-full h-full pointer-events-none select-none"
                style={{
                  objectFit: 'cover',
                  objectPosition: 'center',
                  // 如果 photo.height/width 比例与 slot 比例不匹配，objectFit:cover 自动处理
                }}
                loading="lazy"
                draggable={false}
                onError={(e) => {
                  // 图片加载失败时显示槽位占位
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  target.parentElement!.style.backgroundColor = `var(--color-primary-${(i % 3) === 0 ? 100 : (i % 3) === 1 ? 200 : 300})`;
                  target.parentElement!.style.opacity = `${Math.max(0.4, 1 - i * 0.12)}`;
                }}
              />
            ) : showSlots ? (
              <div
                className="w-full h-full border border-white/20"
                style={{
                  backgroundColor: `var(--color-primary-${(i % 3) === 0 ? 100 : (i % 3) === 1 ? 200 : 300})`,
                  opacity: Math.max(0.4, 1 - i * 0.12),
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
