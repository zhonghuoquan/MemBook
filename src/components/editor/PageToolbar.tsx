import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { LayoutAdjustPanel } from './LayoutAdjustPanel';
import { LayoutSwitchDialog } from './LayoutSwitchDialog';
import { PhotoReorderDialog } from './PhotoReorderDialog';
import { useLicenseStore } from '../../license';

/* ═══════════════════════════════════════════
   Canvas 画布上方浮动工具栏
   当前功能：清除照片 / 排版变化 / 重置模板 / 删除此页
   ═══════════════════════════════════════════ */

export function PageToolbar() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const resetPageLayout = useEditorStore((s) => s.resetPageLayout);
  const removePage = useEditorStore((s) => s.removePage);
  const addPhotoSlot = useEditorStore((s) => s.addPhotoSlot);
  const addToast = useUIStore((s) => s.addToast);

  const [collapsed, setCollapsed] = useState(false);
  const isLayoutAdjustOpen = useUIStore((s) => s.layoutAdjustOpen);
  const setIsLayoutAdjustOpen = useUIStore((s) => s.setLayoutAdjustOpen);
  const isLayoutSwitchOpen = useUIStore((s) => s.layoutSwitchOpen);
  const setIsLayoutSwitchOpen = useUIStore((s) => s.setLayoutSwitchOpen);
  const isReorderOpen = useUIStore((s) => s.photoReorderOpen);
  const setIsReorderOpen = useUIStore((s) => s.setPhotoReorderOpen);
  const setActiveFloatingPanel = useUIStore((s) => s.setActiveFloatingPanel);
  const checkFeature = useLicenseStore((s) => s.checkFeature);

  if (pages.length === 0) return null;

  /* ── 打开排版变化 ── */
  const handleOpenLayoutAdjust = () => {
    if (!checkFeature('layoutAdjust', t('license.layoutAdjustRequiresActivation'))) return;
    setIsLayoutAdjustOpen(!isLayoutAdjustOpen);
  };

  /* ── 打开布局切换 ── */
  const handleOpenLayoutSwitch = () => {
    if (!checkFeature('layoutSwitch', t('license.layoutSwitchRequiresActivation'))) return;
    setIsLayoutSwitchOpen(!isLayoutSwitchOpen);
  };

  /* ── 清除当前页全部照片 ── */
  const handleClearAll = () => {
    const page = pages[currentPageIndex];
    if (!page) return;
    const filledCount = page.placements.filter((p) => p.photoId !== null).length;
    if (filledCount === 0) {
      addToast({ type: 'info', message: t('editor.pageToolbar.noPhotos') });
      return;
    }
    const updatedPlacements = page.placements.map((p) => ({ ...p, photoId: null }));
    const newPages = [...pages];
    newPages[currentPageIndex] = { ...page, placements: updatedPlacements };
    useEditorStore.getState().setPages(newPages);
    addToast({ type: 'success', message: t('editor.pageToolbar.clearedPhotos', { count: filledCount }) });
  };

  /* ── 重置模板（恢复槽位默认位置/尺寸） ── */
  const handleResetLayout = () => {
    resetPageLayout(currentPageIndex);
    addToast({ type: 'success', message: t('editor.pageToolbar.layoutReset') });
  };

  /* ── 打开/关闭照片位置重排弹窗（普通模板与 GP 页面均支持）── */
  const handleOpenReorder = () => {
    if (!checkFeature('photoShuffle', t('license.photoShuffleRequiresActivation'))) return;
    setIsReorderOpen(!isReorderOpen);
  };

  /* ── 添加照片槽位 ── */
  const handleAddPhotoSlot = () => {
    addPhotoSlot();
    addToast({ type: 'success', message: t('editor.pageToolbar.slotAdded') });
  };

  /* ── 删除此页 ── */
  const handleDeletePage = () => {
    removePage(currentPageIndex);
    addToast({ type: 'success', message: t('editor.pageToolbar.pageDeleted') });
  };

  return (
    <>
      <div data-page-toolbar className="absolute top-3 left-1/2 -translate-x-1/2 z-[var(--z-dropdown)] pointer-events-none">
        <div data-onboarding="page-toolbar" className="flex items-center gap-1 px-2 py-1 bg-white/85 backdrop-blur-sm rounded-[var(--radius-lg)]
                        shadow-[var(--shadow-md)] border border-[var(--color-border)] pointer-events-auto
                        select-none transition-all duration-200 whitespace-nowrap">

          {/* 展开/收起按钮 */}
          <button
            className="flex items-center justify-center w-5 h-6 shrink-0 rounded-[var(--radius-sm)] text-[var(--color-gray-500)]
                       hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)] transition-colors
                       border-none bg-transparent cursor-pointer"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t('editor.pageToolbar.expand') : t('editor.pageToolbar.collapse')}
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={`w-2.5 h-2.5 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
              <path d="M2 7l3-4 3 4" />
            </svg>
          </button>

          {!collapsed && (
            <>
              {/* 排版变化 */}
              <button
                className={`flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] transition-colors border-none bg-transparent cursor-pointer ${
                  isLayoutAdjustOpen
                    ? 'text-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                    : 'text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)]'
                }`}
                onClick={handleOpenLayoutAdjust}
                title={t('editor.pageToolbar.layoutAdjustHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <rect x="1.5" y="1.5" width="4" height="11" rx="1" /><rect x="7" y="1.5" width="5" height="5" rx="1" /><rect x="7" y="8.5" width="5" height="4" rx="1" />
                </svg>
                {t('editor.layout.layoutAdjust')}
              </button>

              {/* 分隔线 */}
              <div className="w-px h-4 shrink-0 bg-[var(--color-border)]" />

              {/* 布局切换 */}
              <button
                className={`flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] transition-colors border-none bg-transparent cursor-pointer ${
                  isLayoutSwitchOpen
                    ? 'text-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                    : 'text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)]'
                }`}
                onClick={handleOpenLayoutSwitch}
                title={t('editor.pageToolbar.layoutSwitchHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M2 5a4 4 0 0 1 7-2.5" /><path d="M9 1v2.5H6.5" />
                  <path d="M12 9a4 4 0 0 1-7 2.5" /><path d="M5 13v-2.5h2.5" />
                </svg>
                {t('editor.layout.layoutSwitch')}
              </button>

              {/* 照片位置重排 */}
              <button
                className={`flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] transition-colors border-none bg-transparent cursor-pointer ${
                  isReorderOpen
                    ? 'text-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                    : 'text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)]'
                }`}
                onClick={handleOpenReorder}
                title={t('editor.pageToolbar.photoReorderHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M1 3.5h2.5l2 7H11" />
                  <path d="M1 10.5h2.5l2-7H11" />
                  <path d="M9.5 1.5l3 3-3 3" />
                  <path d="M9.5 6.5l3 3-3 3" />
                </svg>
                {t('editor.layout.photoReorder')}
              </button>

              {/* 分隔线 */}
              <div className="w-px h-4 shrink-0 bg-[var(--color-border)]" />

              {/* 添加照片位 */}
              <button
                className="flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] text-[var(--color-gray-600)]
                           hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] transition-colors
                           border-none bg-transparent cursor-pointer"
                onClick={handleAddPhotoSlot} title={t('editor.pageToolbar.addSlotHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <rect x="1.5" y="2" width="7" height="9" rx="1" />
                  <path d="M9.5 7h3M11 5.5v3" />
                </svg>
                {t('editor.pageToolbar.addSlot')}
              </button>

              {/* 分隔线 */}
              <div className="w-px h-4 shrink-0 bg-[var(--color-border)]" />

              {/* 重置模板 */}
              <button
                className="flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] text-[var(--color-gray-600)]
                           hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] transition-colors
                           border-none bg-transparent cursor-pointer"
                onClick={handleResetLayout} title={t('editor.pageToolbar.resetLayoutHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M1.5 5.5v-4h4" /><path d="M2 7a5 5 0 1 0 1.5-3.5" />
                </svg>
                {t('editor.pageToolbar.resetLayout')}
              </button>

              {/* 分隔线 */}
              <div className="w-px h-4 shrink-0 bg-[var(--color-border)]" />

              {/* 清除全部照片（移至删除此页左侧）*/}
              <button
                className="flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] text-[var(--color-gray-600)]
                           hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] transition-colors
                           border-none bg-transparent cursor-pointer"
                onClick={handleClearAll} title={t('editor.pageToolbar.clearAllHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
                  <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
                </svg>
                {t('editor.pageToolbar.clearAll')}
              </button>

              {/* 删除此页 */}
              <button
                className="flex items-center gap-1 h-6 px-2 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] text-[11px] text-[var(--color-gray-600)]
                           hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] transition-colors
                           border-none bg-transparent cursor-pointer"
                onClick={handleDeletePage} title={t('editor.pageToolbar.deletePageHint')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M11 4l-6 6M5 4l6 6" />
                </svg>
                {t('editor.pageToolbar.deletePage')}
              </button>
            </>
          )}
        </div>
      </div>
      <LayoutAdjustPanel
        open={isLayoutAdjustOpen}
        onClose={() => { setIsLayoutAdjustOpen(false); setActiveFloatingPanel(null); }}
      />
      <LayoutSwitchDialog
        open={isLayoutSwitchOpen}
        onClose={() => { setIsLayoutSwitchOpen(false); setActiveFloatingPanel(null); }}
      />
      <PhotoReorderDialog
        open={isReorderOpen}
        onClose={() => { setIsReorderOpen(false); setActiveFloatingPanel(null); }}
      />
    </>
  );
}
