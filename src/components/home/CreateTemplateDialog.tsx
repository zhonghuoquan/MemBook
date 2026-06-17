import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { SlotLayout } from '../../types';
import { createCustomTemplate, saveCustomTemplate, loadCustomTemplate } from '../../db';

interface CreateTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editTemplate?: { id: string; name: string; slots: SlotLayout[] } | null;
}

/* ── Layout presets ── */
type LayoutPresetId = '2x2' | '2x3' | '3x3' | '4x4' | 'pin-2' | 'pin-3' | 'stagger-4' | 'custom-rc';

const LAYOUT_PRESETS: { id: LayoutPresetId; label: string }[] = [
  { id: '2x2', label: '2×2' }, { id: '2x3', label: '2×3' },
  { id: '3x3', label: '3×3' }, { id: '4x4', label: '4×4' },
  { id: 'pin-2', label: '品2' }, { id: 'pin-3', label: '品3' },
  { id: 'stagger-4', label: '错落' }, { id: 'custom-rc', label: 'R×C' },
];

/* ── Slot generators ── */
function genGrid(rows: number, cols: number, m: number, g: number): SlotLayout[] {
  const sw = (100 - 2 * m - (cols - 1) * g) / cols;
  const sh = (100 - 2 * m - (rows - 1) * g) / rows;
  return Array.from({ length: rows * cols }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    return { id: `slot_${i}`, x: +(m + c * (sw + g)).toFixed(1), y: +(m + r * (sh + g)).toFixed(1), width: +sw.toFixed(1), height: +sh.toFixed(1) };
  });
}
function genPin2(m: number, g: number): SlotLayout[] {
  const w = 100 - 2 * m, th = (100 - 2 * m - g) * 0.55, bh = (100 - 2 * m - g) * 0.45, sw = (w - g) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +w.toFixed(1), height: +th.toFixed(1) },
    { id: 'slot_1', x: m, y: +(m + th + g).toFixed(1), width: +sw.toFixed(1), height: +bh.toFixed(1) },
    { id: 'slot_2', x: +(m + sw + g).toFixed(1), y: +(m + th + g).toFixed(1), width: +sw.toFixed(1), height: +bh.toFixed(1) },
  ];
}
function genPin3(m: number, g: number): SlotLayout[] {
  const lw = (100 - 2 * m - g) * 0.55, rw = (100 - 2 * m - g) * 0.45, h = (100 - 2 * m - g) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +lw.toFixed(1), height: +(100 - 2 * m).toFixed(1) },
    { id: 'slot_1', x: +(m + lw + g).toFixed(1), y: m, width: +rw.toFixed(1), height: +h.toFixed(1) },
    { id: 'slot_2', x: +(m + lw + g).toFixed(1), y: +(m + h + g).toFixed(1), width: +rw.toFixed(1), height: +h.toFixed(1) },
  ];
}
function genStagger(m: number, g: number): SlotLayout[] {
  const bw = (100 - 2 * m - g) * 0.55, sw = (100 - 2 * m - g) * 0.45, srh = (100 - 2 * m - g * 2) / 3, bh = srh * 2 + g;
  return [
    { id: 'slot_0', x: m, y: m, width: +bw.toFixed(1), height: +bh.toFixed(1) },
    { id: 'slot_1', x: +(m + bw + g).toFixed(1), y: m, width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_2', x: +(m + bw + g).toFixed(1), y: +(m + srh + g).toFixed(1), width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_3', x: m, y: +(m + bh + g).toFixed(1), width: +(bw + g + sw).toFixed(1), height: +srh.toFixed(1) },
  ];
}
function genSlots(preset: LayoutPresetId, m: number, g: number, r: number, c: number): SlotLayout[] {
  switch (preset) {
    case '2x2': return genGrid(2, 2, m, g);
    case '2x3': return genGrid(2, 3, m, g);
    case '3x3': return genGrid(3, 3, m, g);
    case '4x4': return genGrid(4, 4, m, g);
    case 'pin-2': return genPin2(m, g);
    case 'pin-3': return genPin3(m, g);
    case 'stagger-4': return genStagger(m, g);
    case 'custom-rc': return genGrid(Math.max(1, r), Math.max(1, c), m, g);
  }
}

const GRID = 5;        // 吸附网格步进(%)
const MIN_SLOT = 5;    // 最小槽位尺寸(%)

export function CreateTemplateDialog({ open, onClose, onCreated, editTemplate }: CreateTemplateDialogProps) {
  const isEditing = !!editTemplate;
  const [name, setName] = useState('');
  const [margin, setMargin] = useState(10);
  const [gap, setGap] = useState(4);
  const [customRows, setCustomRows] = useState(3);
  const [customCols, setCustomCols] = useState(3);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [saving, setSaving] = useState(false);

  // Refs 保持最新值，解决闭包过期
  const marginRef = useRef(margin);
  marginRef.current = margin;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Canvas + 拖拽
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b' | null;
    idx: number;
    sx: number; sy: number;
    mx: number; my: number;     // 鼠标按下时的位置
    startX: number; startY: number;
  } | null>(null);

  const snap = (v: number) => snapToGrid ? Math.round(v / GRID) * GRID : Math.round(v * 10) / 10;

  /* ── 初始化 ── */
  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name);
      setSlots(editTemplate.slots.map((s) => ({ ...s })));
    } else {
      setName('');
      setSlots(genSlots(selectedPreset, margin, gap, customRows, customCols));
    }
    setSelectedIdx(null);
    // 不重置 selectedPreset，保留当前选中状态
  }, [editTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedPreset, setSelectedPreset] = useState<LayoutPresetId>('2x2');
  const isCustomRC = selectedPreset === 'custom-rc';

  // 预设切换 → 重新生成（创建和编辑模式都生效）
  useEffect(() => {
    setSlots(genSlots(selectedPreset, margin, gap, customRows, customCols));
    setSelectedIdx(null);
  }, [selectedPreset]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Canvas 坐标转换 ── */
  const getPct = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  /* ── 拖拽开始 ── */
  const onDragStart = useCallback((e: React.MouseEvent, idx: number, mode: string) => {
    e.stopPropagation();
    if (mode !== 'move') e.preventDefault();
    setSelectedIdx(idx);
    const p = getPct(e.clientX, e.clientY);
    const s = slotsRef.current[idx];
    if (!s) return;
    // 记录鼠标点击位置和槽位起始位置（用于计算 dx/dy）
    dragRef.current = {
      mode: mode as any,
      idx,
      sx: s.x, sy: s.y,
      mx: p.x, my: p.y,           // 鼠标按下时的位置
      startX: s.x + s.width,      // 右下角（缩放用）
      startY: s.y + s.height,
    };
  }, [getPct]);

  /* ── 全局鼠标事件：移动 + 抬起 ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      const p = getPct(e.clientX, e.clientY);
      const M = marginRef.current;
      // dx/dy 相对于鼠标按下的位置，不是槽位位置
      const dx = p.x - dr.mx;
      const dy = p.y - dr.my;

      setSlots((prev) => {
        const next = prev.map((s) => ({ ...s }));
        const slot = next[dr.idx];
        if (!slot) return prev;

        if (dr.mode === 'move') {
          let nx = dr.sx + dx;
          let ny = dr.sy + dy;
          // 边界限制（不吸附，避免拖拽漂移）
          nx = Math.max(M, Math.min(100 - M - slot.width, nx));
          ny = Math.max(M, Math.min(100 - M - slot.height, ny));
          slot.x = nx;
          slot.y = ny;
        } else {
          // 缩放
          let { x: ox, y: oy, width: ow, height: oh } = prev[dr.idx];
          let nw = ow, nh = oh, nx = ox, ny = oy;
          if (dr.mode?.includes('r')) nw = Math.max(MIN_SLOT, dr.startX - ox + dx);
          if (dr.mode?.includes('l')) { nw = Math.max(MIN_SLOT, ow - dx); nx = ox + (ow - nw); }
          if (dr.mode?.includes('b')) nh = Math.max(MIN_SLOT, dr.startY - oy + dy);
          if (dr.mode?.includes('t')) { nh = Math.max(MIN_SLOT, oh - dy); ny = oy + (oh - nh); }
          // 边界约束
          if (nx < M) { nw -= (M - nx); nx = M; }
          if (ny < M) { nh -= (M - ny); ny = M; }
          if (nx + nw > 100 - M) { nw = 100 - M - nx; }
          if (ny + nh > 100 - M) { nh = 100 - M - ny; }
          nw = Math.max(MIN_SLOT, nw);
          nh = Math.max(MIN_SLOT, nh);
          slot.x = nx;
          slot.y = ny;
          slot.width = nw;
          slot.height = nh;
        }
        return next;
      });
    };

    const onUp = () => {
      // 抬起时吸附到网格
      if (dragRef.current) {
        const dr = dragRef.current;
        setSlots((prev) => {
          if (!snapToGrid) return prev;
          const next = prev.map((s) => ({ ...s }));
          const slot = next[dr.idx];
          if (!slot) return prev;
          slot.x = Math.round(slot.x / GRID) * GRID;
          slot.y = Math.round(slot.y / GRID) * GRID;
          if (dr.mode !== 'move') {
            slot.width = Math.max(MIN_SLOT, Math.round(slot.width / GRID) * GRID);
            slot.height = Math.max(MIN_SLOT, Math.round(slot.height / GRID) * GRID);
          }
          return next;
        });
      }
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [getPct, snapToGrid]);

  /* ── 操作 ── */
  const addPhotoSlot = () => {
    setSlots((prev) => {
      const n = prev.length;
      const ref = prev[0] || { width: 30, height: 40 };
      return [...prev, { id: `slot_${n}`, x: snap(Math.max(marginRef.current, 3)), y: snap(Math.max(marginRef.current, 3)), width: snap(ref.width), height: snap(ref.height) }];
    });
  };
  const addTextZone = () => {
    setSlots((prev) => [...prev, { id: `text_${prev.length}`, x: snap(10), y: snap(80), width: snap(80), height: snap(12) }]);
  };
  const removeSelectedSlot = () => {
    if (selectedIdx === null) return;
    setSlots((prev) => prev.filter((_, i) => i !== selectedIdx).map((s, i) => ({ ...s, id: s.id.startsWith('text_') ? `text_${i}` : `slot_${i}` })));
    setSelectedIdx(null);
  };
  const moveUp = () => {
    if (selectedIdx === null || selectedIdx <= 0) return;
    setSlots((prev) => { const n = [...prev]; [n[selectedIdx - 1], n[selectedIdx]] = [n[selectedIdx], n[selectedIdx - 1]]; return n; });
    setSelectedIdx(selectedIdx - 1);
  };
  const moveDown = () => {
    if (selectedIdx === null || selectedIdx >= slots.length - 1) return;
    setSlots((prev) => { const n = [...prev]; [n[selectedIdx], n[selectedIdx + 1]] = [n[selectedIdx + 1], n[selectedIdx]]; return n; });
    setSelectedIdx(selectedIdx + 1);
  };

  const updateSlot = useCallback((idx: number, patch: Partial<SlotLayout>) => {
    setSlots((prev) => { const n = [...prev]; n[idx] = { ...n[idx], ...patch }; return n; });
  }, []);

  const photoCount = slots.filter((s) => s.id.startsWith('slot_')).length;
  const textCount = slots.filter((s) => s.id.startsWith('text_')).length;

  /* ── 保存 ── */
  const handleSave = async () => {
    if (photoCount === 0) return;
    setSaving(true);
    try {
      if (isEditing && editTemplate) {
        const existing = await loadCustomTemplate(editTemplate.id);
        await saveCustomTemplate({
          id: editTemplate.id, name: name || '未命名模板', slots, isBuiltIn: false,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await createCustomTemplate(name || '未命名模板', slots);
      }
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  /* ── 渲染 ── */
  return (
    <Modal open={open} onClose={onClose} title={isEditing ? '编辑模板' : '创建模板'} maxWidth="840px">
      {/* 顶部：名称 + 吸附 */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="给你的模板起个名字" maxLength={20}
            className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body)] text-[var(--color-gray-800)] placeholder:text-[var(--color-text-tertiary)]
                       outline-none hover:border-[var(--color-border-hover)]
                       focus:border-[var(--color-primary-400)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)] transition-all" />
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={snapToGrid} onChange={() => setSnapToGrid(!snapToGrid)}
            className="w-3.5 h-3.5 accent-[var(--color-primary-600)] cursor-pointer" />
          <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">吸附 {GRID}%</span>
        </label>
      </div>

      <div className="flex gap-5">
        {/* ── 左栏：控件面板 ── */}
        <div className="w-[240px] shrink-0 space-y-4">
          {/* 布局预设 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">快速布局</div>
            <div className="grid grid-cols-4 gap-1">
              {LAYOUT_PRESETS.map((p) => (
                <button key={p.id}
                  className={`p-1 rounded-[var(--radius-xs)] text-center cursor-pointer border transition-all text-[9.5px] font-[500] leading-tight ${
                    selectedPreset === p.id ? 'border-[var(--color-primary-500)] bg-[var(--color-surface-selected)] text-[var(--color-primary-700)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:border-[var(--color-primary-300)]'
                  }`}
                  onClick={() => setSelectedPreset(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {isCustomRC && (
            <div className="flex items-center gap-2 p-2 bg-[var(--color-gray-50)] rounded-[var(--radius-sm)] border border-[var(--color-border-light)]">
              <span className="text-[9px] text-[var(--color-gray-500)] shrink-0">行</span>
              <input type="number" min={1} max={10} value={customRows}
                onChange={(e) => setCustomRows(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-12 h-6 px-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] text-center outline-none [appearance:textfield]" />
              <span className="text-[var(--color-gray-300)] text-[10px]">×</span>
              <span className="text-[9px] text-[var(--color-gray-500)] shrink-0">列</span>
              <input type="number" min={1} max={10} value={customCols}
                onChange={(e) => setCustomCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-12 h-6 px-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] text-center outline-none [appearance:textfield]" />
              <span className="text-[9px] text-[var(--color-text-tertiary)] ml-auto">{customRows * customCols}</span>
            </div>
          )}

          {/* 边距 */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] font-[500] text-[var(--color-gray-500)]">边距(边界)</span>
              <span className="text-[8px] text-[var(--color-text-tertiary)]">{margin}%</span>
            </div>
            <input type="range" min={2} max={20} value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
          </div>
          {/* 间距 */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] font-[500] text-[var(--color-gray-500)]">间距</span>
              <span className="text-[8px] text-[var(--color-text-tertiary)]">{gap}%</span>
            </div>
            <input type="range" min={0} max={10} step={0.5} value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
          </div>

          {/* 操作 */}
          <div className="pt-2 border-t border-[var(--color-border-light)] space-y-1.5">
            <div className="flex gap-1.5">
              <button onClick={addPhotoSlot}
                className="flex-1 h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] font-[500] text-[var(--color-gray-600)] hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] cursor-pointer transition-all">
                +照片位
              </button>
              <button onClick={addTextZone}
                className="flex-1 h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] font-[500] text-[var(--color-gray-600)] hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] cursor-pointer transition-all">
                +文字区
              </button>
            </div>
            <button onClick={removeSelectedSlot} disabled={selectedIdx === null}
              className="w-full h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-error)]/30 rounded-[var(--radius-xs)] text-[10px] font-[500] text-[var(--color-error)] hover:bg-[var(--color-error)]/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
              删除选中
            </button>
          </div>
        </div>

        {/* ── 右栏：画布 + 属性 ── */}
        <div className="flex-1 min-w-0">
          {/* 画布 */}
          <div ref={canvasRef} className="aspect-[4/3] bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] relative overflow-hidden select-none">
            {/* 边界指示 */}
            <div className="absolute pointer-events-none z-[2]"
              style={{ left: `${margin}%`, top: `${margin}%`, width: `${100 - margin * 2}%`, height: `${100 - margin * 2}%`, border: '1px dashed var(--color-primary-300)', opacity: 0.45 }} />
            {/* 网格 */}
            {snapToGrid && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs><pattern id="g" width={GRID} height={GRID} patternUnits="userSpaceOnUse"><path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="var(--color-gray-200)" strokeWidth="0.3" /></pattern></defs>
                <rect width="100" height="100" fill="url(#g)" />
              </svg>
            )}
            {/* 槽位 */}
            {slots.map((slot, i) => {
              const isText = slot.id.startsWith('text_');
              const sel = selectedIdx === i;
              const photoN = slots.filter((s, j) => j < i && !s.id.startsWith('text_')).length;
              return (
                <div key={slot.id}
                  className={`absolute rounded-[var(--radius-sm)] flex items-center justify-center ${sel ? 'z-10' : 'z-[1]'}`}
                  style={{
                    left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%`,
                    backgroundColor: isText ? 'hsl(30,40%,88%)' : `hsl(250,${55 + (i * 5) % 25}%,${sel ? 72 : 65 + (i * 3) % 15}%)`,
                    border: isText ? '1.5px dashed #d4a854' : '1px solid rgba(255,255,255,0.4)',
                    outline: sel ? '2px solid var(--color-primary-500)' : 'none',
                    outlineOffset: -1,
                  }}
                  onMouseDown={(e) => onDragStart(e, i, 'move')}>
                  <span className="text-[10px] font-[500] pointer-events-none" style={{ color: isText ? '#a08040' : 'rgba(255,255,255,0.7)' }}>
                    {isText ? '📝' : photoN + 1}
                  </span>
                  {/* 缩放控制柄 */}
                  {sel && ['tl','tr','bl','br','t','b','l','r'].map((pos) => (
                    <Handle key={pos} pos={pos} onMouseDown={(e) => onDragStart(e, i, `resize-${pos}`)} />
                  ))}
                </div>
              );
            })}
          </div>

          {/* 统计 */}
          <div className="flex items-center justify-center gap-3 mt-1.5 text-[10px] text-[var(--color-text-tertiary)]">
            <span>📷 {photoCount} 个照片位</span>
            {textCount > 0 && <span>📝 {textCount} 个文字区</span>}
          </div>

          {/* 选中属性 */}
          {selectedIdx !== null && (
            <div className="mt-3 p-3 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-[500] text-[var(--color-gray-700)]">
                  {slots[selectedIdx]?.id.startsWith('text_') ? '文字区' : `照片位 #${slots.filter((s, j) => j < selectedIdx && !s.id.startsWith('text_')).length + 1}`}
                </span>
                <div className="flex gap-1">
                  <button onClick={moveUp} disabled={selectedIdx <= 0}
                    className="w-5 h-5 flex items-center justify-center border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-white text-[var(--color-gray-500)] disabled:opacity-30 cursor-pointer text-[10px]">↑</button>
                  <button onClick={moveDown} disabled={selectedIdx >= slots.length - 1}
                    className="w-5 h-5 flex items-center justify-center border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-white text-[var(--color-gray-500)] disabled:opacity-30 cursor-pointer text-[10px]">↓</button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([{k:'x',l:'X%'},{k:'y',l:'Y%'},{k:'width',l:'W%'},{k:'height',l:'H%'}] as const).map(({k,l}) => (
                  <div key={k}>
                    <label className="block text-[8px] text-[var(--color-gray-500)] mb-0.5">{l}</label>
                    <input type="number" min={0} max={100} step={1}
                      value={Math.round(slots[selectedIdx][k])}
                      onChange={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); updateSlot(selectedIdx, { [k]: snap(v) }); }}
                      className="w-full h-6 px-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] text-center outline-none [appearance:textfield]" />
                  </div>
                ))}
              </div>
              {/* 尺寸预设 */}
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <span className="text-[8px] text-[var(--color-gray-400)]">预设:</span>
                {[{l:'1:1',w:25,h:25},{l:'4:3',w:28,h:21},{l:'3:4',w:21,h:28},{l:'2:1',w:35,h:17.5},{l:'横条',w:80,h:12},{l:'竖条',w:12,h:80}].map((p) => (
                  <button key={p.l}
                    className="px-1.5 py-0.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[8px] text-[var(--color-gray-500)] hover:border-[var(--color-primary-400)] cursor-pointer transition-colors"
                    onClick={() => updateSlot(selectedIdx!, { width: snap(p.w), height: snap(p.h) })}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部 */}
      <div className="flex justify-between items-center mt-4 pt-3 border-t border-[var(--color-border-light)]">
        <span className="text-[9px] text-[var(--color-text-tertiary)]">拖拽移动 · 拖拽缩放 · 选中调参</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || photoCount === 0}>
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
    tl: { top: -4, left: -4, cursor: 'nw-resize' },
    tr: { top: -4, right: -4, cursor: 'ne-resize' },
    bl: { bottom: -4, left: -4, cursor: 'sw-resize' },
    br: { bottom: -4, right: -4, cursor: 'se-resize' },
    t: { top: -4, left: '50%', cursor: 'n-resize', transform: 'translateX(-50%)' },
    b: { bottom: -4, left: '50%', cursor: 's-resize', transform: 'translateX(-50%)' },
    l: { top: '50%', left: -4, cursor: 'w-resize', transform: 'translateY(-50%)' },
    r: { top: '50%', right: -4, cursor: 'e-resize', transform: 'translateY(-50%)' },
  };
  return (
    <div onMouseDown={onMouseDown}
      className="absolute bg-white border border-[var(--color-primary-500)] rounded-full z-20"
      style={{ width: 10, height: 10, ...positions[pos], boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
  );
}
