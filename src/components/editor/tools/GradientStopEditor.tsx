/**
 * 渐变逐色标编辑器：参考 PPT 渐变设置，可分别调整每个色标的颜色、位置（offset）与透明度。
 * 例如红色→绿色，可单独把绿色色标设为半透明，实现红色渐变到半透明的绿色。
 */
import { useTranslation } from 'react-i18next';
import type { GradientStop } from '../../../types';
import { toRgba } from '../../../constants/colorPalette';

export function GradientStopEditor({
  stops,
  onChange,
}: {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
}) {
  const { t } = useTranslation();

  const updateStop = (i: number, patch: Partial<GradientStop>) => {
    onChange(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.tools.gradientStops')}</div>
      {stops.map((s, i) => {
        const hex = isValidHex(s.color) ? s.color : '#000000';
        const alpha = s.alpha ?? 1;
        const isNoFill = alpha <= 0;
        const label = i === 0
          ? t('editor.tools.gradientStart')
          : i === stops.length - 1
            ? t('editor.tools.gradientEnd')
            : `${i + 1}`;
        return (
          <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 space-y-1.5">
            {/* 色标头：起点/终点 + 颜色 + 无填充 */}
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] text-[var(--color-gray-500)] truncate">{label}</span>
              <label
                className="relative w-6 h-6 shrink-0 rounded-[4px] border border-[var(--color-border)] cursor-pointer overflow-hidden"
                style={{ backgroundColor: toRgba(hex, alpha) }}
                title={`${s.color} · ${Math.round(alpha * 100)}%`}
              >
                <input
                  type="color"
                  value={hex}
                  disabled={isNoFill}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  className={`absolute inset-0 opacity-0 ${isNoFill ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                />
              </label>
              <button
                onClick={() => updateStop(i, { alpha: isNoFill ? 1 : 0 })}
                className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer transition-colors
                  ${isNoFill
                    ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                    : 'border-[var(--color-border)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}
              >
                {t('editor.tools.gradientNoFill')}
              </button>
            </div>
            {/* 位置（offset） */}
            <div className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-[9px] text-[var(--color-gray-400)]">{t('editor.tools.gradientPosition')}</span>
              <input
                type="range" min={0} max={100}
                value={Math.round(s.offset * 100)}
                onChange={(e) => updateStop(i, { offset: +e.target.value / 100 })}
                className="flex-1 h-1 cursor-pointer accent-[var(--color-brand)]"
                title={t('editor.tools.gradientPosition')}
              />
              <span className="w-8 shrink-0 text-right text-[10px] font-[600] tabular-nums text-[var(--color-gray-500)]">
                {Math.round(s.offset * 100)}%
              </span>
            </div>
            {/* 透明度（alpha） */}
            <div className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-[9px] text-[var(--color-gray-400)]">{t('editor.tools.gradientStopOpacity')}</span>
              <input
                type="range" min={0} max={100}
                value={Math.round(alpha * 100)}
                onChange={(e) => updateStop(i, { alpha: +e.target.value / 100 })}
                className="flex-1 h-1 cursor-pointer accent-[var(--color-brand)]"
                title={t('editor.tools.gradientStopOpacity')}
              />
              <span className="w-8 shrink-0 text-right text-[10px] font-[600] tabular-nums text-[var(--color-gray-500)]">
                {Math.round(alpha * 100)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 判断是否为合法 6 位 #hex 颜色 */
function isValidHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}