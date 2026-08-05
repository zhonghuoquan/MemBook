/**
 * 画布空状态组件：无页面时显示添加第一张页面的引导
 * 从 Canvas.tsx 提取，自包含组件
 */
import { useTheme } from '../../../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store';
import { TEMPLATES } from '../../../types';
import { SLOT_CANVAS_PALETTE } from '../../../constants/templatePalette';
import type { AlbumSize, PageMarginSettings } from '../../../types';
import { MM_TO_PX } from './constants';

interface CanvasEmptyStateProps {
  albumSize: AlbumSize | null;
  pageMargin: PageMarginSettings;
  slotGap: number;
  defaultSlotCornerRadius: number;
}

export function CanvasEmptyState({ albumSize, pageMargin, slotGap, defaultSlotCornerRadius }: CanvasEmptyStateProps) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  const handleClick = () => {
    useEditorStore.getState().addPage();
  };

  // 页面逻辑像素尺寸
  const pageW = albumSize ? albumSize.width : 210;
  const pageH = albumSize ? albumSize.height : 280;
  const pageWPx = pageW * MM_TO_PX;
  const pageHPx = pageH * MM_TO_PX;

  // 限制最大预览尺寸，保持相册原始比例
  const maxW = 320;
  const maxH = 440;
  const scale = Math.min(maxW / pageWPx, maxH / pageHPx, 1);
  const previewW = pageWPx * scale;
  const previewH = pageHPx * scale;

  // 边距在预览中的像素值
  const marginTop = pageMargin.top * MM_TO_PX * scale;
  const marginBottom = pageMargin.bottom * MM_TO_PX * scale;
  const marginLeft = pageMargin.left * MM_TO_PX * scale;
  const marginRight = pageMargin.right * MM_TO_PX * scale;

  // 安全区像素尺寸
  const safeW = previewW - marginLeft - marginRight;
  const safeH = previewH - marginTop - marginBottom;
  const gapPx = Math.min(slotGap * MM_TO_PX * scale, safeW * 0.15, safeH * 0.15);

  // pin-shape 模板预览槽位：按安全区与间距做视觉近似，保持与真实页面一致的比例关系
  const template = TEMPLATES.find((t) => t.id === 'pin-shape');
  const slotEls = (() => {
    if (!template || template.slots.length < 3) return [];
    const topH = (safeH - gapPx) * (43 / (43 + 43));
    const bottomH = safeH - gapPx - topH;
    const bottomW = (safeW - gapPx) * (45.5 / (45.5 + 45.5));
    const slots = [
      { x: marginLeft, y: marginTop, w: safeW, h: topH },
      { x: marginLeft, y: marginTop + topH + gapPx, w: bottomW, h: bottomH },
      { x: marginLeft + bottomW + gapPx, y: marginTop + topH + gapPx, w: safeW - bottomW - gapPx, h: bottomH },
    ];
    return slots.map((slot, i) => ({
      x: (slot.x / previewW) * 100,
      y: (slot.y / previewH) * 100,
      w: (slot.w / previewW) * 100,
      h: (slot.h / previewH) * 100,
      color: SLOT_CANVAS_PALETTE[i % SLOT_CANVAS_PALETTE.length],
    }));
  })();

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-auto">
      <button
        type="button"
        onClick={handleClick}
        className="group flex flex-col items-center gap-6 p-8 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-raised)]/30 backdrop-blur-sm transition-all hover:bg-[var(--color-surface-raised)] hover:border-[var(--color-brand)]/50 hover:shadow-[0_8px_40px_rgba(108,99,255,0.12)]"
      >
        {/* 页面预览 */}
        <div
          className="relative bg-white shadow-[0_12px_48px_rgba(0,0,0,0.12)] transition-transform duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_16px_56px_rgba(108,99,255,0.18)]"
          style={{
            width: previewW,
            height: previewH,
            borderRadius: Math.max(2, defaultSlotCornerRadius * scale),
          }}
        >
          {/* 边距引导线 */}
          <div
            className="absolute border-2 border-dashed border-[var(--color-brand)]/30 rounded-[1px] pointer-events-none"
            style={{
              top: marginTop,
              left: marginLeft,
              right: marginRight,
              bottom: marginBottom,
            }}
          />
          {/* 照片槽位占位 */}
          {slotEls.map((slot, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                top: `${slot.y}%`,
                left: `${slot.x}%`,
                width: `${slot.w}%`,
                height: `${slot.h}%`,
                borderRadius: Math.max(2, defaultSlotCornerRadius * scale),
                background: isDark
                  ? `linear-gradient(135deg, ${slot.color}59 0%, ${slot.color}33 100%)`
                  : `linear-gradient(135deg, ${slot.color}33 0%, ${slot.color}1A 100%)`,
                border: `1.5px solid ${isDark ? `${slot.color}80` : `${slot.color}66`}`,
              }}
            />
          ))}
        </div>

        {/* 提示文案 */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center shadow-[0_4px_16px_rgba(108,99,255,0.35)] transition-transform duration-300 group-hover:scale-110">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-[var(--color-text-primary)] font-semibold text-[15px]">{t('editor.canvasEmpty.addFirstPage')}</div>
            <div className="text-[var(--color-text-tertiary)] text-[13px] mt-1">{t('editor.canvasEmpty.marginHint')}</div>
          </div>
        </div>
      </button>
    </div>
  );
}
