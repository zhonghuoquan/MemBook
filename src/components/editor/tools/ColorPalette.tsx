/**
 * 统一颜色色盘选择组件（主题色 / 渐变色）
 * 供文字、背景、形状在左侧面板中共用。
 *
 * 不体现具体色号，仅提供色盘选项：
 * - 主题色：纯色 swatch
 * - 渐变色：linear-gradient swatch
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_COLORS, GRADIENT_COLORS } from '../../../constants/colorPalette';

type PaletteTab = 'solid' | 'gradient';

interface ColorPaletteProps {
  /** 当前颜色值（纯色 hex 或渐变 linear-gradient 字符串） */
  selectedColor: string;
  onColorChange: (color: string) => void;
  /** 是否允许空值（无填充），用于形状填充 */
  allowEmpty?: boolean;
  emptyLabel?: string;
  label?: string;
}

export function ColorPalette({
  selectedColor,
  onColorChange,
  allowEmpty = false,
  emptyLabel,
  label,
}: ColorPaletteProps) {
  const { t } = useTranslation();
  // 默认进入纯色 Tab，若当前为渐变值则进入渐变 Tab
  const [tab, setTab] = useState<PaletteTab>(selectedColor.startsWith('linear-gradient') ? 'gradient' : 'solid');
  const resolvedEmptyLabel = emptyLabel ?? t('editor.tools.shapeNoFill');

  const isActive = (value: string) => selectedColor === value;

  return (
    <div className="space-y-2">
      {label && (
        <div className="text-[10px] font-[500] text-[var(--color-gray-500)]">{label}</div>
      )}

      {/* Tab 切换 */}
      <div className="flex bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] p-0.5">
        <button
          onClick={() => setTab('solid')}
          className={`flex-1 py-1 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] cursor-pointer transition-colors border-none
            ${tab === 'solid' ? 'bg-white text-[var(--color-gray-800)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'}`}
        >
          {t('editor.colorPalette.tabSolid')}
        </button>
        <button
          onClick={() => setTab('gradient')}
          className={`flex-1 py-1 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] cursor-pointer transition-colors border-none
            ${tab === 'gradient' ? 'bg-white text-[var(--color-gray-800)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'}`}
        >
          {t('editor.colorPalette.tabGradient')}
        </button>
      </div>

      {/* 主题色（纯色） */}
      {tab === 'solid' && (
        <div className="flex flex-wrap gap-1.5">
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className="w-7 h-7 rounded-[4px] border-2 cursor-pointer transition-transform hover:scale-110 relative"
              style={{
                backgroundColor: c,
                borderColor: isActive(c) ? 'var(--color-brand)' : 'var(--color-border)',
              }}
              title={c}
            >
              {isActive(c) && (
                <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={c === '#FFFFFF' || c === '#F8F9FA' ? '#333' : '#fff'}>
                  <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 渐变色 */}
      {tab === 'gradient' && (
        <div className="flex flex-wrap gap-1.5">
          {GRADIENT_COLORS.map((g) => (
            <button
              key={g.value}
              onClick={() => onColorChange(g.value)}
              className="w-7 h-7 rounded-[4px] border-2 cursor-pointer transition-transform hover:scale-110 relative"
              style={{
                background: g.value,
                borderColor: isActive(g.value) ? 'var(--color-brand)' : 'var(--color-border)',
              }}
              title={g.name}
            >
              {isActive(g.value) && (
                <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill="#fff">
                  <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 无填充（仅形状填充等场景） */}
      {allowEmpty && (
        <button
          onClick={() => onColorChange('')}
          className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer
            ${isActive('') ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-surface-selected)]' : 'border-[var(--color-border)] text-[var(--color-gray-400)]'}`}
        >
          {resolvedEmptyLabel}
        </button>
      )}
    </div>
  );
}
