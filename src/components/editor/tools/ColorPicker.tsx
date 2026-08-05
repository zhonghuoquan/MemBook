import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 统一颜色选择器组件
 * 支持固定色板 + 最近使用颜色 + 取色器
 */

const COLOR_PALETTE = [
  '#1A1A1A', '#4B5563', '#9CA3AF', '#FFFFFF',
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#22C55E', '#14B8A6', '#3B82F6', '#6366F1',
  '#8B5CF6', '#EC4899', '#F43F5E', '#6C63FF',
];

interface ColorPickerProps {
  selectedColor: string;
  recentColors?: string[];
  onColorChange: (color: string) => void;
  onRecentColorAdd?: (color: string) => void;
  label?: string;
  size?: 'sm' | 'md';
}

export function ColorPicker({
  selectedColor,
  recentColors = [],
  onColorChange,
  onRecentColorAdd,
  label,
  size = 'md',
}: ColorPickerProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('editor.colorPicker.label');
  const swatchSize = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const gap = size === 'sm' ? 'gap-1' : 'gap-1.5';

  const handleColorClick = useCallback((color: string) => {
    onColorChange(color);
    if (onRecentColorAdd) onRecentColorAdd(color);
  }, [onColorChange, onRecentColorAdd]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-[500] text-[var(--color-gray-500)] uppercase tracking-wide">{resolvedLabel}</span>
        {/* 取色器 */}
        <div className="flex items-center gap-1">
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => handleColorClick(e.target.value)}
            className="w-5 h-5 rounded border border-[var(--color-border)] cursor-pointer p-0 bg-transparent"
            title={t('editor.colorPicker.customPicker')}
          />
        </div>
      </div>

      {/* 最近使用 */}
      {recentColors.length > 0 && (
        <div className={`flex ${gap} flex-wrap mb-2`}>
          {recentColors.map((c, i) => (
            <button
              key={`recent-${i}`}
              onClick={() => onColorChange(c)}
              className={`${swatchSize} rounded-[4px] border-2 cursor-pointer transition-all hover:scale-110 relative`}
              style={{
                backgroundColor: c,
                borderColor: selectedColor === c ? 'var(--color-brand)' : 'var(--color-border)',
              }}
              title={t('editor.colorPicker.recentUsed')}
            >
              {selectedColor === c && (
                <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={c === '#FFFFFF' || c === '#F8F9FA' ? '#333' : '#fff'}>
                  <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 色板 */}
      <div className={`flex ${gap} flex-wrap`}>
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => handleColorClick(c)}
            className={`${swatchSize} rounded-[4px] border-2 cursor-pointer transition-all hover:scale-110 relative`}
            style={{
              backgroundColor: c,
              borderColor: selectedColor === c ? 'var(--color-brand)' : 'var(--color-border)',
            }}
            title={c}
          >
            {selectedColor === c && (
              <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={c === '#FFFFFF' || c === '#F8F9FA' ? '#333' : '#fff'}>
                <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
