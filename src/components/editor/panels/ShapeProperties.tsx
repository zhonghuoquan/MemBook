/**
 * 形状属性面板（对象属性面板 / 左侧工具面板共用）
 * 顶部标签切换：基础设置 / 填充 / 描边，避免颜色区占用过多高度。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store';
import type { ShapeElement } from '../../../types';
import { isCornerAdjustable, isCutAdjustable } from '../../../utils/shapeGeometry';
import { ColorPalette } from '../tools/ColorPalette';
import { gradientToCss } from '../../../constants/colorPalette';
import { MIN_SHAPE_SIZE_MM, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH } from '../canvas/constants';

type ShapeTab = 'basic' | 'fill' | 'stroke';

/** 形状属性面板当前标签页的 localStorage key（首次默认 basic，切换后持久化，下次进入保持） */
const SHAPE_TAB_KEY = 'membook_shape_prop_tab';

export function ShapeProperties({ shape }: { shape: ShapeElement }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const updateShapeElement = useEditorStore((s) => s.updateShapeElement);
  const removeShapeElement = useEditorStore((s) => s.removeShapeElement);
  const setSelectedShapeId = useEditorStore((s) => s.setSelectedShapeId);
  // 首次进入读取上次选择的标签页；无记录则默认 basic
  const [tab, setTab] = useState<ShapeTab>(() => {
    const saved = localStorage.getItem(SHAPE_TAB_KEY);
    return saved === 'fill' || saved === 'stroke' ? saved as ShapeTab : 'basic';
  });
  const changeTab = (k: ShapeTab) => {
    setTab(k);
    localStorage.setItem(SHAPE_TAB_KEY, k);
  };

  const tabs: { key: ShapeTab; label: string }[] = [
    { key: 'basic', label: t('editor.tools.shapeTabBasic') },
    { key: 'fill', label: t('editor.tools.shapeTabFill') },
    { key: 'stroke', label: t('editor.tools.shapeTabStroke') },
  ];

  return (
    <div className="space-y-3">
      {/* 标签切换 */}
      <div className="flex bg-[var(--color-surface-hover)] rounded-lg p-1 gap-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => changeTab(tb.key)}
            className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-[600] cursor-pointer transition-all border-none
              ${tab === tb.key ? 'bg-white text-[var(--color-brand)] shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── 基础设置 ── */}
      {tab === 'basic' && (
        <div className="space-y-3">
          {/* 尺寸 */}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeWidth')}</div>
              <input type="number" min={MIN_SHAPE_SIZE_MM} value={Math.round(shape.width)}
                onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { width: Math.max(MIN_SHAPE_SIZE_MM, +e.target.value || MIN_SHAPE_SIZE_MM) })}
                className="w-full h-7 px-2 border border-[var(--color-border)] rounded-lg text-[11px] bg-white outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15" />
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeHeight')}</div>
              <input type="number" min={MIN_SHAPE_SIZE_MM} value={Math.round(shape.height)}
                onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { height: Math.max(MIN_SHAPE_SIZE_MM, +e.target.value || MIN_SHAPE_SIZE_MM) })}
                className="w-full h-7 px-2 border border-[var(--color-border)] rounded-lg text-[11px] bg-white outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15" />
            </div>
          </div>
          {/* 圆角占比（仅矩形类） */}
          {isCornerAdjustable(shape.type) && (() => {
            const effectiveCr = shape.cornerRadius ?? (shape.type === 'rectangle' ? 0 : 0.15);
            return (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.tools.shapeCornerRadius')}</span>
                  <span className="text-[10px] text-[var(--color-gray-500)]">{Math.round(effectiveCr * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(effectiveCr * 100)}
                  onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { cornerRadius: Math.max(0, Math.min(1, +e.target.value / 100)) }, false)}
                  onPointerUp={() => updateShapeElement(currentPageIndex, shape.id, { cornerRadius: shape.cornerRadius }, true)}
                  className="w-full accent-[var(--color-brand)]"
                />
              </div>
            );
          })()}
          {/* 切角大小（仅切角矩形类） */}
          {isCutAdjustable(shape.type) && (() => {
            const effectiveCut = shape.cornerCut ?? 0.25;
            return (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.tools.shapeCornerCut')}</span>
                  <span className="text-[10px] text-[var(--color-gray-500)]">{Math.round(effectiveCut * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(effectiveCut * 100)}
                  onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { cornerCut: Math.max(0, Math.min(1, +e.target.value / 100)) }, false)}
                  onPointerUp={() => updateShapeElement(currentPageIndex, shape.id, { cornerCut: shape.cornerCut }, true)}
                  className="w-full accent-[var(--color-brand)]"
                />
              </div>
            );
          })()}
          {/* 透明度 */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
              <span>{t('editor.tools.opacity')}</span>
              <span className="font-[600] tabular-nums">{Math.round(shape.opacity * 100)}%</span>
            </div>
            <input type="range" min={0} max={100} value={Math.round(shape.opacity * 100)}
              onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { opacity: +e.target.value / 100 }, false)}
              onPointerUp={() => updateShapeElement(currentPageIndex, shape.id, { opacity: shape.opacity }, true)}
              className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
          </div>
          {/* 旋转 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeRotation')}</div>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={359} value={((shape.rotation % 360) + 360) % 360}
                onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { rotation: +e.target.value }, false)}
                onPointerUp={() => updateShapeElement(currentPageIndex, shape.id, { rotation: shape.rotation }, true)}
                className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              <span className="text-[10px] font-[600] tabular-nums">{Math.round(((shape.rotation % 360) + 360) % 360)}°</span>
            </div>
          </div>
          {/* 删除 */}
          <button
            onClick={() => { removeShapeElement(currentPageIndex, shape.id); setSelectedShapeId(null); }}
            className="w-full py-1.5 text-[11px] font-[500] text-[var(--color-error)] border border-[var(--color-error)]/30 rounded-[var(--radius-sm)] bg-[var(--color-error-light)] hover:bg-[var(--color-error)]/10 cursor-pointer transition-colors"
          >
            {t('editor.tools.deleteShape')}
          </button>
        </div>
      )}

      {/* ── 填充 ── */}
      {tab === 'fill' && (
        <div className="space-y-3">
          <ColorPalette
            label={t('editor.tools.shapeFill')}
            selectedColor={shape.gradient && shape.gradient.length >= 2 ? gradientToCss(shape.gradient) : shape.fill}
            onColorChange={(c) => updateShapeElement(currentPageIndex, shape.id, { fill: c, gradient: undefined, gradientType: undefined })}
            onGradientChange={(preset) => updateShapeElement(currentPageIndex, shape.id, {
              gradient: preset.stops,
              gradientType: preset.type,
              fill: preset.stops[0]?.color ?? shape.fill,
            })}
            onClearGradient={() => updateShapeElement(currentPageIndex, shape.id, { gradient: undefined, gradientType: undefined })}
            gradientAngle={shape.gradientAngle}
            onGradientAngleChange={(a) => updateShapeElement(currentPageIndex, shape.id, { gradientAngle: a })}
            gradientStops={shape.gradient}
            onGradientStopsChange={(gradient) => updateShapeElement(currentPageIndex, shape.id, {
              gradient,
              fill: gradient[0]?.color ?? shape.fill,
            })}
            allowEmpty
          />
        </div>
      )}

      {/* ── 描边 ── */}
      {tab === 'stroke' && (
        <div className="space-y-3">
          {/* 描边粗细（置顶）：滑杆 + 数字输入联动 */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
              <span>{t('editor.tools.shapeStrokeWidth')}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={MIN_STROKE_WIDTH} max={MAX_STROKE_WIDTH} step={0.25}
                  value={shape.strokeWidth}
                  onChange={(e) => {
                    const v = +e.target.value;
                    updateShapeElement(currentPageIndex, shape.id, { strokeWidth: Number.isFinite(v) ? Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, v)) : MIN_STROKE_WIDTH });
                  }}
                  className="w-14 h-6 px-1 border border-[var(--color-border)] rounded text-[10px] bg-white outline-none tabular-nums transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
                />
                <span className="font-[600] tabular-nums">px</span>
              </div>
            </div>
            <input type="range" min={MIN_STROKE_WIDTH} max={MAX_STROKE_WIDTH} step={0.25} value={shape.strokeWidth}
              onChange={(e) => updateShapeElement(currentPageIndex, shape.id, { strokeWidth: Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, +e.target.value)) }, false)}
              onPointerUp={() => updateShapeElement(currentPageIndex, shape.id, { strokeWidth: shape.strokeWidth }, true)}
              className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
          </div>
          <ColorPalette
            label={t('editor.tools.shapeStroke')}
            selectedColor={shape.strokeGradient && shape.strokeGradient.length >= 2 ? gradientToCss(shape.strokeGradient) : shape.stroke}
            onColorChange={(c) => updateShapeElement(currentPageIndex, shape.id, { stroke: c, strokeGradient: undefined, strokeGradientAngle: undefined })}
            onGradientChange={(preset) => updateShapeElement(currentPageIndex, shape.id, {
              strokeGradient: preset.stops,
              strokeGradientAngle: 45,
            })}
            onClearGradient={() => updateShapeElement(currentPageIndex, shape.id, { strokeGradient: undefined, strokeGradientAngle: undefined })}
            gradientAngle={shape.strokeGradientAngle}
            onGradientAngleChange={(a) => updateShapeElement(currentPageIndex, shape.id, { strokeGradientAngle: a })}
            gradientStops={shape.strokeGradient}
            onGradientStopsChange={(gradient) => updateShapeElement(currentPageIndex, shape.id, { strokeGradient: gradient })}
            allowEmpty
            emptyLabel={t('editor.tools.shapeNoStroke')}
          />
        </div>
      )}
    </div>
  );
}