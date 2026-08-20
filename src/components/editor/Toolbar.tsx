import { useUIStore, useEditorStore, useHistoryStore } from '../../store';
import { Button } from '../common/Button';
import { Logo } from '../common/Logo';
import { AppHeader } from '../common/AppHeader';
import { loadProject, saveProject, savePhotos, getCurrentProjectId } from '../../db';
import { usePhotoStore } from '../../store';
import { exportBackupZip } from '../../utils/backup';
import { ExportDialog } from './ExportDialog';
import { PageSettings } from './PageSettings';
import { WatermarkSettings } from './WatermarkSettings';
import { PrintDialog } from './PrintDialog';
import { BookPreviewOverlay } from './BookPreviewOverlay';
import { Modal } from '../common/Modal';
import { useState, useRef, useEffect } from 'react';
import { useLicenseStore } from '../../license';
import { useTranslation } from 'react-i18next';

interface ToolbarProps {
  onBack?: () => void;
}

export function Toolbar({ onBack }: ToolbarProps) {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);
  const projectName = useEditorStore((s) => s.projectName);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const checkFeature = useLicenseStore((s) => s.checkFeature);
  const [isPageSettingsOpen, setIsPageSettingsOpen] = useState(false);
  const [isWatermarkSettingsOpen, setIsWatermarkSettingsOpen] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [isBookPreviewOpen, setIsBookPreviewOpen] = useState(false);

  const title = projectName || t('editor.defaultProjectName');

  const [editingTitle, setEditingTitle] = useState(title);
  useEffect(() => { setEditingTitle(title); }, [title]);

  const handleUndo = () => {
    const entry = undo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: t('editor.toast.undone') });
    }
  };

  const handleRedo = () => {
    const entry = redo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: t('editor.toast.redone') });
    }
  };

  // ── 项目名称修改保存 ──
  const handleTitleBlur = async () => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingTitle(projectName || t('editor.defaultProjectName'));
      return;
    }
    if (trimmed === projectName) return;
    useEditorStore.getState().setProjectName(trimmed);
    const projectId = getCurrentProjectId();
    if (projectId) {
      try {
        const existing = await loadProject(projectId);
        if (existing) {
          await saveProject({ ...existing, name: trimmed, updatedAt: new Date().toISOString() });
        }
      } catch {
        addToast({ type: 'error', message: t('editor.toast.nameSaveFailed') });
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setEditingTitle(projectName || t('editor.defaultProjectName'));
      e.currentTarget.blur();
    }
  };

  // ── 手动保存 ──
  const handleSave = async () => {
    try {
      const pages = useEditorStore.getState().pages;
      const photos = usePhotoStore.getState().photos;
      const albumSize = useEditorStore.getState().albumSize;
      const projectId = getCurrentProjectId();

      if (!projectId || pages.length === 0) {
        addToast({ type: 'warning', message: t('editor.toast.nothingToSave') });
        return;
      }

      const existing = await loadProject(projectId);
      if (existing) {
        await saveProject({
          ...existing,
          pages,
          size: albumSize!,
          guideLines: useEditorStore.getState().guideLines,
          updatedAt: new Date().toISOString(),
        });
      }
      await savePhotos(photos, projectId);
      addToast({ type: 'success', message: t('editor.toast.saved') });
    } catch {
      addToast({ type: 'error', message: t('editor.toast.saveFailed') });
    }
  };

  // ── 备份当前项目 ──
  const executeBackup = async () => {
    const projectId = getCurrentProjectId();
    if (!projectId) {
      addToast({ type: 'warning', message: t('editor.toast.noProjectToBackup') });
      return;
    }
    setBackupConfirmOpen(false);
    const result = await exportBackupZip(projectId, projectName);
    addToast({
      type: result.ok ? 'success' : result.cancelled ? 'info' : 'error',
      message: result.message,
    });
  };

  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  // 点击任意区域关闭菜单（捕获阶段确保先于 Konva 事件）
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pageMenuOpen || fileMenuOpen) {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          setPageMenuOpen(false);
          setFileMenuOpen(false);
        }
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [pageMenuOpen, fileMenuOpen]);

  return (
    <>
      <AppHeader>
        {/* MemBook 品牌 */}
        <button
          data-no-drag
          className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] border-none bg-white/40 backdrop-blur-sm cursor-pointer hover:bg-white/70 transition-colors shrink-0"
          onClick={(e) => { e.stopPropagation(); onBack?.(); }}
        >
          <Logo className="w-5 h-5" />
          <span className="text-[var(--text-body)] font-[700] text-[var(--color-primary-600)]">MemBook</span>
        </button>

      {/* 预览模式：隐藏文件/页面/撤销/重做，任务栏保持编辑器样式 */}
      {!isBookPreviewOpen && (
      <>
      <div className="w-px h-4 bg-[var(--color-border-light)]/60 shrink-0" />

      <div ref={menuRef} className="flex items-center gap-1" data-no-drag>
        {/* 文件 ▾ */}
        <div className="relative">
          <button
            data-no-drag
            className={`text-[var(--text-body-sm)] px-3 py-1.5 rounded-[var(--radius-lg)] border-none cursor-pointer transition-all font-[500] ${
              fileMenuOpen ? 'bg-white/80 text-[var(--color-gray-800)] shadow-[var(--shadow-xs)]' : 'bg-transparent text-[var(--color-gray-600)] hover:bg-white/50'
            }`}
            onClick={() => { setFileMenuOpen((o) => !o); setPageMenuOpen(false); }}
          >{t('editor.menu.file')}</button>
          {fileMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-[var(--color-border)] py-1 z-[var(--z-dropdown)] overflow-hidden">
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-primary-50)] transition-colors"
                onClick={() => { setFileMenuOpen(false); setIsPrintDialogOpen(true); }}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6V2h8v4" /><path d="M2 10h12v4H2z" /><path d="M4 10V6h8v4" />
                </svg>
                {t('editor.menu.print')}
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-primary-50)] transition-colors"
                onClick={() => {
                  setFileMenuOpen(false);
                  setBackupConfirmOpen(true);
                }}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a5 5 0 0 1 9.9-1A4 4 0 0 1 12.5 14H4a3 3 0 0 1-1-5.8z" /><path d="M8 8v4" /><path d="M6.5 10.5L8 12l1.5-1.5" />
                </svg>
                {t('editor.menu.backup')}
              </button>
            </div>
          )}
        </div>

        {/* 页面 ▾ */}
        <div className="relative">
          <button
            data-no-drag
            className={`text-[var(--text-body-sm)] px-3 py-1.5 rounded-[var(--radius-lg)] border-none cursor-pointer transition-all font-[500] ${
              pageMenuOpen ? 'bg-white/80 text-[var(--color-gray-800)] shadow-[var(--shadow-xs)]' : 'bg-transparent text-[var(--color-gray-600)] hover:bg-white/50'
            }`}
            onClick={() => { setPageMenuOpen((o) => !o); setFileMenuOpen(false); }}
          >{t('editor.menu.page')}</button>
          {pageMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-[var(--color-border)] py-1 z-[var(--z-dropdown)] overflow-hidden">
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-primary-50)] transition-colors"
                onClick={() => { setPageMenuOpen(false); setIsPageSettingsOpen(true); }}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" />
                  <rect x="5" y="5" width="6" height="6" rx="0.5" strokeDasharray="2 1.5" />
                </svg>
                {t('editor.menu.pageSettings')}
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-primary-50)] transition-colors"
                onClick={() => { setPageMenuOpen(false); useUIStore.getState().setCoverSettingsOpen(true); }}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" />
                  <path d="M2 6h12" />
                </svg>
                {t('editor.menu.coverSettings')}
              </button>
              <div className="h-px bg-[var(--color-border-light)] my-1" />
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] border-none bg-transparent cursor-pointer hover:bg-[var(--color-primary-50)] transition-colors"
                onClick={() => { setPageMenuOpen(false); checkFeature('timeWatermark', t('editor.guard.watermark')) && setIsWatermarkSettingsOpen(true); }}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6" /><path d="M8 5v3.5" /><circle cx="8" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
                </svg>
                {t('editor.menu.timeWatermark')}
              </button>
            </div>
          )}
        </div>

      </div>

      <div className="w-px h-4 bg-[var(--color-gray-300)] shrink-0 mx-1" />

      {/* ↶ ↷ */}
      <button data-no-drag className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] border-none bg-transparent text-[var(--color-gray-500)] cursor-pointer hover:bg-white/50 hover:text-[var(--color-gray-700)] transition-colors" title={t('editor.tooltip.undo')} onClick={handleUndo}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M5 5L2 8l3 3"/><path d="M2 8h8a4 4 0 0 1 0 8"/></svg>
      </button>
      <button data-no-drag className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] border-none bg-transparent text-[var(--color-gray-500)] cursor-pointer hover:bg-white/50 hover:text-[var(--color-gray-700)] transition-colors" title={t('editor.tooltip.redo')} onClick={handleRedo}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M11 5l3 3-3 3"/><path d="M14 8H6a4 4 0 0 0 0 8"/></svg>
      </button>
      </>
      )}

      <div className="flex-1" />

      {/* 标题：绝对居中于整个任务栏（不受左侧功能区显隐影响） */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex justify-center min-w-0" data-no-drag>
        <input id="project-title-input"
          data-no-drag
          className="bg-transparent border-none text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] text-center outline-none px-3 py-1 max-w-[320px] rounded-[var(--radius-md)] focus:bg-white/40 transition-all truncate"
          value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} maxLength={40}
          onBlur={handleTitleBlur} onKeyDown={handleTitleKeyDown} />
      </div>

      <div className="flex-1" />

      {/* 保存 / 导出 */}
      <div className="flex items-center gap-2 mr-2" data-no-drag>
        {/* 预览 ↔ 退出预览（同一按钮切换态） */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsBookPreviewOpen((o) => !o)}
          className="!rounded-[var(--radius-lg)] !bg-white/50 hover:!bg-white/80 !border-none !font-[600]"
          title={isBookPreviewOpen ? t('editor.exitBookPreviewBtn') : t('editor.bookPreviewBtn')}
        >
          {isBookPreviewOpen ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h5a2 2 0 0 1 2 2v9a2 2 0 0 0-2-2H2z"/><path d="M14 3H9a2 2 0 0 0-2 2v9a2 2 0 0 1 2-2h5z"/></svg>
          )}
          {isBookPreviewOpen ? t('editor.exitBookPreviewBtn') : t('editor.bookPreviewBtn')}
        </Button>
        {/* 预览模式下隐藏保存/导出（预览只读，不提供修改入口） */}
        {!isBookPreviewOpen && (
          <>
            <Button variant="secondary" size="sm" onClick={handleSave} className="!rounded-[var(--radius-lg)] !bg-white/50 hover:!bg-white/80 !border-none !font-[600]">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5l-3-3z"/><path d="M11 2v6H5V2"/></svg>{t('editor.saveBtn')}
            </Button>
            <Button variant="primary" size="sm" data-onboarding="export-btn" onClick={() => checkFeature('exportFile', t('editor.guard.export')) && setIsExportDialogOpen(true)} className="!rounded-[var(--radius-lg)] !bg-[image:var(--gradient-brand)] !border-none !font-[600]">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v10"/><path d="M4 8l4 4 4-4"/><path d="M2 14h12"/></svg>{t('editor.exportBtn')}
            </Button>
          </>
        )}
      </div>

      </AppHeader>

      <ExportDialog isOpen={isExportDialogOpen} onClose={() => setIsExportDialogOpen(false)} />
      <PageSettings open={isPageSettingsOpen} onClose={() => setIsPageSettingsOpen(false)} />
      <WatermarkSettings open={isWatermarkSettingsOpen} onClose={() => setIsWatermarkSettingsOpen(false)} />
      <PrintDialog isOpen={isPrintDialogOpen} onClose={() => setIsPrintDialogOpen(false)} />

      <BookPreviewOverlay open={isBookPreviewOpen} onClose={() => setIsBookPreviewOpen(false)} />

      {/* 备份当前项目确认弹窗 */}
      <Modal
        open={backupConfirmOpen}
        onClose={() => setBackupConfirmOpen(false)}
        title={t('editor.backup.title')}
        maxWidth="480px"
        footer={
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setBackupConfirmOpen(false)}
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={executeBackup}
              className="px-4 py-2 text-[var(--text-body-sm)] text-white bg-[var(--color-brand)] border border-[var(--color-brand)] rounded-[var(--radius-md)] hover:opacity-90 transition-colors cursor-pointer"
            >
              {t('editor.backup.confirm')}
            </button>
          </div>
        }
      >
        <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
          {t('editor.backup.desc', { title })}
        </p>
      </Modal>
    </>
  );
}
