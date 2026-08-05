import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditTab, PhotoAdjustments } from '../../types';
import { resolveTemplate } from '../../types';
import { useUIStore, useEditorStore, usePhotoStore } from '../../store';
import { slotEditService } from '../../services/slotEditService';
import { calcCoverFitWithRotation, clampPhotoToSlotBounds } from '../../utils/photoGeometry';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';

const DEFAULT_ADJ: PhotoAdjustments = {
  exposure: 0, brightness: 0, contrast: 0,
  saturation: 0, temperature: 0, vignette: 0,
};

// ═══ 调整参数定义 ═══

type AdjustGroup = {
  key: string;
  labelKey: string;
  params: { key: keyof PhotoAdjustments; labelKey: string; min: number; max: number }[];
};

const ADJUST_GROUPS: AdjustGroup[] = [
  {
    key: 'light', labelKey: 'editor.editFlyout.groupLight',
    params: [
      { key: 'exposure', labelKey: 'editor.editFlyout.exposure', min: -100, max: 100 },
      { key: 'brightness', labelKey: 'editor.editFlyout.brightness', min: -100, max: 100 },
      { key: 'contrast', labelKey: 'editor.editFlyout.contrast', min: -100, max: 100 },
    ],
  },
  {
    key: 'color', labelKey: 'editor.editFlyout.groupColor',
    params: [
      { key: 'saturation', labelKey: 'editor.editFlyout.saturation', min: -100, max: 100 },
      { key: 'temperature', labelKey: 'editor.editFlyout.temperature', min: -100, max: 100 },
    ],
  },
  {
    key: 'effect', labelKey: 'editor.editFlyout.groupEffect',
    params: [
      { key: 'vignette', labelKey: 'editor.editFlyout.vignette', min: 0, max: 100 },
    ],
  },
];

// ═══ 滤镜定义 ═══

const FILTERS: { name: string; nameKey: string; css: string; previewColor: string }[] = [
  { name: '原图', nameKey: 'editor.editFlyout.filterOriginal', css: 'none', previewColor: '#F2EFED' },
  { name: '暖阳', nameKey: 'editor.editFlyout.filterWarm', css: 'sepia(0.3) saturate(1.2) brightness(1.05)', previewColor: '#FEE2C5' },
  { name: '清新', nameKey: 'editor.editFlyout.filterFresh', css: 'saturate(1.1) brightness(1.08) contrast(0.95)', previewColor: '#D1FAE5' },
  { name: '复古', nameKey: 'editor.editFlyout.filterVintage', css: 'sepia(0.4) saturate(1.1) brightness(0.95)', previewColor: '#FDEBD0' },
  { name: '黑白', nameKey: 'editor.editFlyout.filterBW', css: 'grayscale(1) brightness(1.05)', previewColor: '#D1D5DB' },
  { name: '胶片', nameKey: 'editor.editFlyout.filterFilm', css: 'sepia(0.2) contrast(1.1) brightness(0.9)', previewColor: '#E5E0D8' },
  { name: '日系', nameKey: 'editor.editFlyout.filterJapanese', css: 'saturate(0.85) brightness(1.12) hue-rotate(-10deg)', previewColor: '#E0F2FE' },
  { name: '电影', nameKey: 'editor.editFlyout.filterCinema', css: 'contrast(1.2) brightness(0.85) saturate(1.3)', previewColor: '#1F2937' },
];

const editTabs: { tab: EditTab; labelKey: string }[] = [
  { tab: 'adjust', labelKey: 'editor.editFlyout.tabAdjust' },
  { tab: 'filter', labelKey: 'editor.editFlyout.tabFilter' },
  { tab: 'rotate', labelKey: 'editor.editFlyout.tabRotate' },
];

// ═══════════════════════════════════════
//  主组件
// ═══════════════════════════════════════

export function EditFlyout() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.editFlyoutOpen);
  const activeTab = useUIStore((s) => s.editFlyoutTab);
  const setEditFlyoutTab = useUIStore((s) => s.setEditFlyoutTab);
  const setEditFlyoutOpen = useUIStore((s) => s.setEditFlyoutOpen);
  const collapsed = useUIStore((s) => s.editFlyoutCollapsed);
  const setCollapsed = useUIStore((s) => s.setEditFlyoutCollapsed);
  const addToast = useUIStore((s) => s.addToast);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const isEditing = !!(open && selectedSlotId);
  const sb = useScrollbarVisibility<HTMLDivElement>();
  const pages = useEditorStore((s) => s.pages);
  const resetPlacementEdits = useEditorStore((s) => s.resetPlacementEdits);

  const placement = useMemo(() => {
    const page = pages[currentPageIndex];
    if (!page || !selectedSlotId) return null;
    return page.placements.find((p) => p.slotId === selectedSlotId) || null;
  }, [pages, currentPageIndex, selectedSlotId]);

  const handleApply = useCallback(() => {
    setEditFlyoutOpen(false);
    addToast({ type: 'success', message: t('editor.editFlyout.editApplied') });
  }, [setEditFlyoutOpen, addToast, t]);

  const handleReset = useCallback(() => {
    if (selectedSlotId) {
      resetPlacementEdits(currentPageIndex, selectedSlotId);
      addToast({ type: 'info', message: t('editor.editFlyout.allReset') });
    }
  }, [currentPageIndex, selectedSlotId, resetPlacementEdits, addToast, t]);

  if (!open) return null;

  // 折叠状态
  if (collapsed) {
    return (
      <div
        className={`absolute right-0 top-0 bottom-0
                   w-[34px] bg-white/98 backdrop-blur-sm
                   border-l border-[var(--color-border)]
                   shadow-lg ${isEditing ? 'z-[var(--z-modal)]' : 'z-[var(--z-raised)]'}
                   flex flex-col items-center py-4`}
      >
        <button
          className="absolute -left-[14px] top-1/2 -translate-y-1/2
                     w-[16px] h-14 flex items-center justify-center
                     rounded-l-full border border-[var(--color-border)] border-r-0
                     bg-white text-[var(--color-gray-400)]
                     cursor-pointer shadow-sm
                     hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors"
          onClick={() => setCollapsed(false)}
          title={t('editor.editFlyout.expandHint')}
        >
          <svg viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-4">
            <polyline points="2,3 6,7 2,11" />
          </svg>
        </button>
        <span className="mt-auto mb-auto text-[9px] text-[var(--color-gray-400)] font-[600] tracking-widest select-none"
          style={{ writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>
          {t('editor.editFlyout.title')}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`absolute right-0 top-0 bottom-0
                 w-[var(--layout-edit-flyout-width)]
                 bg-white/98 backdrop-blur-sm
                 border-l border-[var(--color-border)]
                 shadow-xl ${isEditing ? 'z-[var(--z-modal)]' : 'z-[var(--z-raised)]'}
                 flex flex-col
                 animate-[slideInRight_0.2s_ease-out]`}
    >
      {/* 左侧收起按钮 */}
      <button
        className="absolute -left-[14px] top-1/2 -translate-y-1/2
                   w-[16px] h-14 flex items-center justify-center
                   rounded-l-full border border-[var(--color-border)] border-r-0
                   bg-white text-[var(--color-gray-400)]
                   cursor-pointer shadow-sm
                   hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors"
        onClick={() => setCollapsed(true)}
        title={t('editor.editFlyout.collapseHint')}
      >
        <svg viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-4">
          <polyline points="6,3 2,7 6,11" />
        </svg>
      </button>

      {/* Title */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[600] text-[var(--color-gray-700)] tracking-tight">{t('editor.editFlyout.title')}</span>
        <button
          className="w-7 h-7 flex items-center justify-center border-none rounded-md
                     bg-transparent text-[var(--color-gray-400)] cursor-pointer
                     hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)] transition-colors"
          onClick={() => setEditFlyoutOpen(false)}
          title={t('editor.editFlyout.close')}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" />
          </svg>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex px-1 gap-0.5 py-1.5 border-b border-[var(--color-border-light)]">
        {editTabs.map((item) => (
          <button
            key={item.tab}
            className={`
              flex-1 py-1.5 text-[11px] font-[500] rounded-md
              border-none cursor-pointer transition-all duration-150
              ${activeTab === item.tab
                ? 'bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
              }
            `}
            onClick={() => setEditFlyoutTab(item.tab)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-4 pr-1 py-4 ${sb.className}`} {...sb.handlers}>
        {!selectedSlotId || !placement ? (
          <div className="text-center py-8 text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
            {t('editor.editFlyout.selectPhotoFirst')}
          </div>
        ) : (
          <>
            {activeTab === 'adjust' && <AdjustTab placement={placement} />}
            {activeTab === 'filter' && <FilterTab placement={placement} />}
            {activeTab === 'rotate' && <RotateTab placement={placement} />}
          </>
        )}
      </div>

      {/* Shortcut Tips */}
      <div className="px-4 py-2 text-[10px] text-[var(--color-gray-400)] border-t border-[var(--color-border-light)]">
        {t('editor.editFlyout.shortcutHint')}
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-border-light)]">
        <button
          className="px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)]
                     text-[var(--text-caption)] text-[var(--color-gray-500)] bg-transparent cursor-pointer
                     hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={handleReset}
        >
          {t('editor.editFlyout.reset')}
        </button>
        <div className="flex gap-2">
          <button
            className="px-4 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-transparent cursor-pointer
                       hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={() => setEditFlyoutOpen(false)}
          >
            {t('editor.editFlyout.cancel')}
          </button>
          <button
            className="px-4 py-1.5 border-none rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] font-[500] text-white bg-[var(--color-primary-600)] cursor-pointer
                       hover:bg-[var(--color-primary-700)] transition-colors"
            onClick={handleApply}
          >
            {t('editor.editFlyout.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   调整 Tab
   ═══════════════════════════════════════ */

function AdjustTab({ placement }: { placement: { adjustments?: PhotoAdjustments } }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const updatePlacementAdjustments = useEditorStore((s) => s.updatePlacementAdjustments);
  const setIsComparingOriginal = useUIStore((s) => s.setIsComparingOriginal);

  const adj = placement.adjustments || DEFAULT_ADJ;

  // 折叠状态（默认全展开）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleChange = useCallback((key: keyof PhotoAdjustments, value: number) => {
    if (!selectedSlotId) return;
    updatePlacementAdjustments(currentPageIndex, selectedSlotId, {
      ...adj,
      [key]: value,
    });
  }, [currentPageIndex, selectedSlotId, updatePlacementAdjustments, adj]);

  // 自动增强
  const handleAutoEnhance = useCallback(() => {
    if (!selectedSlotId) return;
    // 简洁版自动增强：小幅提亮 + 提对比 + 提饱和
    const enhanced: PhotoAdjustments = {
      ...DEFAULT_ADJ,
      brightness: 8,
      contrast: 12,
      saturation: 10,
    };
    updatePlacementAdjustments(currentPageIndex, selectedSlotId, enhanced);
  }, [currentPageIndex, selectedSlotId, updatePlacementAdjustments]);

  // 判断某个参数是否被改动（非默认值）
  const isEdited = useCallback((key: keyof PhotoAdjustments) => {
    return adj[key] !== DEFAULT_ADJ[key];
  }, [adj]);

  // 判断某个组内是否有参数被改动
  const groupHasEdit = useCallback((group: AdjustGroup) => {
    return group.params.some((p) => adj[p.key] !== DEFAULT_ADJ[p.key]);
  }, [adj]);

  return (
    <div className="space-y-3">
      {/* 自动增强 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)]
                   border border-[var(--color-primary-100)] bg-[var(--color-primary-50)]
                   hover:bg-[var(--color-primary-100)] transition-colors cursor-pointer
                   text-left group"
        onClick={handleAutoEnhance}
      >
        <span className="text-base">✨</span>
        <div className="flex-1 min-w-0">
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-primary-700)]">{t('editor.editFlyout.autoEnhance')}</div>
          <div className="text-[10px] text-[var(--color-primary-400)]">{t('editor.editFlyout.autoEnhanceDesc')}</div>
        </div>
      </button>

      {/* 原图对比 */}
      <button
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)]
                   border border-[var(--color-border)] bg-white
                   hover:bg-[var(--color-gray-50)] transition-colors cursor-pointer
                   text-[var(--text-caption)] text-[var(--color-gray-500)]
                   select-none"
        onMouseDown={() => setIsComparingOriginal(true)}
        onMouseUp={() => setIsComparingOriginal(false)}
        onMouseLeave={() => setIsComparingOriginal(false)}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
          <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
        </svg>
        <span>{t('editor.editFlyout.holdToPreview')}</span>
      </button>

      {/* 参数分组 */}
      {ADJUST_GROUPS.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        const hasEdit = groupHasEdit(group);
        return (
          <div key={group.key} className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] overflow-hidden">
            {/* 分组头 */}
            <button
              className="w-full flex items-center justify-between px-3 py-2
                         hover:bg-[var(--color-gray-50)] transition-colors cursor-pointer"
              onClick={() => toggleGroup(group.key)}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)]">{t(group.labelKey)}</span>
                {hasEdit && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)]" />}
              </div>
              <svg
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform ${collapsed ? '' : 'rotate-180'}`}
              >
                <polyline points="2,4.5 6,8.5 10,4.5" />
              </svg>
            </button>

            {/* 滑块列表 */}
            {!collapsed && (
              <div className="px-3 pb-3 space-y-3.5 border-t border-[var(--color-border-light)] pt-3">
                {group.params.map((param) => (
                  <div key={param.key}>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-[var(--color-gray-600)]">{t(param.labelKey)}</span>
                        {isEdited(param.key) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] flex-shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] text-[var(--color-gray-500)] tabular-nums">
                        {adj[param.key] > 0 ? '+' : ''}{adj[param.key]}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      value={adj[param.key]}
                      onChange={(e) => handleChange(param.key, parseInt(e.target.value))}
                      onDoubleClick={() => handleChange(param.key, DEFAULT_ADJ[param.key])}
                      className={`w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none cursor-pointer
                        ${param.key === 'temperature'
                          ? '[&::-webkit-slider-runnable-track]:bg-gradient-to-r [&::-webkit-slider-runnable-track]:from-blue-400 [&::-webkit-slider-runnable-track]:via-gray-200 [&::-webkit-slider-runnable-track]:to-orange-400'
                          : 'bg-[var(--color-gray-200)]'
                        }
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                        [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                        [&::-webkit-slider-thumb]:cursor-pointer`}
                  />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════
   滤镜 Tab
   ═══════════════════════════════════════ */

function FilterTab({ placement }: { placement: { filter?: string | null; filterIntensity?: number } }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const photos = usePhotoStore((s) => s.photos);
  const updatePlacementFilter = useEditorStore((s) => s.updatePlacementFilter);
  const updatePlacementFilterIntensity = useEditorStore((s) => s.updatePlacementFilterIntensity);

  const activeFilter = placement.filter || null;
  const intensity = placement.filterIntensity ?? 100;

  // 获取当前照片的 src 用于缩略图预览
  const page = useEditorStore((s) => s.pages[currentPageIndex]);
  const pl = page?.placements.find((p) => p.slotId === selectedSlotId);
  const photo = pl?.photoId ? photos.find((p) => p.id === pl.photoId) : undefined;
  const photoSrc = photo?.src || '';

  const handleSelect = useCallback((name: string | null) => {
    if (!selectedSlotId) return;
    updatePlacementFilter(currentPageIndex, selectedSlotId, name);
  }, [currentPageIndex, selectedSlotId, updatePlacementFilter]);

  const handleIntensity = useCallback((v: number) => {
    if (!selectedSlotId) return;
    updatePlacementFilterIntensity(currentPageIndex, selectedSlotId, v);
  }, [currentPageIndex, selectedSlotId, updatePlacementFilterIntensity]);

  const activeName = activeFilter || '原图';
  const activeFilterItem = FILTERS.find((f) => f.name === activeName);

  return (
    <div className="space-y-4">
      {/* 当前风格 */}
      <div className="text-[var(--text-caption)] text-[var(--color-gray-500)]">
        {t('editor.editFlyout.currentStyle')}<span className="text-[var(--color-brand)] font-[500]">{activeFilterItem ? t(activeFilterItem.nameKey) : ''}</span>
      </div>

      {/* 滤镜网格 */}
      <div className="grid grid-cols-4 gap-2">
        {FILTERS.map((f) => {
          const isActive = activeFilter === (f.name === '原图' ? null : f.name);
          return (
            <div
              key={f.name}
              className={`flex flex-col items-center gap-1 cursor-pointer group p-1 rounded-[var(--radius-sm)] transition-colors
                          ${isActive ? 'bg-[var(--color-primary-50)] ring-2 ring-[var(--color-primary-400)]' : 'hover:bg-[var(--color-gray-50)]'}`}
              onClick={() => handleSelect(f.name === '原图' ? null : f.name)}
            >
              {/* 缩略图预览 */}
              <div
                className="w-[52px] h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)]
                           overflow-hidden relative bg-cover bg-center"
                style={{
                  backgroundImage: photoSrc ? `url(${photoSrc})` : undefined,
                  filter: f.css,
                  ...(f.name === '原图' && !photoSrc ? { backgroundColor: f.previewColor } : {}),
                }}
              >
                {!photoSrc && f.name === '原图' && (
                  <svg viewBox="0 0 16 16" fill="none" stroke="#999" strokeWidth="1.2" className="w-4 h-4 absolute inset-0 m-auto opacity-50">
                    <rect x="2" y="2" width="12" height="12" rx="2" /><circle cx="8" cy="8" r="2" />
                  </svg>
                )}
                {isActive && (
                  <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-[var(--color-primary-600)] rounded-full flex items-center justify-center">
                    <svg viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" className="w-2 h-2">
                      <polyline points="2,5 4,7 8,3" />
                    </svg>
                  </div>
                )}
              </div>
              <span className={`text-[10px] leading-tight ${isActive ? 'text-[var(--color-brand)] font-[500]' : 'text-[var(--color-gray-500)] group-hover:text-[var(--color-gray-700)]'}`}>
                {t(f.nameKey)}
              </span>
            </div>
          );
        })}
      </div>

      {/* 滤镜强度（仅在有滤镜时显示） */}
      {activeFilter && activeFilter !== null && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[11px] text-[var(--color-gray-600)]">{t('editor.editFlyout.intensity')}</span>
            <span className="text-[11px] text-[var(--color-gray-500)] tabular-nums">{intensity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={intensity}
            onChange={(e) => handleIntensity(parseInt(e.target.value))}
            className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                       [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   旋转 Tab
   ═══════════════════════════════════════ */

function RotateTab({ placement }: { placement: { rotation?: number; flipH?: boolean; flipV?: boolean; panScale?: number } }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const albumSize = useEditorStore((s) => s.albumSize);
  const currentPage = useEditorStore((s) => s.pages[s.currentPageIndex]);
  const photos = usePhotoStore((s) => s.photos);
  const panRotation = useEditorStore((s) => {
    const page = s.pages[s.currentPageIndex];
    const pl = page?.placements.find((p) => p.slotId === s.selectedSlotId);
    return pl?.panRotation ?? 0;
  });
  const panScale = Math.max(placement.panScale || 1, 1);
  const flipH = placement.flipH ?? false;
  const flipV = placement.flipV ?? false;
  const addToast = useUIStore((s) => s.addToast);

  const handleChange = useCallback((value: number) => {
    if (!selectedSlotId) return;
    slotEditService.updatePlacementPanRotation(currentPageIndex, selectedSlotId, value);
  }, [currentPageIndex, selectedSlotId]);

  const handleQuickRotate = useCallback((dir: -90 | 90) => {
    if (!selectedSlotId) return;
    const state = useEditorStore.getState();
    const page = state.pages[currentPageIndex];
    const pl = page?.placements.find((p) => p.slotId === selectedSlotId);
    if (!pl || !pl.photoId) return;
    const oldRotation = pl.panRotation || 0;
    const newRotation = ((oldRotation + dir) % 360 + 360) % 360;
    slotEditService.updatePlacementPanRotation(currentPageIndex, selectedSlotId, newRotation, true);
  }, [currentPageIndex, selectedSlotId]);

  const handleFlip = useCallback((h?: boolean, v?: boolean) => {
    if (!selectedSlotId) return;
    const currentH = h !== undefined ? h : flipH;
    const currentV = v !== undefined ? v : flipV;
    useEditorStore.getState().updatePlacementFlip(currentPageIndex, selectedSlotId, currentH, currentV);
  }, [currentPageIndex, selectedSlotId, flipH, flipV]);

  const handleAutoStraighten = useCallback(() => {
    if (!selectedSlotId) return;
    // 基于角度取整到最近的水平和垂直：如果绝对值在 45° 以内取水平，否则取垂直
    const angle = panRotation % 360;
    let target = 0;
    if (Math.abs(angle) <= 45 || Math.abs(angle) >= 315) target = 0;
    else if (angle >= 45 && angle <= 135) target = 90;
    else if (angle >= 135 && angle <= 225) target = 180;
    else if (angle >= 225 && angle <= 315) target = 270;
    // 同时取最接近的 90° 倍数
    const nearest = Math.round(angle / 90) * 90;
    if (Math.abs(angle - nearest) < Math.abs(angle - target)) target = nearest;
    // 使用取整到最近 90°
    const finalAngle = Math.round(panRotation / 90) * 90;
    slotEditService.updatePlacementPanRotation(currentPageIndex, selectedSlotId, finalAngle, true);
    addToast({ type: 'success', message: t('editor.editFlyout.autoStraightened', { angle: finalAngle }) });
  }, [currentPageIndex, selectedSlotId, panRotation, addToast, t]);

  // 缩放滑块：以槽位中心为锚点缩放，保持照片相对位置
  const handleScaleChange = useCallback((value: number) => {
    if (!selectedSlotId || !currentPage || !albumSize) return;
    const template = resolveTemplate(currentPage);
    const slot = template?.slots.find((s) => s.id === selectedSlotId);
    if (!slot) return;
    const CANVAS_W = albumSize.width * 2;
    const CANVAS_H = albumSize.height * 2;
    const ov = currentPage.slotOverrides?.[selectedSlotId];
    const sw = ov ? ov.width : (slot.width / 100) * CANVAS_W;
    const sh = ov ? ov.height : (slot.height / 100) * CANVAS_H;
    const pl = currentPage.placements.find((p) => p.slotId === selectedSlotId);
    const photo = pl?.photoId ? photos.find((p) => p.id === pl.photoId) : undefined;
    if (!pl || !photo || photo.width <= 0 || photo.height <= 0) return;

    const oldPanScale = Math.max(pl.panScale || 1, 1);
    const newPanScale = Math.max(1, value);
    const totalRot = pl.panRotation ?? (pl.rotation || 0);
    const oldCF = calcCoverFitWithRotation(photo.width, photo.height, sw, sh, totalRot);
    const oldBW = oldCF.boundingW * oldPanScale;
    const oldBH = oldCF.boundingH * oldPanScale;
    const oldDefaultPx = Math.round((sw - oldBW) / 2);
    const oldDefaultPy = Math.round((sh - oldBH) / 2);

    // 以槽位中心为锚点缩放：保持视觉中心相对槽位中心的偏移
    const oldVisualCX = (pl.panX ?? oldDefaultPx) + oldBW / 2;
    const oldVisualCY = (pl.panY ?? oldDefaultPy) + oldBH / 2;
    const newBW = oldCF.boundingW * newPanScale;
    const newBH = oldCF.boundingH * newPanScale;
    let newPanX = oldVisualCX - newBW / 2;
    let newPanY = oldVisualCY - newBH / 2;

    const clamped = clampPhotoToSlotBounds(photo.width, photo.height, sw, sh, totalRot, newPanScale, newPanX, newPanY);

    useEditorStore.getState().updatePlacementPan(currentPageIndex, selectedSlotId, clamped.panX, clamped.panY, newPanScale);
  }, [currentPageIndex, selectedSlotId, currentPage, albumSize, photos]);

  return (
    <div className="space-y-5">
      {/* 快速旋转 */}
      <div>
        <div className="text-[11px] text-[var(--color-gray-500)] mb-2 font-[500]">{t('editor.editFlyout.quickRotate')}</div>
        <div className="flex gap-2">
          <button
            className="flex-1 py-2 flex items-center justify-center gap-1 border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-caption)] text-[var(--color-gray-600)] bg-white cursor-pointer
                       hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={() => handleQuickRotate(-90)}
            title={t('editor.editFlyout.rotateLeftHint')}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M3 7a5 5 0 1 1 4.6 5" /><path d="M4 9L1 7l2-3" />
            </svg>
            {t('editor.editFlyout.rotateLeft')}
          </button>
          <button
            className="flex-1 py-2 flex items-center justify-center gap-1 border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-caption)] text-[var(--color-gray-600)] bg-white cursor-pointer
                       hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={() => handleQuickRotate(90)}
            title={t('editor.editFlyout.rotateRightHint')}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M11 7a5 5 0 1 0-4.6 5" /><path d="M10 9l3-2-2-3" />
            </svg>
            {t('editor.editFlyout.rotateRight')}
          </button>
        </div>
      </div>

      {/* 微调角度 */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[11px] text-[var(--color-gray-500)] font-[500]">{t('editor.editFlyout.fineTune')}</span>
          <span className="text-[11px] text-[var(--color-gray-500)] tabular-nums">{Math.round(panRotation)}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(panRotation)}
          onChange={(e) => handleChange(parseInt(e.target.value))}
          className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                     [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* 缩放 */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[11px] text-[var(--color-gray-500)] font-[500]">{t('editor.editFlyout.zoom')}</span>
          <span className="text-[11px] text-[var(--color-gray-500)] tabular-nums">{Math.round(panScale * 100)}%</span>
        </div>
        <input
          type="range"
          min={100}
          max={300}
          step={1}
          value={Math.round(panScale * 100)}
          onChange={(e) => handleScaleChange(parseInt(e.target.value) / 100)}
          className="w-full h-1 rounded-full accent-[var(--color-primary-600)] appearance-none bg-[var(--color-gray-200)]
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-600)]
                     [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* 翻转 */}
      <div>
        <div className="text-[11px] text-[var(--color-gray-500)] mb-2 font-[500]">{t('editor.editFlyout.flip')}</div>
        <div className="flex gap-2">
          <button
            className={`flex-1 py-2 flex items-center justify-center gap-1 border rounded-[var(--radius-md)]
                       text-[var(--text-caption)] bg-white cursor-pointer transition-colors
                       ${flipH
                         ? 'border-[var(--color-primary-400)] text-[var(--color-brand)] bg-[var(--color-primary-50)]'
                         : 'border-[var(--color-border)] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
                       }`}
            onClick={() => handleFlip(!flipH, flipV)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M2 7h10M7 2v10" />
            </svg>
            {t('editor.editFlyout.flipHorizontal')}
          </button>
          <button
            className={`flex-1 py-2 flex items-center justify-center gap-1 border rounded-[var(--radius-md)]
                       text-[var(--text-caption)] bg-white cursor-pointer transition-colors
                       ${flipV
                         ? 'border-[var(--color-primary-400)] text-[var(--color-brand)] bg-[var(--color-primary-50)]'
                         : 'border-[var(--color-border)] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
                       }`}
            onClick={() => handleFlip(flipH, !flipV)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5 rotate-90">
              <path d="M2 7h10M7 2v10" />
            </svg>
            {t('editor.editFlyout.flipVertical')}
          </button>
        </div>
      </div>

      {/* 自动拉直 */}
      <button
        className="w-full py-2 flex items-center justify-center gap-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)]
                   text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white cursor-pointer
                   hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={handleAutoStraighten}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
          <line x1="2" y1="12" x2="4" y2="2" /><line x1="12" y1="12" x2="11" y2="5" /><line x1="7" y1="12" x2="7" y2="3" />
        </svg>
        {t('editor.editFlyout.autoStraighten')}
      </button>
    </div>
  );
}
