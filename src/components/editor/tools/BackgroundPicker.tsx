import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_BACKGROUNDS, GRADIENT_BACKGROUNDS, TEXTURE_BACKGROUNDS } from '../../../types';

/**
 * 背景选择器组件
 * 支持纯色（主题色）/渐变/纹理三种 Tab 切换。
 * 统一色盘：纯色与渐变分别复用主题色 / 渐变色盘，不再展示具体色号。
 */

type BgTab = 'solid' | 'gradient' | 'texture';

interface BackgroundPickerProps {
  currentPageBg?: string;
  onApplyBg: (color: string) => void;
  onApplyToAll: (color: string) => void;
}

// 纹理预览生成（CSS 背景图案）
const TEXTURE_STYLES: Record<string, React.CSSProperties> = {
  'texture-ricepaper': { backgroundColor: '#F5F0E8', backgroundImage: 'radial-gradient(circle, #E8E0D0 1px, transparent 1px)', backgroundSize: '8px 8px' },
  'texture-kraft': { backgroundColor: '#C4A882' },
  'texture-dots': { backgroundColor: '#F9FAFB', backgroundImage: 'radial-gradient(circle, #D1D5DB 1px, transparent 1px)', backgroundSize: '12px 12px' },
  'texture-grid': { backgroundColor: '#F9FAFB', backgroundImage: 'linear-gradient(#E5E7EB 1px, transparent 1px), linear-gradient(90deg, #E5E7EB 1px, transparent 1px)', backgroundSize: '16px 16px' },
  'texture-stripes': { backgroundColor: '#FAFAFA', backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, #E5E7EB 4px, #E5E7EB 5px)' },
  'texture-linen': { backgroundColor: '#F0EDE8', backgroundImage: 'linear-gradient(0deg, transparent 50%, rgba(0,0,0,0.02) 50%), linear-gradient(90deg, transparent 50%, rgba(0,0,0,0.02) 50%)', backgroundSize: '4px 4px' },
};

export function BackgroundPicker({ currentPageBg, onApplyBg, onApplyToAll }: BackgroundPickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BgTab>('solid');
  const [applyToAll, setApplyToAll] = useState(false);

  const handleApply = (value: string) => {
    if (applyToAll) onApplyToAll(value);
    else onApplyBg(value);
  };

  return (
    <div className="space-y-3">
      {/* Tab 切换 */}
      <div className="flex bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] p-0.5">
        {([
          { key: 'solid', label: t('editor.tools.background.tabSolid') },
          { key: 'gradient', label: t('editor.tools.background.tabGradient') },
          { key: 'texture', label: t('editor.tools.background.tabTexture') },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] cursor-pointer transition-colors border-none
              ${tab === key
                ? 'bg-white text-[var(--color-gray-800)] shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 纯色（主题色盘） */}
      {tab === 'solid' && (
        <div className="grid grid-cols-4 gap-2">
          {THEME_BACKGROUNDS.map((bg) => (
            <button
              key={bg.color}
              onClick={() => handleApply(bg.color)}
              className={`aspect-square rounded-[var(--radius-md)] border-2 cursor-pointer hover:scale-105 transition-all relative
                ${currentPageBg === bg.color
                  ? 'border-[var(--color-brand)] scale-105 shadow-[var(--shadow-card-hover)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-gray-300)]'
                }`}
              style={{ backgroundColor: bg.color }}
              title={bg.name}
            >
              {(bg.color === '#FFFFFF' || bg.color === '#F8F9FA') && currentPageBg !== bg.color && (
                <div className="absolute inset-0 rounded-[inherit] border border-[var(--color-border)]" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* 渐变（渐变色盘） */}
      {tab === 'gradient' && (
        <div className="grid grid-cols-4 gap-2">
          {GRADIENT_BACKGROUNDS.map((bg) => (
            <button
              key={bg.name}
              onClick={() => handleApply(bg.value)}
              className={`aspect-square rounded-[var(--radius-md)] border-2 cursor-pointer hover:scale-105 transition-all
                ${currentPageBg === bg.value
                  ? 'border-[var(--color-brand)] scale-105 shadow-[var(--shadow-card-hover)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-gray-300)]'
                }`}
              style={{ background: bg.value }}
              title={bg.name}
            />
          ))}
        </div>
      )}

      {/* 纹理 */}
      {tab === 'texture' && (
        <div className="grid grid-cols-4 gap-2">
          {TEXTURE_BACKGROUNDS.map((bg) => (
            <button
              key={bg.value}
              onClick={() => handleApply(bg.value)}
              className={`aspect-square rounded-[var(--radius-md)] border-2 cursor-pointer hover:scale-105 transition-all
                ${currentPageBg === bg.value
                  ? 'border-[var(--color-brand)] scale-105 shadow-[var(--shadow-card-hover)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-gray-300)]'
                }`}
              style={TEXTURE_STYLES[bg.value] || { backgroundColor: '#fff' }}
              title={bg.name}
            />
          ))}
        </div>
      )}

      {/* 应用范围 */}
      <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border-light)]">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-[var(--color-brand)] cursor-pointer"
          />
          <span className="text-[11px] text-[var(--color-gray-500)]">{t('editor.tools.background.applyToAll')}</span>
        </label>
      </div>
    </div>
  );
}
