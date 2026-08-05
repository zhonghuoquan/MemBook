import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TEXT_STYLE_PRESETS, STICKY_COLORS } from '../../../types';
import type { StickyNoteStyle } from '../../../types';

/**
 * 文字样式预设卡片
 */

interface TextStylePresetsProps {
  onAddText: (preset: typeof TEXT_STYLE_PRESETS[number]) => void;
}

export function TextStylePresets({ onAddText }: TextStylePresetsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-[500] text-[var(--color-gray-500)] uppercase tracking-wide">{t('editor.tools.quickStyles')}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {TEXT_STYLE_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onAddText(preset)}
            className="flex flex-col items-center justify-center py-2 px-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white cursor-pointer hover:border-[var(--color-primary-400)] hover:bg-[var(--color-primary-50)] transition-colors"
          >
            <span
              className="leading-tight mb-0.5 truncate max-w-full"
              style={{
                fontSize: `${Math.min(preset.fontSize, 16)}px`,
                fontWeight: preset.bold ? 700 : 400,
                fontStyle: preset.italic ? 'italic' : 'normal',
                color: preset.color,
              }}
            >
              {preset.name}
            </span>
            <span className="text-[9px] text-[var(--color-gray-400)]">{preset.fontSize}px</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 便利贴样式选择器
 */

interface StickyStylePickerProps {
  selectedColor: string;
  selectedStyle: StickyNoteStyle;
  onColorSelect: (color: string) => void;
  onStyleSelect: (style: StickyNoteStyle) => void;
  onAdd: () => void;
}

const STICKY_STYLES: { key: StickyNoteStyle; labelKey: string; icon: React.ReactNode }[] = [
  {
    key: 'rounded',
    labelKey: 'editor.tools.styleRounded',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="3" width="14" height="14" rx="4" /></svg>,
  },
  {
    key: 'square',
    labelKey: 'editor.tools.styleSquare',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="3" width="14" height="14" rx="1" /></svg>,
  },
  {
    key: 'tape',
    labelKey: 'editor.tools.styleTape',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="5" width="14" height="12" rx="2" /><rect x="6" y="2" width="8" height="5" rx="1" strokeDasharray="2 1" /></svg>,
  },
  {
    key: 'shadow',
    labelKey: 'editor.tools.styleShadow',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="4" y="4" width="12" height="12" rx="2" /><rect x="5" y="5" width="12" height="12" rx="2" opacity="0.3" /></svg>,
  },
];

export function StickyStylePicker({ selectedColor, selectedStyle, onColorSelect, onStyleSelect, onAdd }: StickyStylePickerProps) {
  const { t } = useTranslation();
  const handleColorClick = useCallback((c: string) => {
    onColorSelect(c);
    onAdd();
  }, [onColorSelect, onAdd]);

  return (
    <div className="space-y-3">
      {/* 颜色选择 */}
      <div>
        <div className="text-[10px] font-[500] text-[var(--color-gray-500)] uppercase tracking-wide mb-1.5">{t('editor.tools.color')}</div>
        <div className="flex gap-2 flex-wrap">
          {STICKY_COLORS.map((sc) => (
            <button
              key={sc.color}
              onClick={() => handleColorClick(sc.color)}
              className={`w-9 h-9 rounded-[var(--radius-md)] border-2 cursor-pointer hover:scale-110 transition-all relative
                ${selectedColor === sc.color
                  ? 'border-[var(--color-brand)] scale-105 shadow-[var(--shadow-sm)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-gray-300)]'
                }`}
              style={{ backgroundColor: sc.color }}
              title={sc.name}
            >
              {selectedColor === sc.color && (
                <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-4 h-4" fill={sc.color === '#FFFFFF' ? '#6C63FF' : '#fff'}>
                  <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 样式选择 */}
      <div>
        <div className="text-[10px] font-[500] text-[var(--color-gray-500)] uppercase tracking-wide mb-1.5">{t('editor.tools.style')}</div>
        <div className="flex gap-1.5">
          {STICKY_STYLES.map(({ key, labelKey, icon }) => (
            <button
              key={key}
              onClick={() => onStyleSelect(key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                ${selectedStyle === key
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-white text-[var(--color-gray-400)] hover:border-[var(--color-gray-300)]'
                }`}
            >
              {icon}
              <span className="text-[10px] font-[500]">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
