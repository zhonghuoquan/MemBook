import { useCallback, useMemo } from 'react';
import type { EditTab } from '../../types';
import type { PhotoAdjustments } from '../../types';
import { useUIStore, useEditorStore } from '../../store';

const DEFAULT_ADJ: PhotoAdjustments = { brightness: 0, contrast: 0, saturation: 0 };

const editTabs: { tab: EditTab; label: string }[] = [
  { tab: 'crop', label: '裁剪' },
  { tab: 'adjust', label: '调整' },
  { tab: 'filter', label: '滤镜' },
  { tab: 'rotate', label: '旋转' },
];

export function EditFlyout() {
  const open = useUIStore((s) => s.editFlyoutOpen);
  const activeTab = useUIStore((s) => s.editFlyoutTab);
  const setEditFlyoutTab = useUIStore((s) => s.setEditFlyoutTab);
  const setEditFlyoutOpen = useUIStore((s) => s.setEditFlyoutOpen);
  const addToast = useUIStore((s) => s.addToast);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const pages = useEditorStore((s) => s.pages);
  const resetPlacementEdits = useEditorStore((s) => s.resetPlacementEdits);

  const placement = useMemo(() => {
    const page = pages[currentPageIndex];
    if (!page || !selectedSlotId) return null;
    return page.placements.find((p) => p.slotId === selectedSlotId) || null;
  }, [pages, currentPageIndex, selectedSlotId]);

  const handleApply = useCallback(() => {
    setEditFlyoutOpen(false);
    addToast({ type: 'success', message: '编辑已应用' });
  }, [setEditFlyoutOpen, addToast]);

  const handleReset = useCallback(() => {
    if (selectedSlotId) {
      resetPlacementEdits(currentPageIndex, selectedSlotId);
      addToast({ type: 'info', message: '已重置编辑' });
    }
  }, [currentPageIndex, selectedSlotId, resetPlacementEdits, addToast]);

  if (!open) return null;

  return (
    <div
      className="absolute left-0 top-0 bottom-0
                 w-[var(--layout-edit-flyout-width)]
                 bg-white border-r border-[var(--color-border)]
                 shadow-[var(--shadow-md)]
                 z-[var(--z-raised)]
                 flex flex-col
                 animate-[slideIn_0.2s_ease-out]"
    >
      {/* Title */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">照片编辑</span>
        <button
          className="w-7 h-7 flex items-center justify-center border-none rounded-[var(--radius-xs)]
                     bg-transparent text-[var(--color-gray-500)] cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => setEditFlyoutOpen(false)}
          title="关闭"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-[var(--color-border-light)]">
        {editTabs.map((item) => (
          <button
            key={item.tab}
            className={`
              flex-1 py-2 text-[var(--text-body-sm)] font-[500]
              border-none bg-transparent cursor-pointer
              transition-colors duration-150
              ${activeTab === item.tab
                ? 'text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]'
                : 'text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
              }
            `}
            onClick={() => setEditFlyoutTab(item.tab)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedSlotId || !placement ? (
          <div className="text-center py-8 text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
            请先在画布上选择一张照片
          </div>
        ) : (
          <>
            {activeTab === 'crop' && <CropTab />}
            {activeTab === 'adjust' && <AdjustTab placement={placement} />}
            {activeTab === 'filter' && <FilterTab placement={placement} />}
            {activeTab === 'rotate' && <RotateTab placement={placement} />}
          </>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-border-light)]">
        <button
          className="px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)]
                     text-[var(--text-caption)] text-[var(--color-gray-500)] bg-transparent cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={handleReset}
        >
          重置
        </button>
        <div className="flex gap-2">
          <button
            className="px-4 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-transparent cursor-pointer
                       hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={() => setEditFlyoutOpen(false)}
          >
            取消
          </button>
          <button
            className="px-4 py-1.5 border-none rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] font-[500] text-white bg-[var(--color-primary-600)] cursor-pointer
                       hover:bg-[var(--color-primary-700)] transition-colors"
            onClick={handleApply}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   子组件：各编辑 Tab
   ═══════════════════════════════════════ */

function CropTab() {
  const addToast = useUIStore((s) => s.addToast);
  return (
    <div className="space-y-4">
      <div className="aspect-square bg-[var(--color-gray-100)] rounded-[var(--radius-md)]
                      flex items-center justify-center text-[var(--color-gray-400)] text-[var(--text-caption)]">
        裁剪预览区域
      </div>
      <p className="text-[var(--text-caption)] text-[var(--color-gray-500)] leading-relaxed">
        双击照片可在画布上手动调整裁剪区域。点击智能裁剪自动检测主体居中。
      </p>
      <button
        className="w-full py-2 border border-[var(--color-border)] rounded-[var(--radius-md)]
                   text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white cursor-pointer
                   hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => addToast({ type: 'info', message: '智能裁剪即将上线' })}
      >
        智能裁剪
      </button>
    </div>
  );
}

/* ── 调整（亮度/对比度/饱和度） ── */

function AdjustTab({ placement }: { placement: { adjustments?: PhotoAdjustments } }) {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const updatePlacementAdjustments = useEditorStore((s) => s.updatePlacementAdjustments);

  const adj = placement.adjustments || DEFAULT_ADJ;

  const handleChange = useCallback((key: keyof PhotoAdjustments, value: number) => {
    if (!selectedSlotId) return;
    updatePlacementAdjustments(currentPageIndex, selectedSlotId, {
      ...adj,
      [key]: value,
    });
  }, [currentPageIndex, selectedSlotId, updatePlacementAdjustments, adj]);

  const sliders: { key: keyof PhotoAdjustments; label: string }[] = [
    { key: 'brightness', label: '亮度' },
    { key: 'contrast', label: '对比度' },
    { key: 'saturation', label: '饱和度' },
  ];

  return (
    <div className="space-y-5">
      {sliders.map((s) => (
        <div key={s.key}>
          <div className="flex justify-between mb-1">
            <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">{s.label}</span>
            <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{adj[s.key] > 0 ? '+' : ''}{adj[s.key]}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={adj[s.key]}
            onChange={(e) => handleChange(s.key, parseInt(e.target.value))}
            className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                       [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      ))}
    </div>
  );
}

/* ── 滤镜 ── */

const FILTERS: { name: string; css: string; previewColor: string }[] = [
  { name: '原图', css: 'none', previewColor: '#F2EFED' },
  { name: '暖阳', css: 'sepia(0.3) saturate(1.2) brightness(1.05)', previewColor: '#FEE2C5' },
  { name: '清新', css: 'saturate(1.1) brightness(1.08) contrast(0.95)', previewColor: '#D1FAE5' },
  { name: '复古', css: 'sepia(0.4) saturate(1.1) brightness(0.95)', previewColor: '#FDEBD0' },
  { name: '黑白', css: 'grayscale(1) brightness(1.05)', previewColor: '#D1D5DB' },
  { name: '胶片', css: 'sepia(0.2) contrast(1.1) brightness(0.9)', previewColor: '#E5E0D8' },
  { name: '日系', css: 'saturate(0.85) brightness(1.12) hue-rotate(-10deg)', previewColor: '#E0F2FE' },
  { name: '电影', css: 'contrast(1.2) brightness(0.85) saturate(1.3)', previewColor: '#1F2937' },
];

function FilterTab({ placement }: { placement: { filter?: string | null } }) {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const updatePlacementFilter = useEditorStore((s) => s.updatePlacementFilter);

  const activeFilter = placement.filter || null;

  const handleSelect = useCallback((name: string | null) => {
    if (!selectedSlotId) return;
    updatePlacementFilter(currentPageIndex, selectedSlotId, name);
  }, [currentPageIndex, selectedSlotId, updatePlacementFilter]);

  return (
    <div className="grid grid-cols-4 gap-2">
      {FILTERS.map((f) => {
        const isActive = activeFilter === (f.name === '原图' ? null : f.name);
        return (
          <div
            key={f.name}
            className={`flex flex-col items-center gap-1 cursor-pointer group p-1 rounded-[var(--radius-sm)] transition-colors
                        ${isActive ? 'bg-[var(--color-primary-50)] ring-1 ring-[var(--color-primary-400)]' : 'hover:bg-[var(--color-gray-50)]'}`}
            onClick={() => handleSelect(f.name === '原图' ? null : f.name)}
          >
            <div
              className="w-14 h-14 rounded-[var(--radius-lg)] border border-[var(--color-border)] flex items-center justify-center"
              style={{ backgroundColor: f.previewColor }}
            >
              {/* Icon hint */}
              {f.name === '原图' && (
                <svg viewBox="0 0 16 16" fill="none" stroke="#999" strokeWidth="1.2" className="w-4 h-4 opacity-50">
                  <rect x="2" y="2" width="12" height="12" rx="2" /><circle cx="8" cy="8" r="2" />
                </svg>
              )}
            </div>
            <span className={`text-[var(--text-nano)] ${isActive ? 'text-[var(--color-brand)] font-[500]' : 'text-[var(--color-gray-500)] group-hover:text-[var(--color-gray-700)]'}`}>
              {f.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 旋转 ── */

function RotateTab({ placement }: { placement: { rotation?: number } }) {
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const updatePlacementRotation = useEditorStore((s) => s.updatePlacementRotation);
  const addToast = useUIStore((s) => s.addToast);

  const rotation = placement.rotation || 0;

  const handleChange = useCallback((value: number) => {
    if (!selectedSlotId) return;
    updatePlacementRotation(currentPageIndex, selectedSlotId, value);
  }, [currentPageIndex, selectedSlotId, updatePlacementRotation]);

  const handleQuickRotate = useCallback((deg: number) => {
    if (!selectedSlotId) return;
    const newRotation = ((rotation + deg) % 360 + 360) % 360;
    updatePlacementRotation(currentPageIndex, selectedSlotId, newRotation);
  }, [currentPageIndex, selectedSlotId, updatePlacementRotation, rotation]);

  return (
    <div className="space-y-5">
      {/* Quick rotate buttons */}
      <div className="flex gap-2">
        <button
          className="flex-1 py-2 flex items-center justify-center gap-1 border border-[var(--color-border)] rounded-[var(--radius-md)]
                     text-[var(--text-caption)] text-[var(--color-gray-600)] bg-white cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => handleQuickRotate(-90)}
          title="左转90°"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 7a5 5 0 1 1 4.6 5" /><path d="M4 9L1 7l2-3" />
          </svg>
          左转
        </button>
        <button
          className="flex-1 py-2 flex items-center justify-center gap-1 border border-[var(--color-border)] rounded-[var(--radius-md)]
                     text-[var(--text-caption)] text-[var(--color-gray-600)] bg-white cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => handleQuickRotate(90)}
          title="右转90°"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M11 7a5 5 0 1 0-4.6 5" /><path d="M10 9l3-2-2-3" />
          </svg>
          右转
        </button>
        <button
          className="flex-1 py-2 flex items-center justify-center border border-[var(--color-border)] rounded-[var(--radius-md)]
                     text-[var(--text-caption)] text-[var(--color-gray-600)] bg-white cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => handleQuickRotate(180)}
          title="翻转"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M2 7h10M7 2v10" />
          </svg>
        </button>
      </div>

      {/* Fine rotation slider */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">微调</span>
          <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{rotation}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          value={rotation}
          onChange={(e) => handleChange(parseInt(e.target.value))}
          className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                     [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>
      <button
        className="w-full py-2 border border-[var(--color-border)] rounded-[var(--radius-md)]
                   text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white cursor-pointer
                   hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => addToast({ type: 'info', message: '自动拉直即将上线' })}
      >
        自动拉直
      </button>
    </div>
  );
}
