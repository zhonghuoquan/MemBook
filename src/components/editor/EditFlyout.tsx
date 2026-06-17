import { useCallback } from 'react';
import type { EditTab } from '../../types';
import { useUIStore, useEditorStore } from '../../store';

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
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);

  const handleApply = useCallback(() => {
    setEditFlyoutOpen(false);
    addToast({ type: 'success', message: '编辑已应用' });
  }, [setEditFlyoutOpen, addToast]);

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
        {!selectedSlotId ? (
          <div className="text-center py-8 text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
            请先在画布上选择一张照片
          </div>
        ) : (
          <>
            {activeTab === 'crop' && <CropTab />}
            {activeTab === 'adjust' && <AdjustTab />}
            {activeTab === 'filter' && <FilterTab />}
            {activeTab === 'rotate' && <RotateTab />}
          </>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-light)]">
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
  );
}

function CropTab() {
  return (
    <div className="space-y-4">
      <div className="aspect-square bg-[var(--color-gray-100)] rounded-[var(--radius-md)] flex items-center justify-center text-[var(--color-gray-400)] text-[var(--text-caption)]">
        裁剪预览区域
      </div>
      <button className="w-full py-2 border border-[var(--color-border)] rounded-[var(--radius-md)]
                         text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white cursor-pointer
                         hover:bg-[var(--color-surface-hover)] transition-colors">
        智能裁剪
      </button>
    </div>
  );
}

function AdjustTab() {
  const sliders = [
    { label: '亮度', min: -100, max: 100, value: 0 },
    { label: '对比度', min: -100, max: 100, value: 0 },
    { label: '饱和度', min: -100, max: 100, value: 0 },
  ];
  return (
    <div className="space-y-5">
      {sliders.map((s) => (
        <div key={s.label}>
          <div className="flex justify-between mb-1">
            <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">{s.label}</span>
            <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{s.value}</span>
          </div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            defaultValue={s.value}
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

function FilterTab() {
  const filters = [
    { name: '原图', color: '#F2EFED' },
    { name: '暖阳', color: '#FEE2C5' },
    { name: '清新', color: '#D1FAE5' },
    { name: '复古', color: '#FDEBD0' },
    { name: '黑白', color: '#D1D5DB' },
    { name: '胶片', color: '#E5E0D8' },
    { name: '日系', color: '#E0F2FE' },
    { name: '电影', color: '#1F2937' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {filters.map((f) => (
        <div key={f.name} className="flex flex-col items-center gap-1 cursor-pointer group">
          <div
            className="w-14 h-14 rounded-[var(--radius-lg)] border border-[var(--color-border)]"
            style={{ backgroundColor: f.color }}
          />
          <span className="text-[var(--text-nano)] text-[var(--color-gray-500)] group-hover:text-[var(--color-gray-700)]">{f.name}</span>
        </div>
      ))}
    </div>
  );
}

function RotateTab() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[var(--text-caption)] text-[var(--color-gray-600)]">旋转角度</span>
          <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">0°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          defaultValue={0}
          className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                     [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>
      <button className="w-full py-2 border border-[var(--color-border)] rounded-[var(--radius-md)]
                         text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white cursor-pointer
                         hover:bg-[var(--color-surface-hover)] transition-colors">
        自动拉直
      </button>
    </div>
  );
}
