/**
 * 统一颜色色盘选择组件（纯色 / 渐变色）
 * 供文字、背景、形状在左侧面板中共用。
 *
 * - 主题色：分「莫兰迪 / 鲜艳」两组 swatch + 自定义取色器，点击回调 onColorChange(hex)
 * - 渐变色：结构化预设 swatch（莫兰迪 / 鲜艳），点击回调 onGradientChange(preset)
 *   （preset 含 css 供背景/预览、stops 供形状/文字 Konva 渲染）
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STANDARD_COLORS, PALETTE_COLORS, GRADIENT_COLOR_COLUMNS, TRIPLE_GRADIENT_PRESETS, QUAD_GRADIENT_PRESETS } from '../../../constants/colorPalette';
import type { GradientPreset } from '../../../constants/colorPalette';
import type { GradientStop } from '../../../types';
import { GradientStopEditor } from './GradientStopEditor';

type PaletteTab = 'solid' | 'gradient';

interface ColorPaletteProps {
  /** 当前颜色值（纯色 hex 或渐变 css） */
  selectedColor: string;
  /** 纯色选择回调 */
  onColorChange: (color: string) => void;
  /** 渐变选择回调（可选；不提供则 fallback 到 onColorChange(css)） */
  onGradientChange?: (preset: GradientPreset) => void;
  /** 清除渐变（无渐变）回调；提供则在渐变 Tab 显示「无渐变」按钮 */
  onClearGradient?: () => void;
  /** 当前线性渐变角度（0-360） */
  gradientAngle?: number;
  /** 渐变角度变化回调 */
  onGradientAngleChange?: (angle: number) => void;
  /** 当前渐变色标（用于逐色标编辑） */
  gradientStops?: GradientStop[];
  /** 渐变逐色标变化回调 */
  onGradientStopsChange?: (stops: GradientStop[]) => void;
  /** 是否允许空值（无填充），用于形状填充 */
  allowEmpty?: boolean;
  emptyLabel?: string;
  label?: string;
}

export function ColorPalette({
  selectedColor,
  onColorChange,
  onGradientChange,
  onClearGradient,
  gradientAngle,
  onGradientAngleChange,
  gradientStops,
  onGradientStopsChange,
  allowEmpty = false,
  emptyLabel,
  label,
}: ColorPaletteProps) {
  const { t } = useTranslation();
  // 默认进入纯色 Tab，若当前为渐变值则进入渐变 Tab
  const [tab, setTab] = useState<PaletteTab>(selectedColor.startsWith('linear-gradient') ? 'gradient' : 'solid');
  const resolvedEmptyLabel = emptyLabel ?? t('editor.tools.shapeNoFill');
  const currentColor = isValidHex(selectedColor) ? selectedColor : '#000000';

  const isActiveColor = (c: string) => selectedColor === c;
  const isActiveGradient = (css: string) => selectedColor === css;

  const handleGradientPick = (preset: GradientPreset) => {
    if (onGradientChange) onGradientChange(preset);
    else onColorChange(preset.css);
  };

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
        <div className="space-y-2">
          {/* 顶部：无填充 + 自定义颜色（同一行） */}
          <div className="flex items-center gap-2">
            {allowEmpty && (
              <button
                onClick={() => onColorChange('')}
                className={`shrink-0 px-3 py-2 rounded-[var(--radius-md)] border cursor-pointer text-[11px] font-[500] transition-colors
                  ${isActiveColor('') ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-surface-selected)]' : 'border-[var(--color-border)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}
              >
                {resolvedEmptyLabel}
              </button>
            )}
            <label className="flex items-center gap-2 flex-1 min-w-0 py-1.5 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white cursor-pointer transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-hover)] group">
              <input type="color" value={currentColor} onChange={(e) => onColorChange(e.target.value)} className="sr-only" title={t('editor.colorPicker.customPicker')} />
              <span
                className="w-7 h-7 rounded-[4px] border shrink-0 relative overflow-hidden shadow-inner"
                style={{ backgroundColor: currentColor, borderColor: isActiveColor(currentColor) ? 'var(--color-brand)' : 'var(--color-border)' }}
              >
                {isActiveColor(currentColor) && (
                  <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={isLightColor(currentColor) ? '#333' : '#fff'}>
                    <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="flex-1 min-w-0 text-[11px] font-[500] text-[var(--color-gray-700)] truncate">{t('editor.colorPalette.customColor')}</span>
            </label>
          </div>

          {/* 标准色（单独一行） */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-400)] mb-1">{t('editor.colorPalette.standardColors')}</div>
            <div className="flex gap-1">
              {STANDARD_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  className="flex-1 aspect-square rounded-[3px] border cursor-pointer transition-transform hover:scale-105 relative"
                  style={{ backgroundColor: c, borderColor: isActiveColor(c) ? 'var(--color-brand)' : 'var(--color-border)' }}
                  title={c}
                >
                  {isActiveColor(c) && (
                    <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={isLightColor(c) ? '#333' : '#fff'}>
                      <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 色盘（小色块网格铺满下方） */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-400)] mb-1">{t('editor.colorPalette.colorWheel')}</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}>
              {PALETTE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  className="w-full aspect-square rounded-[3px] border cursor-pointer transition-transform hover:scale-105 relative"
                  style={{ backgroundColor: c, borderColor: isActiveColor(c) ? 'var(--color-brand)' : 'var(--color-border)' }}
                  title={c}
                >
                  {isActiveColor(c) && (
                    <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill={isLightColor(c) ? '#333' : '#fff'}>
                      <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 渐变色（5 列 × 7 行等宽阵列） */}
      {tab === 'gradient' && (
        <div className="space-y-2">
          {/* 顶部：无渐变 */}
          {onClearGradient && (
            <button
              onClick={onClearGradient}
              className="w-full py-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] cursor-pointer text-[11px] font-[500] text-[var(--color-gray-500)] transition-colors hover:border-[var(--color-gray-300)]"
            >
              {t('editor.colorPalette.noGradient')}
            </button>
          )}

          {/* 渐变设置（有渐变时显示）。仅支持线性（无线性/径向切换按钮） */}
          {gradientStops && gradientStops.length >= 2 && (onGradientAngleChange || onGradientStopsChange) && (
            <div className="space-y-2">
              {/* 渐变角度：滑杆（关键角度吸附）+ 数字输入 */}
              {onGradientAngleChange && (
                <AngleControl
                  value={gradientAngle ?? 45}
                  onChange={onGradientAngleChange}
                  label={t('editor.tools.gradientAngle')}
                />
              )}
              {/* 逐色标编辑 */}
              {onGradientStopsChange && (
                <GradientStopEditor stops={gradientStops} onChange={onGradientStopsChange} />
              )}
            </div>
          )}

          <div className="flex gap-1.5">
            {GRADIENT_COLOR_COLUMNS.map((col) => (
              <div key={col.name} className="flex-1 flex flex-col gap-1.5">
                {col.presets.map((g) => (
                  <button
                    key={g.name}
                    onClick={() => handleGradientPick(g)}
                    className="w-full aspect-square rounded-[4px] border border-[var(--color-border)] cursor-pointer transition-transform hover:scale-105 relative"
                    style={{
                      background: g.css,
                      borderColor: isActiveGradient(g.css) ? 'var(--color-brand)' : 'var(--color-border)',
                    }}
                    title={g.name}
                  >
                    {isActiveGradient(g.css) && (
                      <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill="#fff">
                        <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* 三色渐变（独立一行） */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-400)] mb-1">{t('editor.colorPalette.tripleGradient')}</div>
            <div className="flex gap-1.5">
              {TRIPLE_GRADIENT_PRESETS.map((g) => (
                <button
                  key={g.name}
                  onClick={() => handleGradientPick(g)}
                  className="flex-1 aspect-square rounded-[4px] border border-[var(--color-border)] cursor-pointer transition-transform hover:scale-105 relative"
                  style={{
                    background: g.css,
                    borderColor: isActiveGradient(g.css) ? 'var(--color-brand)' : 'var(--color-border)',
                  }}
                  title={g.name}
                >
                  {isActiveGradient(g.css) && (
                    <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill="#fff">
                      <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 四色渐变（独立一行） */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-400)] mb-1">{t('editor.colorPalette.quadGradient')}</div>
            <div className="flex gap-1.5">
              {QUAD_GRADIENT_PRESETS.map((g) => (
                <button
                  key={g.name}
                  onClick={() => handleGradientPick(g)}
                  className="flex-1 aspect-square rounded-[4px] border border-[var(--color-border)] cursor-pointer transition-transform hover:scale-105 relative"
                  style={{
                    background: g.css,
                    borderColor: isActiveGradient(g.css) ? 'var(--color-brand)' : 'var(--color-border)',
                  }}
                  title={g.name}
                >
                  {isActiveGradient(g.css) && (
                    <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto w-3 h-3" fill="#fff">
                      <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 判断是否为合法 #hex 颜色 */
function isValidHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

/** 判断颜色是否为浅色（决定对勾图标用深色还是浅色） */
function isLightColor(c: string): boolean {
  const hex = c.replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) >= 150;
}

/** 渐变角度关键吸附点（常见规范角度） */
const ANGLE_SNAP_POINTS = [0, 45, 90, 135, 180, 225, 270, 315, 360];

/** 渐变角度控制：滑杆（接近关键角度时吸附）+ 数字输入（0-360） */
function AngleControl({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const shown = Math.round(value);
  // 滑杆拖动：若落点距某关键角度 ≤5°，吸附到该角度（对齐 0/45/90/135/180/225/270/315/360）
  const handleRange = (raw: number) => {
    const nearest = ANGLE_SNAP_POINTS.reduce((best, a) => Math.abs(a - raw) < Math.abs(best - raw) ? a : best, ANGLE_SNAP_POINTS[0]);
    onChange(Math.abs(nearest - raw) <= 5 ? nearest : raw);
  };
  // 数字输入：clamp 到 0-360
  const handleNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(0, Math.min(360, Math.round(+e.target.value || 0)));
    onChange(v);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[10px] text-[var(--color-gray-500)]">{label}</span>
      <input
        type="range" min={0} max={360} step={1}
        value={shown}
        onChange={(e) => handleRange(+e.target.value)}
        className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]"
      />
      <input
        type="number" min={0} max={360} value={shown}
        onChange={handleNumber}
        className="w-12 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-center text-[10px] font-[600] tabular-nums text-[var(--color-gray-700)] outline-none focus:border-[var(--color-brand)]"
      />
      <span className="shrink-0 text-[10px] text-[var(--color-gray-400)]">°</span>
    </div>
  );
}