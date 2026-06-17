import { useState, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { SlotLayout } from '../../types';
import { createCustomTemplate } from '../../db';

interface CreateTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
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
  icon: string;       // simplified SVG
  description: string;
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: '2x2', label: '2×2 网格', icon: 'grid-2x2', description: '4张等分' },
  { id: '2x3', label: '2×3 网格', icon: 'grid-2x3', description: '6张等分' },
  { id: '3x3', label: '3×3 网格', icon: 'grid-3x3', description: '9张等分' },
  { id: '4x4', label: '4×4 网格', icon: 'grid-4x4', description: '16张等分' },
  { id: 'pin-2', label: '品字形2图', icon: 'pin-2', description: '大+2小' },
  { id: 'pin-3', label: '品字形3图', icon: 'pin-3', description: '左2+右1' },
  { id: 'stagger-4', label: '错落4图', icon: 'stagger-4', description: '大+3小' },
  { id: 'custom-rc', label: '自定义行列', icon: 'custom-rc', description: '自由设行列' },
];

function generateGridSlots(rows: number, cols: number, margin: number, gap: number): SlotLayout[] {
  const slotW = (100 - 2 * margin - (cols - 1) * gap) / cols;
  const slotH = (100 - 2 * margin - (rows - 1) * gap) / rows;
  const slots: SlotLayout[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        id: `slot_${i}`,
        x: +(margin + c * (slotW + gap)).toFixed(1),
        y: +(margin + r * (slotH + gap)).toFixed(1),
        width: +slotW.toFixed(1),
        height: +slotH.toFixed(1),
      });
      i++;
    }
  }
  return slots;
}

function generatePin2Slots(margin: number, gap: number): SlotLayout[] {
  const wideW = 100 - 2 * margin;
  const wideH = (100 - 2 * margin - gap) * 0.55;
  const smH = (100 - 2 * margin - gap) * 0.45;
  const smW = (wideW - gap) / 2;
  return [
    { id: 'slot_0', x: margin, y: margin, width: +wideW.toFixed(1), height: +wideH.toFixed(1) },
    { id: 'slot_1', x: margin, y: +(margin + wideH + gap).toFixed(1), width: +smW.toFixed(1), height: +smH.toFixed(1) },
    { id: 'slot_2', x: +(margin + smW + gap).toFixed(1), y: +(margin + wideH + gap).toFixed(1), width: +smW.toFixed(1), height: +smH.toFixed(1) },
  ];
}

function generatePin3Slots(margin: number, gap: number): SlotLayout[] {
  const leftW = (100 - 2 * margin - gap) * 0.55;
  const rightW = (100 - 2 * margin - gap) * 0.45;
  const halfH = (100 - 2 * margin - gap) / 2;
  return [
    { id: 'slot_0', x: margin, y: margin, width: +leftW.toFixed(1), height: +(100 - 2 * margin).toFixed(1) },
    { id: 'slot_1', x: +(margin + leftW + gap).toFixed(1), y: margin, width: +rightW.toFixed(1), height: +halfH.toFixed(1) },
    { id: 'slot_2', x: +(margin + leftW + gap).toFixed(1), y: +(margin + halfH + gap).toFixed(1), width: +rightW.toFixed(1), height: +halfH.toFixed(1) },
  ];
}

function generateStagger4Slots(margin: number, gap: number): SlotLayout[] {
  const bigW = (100 - 2 * margin - gap) * 0.55;
  const smW = (100 - 2 * margin - gap) * 0.45;
  const smRowH = (100 - 2 * margin - gap * 2) / 3;
  const bigH = smRowH * 2 + gap;
  return [
    { id: 'slot_0', x: margin, y: margin, width: +bigW.toFixed(1), height: +bigH.toFixed(1) },
    { id: 'slot_1', x: +(margin + bigW + gap).toFixed(1), y: margin, width: +smW.toFixed(1), height: +smRowH.toFixed(1) },
    { id: 'slot_2', x: +(margin + bigW + gap).toFixed(1), y: +(margin + smRowH + gap).toFixed(1), width: +smW.toFixed(1), height: +smRowH.toFixed(1) },
    { id: 'slot_3', x: margin, y: +(margin + bigH + gap).toFixed(1), width: +(bigW + gap + smW).toFixed(1), height: +smRowH.toFixed(1) },
  ];
}

export function CreateTemplateDialog({ open, onClose, onCreated }: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<LayoutPresetId>('2x2');
  const [margin, setMargin] = useState(10);
  const [gap, setGap] = useState(4);
  const [customRows, setCustomRows] = useState(3);
  const [customCols, setCustomCols] = useState(3);
  const [saving, setSaving] = useState(false);

  const isCustomRC = selectedPreset === 'custom-rc';

  // Generate slots based on selected preset
  const slots = useMemo(() => {
    switch (selectedPreset) {
      case '2x2': return generateGridSlots(2, 2, margin, gap);
      case '2x3': return generateGridSlots(2, 3, margin, gap);
      case '3x3': return generateGridSlots(3, 3, margin, gap);
      case '4x4': return generateGridSlots(4, 4, margin, gap);
      case 'pin-2': return generatePin2Slots(margin, gap);
      case 'pin-3': return generatePin3Slots(margin, gap);
      case 'stagger-4': return generateStagger4Slots(margin, gap);
      case 'custom-rc': return generateGridSlots(Math.max(1, customRows), Math.max(1, customCols), margin, gap);
      default: return [];
    }
  }, [selectedPreset, margin, gap, customRows, customCols]);

  const handleSave = async () => {
    if (slots.length === 0) return;
    setSaving(true);
    try {
      await createCustomTemplate(name || '未命名模板', slots);
      onCreated();
      onClose();
      setName('');
      setSelectedPreset('2x2');
      setMargin(10);
      setGap(4);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="创建模板" maxWidth="740px">
      <div className="flex gap-6">
        {/* Left: layout selection */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Layout grid */}
          <div>
            <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2">
              选择布局
            </label>
            <div className="grid grid-cols-4 gap-2">
              {LAYOUT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`
                    p-2 rounded-[var(--radius-md)] text-center cursor-pointer border
                    transition-all duration-150
                    ${selectedPreset === p.id
                      ? 'border-[var(--color-primary-600)] border-2 bg-[var(--color-surface-selected)]'
                      : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-400)]'
                    }
                  `}
                  onClick={() => setSelectedPreset(p.id)}
                >
                  {/* Mini layout icon */}
                  <LayoutIcon layoutId={p.id} />
                  <div className="text-[var(--text-nano)] font-[500] text-[var(--color-gray-800)] mt-1 leading-tight">
                    {p.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom rows/cols */}
          {isCustomRC && (
            <div className="flex items-center gap-3 p-3 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)]">
              <label className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] shrink-0">
                行数
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={customRows}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                  setCustomRows(v);
                }}
                className="w-16 h-8 px-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                           text-[var(--text-caption)] text-[var(--color-gray-800)] text-center
                           outline-none [appearance:textfield]
                           [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[var(--color-gray-300)]">×</span>
              <label className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] shrink-0">
                列数
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={customCols}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                  setCustomCols(v);
                }}
                className="w-16 h-8 px-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                           text-[var(--text-caption)] text-[var(--color-gray-800)] text-center
                           outline-none [appearance:textfield]
                           [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] ml-auto">
                {customRows * customCols} 个槽位
              </span>
            </div>
          )}

          {/* Margin slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)]">
                边距
              </label>
              <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)]">{margin}%</span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)] [&::-webkit-slider-thumb]:cursor-pointer
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
            />
          </div>

          {/* Gap slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)]">
                间距
              </label>
              <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)]">{gap}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-[var(--color-gray-200)] cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-primary-600)]
                         [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)] [&::-webkit-slider-thumb]:cursor-pointer
                         [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
            />
          </div>
        </div>

        {/* Right: preview */}
        <div className="w-[220px] shrink-0">
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2">
            预览
          </label>
          <div className="aspect-[4/3] bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <div className="w-full h-full relative">
              {slots.map((slot, i) => (
                <div
                  key={slot.id}
                  className="absolute rounded-[var(--radius-sm)] border border-white/40 flex items-center justify-center"
                  style={{
                    left: `${slot.x}%`,
                    top: `${slot.y}%`,
                    width: `${slot.width}%`,
                    height: `${slot.height}%`,
                    backgroundColor: `hsl(250, ${50 + (i * 5) % 30}%, ${65 + (i * 3) % 20}%)`,
                  }}
                >
                  <span className="text-[var(--text-nano)] text-white/60 font-[500] select-none">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Slot count */}
          <div className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] mt-2 text-center">
            {slots.length} 个照片位
          </div>

          {/* Template name */}
          <div className="mt-4">
            <label className="block text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-1">
              模板名称
            </label>
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
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--color-border-light)]">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || slots.length === 0}>
          {saving ? '保存中…' : '保存模板'}
        </Button>
      </div>
    </Modal>
  );
}

/* ── Mini layout icon for preset buttons ── */
function LayoutIcon({ layoutId }: { layoutId: LayoutPresetId }) {
  const cellColor = '#6C63FF';

  const iconMap: Record<string, React.ReactNode> = {
    '2x2': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        <rect x="3" y="3" width="14" height="14" rx="2" fill={cellColor} opacity="0.8" />
        <rect x="19" y="3" width="14" height="14" rx="2" fill={cellColor} opacity="0.6" />
        <rect x="3" y="19" width="14" height="14" rx="2" fill={cellColor} opacity="0.6" />
        <rect x="19" y="19" width="14" height="14" rx="2" fill={cellColor} opacity="0.4" />
      </svg>
    ),
    '2x3': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        {[0,1,2].map(r => [0,1].map(c => (
          <rect key={`${r}${c}`} x={3 + c*17} y={3 + r*11} width="14" height="9" rx="1.5"
                fill={cellColor} opacity={1 - (r*2 + c)*0.15} />
        )))}
      </svg>
    ),
    '3x3': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        {[0,1,2].map(r => [0,1,2].map(c => (
          <rect key={`${r}${c}`} x={2 + c*11} y={2 + r*11} width="9" height="9" rx="1.5"
                fill={cellColor} opacity={1 - (r*3 + c)*0.1} />
        )))}
      </svg>
    ),
    '4x4': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        {[0,1,2,3].map(r => [0,1,2,3].map(c => (
          <rect key={`${r}${c}`} x={2 + c*8.5} y={2 + r*8.5} width="7" height="7" rx="1"
                fill={cellColor} opacity={1 - (r*4 + c)*0.08} />
        )))}
      </svg>
    ),
    'pin-2': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        <rect x="3" y="3" width="30" height="18" rx="2" fill={cellColor} opacity="0.8" />
        <rect x="3" y="23" width="14" height="10" rx="2" fill={cellColor} opacity="0.6" />
        <rect x="19" y="23" width="14" height="10" rx="2" fill={cellColor} opacity="0.4" />
      </svg>
    ),
    'pin-3': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        <rect x="3" y="3" width="16" height="30" rx="2" fill={cellColor} opacity="0.8" />
        <rect x="21" y="3" width="12" height="14" rx="2" fill={cellColor} opacity="0.6" />
        <rect x="21" y="19" width="12" height="14" rx="2" fill={cellColor} opacity="0.4" />
      </svg>
    ),
    'stagger-4': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        <rect x="3" y="3" width="20" height="24" rx="2" fill={cellColor} opacity="0.8" />
        <rect x="25" y="3" width="8" height="10" rx="2" fill={cellColor} opacity="0.6" />
        <rect x="25" y="15" width="8" height="10" rx="2" fill={cellColor} opacity="0.4" />
        <rect x="3" y="29" width="30" height="4" rx="1.5" fill={cellColor} opacity="0.3" />
      </svg>
    ),
    'custom-rc': (
      <svg viewBox="0 0 36 36" className="w-8 h-8 mx-auto">
        <rect x="3" y="3" width="30" height="30" rx="2" fill="none" stroke={cellColor} strokeWidth="1.5" strokeDasharray="3 2" />
        <text x="18" y="21" textAnchor="middle" fill={cellColor} fontSize="8" fontWeight="bold">R×C</text>
      </svg>
    ),
  };

  return <>{iconMap[layoutId] || iconMap['2x2']}</>;
}
