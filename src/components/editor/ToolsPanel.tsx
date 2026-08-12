import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store';
import {
  STICKY_COLORS, TEXT_STYLE_PRESETS, SHAPE_TYPES, DEFAULT_SHAPE_SIZE,
} from '../../types';
import type { BrushType, PageTextElement, StickyNote, ShapeElement, ShapeType } from '../../types';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { BrushPreview } from './tools/BrushPreview';
import { ColorPicker } from './tools/ColorPicker';
import { BackgroundPicker } from './tools/BackgroundPicker';

/* ── 画笔类型 SVG 图标 ── */
const BRUSH_TYPES: { type: BrushType; label: string; icon: React.ReactNode }[] = [
  {
    type: 'pencil', label: 'editor.tools.brushPencil',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z"/><path d="M12.5 4.5l3 3"/></svg>,
  },
  {
    type: 'brush', label: 'editor.tools.brushBrush',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><path d="M15 2c1 2 1 4-1 6l-3 3-4-4 3-3c2-2 4-2 5-2z"/><path d="M7 11l-4 6 2 1 4-5"/></svg>,
  },
  {
    type: 'marker', label: 'editor.tools.brushMarker',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><rect x="8" y="2" width="6" height="12" rx="1" transform="rotate(25 11 8)"/><path d="M6 14l-3 4 2 0.5 3-3"/></svg>,
  },
  {
    type: 'highlighter', label: 'editor.tools.brushHighlighter',
    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><rect x="3" y="7" width="14" height="5" rx="1" opacity="0.5"/><path d="M5 7V4h10v3"/></svg>,
  },
];

export function ToolsPanel() {
  const { t } = useTranslation();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const setBrushSettings = useEditorStore((s) => s.setBrushSettings);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const updatePageBackground = useEditorStore((s) => s.updatePageBackground);
  const applyBackgroundToAllPages = useEditorStore((s) => s.applyBackgroundToAllPages);
  const addTextElement = useEditorStore((s) => s.addTextElement);
  const sb = useScrollbarVisibility<HTMLDivElement>();
  const addStickyNote = useEditorStore((s) => s.addStickyNote);
  const addShapeElement = useEditorStore((s) => s.addShapeElement);
  const updateShapeElement = useEditorStore((s) => s.updateShapeElement);
  const removeShapeElement = useEditorStore((s) => s.removeShapeElement);
  const setPendingTextEditId = useEditorStore((s) => s.setPendingTextEditId);
  const removeBrushStroke = useEditorStore((s) => s.removeBrushStroke);
  const pages = useEditorStore((s) => s.pages);
  const currentPage = pages[currentPageIndex];

  /* ── 文字/便利贴选中态与编辑方法 ── */
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const selectedStickyId = useEditorStore((s) => s.selectedStickyId);
  const selectedShapeId = useEditorStore((s) => s.selectedShapeId);
  const setSelectedTextId = useEditorStore((s) => s.setSelectedTextId);
  const setSelectedStickyId = useEditorStore((s) => s.setSelectedStickyId);
  const setSelectedShapeId = useEditorStore((s) => s.setSelectedShapeId);
  const updateTextElement = useEditorStore((s) => s.updateTextElement);
  const updateStickyNote = useEditorStore((s) => s.updateStickyNote);
  const selectedTextEl = currentPage?.textElements?.find((e) => e.id === selectedTextId);
  const selectedStickyNote = currentPage?.stickyNotes?.find((n) => n.id === selectedStickyId);
  const selectedShape = currentPage?.shapeElements?.find((s) => s.id === selectedShapeId);

  /* 文字字体列表 */
  const FONT_FAMILIES = ['思源黑体', '宋体', '微软雅黑', '楷体', '黑体', '仿宋'];

  /* ── 折叠状态 ── */
  const [, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /* ── 便利贴默认参数（用于新建便利贴；选中便利贴的属性在下方面板编辑） ── */
  const DEFAULT_STICKY_COLOR = STICKY_COLORS[0].color;
  const DEFAULT_STICKY_STYLE = 'rounded' as const;
  const DEFAULT_STICKY_SIZE = { w: 120, h: 120 }; // md

  /* ── 最近颜色管理 ── */
  const addRecentColor = useCallback((color: string) => {
    setBrushSettings({
      recentColors: [color, ...(brushSettings.recentColors || []).filter((c) => c !== color)].slice(0, 8),
    });
  }, [brushSettings.recentColors, setBrushSettings]);

  /* ── 添加文字（支持预设样式） ── */
  const handleAddText = useCallback((preset?: typeof TEXT_STYLE_PRESETS[number]) => {
    if (!currentPage) return;
    const el: PageTextElement = {
      id: `text-${Date.now()}`,
      x: 30, y: 30,
      width: 150, height: (preset?.fontSize ?? 20) * 2.5,
      text: '',
      fontSize: preset?.fontSize ?? 20,
      fontFamily: '思源黑体',
      color: preset?.color ?? '#212529',
      align: 'left',
      bold: preset?.bold ?? false,
      italic: preset?.italic ?? false,
      underline: false,
      rotation: 0,
      zIndex: 0,
    };
    addTextElement(currentPageIndex, el);
    // 自动选中新文字并进入编辑模式
    setSelectedStickyId(null);
    setSelectedTextId(el.id);
    setPendingTextEditId(el.id);
  }, [currentPage, currentPageIndex, addTextElement, setPendingTextEditId, setSelectedTextId, setSelectedStickyId]);

  /* ── 添加便利贴 ── */
  const handleAddSticky = useCallback((color?: string) => {
    if (!currentPage) return;
    const note: StickyNote = {
      id: `sticky-${Date.now()}`,
      x: 45, y: 40,
      width: DEFAULT_STICKY_SIZE.w, height: DEFAULT_STICKY_SIZE.h,
      color: color || DEFAULT_STICKY_COLOR,
      text: '',
      fontSize: 14,
      fontFamily: '思源黑体',
      rotation: 0,
      zIndex: 0,
      style: DEFAULT_STICKY_STYLE,
    };
    addStickyNote(currentPageIndex, note);
    // 自动选中新便利贴并进入编辑模式
    setSelectedTextId(null);
    setSelectedStickyId(note.id);
    setPendingTextEditId(note.id);
  }, [currentPage, currentPageIndex, addStickyNote, setSelectedTextId, setSelectedStickyId, setPendingTextEditId]);

  /* ── 添加形状 ── */
  const handleAddShape = useCallback((type: ShapeType) => {
    if (!currentPage) return;
    const shape: ShapeElement = {
      id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: 105, y: 140,   // 页面中心附近（mm）
      width: DEFAULT_SHAPE_SIZE.width,
      height: DEFAULT_SHAPE_SIZE.height,
      type,
      fill: '#6C63FF',
      stroke: '#6C63FF',
      strokeWidth: 2,
      opacity: 1,
      rotation: 0,
      zIndex: 0,
    };
    addShapeElement(currentPageIndex, shape);
    // 自动选中新形状
    setSelectedTextId(null);
    setSelectedStickyId(null);
    setSelectedShapeId(shape.id);
  }, [currentPage, currentPageIndex, addShapeElement, setSelectedTextId, setSelectedStickyId, setSelectedShapeId]);

  /* ── 清除当前页所有笔迹 ── */
  const handleClearAllStrokes = useCallback(() => {
    if (!currentPage) return;
    const strokes = currentPage.brushStrokes || [];
    for (const s of strokes) {
      removeBrushStroke(currentPageIndex, s.id);
    }
  }, [currentPage, currentPageIndex, removeBrushStroke]);

  const brushStrokes = currentPage?.brushStrokes || [];

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">{t('editor.tools.title')}</span>
      </div>

      {/* Content */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 space-y-2 ${sb.className}`} {...sb.handlers}>

        {/* ═══════════════════ 1. 画笔 & 橡皮擦 ═══════════════════ */}
        <CollapsibleSection title={t('editor.tools.brushSection')} icon="brush" defaultOpen onToggle={() => toggleSection('brush')}>
          {/* 工具切换 */}
          <div className="flex items-center gap-1.5 mb-3">
            <ToolButton
              active={activeTool === 'brush'}
              onClick={() => setActiveTool(activeTool === 'brush' ? 'none' : 'brush')}
              variant="brand"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
                <path d="M12 2c1 1.5 1 3-0.5 4.5L8 10 5 7l3.5-3.5C10 2 11 2 12 2z"/><path d="M4 11l-2 3.5 1.5 0.5 2.5-3"/>
              </svg>
              {t('editor.tools.brush')}
            </ToolButton>
            <ToolButton
              active={activeTool === 'eraser'}
              onClick={() => setActiveTool(activeTool === 'eraser' ? 'none' : 'eraser')}
              variant="danger"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
                <path d="M2 12h12M5 9l-3 3h5l7-7-4-4-5 5z"/>
              </svg>
              {t('editor.tools.eraser')}
            </ToolButton>
          </div>

          {/* 画笔设置 */}
          {activeTool === 'brush' && (
            <div className="space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              {/* 预览 */}
              <BrushPreview
                brushType={brushSettings.brushType}
                strokeWidth={brushSettings.strokeWidth}
                color={brushSettings.color}
                opacity={brushSettings.opacity}
              />

              {/* 笔触类型 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">{t('editor.tools.brushType')}</div>
                <div className="flex gap-1.5">
                  {BRUSH_TYPES.map((bt) => (
                    <button
                      key={bt.type}
                      onClick={() => setBrushSettings({ brushType: bt.type })}
                      className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-[var(--radius-sm)] text-[10px] font-[500] border transition-colors cursor-pointer
                        ${brushSettings.brushType === bt.type
                          ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                          : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                        }`}
                    >
                      {bt.icon}
                      {t(bt.label)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 粗细 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.strokeWidth')}</span>
                  <span className="font-[600] tabular-nums">{brushSettings.strokeWidth}px</span>
                </div>
                <input type="range" min={1} max={24} value={brushSettings.strokeWidth}
                  onChange={(e) => setBrushSettings({ strokeWidth: +e.target.value })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>

              {/* 颜色 */}
              <ColorPicker
                selectedColor={brushSettings.color}
                recentColors={brushSettings.recentColors}
                onColorChange={(c) => setBrushSettings({ color: c })}
                onRecentColorAdd={addRecentColor}
                size="sm"
              />

              {/* 透明度 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.opacity')}</span>
                  <span className="font-[600] tabular-nums">{Math.round(brushSettings.opacity * 100)}%</span>
                </div>
                <input type="range" min={10} max={100} value={Math.round(brushSettings.opacity * 100)}
                  onChange={(e) => setBrushSettings({ opacity: +e.target.value / 100 })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>
            </div>
          )}

          {/* 橡皮擦设置 */}
          {activeTool === 'eraser' && (
            <div className="space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] border border-[var(--color-error)]/20">
              <div className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.tools.eraserHint')}</div>
              {/* 橡皮擦大小 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.eraserSize')}</span>
                  <span className="font-[600] tabular-nums">{brushSettings.strokeWidth * 2}px</span>
                </div>
                <input type="range" min={4} max={48} step={2}
                  value={brushSettings.strokeWidth * 2}
                  onChange={(e) => setBrushSettings({ strokeWidth: +e.target.value / 2 })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-error)]" />
              </div>
              {/* 清除全部 */}
              {brushStrokes.length > 0 && (
                <button
                  onClick={handleClearAllStrokes}
                  className="w-full py-1.5 text-[11px] font-[500] text-[var(--color-error)] border border-[var(--color-error)]/30 rounded-[var(--radius-sm)] bg-[var(--color-error-light)] hover:bg-[var(--color-error)]/10 cursor-pointer transition-colors"
                >
                  {t('editor.tools.clearAllStrokes', { count: brushStrokes.length })}
                </button>
              )}
            </div>
          )}

          {activeTool !== 'brush' && activeTool !== 'eraser' && (
            <div className="text-[11px] text-[var(--color-gray-400)] px-3 py-2 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              {t('editor.tools.brushHint')}
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════════ 2. 文字 ═══════════════════ */}
        <CollapsibleSection title={t('editor.tools.textSection')} icon="text" defaultOpen onToggle={() => toggleSection('text')}
          headerAction={
            <button
              onClick={() => handleAddText()}
              title={t('editor.tools.addText')}
              className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)]
                         border border-[var(--color-primary-400)] text-[var(--color-primary-600)]
                         bg-[var(--color-surface-selected)] cursor-pointer
                         hover:bg-[var(--color-primary-50)] hover:border-[var(--color-primary-500)] transition-colors"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
              </svg>
            </button>
          }
        >
          {/* 文字属性面板（选中文字元素时显示） */}
          {selectedTextEl && (
            <div className="space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              <div className="text-[10px] font-[500] text-[var(--color-brand)] uppercase tracking-wide">{t('editor.tools.textProperties')}</div>
              {/* 字体 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.fontFamily')}</div>
                <select value={selectedTextEl.fontFamily} onChange={(e) => updateTextElement(currentPageIndex, selectedTextEl.id, { fontFamily: e.target.value })}
                  className="w-full h-7 px-1.5 border border-[var(--color-border)] rounded text-[11px] bg-white cursor-pointer outline-none">
                  {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              {/* 字号 */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.fontSize')}</span>
                  <span className="font-[600] tabular-nums">{selectedTextEl.fontSize}px</span>
                </div>
                <input type="range" min={8} max={72} value={selectedTextEl.fontSize}
                  onChange={(e) => updateTextElement(currentPageIndex, selectedTextEl.id, { fontSize: Math.max(1, Math.min(999, +e.target.value || 12)) })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>
              {/* 加粗 / 斜体 */}
              <div className="flex gap-1.5">
                <button onClick={() => updateTextElement(currentPageIndex, selectedTextEl.id, { bold: !selectedTextEl.bold })}
                  className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                    ${selectedTextEl.bold ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                  <span className="font-bold">B</span> {t('editor.tools.bold')}
                </button>
                <button onClick={() => updateTextElement(currentPageIndex, selectedTextEl.id, { italic: !selectedTextEl.italic })}
                  className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                    ${selectedTextEl.italic ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                  <span className="italic">I</span> {t('editor.tools.italic')}
                </button>
              </div>
              {/* 颜色 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.textColor')}</div>
                <div className="flex items-center gap-2">
                  <input type="color" value={selectedTextEl.color} onChange={(e) => updateTextElement(currentPageIndex, selectedTextEl.id, { color: e.target.value })}
                    className="w-8 h-7 border border-[var(--color-border)] rounded cursor-pointer p-0" />
                  <input type="text" value={selectedTextEl.color} onChange={(e) => updateTextElement(currentPageIndex, selectedTextEl.id, { color: e.target.value })}
                    className="flex-1 h-7 px-2 border border-[var(--color-border)] rounded text-[11px] bg-white outline-none" />
                </div>
              </div>
              {/* 对齐 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.align')}</div>
                <div className="flex gap-1.5">
                  {([
                    { key: 'left' as const, label: t('editor.tools.alignLeft'), icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="7" x2="9" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
                    { key: 'center' as const, label: t('editor.tools.alignCenter'), icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
                    { key: 'right' as const, label: t('editor.tools.alignRight'), icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3"><line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="7" x2="12" y2="7"/><line x1="2" y1="11" x2="12" y2="11"/></svg> },
                  ]).map(({ key, label, icon }) => (
                    <button key={key} title={label}
                      onClick={() => updateTextElement(currentPageIndex, selectedTextEl.id, { align: key })}
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                        ${selectedTextEl.align === key ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              {/* 文字方向 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.textDirection')}</div>
                <div className="flex gap-1.5">
                  <button onClick={() => updateTextElement(currentPageIndex, selectedTextEl.id, { rotation: 0 })}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                      ${selectedTextEl.rotation !== -90 ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><line x1="1.5" y1="3" x2="10.5" y2="3"/><line x1="1.5" y1="6" x2="8" y2="6"/><line x1="1.5" y1="9" x2="10.5" y2="9"/></svg>
                    {t('editor.tools.horizontal')}
                  </button>
                  <button onClick={() => updateTextElement(currentPageIndex, selectedTextEl.id, { rotation: -90 })}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
                      ${selectedTextEl.rotation === -90 ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'}`}>
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><line x1="3" y1="1.5" x2="3" y2="10.5"/><line x1="6" y1="2" x2="6" y2="7.5"/><line x1="9" y1="1.5" x2="9" y2="10.5"/></svg>
                    {t('editor.tools.vertical')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 未选中文字时的提示 */}
          {!selectedTextEl && (
            <div className="text-[11px] text-[var(--color-gray-400)] p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              {t('editor.tools.textHint')}
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════════ 3. 便利贴 ═══════════════════ */}
        <CollapsibleSection title={t('editor.tools.stickySection')} icon="sticky" defaultOpen onToggle={() => toggleSection('sticky')}
          headerAction={
            <button
              onClick={() => handleAddSticky()}
              title={t('editor.tools.addSticky')}
              className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)]
                         border border-[var(--color-primary-400)] text-[var(--color-primary-600)]
                         bg-[var(--color-surface-selected)] cursor-pointer
                         hover:bg-[var(--color-primary-50)] hover:border-[var(--color-primary-500)] transition-colors"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
              </svg>
            </button>
          }
        >
          {/* 便利贴属性面板（选中便利贴时显示） */}
          {selectedStickyNote && (
            <div className="space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              <div className="text-[10px] font-[500] text-[var(--color-brand)] uppercase tracking-wide">{t('editor.tools.stickyProperties')}</div>
              {/* 颜色 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">{t('editor.tools.color')}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {STICKY_COLORS.map((sc) => (
                    <button
                      key={sc.color}
                      onClick={() => updateStickyNote(currentPageIndex, selectedStickyNote.id, { color: sc.color })}
                      className={`w-7 h-7 rounded-[4px] border-2 cursor-pointer transition-transform hover:scale-110
                        ${selectedStickyNote.color === sc.color ? 'border-[var(--color-brand)] scale-110' : 'border-[var(--color-border)]'}`}
                      style={{ backgroundColor: sc.color }}
                      title={sc.name}
                    />
                  ))}
                </div>
              </div>
              {/* 样式 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">{t('editor.tools.style')}</div>
                <div className="flex gap-1.5">
                  {([
                    { key: 'rounded' as const, label: t('editor.tools.styleRounded') },
                    { key: 'square' as const, label: t('editor.tools.styleSquare') },
                    { key: 'tape' as const, label: t('editor.tools.styleTape') },
                    { key: 'shadow' as const, label: t('editor.tools.styleShadow') },
                  ]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => updateStickyNote(currentPageIndex, selectedStickyNote.id, { style: key })}
                      className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[10px] font-[500] border cursor-pointer transition-colors
                        ${(selectedStickyNote.style || 'rounded') === key
                          ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                          : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 未选中便利贴时的提示 */}
          {!selectedStickyNote && (
            <div className="text-[11px] text-[var(--color-gray-400)] p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              {t('editor.tools.stickyHint')}
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════════ 3.5 形状 ═══════════════════ */}
        <CollapsibleSection title={t('editor.tools.shapeSection')} icon="shape" defaultOpen onToggle={() => toggleSection('shape')}>
          {/* 形状选择面板 */}
          <div className="p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] space-y-2">
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.addShape')}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPE_TYPES.map((st) => (
                <button
                  key={st}
                  onClick={() => handleAddShape(st)}
                  title={t(`editor.tools.shape_${st}`)}
                  className="flex items-center justify-center h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)]
                             bg-white text-[var(--color-gray-500)] hover:border-[var(--color-brand)]
                             hover:text-[var(--color-brand)] cursor-pointer transition-colors"
                >
                  <ShapeIcon type={st} className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>

          {/* 选中形状时的属性编辑面板 */}
          {selectedShape && (
            <div className="space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              <div className="text-[10px] font-[500] text-[var(--color-brand)] uppercase tracking-wide">{t('editor.tools.shapeProperties')}</div>
              {/* 尺寸 */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeWidth')}</div>
                  <input type="number" min={5} value={Math.round(selectedShape.width)}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { width: Math.max(5, +e.target.value || 5) })}
                    className="w-full h-7 px-2 border border-[var(--color-border)] rounded text-[11px] bg-white outline-none" />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeHeight')}</div>
                  <input type="number" min={5} value={Math.round(selectedShape.height)}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { height: Math.max(5, +e.target.value || 5) })}
                    className="w-full h-7 px-2 border border-[var(--color-border)] rounded text-[11px] bg-white outline-none" />
                </div>
              </div>
              {/* 填充色（支持无填充） */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.shapeFill')}</span>
                  <button
                    onClick={() => updateShapeElement(currentPageIndex, selectedShape.id, { fill: '' })}
                    className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${selectedShape.fill === '' ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-[var(--color-border)] text-[var(--color-gray-400)]'}`}
                  >
                    {t('editor.tools.shapeNoFill')}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={selectedShape.fill || '#000000'}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { fill: e.target.value })}
                    disabled={selectedShape.fill === ''}
                    className="w-8 h-7 border border-[var(--color-border)] rounded cursor-pointer p-0 disabled:opacity-40" />
                  <input type="text" value={selectedShape.fill || ''}
                    placeholder={t('editor.tools.shapeNoFill')}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { fill: e.target.value })}
                    className="flex-1 h-7 px-2 border border-[var(--color-border)] rounded text-[11px] bg-white outline-none" />
                </div>
              </div>
              {/* 描边 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeStroke')}</div>
                <div className="flex items-center gap-2">
                  <input type="color" value={selectedShape.stroke || '#000000'}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { stroke: e.target.value })}
                    className="w-8 h-7 border border-[var(--color-border)] rounded cursor-pointer p-0" />
                  <input type="text" value={selectedShape.stroke}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { stroke: e.target.value })}
                    className="flex-1 h-7 px-2 border border-[var(--color-border)] rounded text-[11px] bg-white outline-none" />
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                    <span>{t('editor.tools.shapeStrokeWidth')}</span>
                    <span className="font-[600] tabular-nums">{selectedShape.strokeWidth}px</span>
                  </div>
                  <input type="range" min={0} max={20} value={selectedShape.strokeWidth}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { strokeWidth: +e.target.value })}
                    className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
                </div>
              </div>
              {/* 透明度 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.opacity')}</span>
                  <span className="font-[600] tabular-nums">{Math.round(selectedShape.opacity * 100)}%</span>
                </div>
                <input type="range" min={0} max={100} value={Math.round(selectedShape.opacity * 100)}
                  onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { opacity: +e.target.value / 100 })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>
              {/* 旋转 */}
              <div>
                <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1">{t('editor.tools.shapeRotation')}</div>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={359} value={((selectedShape.rotation % 360) + 360) % 360}
                    onChange={(e) => updateShapeElement(currentPageIndex, selectedShape.id, { rotation: +e.target.value })}
                    className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
                  <span className="text-[10px] font-[600] tabular-nums">{Math.round(((selectedShape.rotation % 360) + 360) % 360)}°</span>
                </div>
              </div>
              {/* 删除 */}
              <button
                onClick={() => { removeShapeElement(currentPageIndex, selectedShape.id); setSelectedShapeId(null); }}
                className="w-full py-1.5 text-[11px] font-[500] text-[var(--color-error)] border border-[var(--color-error)]/30 rounded-[var(--radius-sm)] bg-[var(--color-error-light)] hover:bg-[var(--color-error)]/10 cursor-pointer transition-colors"
              >
                {t('editor.tools.deleteShape')}
              </button>
            </div>
          )}

          {/* 未选中形状时的提示 */}
          {!selectedShape && (
            <div className="text-[11px] text-[var(--color-gray-400)] p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              {t('editor.tools.shapeHint')}
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════════ 4. 背景 ═══════════════════ */}
        <CollapsibleSection title={t('editor.tools.backgroundSection')} icon="bg" defaultOpen onToggle={() => toggleSection('bg')}>
          <BackgroundPicker
            currentPageBg={currentPage?.background}
            onApplyBg={(color) => updatePageBackground(currentPageIndex, color)}
            onApplyToAll={applyBackgroundToAllPages}
          />
        </CollapsibleSection>

      </div>
    </aside>
  );
}

/* ── 可折叠区域 ── */
function CollapsibleSection({
  title,
  defaultOpen,
  onToggle,
  children,
  headerAction,
}: {
  title: string;
  icon?: string;
  defaultOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** 标题栏右侧的操作区（如添加按钮），不随展开/收起隐藏 */
  headerAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => { setOpen(!open); onToggle(); };

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-white overflow-hidden">
      <div className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--color-surface-hover)] transition-colors">
        <button
          onClick={toggle}
          className="flex items-center gap-2 flex-1 cursor-pointer border-none bg-transparent p-0"
        >
          <svg
            viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform ${open ? 'rotate-90' : ''}`}
          >
            <path d="M4.5 2l4 4-4 4"/>
          </svg>
          <span className="text-[12px] font-[500] text-[var(--color-gray-700)]">{title}</span>
        </button>
        {headerAction && (
          <div className="shrink-0">{headerAction}</div>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

/* ── 工具按钮 ── */
function ToolButton({
  active,
  onClick,
  variant,
  children,
}: {
  active: boolean;
  onClick: () => void;
  variant: 'brand' | 'danger';
  children: React.ReactNode;
}) {
  const activeClass = variant === 'brand'
    ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
    : 'border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]';
  const inactiveClass = 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]';

  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-[500] border cursor-pointer transition-colors
        ${active ? activeClass : inactiveClass}`}
    >
      {children}
    </button>
  );
}

/* ── 形状 SVG 图标 ── */
function ShapeIcon({ type, className }: { type: ShapeType; className?: string }) {
  const props = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinejoin: 'round' as const };
  switch (type) {
    case 'rectangle': return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="1"/></svg>;
    case 'square': return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="1"/></svg>;
    case 'circle': return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
    case 'ellipse': return <svg {...props}><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>;
    case 'triangle': return <svg {...props}><path d="M12 4l9 16H3z"/></svg>;
    case 'diamond': return <svg {...props}><path d="M12 3l9 9-9 9-9-9z"/></svg>;
    case 'pentagon': return <svg {...props}><path d="M12 3l8 6-3 11H7L4 9z"/></svg>;
    case 'hexagon': return <svg {...props}><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/></svg>;
    case 'star': return <svg {...props}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>;
    case 'arrow': return <svg {...props}><line x1="3" y1="12" x2="17" y2="12"/><path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'line': return <svg {...props}><line x1="4" y1="20" x2="20" y2="4" strokeLinecap="round"/></svg>;
    default: return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="1"/></svg>;
  }
}
