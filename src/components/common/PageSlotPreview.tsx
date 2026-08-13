import { useEditorStore } from '../../store';
import { normalizeSlotCornerRadius } from '../../types';
import { SLOT_PALETTE, SLOT_BORDER_COLORS } from '../../constants/templatePalette';
import { calcPagePreviewFit } from '../../utils/sharedRender';
import type { AlbumPage, Template } from '../../types';

interface PageSlotPreviewProps {
  page: AlbumPage;
  template?: Template;
  width: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 页面槽位模板风格预览。
 * 与 TemplatePanel 的 TemplateMiniPreview 保持一致的渐变配色和边框，
 * 用于布局切换弹窗、底部缩略图空槽、网格视图占位等场景。
 */
export function PageSlotPreview({
  page,
  template,
  width,
  height,
  className,
  style,
}: PageSlotPreviewProps) {
  const albumSize = useEditorStore.getState().albumSize;
  const slots = template?.slots ?? [];
  if (slots.length === 0) return null;

  const containerHeight = height ?? (albumSize
    ? (width * albumSize.height) / albumSize.width
    : width * 1.4);

  const fit = calcPagePreviewFit(albumSize, width, containerHeight);
  const cornerRadius = normalizeSlotCornerRadius(page.slotCornerRadius) * fit.scale;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        height: containerHeight,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: fit.offsetX,
          top: fit.offsetY,
          width: fit.renderW,
          height: fit.renderH,
        }}
      >
        {slots.map((slot, i) => {
          const ov = page.slotOverrides?.[slot.id];
          let left: string | number;
          let top: string | number;
          let w: string | number;
          let h: string | number;

          if (ov && albumSize) {
            left = ov.x * fit.scale;
            top = ov.y * fit.scale;
            w = ov.width * fit.scale;
            h = ov.height * fit.scale;
          } else {
            left = `${slot.x}%`;
            top = `${slot.y}%`;
            w = `${slot.width}%`;
            h = `${slot.height}%`;
          }

          return (
            <div
              key={slot.id}
              style={{
                position: 'absolute',
                left,
                top,
                width: w,
                height: h,
                backgroundImage: SLOT_PALETTE[i % SLOT_PALETTE.length],
                border: `1px solid ${SLOT_BORDER_COLORS[i % SLOT_BORDER_COLORS.length]}`,
                borderRadius: `${cornerRadius}px`,
                boxSizing: 'border-box',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
