/**
 * 文字元素属性面板（对象属性面板 / 左侧工具面板共用）
 * 顶部标签切换：基础设置 / 颜色，避免颜色区占用过多高度。
 * 传入选中的文字元素 el；store 的 currentPageIndex / updateTextElement 在组件内读取。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store';
import type { PageTextElement } from '../../../types';
import { ColorPalette } from '../tools/ColorPalette';
import { gradientToCss } from '../../../constants/colorPalette';

/** 文字字体列表：中文在上、英文在下，各按常用度排序。
 * 系统字体（中文 12 + 英文 8）直接写字体名，系统已装则正常显示、未装则回退默认字体；
 * 艺术字体（中文 8 + 英文 7 + 自备英文 12）已打包进 src/assets/fonts，经 src/styles/fonts.css @font-face 加载，离线可用。 */
export const TEXT_FONT_FAMILIES = [
  // ══ 中文（上） ══
  // ── 常用中文字体 12 种（系统自带） ──
  '思源黑体',
  '思源宋体',
  '微软雅黑',
  '宋体',
  '黑体',
  '楷体',
  '仿宋',
  '隶书',
  '幼圆',
  '华文行楷',
  '华文楷体',
  '华文细黑',
  // ── 中文艺术字体 8 种（内置） ──
  '站酷快乐体',
  '站酷庆科黄油体',
  '站酷小薇体',
  '马善政毛笔楷书',
  '龙藏体',
  '柳建毛草体',
  '直播星体',
  '新蒂小丸子体',
  // ══ 英文（下） ══
  // ── 常用英文字体 8 种（系统自带） ──
  'Arial',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Trebuchet MS',
  'Helvetica Neue',
  'Courier New',
  'Impact',
  // ── 英文艺术字体 7 种（内置） ──
  'Playfair Display',
  'Montserrat',
  'Cormorant Garamond',
  'Dancing Script',
  'Great Vibes',
  'Caveat',
  'Pacifico',
  // ── 自备英文艺术字体 12 种（本地打包） ──
  'Beyno',
  'Comfortaa',
  'Segoe UI SemiBold',
  'Jokerman',
  'Rage',
  'Big John',
  'Azedo Light',
  'Hagin Caps Thin',
  'Hitch-hike',
  'Intro Cond Light',
  'Mr. Jackson Rankenstein',
  'Corbelli',
];

type TextTab = 'basic' | 'color';

/** 文字属性面板当前标签页的 localStorage key（首次默认 basic，切换后持久化，下次进入保持） */
const TEXT_TAB_KEY = 'membook_text_prop_tab';

export function TextProperties({ el }: { el: PageTextElement }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const updateTextElement = useEditorStore((s) => s.updateTextElement);
  // 首次进入读取上次选择的标签页；无记录则默认 basic
  const [tab, setTab] = useState<TextTab>(() => {
    const saved = localStorage.getItem(TEXT_TAB_KEY);
    return saved === 'color' ? 'color' : 'basic';
  });
  const changeTab = (k: TextTab) => {
    setTab(k);
    localStorage.setItem(TEXT_TAB_KEY, k);
  };

  const tabs: { key: TextTab; label: string }[] = [
    { key: 'basic', label: t('editor.tools.textTabBasic') },
    { key: 'color', label: t('editor.tools.textTabColor') },
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
          {/* 字体 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.fontFamily')}</div>
            <select value={el.fontFamily} onChange={(e) => updateTextElement(currentPageIndex, el.id, { fontFamily: e.target.value })}
              className="w-full h-7 px-2 border border-[var(--color-border)] rounded-lg text-[11px] bg-white cursor-pointer outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15">
              {TEXT_FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>
          {/* 字号（slider + 数字输入联动） */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
              <span>{t('editor.tools.fontSize')}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={8} max={300} step={0.5}
                  value={el.fontSize}
                  onChange={(e) => updateTextElement(currentPageIndex, el.id, { fontSize: Math.max(1, Math.min(999, +e.target.value || 12)) })}
                  className="w-14 h-6 px-1 border border-[var(--color-border)] rounded text-[10px] bg-white outline-none tabular-nums transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
                />
                <span className="font-[600] tabular-nums">px</span>
              </div>
            </div>
            <input type="range" min={8} max={72} value={el.fontSize}
              onChange={(e) => updateTextElement(currentPageIndex, el.id, { fontSize: Math.max(1, Math.min(999, +e.target.value || 12)) })}
              className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
          </div>
          {/* 行间距（横排=行高倍数，竖排=列间距倍数） */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
              <span>{t('editor.tools.lineSpacing')}</span>
              <span className="font-[600] tabular-nums">{(el.lineHeight ?? 1.2).toFixed(1)}</span>
            </div>
            <input type="range" min={0.6} max={3} step={0.1} value={el.lineHeight ?? 1.2}
              onChange={(e) => updateTextElement(currentPageIndex, el.id, { lineHeight: +e.target.value })}
              className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
          </div>
          {/* 字间距（横排=水平字符间距，竖排=垂直字符间距） */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
              <span>{t('editor.tools.letterSpacing')}</span>
              <span className="font-[600] tabular-nums">{el.letterSpacing ?? 0}px</span>
            </div>
            <input type="range" min={0} max={20} step={1} value={el.letterSpacing ?? 0}
              onChange={(e) => updateTextElement(currentPageIndex, el.id, { letterSpacing: +e.target.value })}
              className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
          </div>
          {/* 加粗 / 斜体 */}
          <div className="flex gap-1.5">
            <button onClick={() => updateTextElement(currentPageIndex, el.id, { bold: !el.bold })}
              className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                ${el.bold ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
              <span className="font-bold">B</span> {t('editor.tools.bold')}
            </button>
            <button onClick={() => updateTextElement(currentPageIndex, el.id, { italic: !el.italic })}
              className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                ${el.italic ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
              <span className="italic">I</span> {t('editor.tools.italic')}
            </button>
          </div>
          {/* 对齐 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.align')}</div>
            <div className="flex gap-1.5">
              {([
                { key: 'left' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="7" x2="9" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
                { key: 'center' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
                { key: 'right' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="7" x2="12" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
              ]).map(({ key, icon }) => (
                <button key={key} title={key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateTextElement(currentPageIndex, el.id, { align: key })}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                    ${el.align === key ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          {/* 垂直对齐（顶/居中/底） */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.verticalAlign')}</div>
            <div className="flex gap-1.5">
              {([
                { key: 'top' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="3" y1="2" x2="3" y2="12"/><line x1="3" y1="2" x2="12" y2="2"/><line x1="3" y1="6" x2="9" y2="6"/><line x1="3" y1="10" x2="12" y2="10"/></svg> },
                { key: 'center' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="3" y1="2" x2="3" y2="12"/><line x1="3" y1="3" x2="12" y2="3"/><line x1="3" y1="7" x2="9" y2="7"/><line x1="3" y1="11" x2="12" y2="11"/></svg> },
                { key: 'bottom' as const, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="3" y1="2" x2="3" y2="12"/><line x1="3" y1="12" x2="12" y2="12"/><line x1="3" y1="4" x2="9" y2="4"/><line x1="3" y1="8" x2="12" y2="8"/></svg> },
              ]).map(({ key, icon }) => (
                <button key={key} title={key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateTextElement(currentPageIndex, el.id, { verticalAlign: key })}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                    ${(el.verticalAlign ?? 'center') === key ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          {/* 文字方向 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.textDirection')}</div>
            <div className="flex gap-1.5">
              <button onClick={() => updateTextElement(currentPageIndex, el.id, { isVertical: false })}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                  ${el.isVertical !== true ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><line x1="1.5" y1="3" x2="10.5" y2="3"/><line x1="1.5" y1="6" x2="8" y2="6"/><line x1="1.5" y1="9" x2="10.5" y2="9"/></svg>
                {t('editor.tools.horizontal')}
              </button>
              <button onClick={() => updateTextElement(currentPageIndex, el.id, { isVertical: true })}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                  ${el.isVertical === true ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><line x1="3" y1="1.5" x2="3" y2="10.5"/><line x1="6" y1="2" x2="6" y2="7.5"/><line x1="9" y1="1.5" x2="9" y2="10.5"/></svg>
                {t('editor.tools.vertical')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 颜色 ── */}
      {tab === 'color' && (
        <div className="space-y-3">
          <ColorPalette
            label={t('editor.tools.textColor')}
            selectedColor={el.gradient && el.gradient.length >= 2 ? gradientToCss(el.gradient) : el.color}
            onColorChange={(c) => updateTextElement(currentPageIndex, el.id, { color: c, gradient: undefined, gradientType: undefined })}
            onGradientChange={(preset) => updateTextElement(currentPageIndex, el.id, {
              gradient: preset.stops,
              gradientType: preset.type,
              color: preset.stops[0]?.color ?? el.color,
            })}
            onClearGradient={() => updateTextElement(currentPageIndex, el.id, { gradient: undefined, gradientType: undefined })}
            gradientAngle={el.gradientAngle}
            onGradientAngleChange={(a) => updateTextElement(currentPageIndex, el.id, { gradientAngle: a })}
            gradientStops={el.gradient}
            onGradientStopsChange={(gradient) => updateTextElement(currentPageIndex, el.id, {
              gradient,
              color: gradient[0]?.color ?? el.color,
            })}
          />
        </div>
      )}
    </div>
  );
}