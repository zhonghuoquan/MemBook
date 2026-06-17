import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { SlotLayout } from '../../types';
import { createCustomTemplate, saveCustomTemplate, loadCustomTemplate } from '../../db';

interface CreateTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** 编辑模式：传入已有模板数据 */
  editTemplate?: { id: string; name: string; slots: SlotLayout[] } | null;
}

/* ── Layout presets ── */
type LayoutPresetId =
  | '2x2' | '2x3' | '3x3' | '4x4'
  | 'pin-2' | 'pin-3'
  | 'stagger-4'
  | 'custom-rc';

interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  description: string;
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: '2x2', label: '2×2 网格', description: '4张等分' },
  { id: '2x3', label: '2×3 网格', description: '6张等分' },
  { id: '3x3', label: '3×3 网格', description: '9张等分' },
  { id: '4x4', label: '4×4 网格', description: '16张等分' },
  { id: 'pin-2', label: '品字形2图', description: '大+2小' },
  { id: 'pin-3', label: '品字形3图', description: '左2+右1' },
  { id: 'stagger-4', label: '错落4图', description: '大+3小' },
  { id: 'custom-rc', label: '自定义行列', description: '自由设行列' },
];

/* ── Slot generators ── */
function gridSlots(rows: number, cols: number, m: number, g: number): SlotLayout[] {
  const sw = (100 - 2 * m - (cols - 1) * g) / cols;
  const sh = (100 - 2 * m - (rows - 1) * g) / rows;
  return Array.from({ length: rows * cols }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    return { id: `slot_${i}`, x: +(m + c * (sw + g)).toFixed(1), y: +(m + r * (sh + g)).toFixed(1), width: +sw.toFixed(1), height: +sh.toFixed(1) };
  });
}

function pin2Slots(m: number, g: number): SlotLayout[] {
  const ww = 100 - 2 * m, wh = (100 - 2 * m - g) * 0.55, sh = (100 - 2 * m - g) * 0.45, sw = (ww - g) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +ww.toFixed(1), height: +wh.toFixed(1) },
    { id: 'slot_1', x: m, y: +(m + wh + g).toFixed(1), width: +sw.toFixed(1), height: +sh.toFixed(1) },
    { id: 'slot_2', x: +(m + sw + g).toFixed(1), y: +(m + wh + g).toFixed(1), width: +sw.toFixed(1), height: +sh.toFixed(1) },
  ];
}

function pin3Slots(m: number, g: number): SlotLayout[] {
  const lw = (100 - 2 * m - g) * 0.55, rw = (100 - 2 * m - g) * 0.45, hh = (100 - 2 * m - g) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +lw.toFixed(1), height: +(100 - 2 * m).toFixed(1) },
    { id: 'slot_1', x: +(m + lw + g).toFixed(1), y: m, width: +rw.toFixed(1), height: +hh.toFixed(1) },
    { id: 'slot_2', x: +(m + lw + g).toFixed(1), y: +(m + hh + g).toFixed(1), width: +rw.toFixed(1), height: +hh.toFixed(1) },
  ];
}

function stagger4Slots(m: number, g: number): SlotLayout[] {
  const bw = (100 - 2 * m - g) * 0.55, sw = (100 - 2 * m - g) * 0.45, srh = (100 - 2 * m - g * 2) / 3, bh = srh * 2 + g;
  return [
    { id: 'slot_0', x: m, y: m, width: +bw.toFixed(1), height: +bh.toFixed(1) },
    { id: 'slot_1', x: +(m + bw + g).toFixed(1), y: m, width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_2', x: +(m + bw + g).toFixed(1), y: +(m + srh + g).toFixed(1), width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_3', x: m, y: +(m + bh + g).toFixed(1), width: +(bw + g + sw).toFixed(1), height: +srh.toFixed(1) },
  ];
}

function generateSlots(preset: LayoutPresetId, m: number, g: number, r: number, c: number): SlotLayout[] {
  switch (preset) {
    case '2x2': return gridSlots(2, 2, m, g);
    case '2x3': return gridSlots(2, 3, m, g);
    case '3x3': return gridSlots(3, 3, m, g);
    case '4x4': return gridSlots(4, 4, m, g);
    case 'pin-2': return pin2Slots(m, g);
    case 'pin-3': return pin3Slots(m, g);
    case 'stagger-4': return stagger4Slots(m, g);
    case 'custom-rc': return gridSlots(Math.max(1, r), Math.max(1, c), m, g);
  }
}

const GRID = 5; // snap grid in percent

export function CreateTemplateDialog({ open, onClose, onCreated, editTemplate }: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<LayoutPresetId>('2x2');
  const [margin, setMargin] = useState(10);
  const [gap, setGap] = useState(4);
  const [customRows, setCustomRows] = useState(3);
  const [customCols, setCustomCols] = useState(3);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── 拖拽交互 ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | null;
    slotIdx: number;
    startX: number;
    startY: number;
    startSlot: SlotLayout;
  } | null>(null);

  const getCanvasPct = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const handleSlotMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    setSelectedIdx(idx);
    const pos = getCanvasPct(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'move',
      slotIdx: idx,
      startX: pos.x,
      startY: pos.y,
      startSlot: { ...slots[idx] },
    };
  }, [getCanvasPct, slots]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, idx: number, corner: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedIdx(idx);
    const pos = getCanvasPct(e.clientX, e.clientY);
    dragRef.current = {
      mode: corner as any,
      slotIdx: idx,
      startX: pos.x,
      startY: pos.y,
      startSlot: { ...slots[idx] },
    };
  }, [getCanvasPct, slots]);

  // 全局 mousemove / mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      const pos = getCanvasPct(e.clientX, e.clientY);
      const dx = pos.x - dr.startX;
      const dy = pos.y - dr.startY;
      const s = dr.startSlot;

      setSlots((prev) => {
        const next = [...prev];
        const slot = { ...next[dr.slotIdx] };
        const snap = (v: number) => snapToGrid ? Math.round(v / GRID) * GRID : Math.round(v * 10) / 10;

        if (dr.mode === 'move') {
          slot.x = snap(Math.max(0, Math.min(100 - slot.width, s.x + dx)));
          slot.y = snap(Math.max(0, Math.min(100 - slot.height, s.y + dy)));
        } else {
          // Resize
          let { x, y, width, height } = s;
          if (dr.mode?.includes('r')) { width = Math.max(5, s.width + dx); }
          if (dr.mode?.includes('l')) { width = Math.max(5, s.width - dx); x = s.x + (s.width - Math.max(5, s.width - dx)); }
          if (dr.mode?.includes('b')) { height = Math.max(5, s.height + dy); }
          if (dr.mode?.includes('t')) { height = Math.max(5, s.height - dy); y = s.y + (s.height - Math.max(5, s.height - dy)); }
          // Clamp
          if (x < 0) { width += x; x = 0; }
          if (y < 0) { height += y; y = 0; }
          if (x + width > 100) { width = 100 - x; }
          if (y + height > 100) { height = 100 - y; }
          slot.x = snap(x);
          slot.y = snap(y);
          slot.width = snap(Math.max(5, width));
          slot.height = snap(Math.max(5, height));
        }
        next[dr.slotIdx] = slot;
        return next;
      });
    };

    const onUp = () => { dragRef.current = null; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [getCanvasPct, snapToGrid]);

  const isEditing = !!editTemplate;
  const isCustomRC = selectedPreset === 'custom-rc';

  // 编辑模式：初始化数据
  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name);
      setSlots(editTemplate.slots.map((s) => ({ ...s })));
      setSelectedPreset('custom-rc');
    }
  }, [editTemplate]);

  // Reset slots when preset / params change (only in create mode)
  useEffect(() => {
    if (isEditing) return;
    setSlots(generateSlots(selectedPreset, margin, gap, customRows, customCols));
    setSelectedIdx(null);
  }, [selectedPreset, margin, gap, customRows, customCols, isEditing]);

  const snapVal = (v: number) => snapToGrid ? Math.round(v / GRID) * GRID : v;

  const updateSlot = useCallback((idx: number, patch: Partial<SlotLayout>) => {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const addPhotoSlot = () => {
    setSlots((prev) => {
      const n = prev.length;
      const s = prev[0] || { x: 3, y: 3, width: 30, height: 40 };
      const newSlot: SlotLayout = {
        id: `slot_${n}`,
        x: snapVal(3),
        y: snapVal(3),
        width: snapVal(s.width),
        height: snapVal(s.height),
      };
      return [...prev, newSlot];
    });
    setSelectedIdx(slots.length);
  };

  const addTextZone = () => {
    setSlots((prev) => {
      const n = prev.length;
      const newSlot: SlotLayout = {
        id: `text_${n}`,
        x: snapVal(10),
        y: snapVal(80),
        width: snapVal(80),
        height: snapVal(12),
      };
      return [...prev, newSlot];
    });
    setSelectedIdx(slots.length);
  };

  const removeSelectedSlot = () => {
    if (selectedIdx === null) return;
    setSlots((prev) => {
      const next = prev.filter((_, i) => i !== selectedIdx);
      return next.map((s, i) => ({ ...s, id: s.id.startsWith('text_') ? `text_${i}` : `slot_${i}` }));
    });
    setSelectedIdx(null);
  };

  const moveSlotUp = () => {
    if (selectedIdx === null || selectedIdx <= 0) return;
    setSlots((prev) => { const next = [...prev]; [next[selectedIdx - 1], next[selectedIdx]] = [next[selectedIdx], next[selectedIdx - 1]]; return next; });
    setSelectedIdx(selectedIdx - 1);
  };

  const moveSlotDown = () => {
    if (selectedIdx === null || selectedIdx >= slots.length - 1) return;
    setSlots((prev) => { const next = [...prev]; [next[selectedIdx], next[selectedIdx + 1]] = [next[selectedIdx + 1], next[selectedIdx]]; return next; });
    setSelectedIdx(selectedIdx + 1);
  };

  const slotCount = slots.filter((s) => s.id.startsWith('slot_')).length;
  const textCount = slots.filter((s) => s.id.startsWith('text_')).length;

  const handleSave = async () => {
    if (slotCount === 0) return;
    setSaving(true);
    try {
      if (isEditing && editTemplate) {
        // 保留原始 createdAt
        const existing = await loadCustomTemplate(editTemplate.id);
        await saveCustomTemplate({
          id: editTemplate.id,
          name: name || '未命名模板',
          slots,
          isBuiltIn: false,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await createCustomTemplate(name || '未命名模板', slots);
      }
      onCreated();
      resetState();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const resetState = () => {
    setName('');
    setSelectedPreset('2x2');
    setMargin(10);
    setGap(4);
    setSelectedIdx(null);
  };

  // ── Render ──
  return (
    <Modal open={open} onClose={onClose} title="创建模板" maxWidth="840px">
      {/* Top: Name + Grid snap */}
      <div className="flex items-center gap-4 mb-5">
        <div className="flex-1">
          <input
            type="text"
            className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body)] text-[var(--color-gray-800)]
                       placeholder:text-[var(--color-text-tertiary)]
                       outline-none hover:border-[var(--color-border-hover)]
                       focus:border-[var(--color-primary-400)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
                       transition-all"
            placeholder="给你的模板起个名字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
          />
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={() => setSnapToGrid(!snapToGrid)}
            className="w-3.5 h-3.5 accent-[var(--color-primary-600)] cursor-pointer"
          />
          <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">吸附网格 ({GRID}%)</span>
        </label>
      </div>

      <div className="flex gap-6">
        {/* ── Left: Presets + Controls ── */}
        <div className="w-[280px] shrink-0 space-y-4">
          {/* Layout presets */}
          <div>
            <label className="block text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-1.5">
              快速布局
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {LAYOUT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`p-1.5 rounded-[var(--radius-sm)] text-center cursor-pointer border transition-all duration-150 ${
                    selectedPreset === p.id
                      ? 'border-[var(--color-primary-500)] bg-[var(--color-surface-selected)]'
                      : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-300)]'
                  }`}
                  onClick={() => setSelectedPreset(p.id)}
                >
                  <LayoutIcon layoutId={p.id} />
                  <div className="text-[9px] font-[500] text-[var(--color-gray-700)] mt-0.5 leading-tight">{p.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom rows/cols */}
          {isCustomRC && (
            <div className="flex items-center gap-2 p-2.5 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] border border-[var(--color-border-light)]">
              <label className="text-[10px] font-[500] text-[var(--color-gray-600)] shrink-0">行</label>
              <input type="number" min={1} max={10} value={customRows}
                onChange={(e) => setCustomRows(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-14 h-7 px-1.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[11px] text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-[var(--color-gray-300)] text-[11px]">×</span>
              <label className="text-[10px] font-[500] text-[var(--color-gray-600)] shrink-0">列</label>
              <input type="number" min={1} max={10} value={customCols}
                onChange={(e) => setCustomCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-14 h-7 px-1.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[11px] text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-[10px] text-[var(--color-text-tertiary)] ml-auto">{customRows * customCols}位</span>
            </div>
          )}

          {/* Sliders */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] font-[500] text-[var(--color-gray-600)]">边距</label>
              <span className="text-[9px] text-[var(--color-text-tertiary)]">{margin}%</span>
            </div>
            <input type="range" min={2} max={20} value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)]" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] font-[500] text-[var(--color-gray-600)]">间距</label>
              <span className="text-[9px] text-[var(--color-text-tertiary)]">{gap}%</span>
            </div>
            <input type="range" min={0} max={10} step={0.5} value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)]" />
          </div>

          {/* Slot operations */}
          <div className="pt-2 border-t border-[var(--color-border-light)]">
            <div className="flex items-center gap-1.5 mb-2">
              <button onClick={addPhotoSlot}
                className="flex-1 h-8 flex items-center justify-center gap-1 bg-white border border-[var(--color-border)]
                           rounded-[var(--radius-sm)] text-[11px] font-[500] text-[var(--color-gray-600)]
                           hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] cursor-pointer transition-all">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3 h-3"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/><circle cx="4.5" cy="4.5" r="0.8" fill="currentColor" stroke="none"/><path d="M1.5 8l2-2 2 2 1.5-1.5L10 9.5"/></svg>
                加照片位
              </button>
              <button onClick={addTextZone}
                className="flex-1 h-8 flex items-center justify-center gap-1 bg-white border border-[var(--color-border)]
                           rounded-[var(--radius-sm)] text-[11px] font-[500] text-[var(--color-gray-600)]
                           hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] cursor-pointer transition-all">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3 h-3"><line x1="2" y1="2.5" x2="10" y2="2.5"/><line x1="6" y1="2.5" x2="6" y2="9.5"/><line x1="3.5" y1="9.5" x2="8.5" y2="9.5"/></svg>
                加文字区
              </button>
            </div>
            <button onClick={removeSelectedSlot}
              disabled={selectedIdx === null}
              className="w-full h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-error)]/30
                         rounded-[var(--radius-sm)] text-[11px] font-[500] text-[var(--color-error)]
                         hover:bg-[var(--color-error)]/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
              删除选中槽位
            </button>
          </div>
        </div>

        {/* ── Right: Preview + Properties ── */}
        <div className="flex-1 min-w-0">
          {/* Interactive preview */}
          <div ref={canvasRef} className="aspect-[4/3] bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] relative overflow-hidden">
            {/* Grid overlay */}
            {snapToGrid && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                    <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="var(--color-gray-200)" strokeWidth="0.3" />
                  </pattern>
                </defs>
                <rect width="100" height="100" fill="url(#grid)" />
              </svg>
            )}

            {/* Slots — 支持拖拽移动 + 拖拽缩放 */}
            {slots.map((slot, i) => {
              const isText = slot.id.startsWith('text_');
              const isSelected = selectedIdx === i;
              const hue = isText ? 30 : 250;
              const sat = isText ? 40 : 55;
              const lig = isSelected ? 72 : isText ? 88 : 65 + (i * 3) % 15;

              return (
                <div
                  key={slot.id}
                  className={`absolute rounded-[var(--radius-sm)] select-none ${
                    isSelected ? 'z-10' : 'z-[1]'
                  }`}
                  style={{
                    left: `${slot.x}%`, top: `${slot.y}%`,
                    width: `${slot.width}%`, height: `${slot.height}%`,
                    backgroundColor: `hsl(${hue}, ${sat}%, ${lig}%)`,
                    border: isText ? '1.5px dashed #d4a854' : '1px solid rgba(255,255,255,0.4)',
                    outline: isSelected ? '2px solid var(--color-primary-500)' : 'none',
                    outlineOffset: -1,
                  }}
                  onMouseDown={(e) => handleSlotMouseDown(e, i)}
                >
                  <span className="text-[10px] font-[500] pointer-events-none select-none"
                        style={{ color: isText ? '#a08040' : 'rgba(255,255,255,0.7)' }}>
                    {isText ? 'T' : i + 1}
                  </span>

                  {/* 选中时显示缩放控制柄 */}
                  {isSelected && (
                    <>
                      <Handle pos="tl" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-tl')} />
                      <Handle pos="tr" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-tr')} />
                      <Handle pos="bl" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-bl')} />
                      <Handle pos="br" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-br')} />
                      {/* 边缘缩放 */}
                      <Handle pos="t" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-t')} />
                      <Handle pos="b" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-b')} />
                      <Handle pos="l" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-l')} />
                      <Handle pos="r" onMouseDown={(e) => handleResizeMouseDown(e, i, 'resize-r')} />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Slot count */}
          <div className="flex items-center justify-center gap-3 mt-1.5 text-[10px] text-[var(--color-text-tertiary)]">
            <span>📷 {slotCount} 个照片位</span>
            {textCount > 0 && <span>📝 {textCount} 个文字区</span>}
          </div>

          {/* ── Selected slot properties ── */}
          {selectedIdx !== null && (
            <div className="mt-3 p-3 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)] animate-[fadeIn_0.15s_ease-out]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-[500] text-[var(--color-gray-700)]">
                  槽位 {selectedIdx + 1}
                  {slots[selectedIdx]?.id.startsWith('text_') && <span className="text-[var(--color-warning)] ml-1">(文字区)</span>}
                </span>
                <div className="flex gap-1">
                  <button onClick={moveSlotUp} disabled={selectedIdx <= 0}
                    className="w-6 h-6 flex items-center justify-center border border-[var(--color-border)] rounded-[var(--radius-sm)]
                               bg-white text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] disabled:opacity-30 cursor-pointer text-[11px]">
                    ↑
                  </button>
                  <button onClick={moveSlotDown} disabled={selectedIdx >= slots.length - 1}
                    className="w-6 h-6 flex items-center justify-center border border-[var(--color-border)] rounded-[var(--radius-sm)]
                               bg-white text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] disabled:opacity-30 cursor-pointer text-[11px]">
                    ↓
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { key: 'x', label: 'X%' },
                  { key: 'y', label: 'Y%' },
                  { key: 'width', label: 'W%' },
                  { key: 'height', label: 'H%' },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-[9px] text-[var(--color-gray-500)] mb-0.5">{label}</label>
                    <input
                      type="number"
                      min={0} max={100} step={1}
                      value={Math.round(slots[selectedIdx][key])}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        updateSlot(selectedIdx, { [key]: snapToGrid ? snapVal(v) : v });
                      }}
                      className="w-full h-7 px-1.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-sm)]
                                 text-[11px] text-center outline-none [appearance:textfield]
                                 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                ))}
              </div>
              {/* Quick size presets */}
              <div className="flex items-center gap-1 mt-2">
                <span className="text-[9px] text-[var(--color-gray-400)] mr-1">预设:</span>
                {[
                  { label: '1:1', w: 25, h: 25 },
                  { label: '4:3', w: 28, h: 21 },
                  { label: '3:4', w: 21, h: 28 },
                  { label: '2:1', w: 35, h: 17.5 },
                  { label: '1:2', w: 17.5, h: 35 },
                  { label: '全宽', w: 90, h: 15 },
                ].map((preset) => (
                  <button key={preset.label}
                    className="px-1.5 py-0.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)]
                               text-[9px] text-[var(--color-gray-500)] hover:border-[var(--color-primary-400)]
                               cursor-pointer transition-colors"
                    onClick={() => {
                      updateSlot(selectedIdx, { width: snapVal(preset.w), height: snapVal(preset.h) });
                    }}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mt-5 pt-4 border-t border-[var(--color-border-light)]">
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {slots.length} 个区域 · 拖动移动 · 拖拽角/边缘缩放 · 选中后可在下方调参
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || slotCount === 0}>
            {saving ? '保存中…' : '保存模板'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 缩放控制柄 ── */
function Handle({ pos, onMouseDown }: { pos: string; onMouseDown: (e: React.MouseEvent) => void }) {
  const positions: Record<string, React.CSSProperties> = {
    tl: { top: -3, left: -3, cursor: 'nw-resize' },
    tr: { top: -3, right: -3, cursor: 'ne-resize' },
    bl: { bottom: -3, left: -3, cursor: 'sw-resize' },
    br: { bottom: -3, right: -3, cursor: 'se-resize' },
    t: { top: -3, left: '50%', cursor: 'n-resize', transform: 'translateX(-50%)' },
    b: { bottom: -3, left: '50%', cursor: 's-resize', transform: 'translateX(-50%)' },
    l: { top: '50%', left: -3, cursor: 'w-resize', transform: 'translateY(-50%)' },
    r: { top: '50%', right: -3, cursor: 'e-resize', transform: 'translateY(-50%)' },
  };
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute bg-white border border-[var(--color-primary-500)] rounded-full z-20"
      style={{
        width: 12, height: 12,
        ...positions[pos],
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}
    />
  );
}

/* ── Mini layout icon ── */
function LayoutIcon({ layoutId }: { layoutId: LayoutPresetId }) {
  const c = '#6C63FF';
  const icons: Record<string, React.ReactNode> = {
    '2x2': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto"><rect x="3" y="3" width="12" height="12" rx="1.5" fill={c} opacity="0.8" /><rect x="17" y="3" width="12" height="12" rx="1.5" fill={c} opacity="0.6" /><rect x="3" y="17" width="12" height="12" rx="1.5" fill={c} opacity="0.6" /><rect x="17" y="17" width="12" height="12" rx="1.5" fill={c} opacity="0.4" /></svg>),
    '2x3': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto">{Array.from({length:6},(_,i)=>(<rect key={i} x={2+i%2*16} y={2+Math.floor(i/2)*10} width="13" height="8" rx="1.5" fill={c} opacity={1-i*0.12} />))}</svg>),
    '3x3': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto">{Array.from({length:9},(_,i)=>(<rect key={i} x={2+i%3*10} y={2+Math.floor(i/3)*10} width="8" height="8" rx="1.5" fill={c} opacity={1-i*0.09} />))}</svg>),
    '4x4': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto">{Array.from({length:16},(_,i)=>(<rect key={i} x={1+i%4*8} y={1+Math.floor(i/4)*8} width="6" height="6" rx="1" fill={c} opacity={1-i*0.06} />))}</svg>),
    'pin-2': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto"><rect x="3" y="3" width="26" height="15" rx="1.5" fill={c} opacity="0.8" /><rect x="3" y="20" width="12" height="9" rx="1.5" fill={c} opacity="0.6" /><rect x="17" y="20" width="12" height="9" rx="1.5" fill={c} opacity="0.4" /></svg>),
    'pin-3': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto"><rect x="3" y="3" width="13" height="26" rx="1.5" fill={c} opacity="0.8" /><rect x="18" y="3" width="11" height="12" rx="1.5" fill={c} opacity="0.6" /><rect x="18" y="17" width="11" height="12" rx="1.5" fill={c} opacity="0.4" /></svg>),
    'stagger-4': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto"><rect x="3" y="3" width="17" height="20" rx="1.5" fill={c} opacity="0.8" /><rect x="22" y="3" width="7" height="9" rx="1.5" fill={c} opacity="0.6" /><rect x="22" y="14" width="7" height="9" rx="1.5" fill={c} opacity="0.4" /><rect x="3" y="25" width="26" height="4" rx="1" fill={c} opacity="0.3" /></svg>),
    'custom-rc': (<svg viewBox="0 0 32 32" className="w-7 h-7 mx-auto"><rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke={c} strokeWidth="1.3" strokeDasharray="2.5 2" /><text x="16" y="19" textAnchor="middle" fill={c} fontSize="7" fontWeight="bold">R×C</text></svg>),
  };
  return <>{icons[layoutId] || icons['2x2']}</>;
}
