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

/* ── 内置间距（已移除间距滑块，固定为 1.5%） ── */
const G = 1.5;

/* ── Slot generators ── */
function genGrid(rows: number, cols: number, m: number): SlotLayout[] {
  const sw = (100 - 2 * m - (cols - 1) * G) / cols;
  const sh = (100 - 2 * m - (rows - 1) * G) / rows;
  return Array.from({ length: rows * cols }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    return { id: `slot_${i}`, x: +(m + c * (sw + G)).toFixed(1), y: +(m + r * (sh + G)).toFixed(1), width: +sw.toFixed(1), height: +sh.toFixed(1) };
  });
}
function genPin2(m: number): SlotLayout[] {
  const w = 100 - 2 * m, th = (100 - 2 * m - G) * 0.55, bh = (100 - 2 * m - G) * 0.45, sw = (w - G) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +w.toFixed(1), height: +th.toFixed(1) },
    { id: 'slot_1', x: m, y: +(m + th + G).toFixed(1), width: +sw.toFixed(1), height: +bh.toFixed(1) },
    { id: 'slot_2', x: +(m + sw + G).toFixed(1), y: +(m + th + G).toFixed(1), width: +sw.toFixed(1), height: +bh.toFixed(1) },
  ];
}
function genPin3(m: number): SlotLayout[] {
  const lw = (100 - 2 * m - G) * 0.55, rw = (100 - 2 * m - G) * 0.45, h = (100 - 2 * m - G) / 2;
  return [
    { id: 'slot_0', x: m, y: m, width: +lw.toFixed(1), height: +(100 - 2 * m).toFixed(1) },
    { id: 'slot_1', x: +(m + lw + G).toFixed(1), y: m, width: +rw.toFixed(1), height: +h.toFixed(1) },
    { id: 'slot_2', x: +(m + lw + G).toFixed(1), y: +(m + h + G).toFixed(1), width: +rw.toFixed(1), height: +h.toFixed(1) },
  ];
}
function genStagger(m: number): SlotLayout[] {
  const bw = (100 - 2 * m - G) * 0.55, sw = (100 - 2 * m - G) * 0.45, srh = (100 - 2 * m - G * 2) / 3, bh = srh * 2 + G;
  return [
    { id: 'slot_0', x: m, y: m, width: +bw.toFixed(1), height: +bh.toFixed(1) },
    { id: 'slot_1', x: +(m + bw + G).toFixed(1), y: m, width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_2', x: +(m + bw + G).toFixed(1), y: +(m + srh + G).toFixed(1), width: +sw.toFixed(1), height: +srh.toFixed(1) },
    { id: 'slot_3', x: m, y: +(m + bh + G).toFixed(1), width: +(bw + G + sw).toFixed(1), height: +srh.toFixed(1) },
  ];
}
function genSlots(preset: string, m: number, r: number, c: number): SlotLayout[] {
  switch (preset) {
    case '2x2': return genGrid(2, 2, m);
    case '2x3': return genGrid(2, 3, m);
    case '3x3': return genGrid(3, 3, m);
    case '4x4': return genGrid(4, 4, m);
    case '5x5': return genGrid(5, 5, m);
    case 'pin-2': return genPin2(m);
    case 'pin-3': return genPin3(m);
    case 'stagger-4': return genStagger(m);
    default: return genGrid(Math.max(1, r), Math.max(1, c), m);
  }
}

const GRID = 3;         // 网格步进(%) — 更精细
const MIN_SLOT = 5;     // 最小槽位尺寸(%)
const SNAP_DIST = 2.5;  // 边缘吸附最大距离(%)

/* ── 智能吸附：在多条候选线中找到最近一条 ── */
function smartSnap(val: number, targets: number[], maxDist: number): number {
  let best = val, bestDist = maxDist;
  for (const t of targets) {
    const d = Math.abs(val - t);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

export function CreateTemplateDialog({ open, onClose, onCreated, editTemplate }: CreateTemplateDialogProps) {
  const isEditing = !!editTemplate;
  const [name, setName] = useState('');
  const [margin, setMargin] = useState(10);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [slots, setSlots] = useState<SlotLayout[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState('2x2');

  const marginRef = useRef(margin);
  marginRef.current = margin;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: string | null; idx: number;
    sx: number; sy: number; mx: number; my: number;
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
      setSlots(genSlots('2x2', margin, 3, 3));
    }
    setSelectedIdx(null);
  }, [editTemplate?.id]); // eslint-disable-line

  /* ── 预设/边距/行列变化 → 重新生成网格 ── */
  useEffect(() => {
    setSlots(genSlots(preset, margin, rows, cols));
    setSelectedIdx(null);
  }, [preset, margin, rows, cols]);

  /* ── 画布坐标 ── */
  const getPct = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 };
  }, []);

  /* ── 拖拽 ── */
  const onDragStart = useCallback((e: React.MouseEvent, idx: number, mode: string) => {
    e.stopPropagation();
    if (mode !== 'move') e.preventDefault();
    setSelectedIdx(idx);
    const p = getPct(e.clientX, e.clientY);
    const s = slotsRef.current[idx];
    if (!s) return;
    // 记录鼠标按下位置(mx/my)和槽位起始位置(sx/sy)
    // 拖拽中 slot.pos = 起始 + (鼠标当前 - 鼠标起始)，精确跟随
    dragRef.current = { mode, idx, sx: s.x, sy: s.y, mx: p.x, my: p.y, startX: s.x + s.width, startY: s.y + s.height };
  }, [getPct]);

  useEffect(() => {
    /* 拖拽中：自由移动，无吸附、无边界限制（抬起时才处理） */
    const onMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      const p = getPct(e.clientX, e.clientY);
      const dx = p.x - dr.mx, dy = p.y - dr.my;
      setSlots((prev) => {
        const next = prev.map((s) => ({ ...s }));
        const slot = next[dr.idx];
        if (!slot) return prev;
        if (dr.mode === 'move') {
          slot.x = dr.sx + dx;
          slot.y = dr.sy + dy;
        } else {
          let { x: ox, y: oy, width: ow, height: oh } = prev[dr.idx];
          let nw = ow, nh = oh, nx = ox, ny = oy;
          if (dr.mode?.includes('r')) nw = Math.max(MIN_SLOT, dr.startX - ox + dx);
          if (dr.mode?.includes('l')) { nw = Math.max(MIN_SLOT, ow - dx); nx = ox + (ow - nw); }
          if (dr.mode?.includes('b')) nh = Math.max(MIN_SLOT, dr.startY - oy + dy);
          if (dr.mode?.includes('t')) { nh = Math.max(MIN_SLOT, oh - dy); ny = oy + (oh - nh); }
          slot.x = nx; slot.y = ny;
          slot.width = Math.max(MIN_SLOT, nw);
          slot.height = Math.max(MIN_SLOT, nh);
        }
        return next;
      });
    };

    /* 抬起时：边界约束 + 网格吸附 + 边缘对齐 */
    const onUp = () => {
      const dr = dragRef.current;
      dragRef.current = null;
      if (!dr) return;
      const M = marginRef.current;

      setSlots((prev) => {
        const next = prev.map((s) => ({ ...s }));
        const slot = next[dr.idx];
        if (!slot) return prev;

        let { x, y, width, height } = slot;

        // 1. 边界约束
        x = Math.max(M, Math.min(100 - M - width, x));
        y = Math.max(M, Math.min(100 - M - height, y));
        if (x + width > 100 - M) width = 100 - M - x;
        if (y + height > 100 - M) height = 100 - M - y;
        width = Math.max(MIN_SLOT, width);
        height = Math.max(MIN_SLOT, height);

        // 2. 收集所有可吸附的参考线
        const snapX: number[] = [M, 50, 100 - M];
        const snapY: number[] = [M, 50, 100 - M];
        for (let i = 0; i < prev.length; i++) {
          if (i === dr.idx) continue;
          const o = prev[i];
          snapX.push(o.x, o.x + o.width);
          snapY.push(o.y, o.y + o.height);
        }

        if (snapToGrid) {
          // 网格吸附：四边分别吸附到最近的网格线
          const gridSnap = (v: number) => Math.round(v / GRID) * GRID;
          const left = gridSnap(x);
          const right = gridSnap(x + width);
          width = right - left;
          x = left;

          const top = gridSnap(y);
          const bottom = gridSnap(y + height);
          height = bottom - top;
          y = top;
        }

        // 3. 边缘对齐吸附（仅在启用吸附时）
        if (snapToGrid) {
          const left = smartSnap(x, snapX, SNAP_DIST);
          const right = smartSnap(x + width, snapX, SNAP_DIST);
          const top = smartSnap(y, snapY, SNAP_DIST);
          const bottom = smartSnap(y + height, snapY, SNAP_DIST);

          // 选择偏移更小的方向
          const dxL = Math.abs(left - x), dxR = Math.abs(right - (x + width));
          const dyT = Math.abs(top - y), dyB = Math.abs(bottom - (y + height));

          if (dxL <= dxR) { x = left; width = (x + width) - left; }
          else { width = right - x; }

          if (dyT <= dyB) { y = top; height = (y + height) - top; }
          else { height = bottom - y; }

          width = Math.max(MIN_SLOT, width);
          height = Math.max(MIN_SLOT, height);
        }

        // 4. 最终边界保护
        x = Math.max(M, Math.min(100 - M - width, x));
        y = Math.max(M, Math.min(100 - M - height, y));

        slot.x = x;
        slot.y = y;
        slot.width = width;
        slot.height = height;
        return next;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [getPct, snapToGrid]);

  /* ── 操作 ── */
  const addPhotoSlot = () => setSlots((prev) => [...prev, { id: `slot_${prev.length}`, x: snap(Math.max(marginRef.current, 3)), y: snap(Math.max(marginRef.current, 3)), width: 25, height: 25 }]);
  const addTextZone = () => setSlots((prev) => [...prev, { id: `text_${prev.length}`, x: snap(10), y: snap(80), width: snap(80), height: snap(12) }]);
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
    } finally { setSaving(false); }
  };

  /* ── 布局预设按钮 ── */
  const presets = [
    { id: '2x2', label: '2×2', icon: 'grid', desc: '4等分' },
    { id: '2x3', label: '2×3', icon: 'grid', desc: '6格' },
    { id: '3x3', label: '3×3', icon: 'grid', desc: '9格' },
    { id: '4x4', label: '4×4', icon: 'grid', desc: '16格' },
    { id: '5x5', label: '5×5', icon: 'grid', desc: '25格' },
    { id: 'pin-2', label: '品字2', icon: 'pin', desc: '大+2小' },
    { id: 'pin-3', label: '品字3', icon: 'pin', desc: '左2+右1' },
    { id: 'stagger-4', label: '错落4', icon: 'pin', desc: '大+3小' },
  ];

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? '编辑模板' : '创建模板'} maxWidth="860px">
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
        {/* ── 左栏 ── */}
        <div className="w-[220px] shrink-0 space-y-4">
          {/* 网格预设 */}
          <div>
            <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">快速网格</div>
            <div className="grid grid-cols-3 gap-1">
              {presets.map((p) => (
                <button key={p.id}
                  className={`p-1.5 rounded-[var(--radius-xs)] text-center cursor-pointer border transition-all ${
                    preset === p.id
                      ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)]'
                      : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-300)]'
                  }`}
                  onClick={() => setPreset(p.id)}>
                  <div className="flex justify-center gap-[1px] mx-auto w-6 h-6">
                    {p.icon === 'grid' ? <GridIcon id={p.id} /> : <PinIcon id={p.id} />}
                  </div>
                  <div className="text-[9px] font-[500] text-[var(--color-gray-700)] mt-0.5">{p.label}</div>
                  <div className="text-[7px] text-[var(--color-gray-400)]">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义行列 */}
          <div className="flex items-center gap-2 p-2 bg-[var(--color-gray-50)] rounded-[var(--radius-sm)] border border-[var(--color-border-light)]">
            <span className="text-[9px] text-[var(--color-gray-500)] shrink-0">行</span>
            <input type="number" min={1} max={12} value={rows}
              onChange={(e) => { setRows(Math.max(1, Math.min(12, Number(e.target.value) || 1))); setPreset('custom'); }}
              className="w-11 h-6 px-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] text-center outline-none [appearance:textfield]" />
            <span className="text-[var(--color-gray-300)] text-[10px]">×</span>
            <span className="text-[9px] text-[var(--color-gray-500)] shrink-0">列</span>
            <input type="number" min={1} max={12} value={cols}
              onChange={(e) => { setCols(Math.max(1, Math.min(12, Number(e.target.value) || 1))); setPreset('custom'); }}
              className="w-11 h-6 px-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] text-center outline-none [appearance:textfield]" />
            <span className="text-[9px] text-[var(--color-text-tertiary)] ml-auto">{rows * cols}</span>
          </div>

          {/* 边距 */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] font-[500] text-[var(--color-gray-500)]">边距</span>
              <span className="text-[8px] text-[var(--color-text-tertiary)]">{margin}%</span>
            </div>
            <input type="range" min={2} max={20} value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
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
                +照片
              </button>
              <button onClick={addTextZone}
                className="flex-1 h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-border)] rounded-[var(--radius-xs)] text-[10px] font-[500] text-[var(--color-gray-600)] hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] cursor-pointer transition-all">
                +文字
              </button>
            </div>
            <button onClick={removeSelectedSlot} disabled={selectedIdx === null}
              className="w-full h-7 flex items-center justify-center gap-1 bg-white border border-[var(--color-error)]/30 rounded-[var(--radius-xs)] text-[10px] font-[500] text-[var(--color-error)] hover:bg-[var(--color-error)]/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
              删除选中
            </button>
          </div>

          {/* 提示 */}
          <div className="text-[8px] text-[var(--color-text-tertiary)] leading-relaxed">
            点击网格预设自动生成 ·<br />
            拖拽移动/缩放微调 ·<br />
            吸附件辅助对齐
          </div>
        </div>

        {/* ── 右栏：画布 + 属性 ── */}
        <div className="flex-1 min-w-0">
          <div ref={canvasRef} className="aspect-[4/3] bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] relative overflow-hidden select-none">
            <div className="absolute pointer-events-none z-[2]"
              style={{ left: `${margin}%`, top: `${margin}%`, width: `${100 - margin * 2}%`, height: `${100 - margin * 2}%`, border: '1px dashed var(--color-primary-300)', opacity: 0.4 }} />
            {snapToGrid && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs><pattern id="g" width={GRID} height={GRID} patternUnits="userSpaceOnUse"><path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="var(--color-gray-200)" strokeWidth="0.3" /></pattern></defs>
                <rect width="100" height="100" fill="url(#g)" />
              </svg>
            )}
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
                    outline: sel ? '2px solid var(--color-primary-500)' : 'none', outlineOffset: -1,
                  }}
                  onMouseDown={(e) => onDragStart(e, i, 'move')}>
                  <span className="text-[10px] font-[500] pointer-events-none" style={{ color: isText ? '#a08040' : 'rgba(255,255,255,0.7)' }}>
                    {isText ? '📝' : photoN + 1}
                  </span>
                  {sel && ['tl','tr','bl','br','t','b','l','r'].map((pos) => (
                    <Handle key={pos} pos={pos} onMouseDown={(e) => onDragStart(e, i, `resize-${pos}`)} />
                  ))}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-3 mt-1.5 text-[10px] text-[var(--color-text-tertiary)]">
            <span>📷 {photoCount} 个照片位</span>
            {textCount > 0 && <span>📝 {textCount} 个文字区</span>}
          </div>

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

      <div className="flex justify-between items-center mt-4 pt-3 border-t border-[var(--color-border-light)]">
        <span className="text-[9px] text-[var(--color-text-tertiary)]">{slots.length} 个区域</span>
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
  const p: Record<string, React.CSSProperties> = {
    tl: { top: -4, left: -4, cursor: 'nw-resize' },
    tr: { top: -4, right: -4, cursor: 'ne-resize' },
    bl: { bottom: -4, left: -4, cursor: 'sw-resize' },
    br: { bottom: -4, right: -4, cursor: 'se-resize' },
    t: { top: -4, left: '50%', cursor: 'n-resize', transform: 'translateX(-50%)' },
    b: { bottom: -4, left: '50%', cursor: 's-resize', transform: 'translateX(-50%)' },
    l: { top: '50%', left: -4, cursor: 'w-resize', transform: 'translateY(-50%)' },
    r: { top: '50%', right: -4, cursor: 'e-resize', transform: 'translateY(-50%)' },
  };
  return <div onMouseDown={onMouseDown}
    className="absolute bg-white border border-[var(--color-primary-500)] rounded-full z-20"
    style={{ width: 10, height: 10, ...p[pos], boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />;
}

/* ── 网格图标 ── */
function GridIcon({ id }: { id: string }) {
  const m = { '2x2': [2,2], '2x3': [2,3], '3x3': [3,3], '4x4': [4,4], '5x5': [5,5] }[id] || [2,2];
  const [rows, cols] = m;
  const cw = 20 / cols, ch = 20 / rows;
  return (
    <svg viewBox="0 0 20 20" className="w-6 h-6">
      {Array.from({ length: rows * cols }, (_, i) => (
        <rect key={i} x={i % cols * cw + 0.3} y={Math.floor(i / cols) * ch + 0.3}
          width={cw - 0.6} height={ch - 0.6} rx={1} fill="#6C63FF" opacity={0.7 - i * 0.04} />
      ))}
    </svg>
  );
}

/* ── 特殊布局图标 ── */
function PinIcon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6">
      {id === 'pin-2' ? (
        <><rect x="2" y="2" width="20" height="11" rx="1.5" fill="#6C63FF" opacity="0.8" />
          <rect x="2" y="15" width="9" height="7" rx="1.5" fill="#6C63FF" opacity="0.6" />
          <rect x="13" y="15" width="9" height="7" rx="1.5" fill="#6C63FF" opacity="0.4" /></>
      ) : id === 'pin-3' ? (
        <><rect x="2" y="2" width="10" height="20" rx="1.5" fill="#6C63FF" opacity="0.8" />
          <rect x="14" y="2" width="8" height="9" rx="1.5" fill="#6C63FF" opacity="0.6" />
          <rect x="14" y="13" width="8" height="9" rx="1.5" fill="#6C63FF" opacity="0.4" /></>
      ) : (
        <><rect x="2" y="2" width="13" height="15" rx="1.5" fill="#6C63FF" opacity="0.8" />
          <rect x="17" y="2" width="5" height="7" rx="1.5" fill="#6C63FF" opacity="0.6" />
          <rect x="17" y="11" width="5" height="6" rx="1.5" fill="#6C63FF" opacity="0.4" />
          <rect x="2" y="19" width="20" height="3" rx="1" fill="#6C63FF" opacity="0.3" /></>
      )}
    </svg>
  );
}
