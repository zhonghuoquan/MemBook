import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store';
import {
  STICKY_COLORS, TEXT_STYLE_PRESETS, SHAPE_TYPES,
  DEFAULT_TEXT_LINE_HEIGHT, DEFAULT_TEXT_LETTER_SPACING,
} from '../../types';
import type { BrushType, PageTextElement, StickyNote, ShapeType } from '../../types';
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
  const pendingShapeType = useEditorStore((s) => s.pendingShapeType);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const setBrushSettings = useEditorStore((s) => s.setBrushSettings);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const updatePageBackground = useEditorStore((s) => s.updatePageBackground);
  const applyBackgroundByScope = useEditorStore((s) => s.applyBackgroundByScope);
  const addTextElement = useEditorStore((s) => s.addTextElement);
  const sb = useScrollbarVisibility<HTMLDivElement>();
  const addStickyNote = useEditorStore((s) => s.addStickyNote);
  const setPendingTextEditId = useEditorStore((s) => s.setPendingTextEditId);
  const setPendingShapeType = useEditorStore((s) => s.setPendingShapeType);
  const removeBrushStroke = useEditorStore((s) => s.removeBrushStroke);
  const pages = useEditorStore((s) => s.pages);
  const currentPage = pages[currentPageIndex];

  /* ── 添加元素后清空其它选中态，交由右侧属性面板编辑 ── */
  const setSelectedTextId = useEditorStore((s) => s.setSelectedTextId);
  const setSelectedStickyId = useEditorStore((s) => s.setSelectedStickyId);
  const setSelectedShapeId = useEditorStore((s) => s.setSelectedShapeId);

  /* ── 便利贴默认参数（用于新建便利贴；选中便利贴的属性在右侧面板编辑） ── */
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
      width: 150,
      // 高度与单行文字高度一致（与 fitTextSize 计算一致：fontSize*1.2 + 内边距），避免文本框远超文字高度
      height: Math.round((preset?.fontSize ?? 20) * 1.2 + 4),
      text: '',
      fontSize: preset?.fontSize ?? 20,
      fontFamily: '思源黑体',
      color: preset?.color ?? '#212529',
      align: 'left',
      verticalAlign: 'center',
      bold: preset?.bold ?? false,
      italic: preset?.italic ?? false,
      underline: false,
      rotation: 0,
      zIndex: 0,
      lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
      letterSpacing: DEFAULT_TEXT_LETTER_SPACING,
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

  /* ── 选择形状：进入形状绘制模式（PPT 式：选择后在工作区按住拖拽绘制） ── */
  const handlePickShape = useCallback((type: ShapeType) => {
    // 再次点击同一形状：退出绘制模式
    if (activeTool === 'shape' && pendingShapeType === type) {
      setActiveTool('none');
      setPendingShapeType(null);
      return;
    }
    setPendingShapeType(type);
    setActiveTool('shape');
    // 清空其它元素的选中态，避免与绘制模式混淆
    setSelectedTextId(null);
    setSelectedStickyId(null);
    setSelectedShapeId(null);
  }, [activeTool, pendingShapeType, setPendingShapeType, setActiveTool, setSelectedTextId, setSelectedStickyId, setSelectedShapeId]);

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
      {/* Content */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 space-y-4 ${sb.className}`} {...sb.handlers}>

        {/* ═══════════════════ 1. 绘制工具（画笔 & 橡皮擦） ═══════════════════ */}
        <section>
          <SectionTitle>{t('editor.tools.brushSection')}</SectionTitle>
          {/* 工具切换：始终可见，点击即用 */}
          <div className="flex items-center gap-1.5">
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

          {/* 画笔设置：选中画笔时展开 */}
          {activeTool === 'brush' && (
            <div className="mt-2.5 space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
              <BrushPreview
                brushType={brushSettings.brushType}
                strokeWidth={brushSettings.strokeWidth}
                color={brushSettings.color}
                opacity={brushSettings.opacity}
              />

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

              <div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-gray-500)] mb-1">
                  <span>{t('editor.tools.strokeWidth')}</span>
                  <span className="font-[600] tabular-nums">{brushSettings.strokeWidth}px</span>
                </div>
                <input type="range" min={1} max={24} value={brushSettings.strokeWidth}
                  onChange={(e) => setBrushSettings({ strokeWidth: +e.target.value })}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>

              <ColorPicker
                selectedColor={brushSettings.color}
                recentColors={brushSettings.recentColors}
                onColorChange={(c) => setBrushSettings({ color: c })}
                onRecentColorAdd={addRecentColor}
                size="sm"
              />

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

          {/* 橡皮擦设置：选中橡皮擦时展开 */}
          {activeTool === 'eraser' && (
            <div className="mt-2.5 space-y-3 p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] border border-[var(--color-error)]/20">
              <div className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.tools.eraserHint')}</div>
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
        </section>

        {/* ═══════════════════ 2. 添加元素（文字 & 便利贴） ═══════════════════ */}
        <section>
          <SectionTitle>{t('editor.tools.elementsSection')}</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            <AddButton
              onClick={() => handleAddText()}
              label={t('editor.tools.addText')}
              icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><path d="M4 3h8M8 3v10M5.5 13h5"/></svg>}
            />
            <AddButton
              onClick={() => handleAddSticky()}
              label={t('editor.tools.addSticky')}
              icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3h10v6l-3 3H3z" fill="var(--color-primary-100)" strokeLinejoin="round"/><path d="M10 13l3-3"/></svg>}
            />
          </div>
          <div className="text-[11px] text-[var(--color-gray-400)] px-1 pt-1.5">{t('editor.tools.elementsHint')}</div>
        </section>

        {/* ═══════════════════ 3. 形状 ═══════════════════ */}
        <section>
          <SectionTitle>{t('editor.tools.shapeSection')}</SectionTitle>
          <div className="p-3 bg-[var(--color-surface-hover)] rounded-[var(--radius-md)]">
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPE_TYPES.map((st) => (
                <button
                  key={st}
                  onClick={() => handlePickShape(st)}
                  title={t(`editor.tools.shape_${st}`)}
                  className={`flex items-center justify-center h-10 rounded-[var(--radius-sm)] border cursor-pointer transition-colors
                             ${activeTool === 'shape' && pendingShapeType === st
                               ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                               : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'}`}
                >
                  <ShapeIcon type={st} className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-[var(--color-gray-400)] px-1 pt-1.5">{t('editor.tools.shapeHint')}</div>
        </section>

        {/* ═══════════════════ 4. 背景 ═══════════════════ */}
        <section>
          <SectionTitle>{t('editor.tools.backgroundSection')}</SectionTitle>
          <BackgroundPicker
            currentPage={currentPage}
            onApplyBg={(bg) => updatePageBackground(currentPageIndex, bg)}
            onApplyByScope={applyBackgroundByScope}
          />
        </section>

      </div>
    </aside>
  );
}

/* ── 分区标题 ── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-[600] text-[var(--color-gray-600)] uppercase tracking-wide mb-2">
      {children}
    </h3>
  );
}

/* ── 添加元素按钮 ── */
function AddButton({ onClick, label, icon }: { onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 py-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-primary-400)] bg-[var(--color-surface-selected)] text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] cursor-pointer transition-colors"
    >
      {icon}
      <span className="text-[11px] font-[500]">{label}</span>
    </button>
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
    case 'roundedRect': return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="4"/></svg>;
    case 'singleRoundRect': return <svg {...props}><path d="M9 5H20v14H4v-9Q4 5 9 5z"/></svg>;
    case 'diagonalRoundRect': return <svg {...props}><path d="M9 5H20v11Q20 19 17 19H4v-9Q4 5 9 5z"/></svg>;
    case 'parallelogram': return <svg {...props}><path d="M5 5h16l-3 14H2z"/></svg>;
    case 'trapezoid': return <svg {...props}><path d="M8 5h8l5 14H3z"/></svg>;
    case 'cutCornerRect': return <svg {...props}><path d="M9 5H20v14H4V9z"/></svg>;
    case 'cutDiagonalRect': return <svg {...props}><path d="M9 5H20v10l-4 4H4V9z"/></svg>;
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
