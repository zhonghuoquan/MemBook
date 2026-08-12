import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Toolbar } from '../editor/Toolbar';
import { LeftPanel } from '../editor/LeftPanel';
import { Canvas } from '../editor/Canvas';
import { EditorEmptyState } from '../editor/EditorEmptyState';
import { EditFlyout } from '../editor/EditFlyout';
import { PageToolbar } from '../editor/PageToolbar';
import { PageDisplayModeToggle } from '../editor/PageDisplayModeToggle';
import { BottomNav } from '../editor/BottomNav';
import { GridView } from '../editor/GridView';
import { OnboardingTour, shouldShowOnboarding } from '../editor/OnboardingTour';
import { StorageModeDialog } from '../common/StorageModeDialog';
import { Modal } from '../common/Modal';
import { useUIStore, useEditorStore, usePhotoStore, useHistoryStore } from '../../store';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT } from '../../types';
import { usePhotoImport } from '../../hooks/usePhotoImport';
import { useLocationResolver } from '../../hooks/useLocationResolver';
import { getDemoPhotos, getDemoProject } from '../../utils/demoData';
import { loadProject, loadPhotos, createAndSaveProject, saveProject, savePhotos, scheduleAutoSave, setAutoSaveProvider, setAutoSaveStatusHandler, getCurrentProjectId } from '../../db';
import { restoreDirectoryHandle, makeDirectPhotoUrl, acquirePhotoUrl } from '../../engine/storage-engine';
import { photoService } from '../../services/photoService';
import { exportBackupZip } from '../../utils/backup';
import { logger } from '../../utils/logger';
import { safeUnlisten } from '../../utils/tauri';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface EditorViewProps {
  onBack?: () => void;
  onNavigateToSmartLayout: () => void;
}

export function EditorView({ onBack, onNavigateToSmartLayout }: EditorViewProps) {
  const { t } = useTranslation();
  const pages = useEditorStore((s) => s.pages);
  const setPages = useEditorStore((s) => s.setPages);
  const setAlbumSize = useEditorStore((s) => s.setAlbumSize);
  const photos = usePhotoStore((s) => s.photos);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const addToast = useUIStore((s) => s.addToast);
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const clearSmartLayoutState = useUIStore((s) => s.clearSmartLayoutState);
  const persistWarning = useUIStore((s) => s.persistWarning);
  const setPersistWarning = useUIStore((s) => s.setPersistWarning);
  const editFlyoutOpen = useUIStore((s) => s.editFlyoutOpen);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const initBehaviorDone = useRef(false);
  const loadProjectDone = useRef(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── 全局照片导入：整个窗口拖拽都有效 ──
  const photoImport = usePhotoImport();
  // ── 自动补全缺失的地理位置（导入时逆地理编码失败的兜底） ──
  useLocationResolver();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const dropLockRef = useRef(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const runHandleFiles = useCallback(async (files: FileList) => {
    if (dropLockRef.current) return;
    dropLockRef.current = true;
    try {
      await photoImport.handleFiles(files);
    } finally {
      setTimeout(() => { dropLockRef.current = false; }, 300);
    }
  }, [photoImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    // Tauri 环境下由 tauri://drag-drop 事件处理，禁止浏览器原生 onDrop 导入，
    // 避免同一次物理拖拽触发两个事件导致重复导入
    if (isTauri) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      runHandleFiles(e.dataTransfer.files);
    }
  }, [runHandleFiles]);
  // Tauri WebView2 全局拖拽监听
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlistenFn: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { readFile, stat } = await import('@tauri-apps/plugin-fs');
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
          bmp: 'image/bmp', gif: 'image/gif',
        };
        unlistenFn = await listen<{ paths: string[]; position?: { x: number; y: number } }>(
          'tauri://drag-drop',
          async (event) => {
            const { paths } = event.payload;
            logger.info('[drag-drop] 收到 Tauri 拖拽事件，路径数:', paths?.length ?? 0);
            if (!paths || paths.length === 0) return;
            if (dropLockRef.current) {
              logger.warn('[drag-drop] 已有导入在进行中，跳过本次拖拽');
              return;
            }
            dropLockRef.current = true;
            setIsDragOver(false);
            const imageFiles: File[] = [];
            const fallbackTimes = new Map<string, number>();
            const originalPaths = new Map<string, string>();
            for (const rawPath of paths) {
              // 兼容可能的 file:// 前缀或 URL 编码
              const path = decodeURIComponent(rawPath.replace(/^file:\/\//i, ''));
              const ext = path.split('.').pop()?.toLowerCase() || '';
              if (!mimeMap[ext]) {
                logger.info('[drag-drop] 跳过非图片文件:', path);
                continue;
              }
              try {
                const name = path.split(/[/\\]/).pop() || 'photo';
                const [content, info] = await Promise.all([
                  readFile(path),
                  stat(path).catch(() => null),
                ]);
                const file = new File([content], name, { type: mimeMap[ext] });
                imageFiles.push(file);
                originalPaths.set(`${file.name}|${file.size}`, path);
                // Tauri 新建的 File 默认 lastModified=now，用真实文件时间兜底
                const mtime = info?.mtime?.getTime();
                const birthtime = info?.birthtime?.getTime();
                const earliest = mtime != null && birthtime != null
                  ? Math.min(mtime, birthtime)
                  : (mtime ?? birthtime ?? null);
                if (earliest != null) {
                  fallbackTimes.set(`${file.name}|${file.size}`, earliest);
                }
              } catch (err) {
                logger.warn('[drag-drop] 读取文件失败，跳过:', path, err);
              }
            }
            if (imageFiles.length > 0) {
              logger.info('[drag-drop] 开始导入', imageFiles.length, '个文件');
              await photoImport.handleFiles(imageFiles, { fallbackTimes, originalPaths });
            } else {
              addToast({ type: 'warning', message: t('editor.dragDrop.noValidImages') });
            }
            setTimeout(() => { dropLockRef.current = false; }, 300);
          },
        );
        // 竞态处理：如果组件在 await 期间已卸载，立即注销监听器
        if (disposed && unlistenFn) {
          safeUnlisten(unlistenFn);
          unlistenFn = null;
        }
      } catch (err) {
        logger.error('[drag-drop] 注册 Tauri 拖拽监听失败:', err);
      }
    })();
    return () => {
      disposed = true;
      safeUnlisten(unlistenFn);
      unlistenFn = null;
    };
  }, [photoImport, addToast]);

  // 编辑器加载完成后检查是否首次使用引导（首次进入编辑器即弹出，不依赖是否已创建页面）
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowOnboarding(shouldShowOnboarding());
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // ── 加载已保存项目 ──
  useEffect(() => {
    if (initBehaviorDone.current) return;
    initBehaviorDone.current = true;

    // 进入编辑器时清理智能编排状态，避免重新进入相册后自动进入智能编排
    clearSmartLayoutState();
    // 每次进入编辑器默认回到单页编辑模式，不保留上次网格视图状态
    setViewMode('single');
  }, [clearSmartLayoutState, setViewMode]);

  // 从网格视图切回单页编辑时，再次清理智能编排状态，防止照片面板的恢复效果进入编排选择模式
  useEffect(() => {
    if (viewMode === 'single') {
      clearSmartLayoutState();
    }
  }, [viewMode, clearSmartLayoutState]);

  // ── 加载已保存项目 ──
  useEffect(() => {
    if (loadProjectDone.current) return;
    loadProjectDone.current = true;

    (async () => {
      // 如果 pages 已有数据（由 HomeView.handleOpenProject 预加载），跳过项目重载，仅初始化历史
      const currentPages = useEditorStore.getState().pages;
      if (currentPages.length > 0) {
        useHistoryStore.getState().clear();
        useHistoryStore.getState().pushSnapshot(currentPages, null);
        // 照片已由 handleOpenProject 设置，无需重复加载
        const savedId = getCurrentProjectId();
        if (savedId) {
          const project = await loadProject(savedId);
          if (project) {
            addToast({ type: 'success', message: t('editor.project.opened', { name: project.name }) });
          }
        }
        return;
      }

      const savedId = getCurrentProjectId();
      if (savedId) {
        // 无预加载数据（如页面刷新）→ 从 IndexedDB 完整加载
        try {
          const project = await loadProject(savedId);
          if (project) {
            setAlbumSize(project.size);
            useEditorStore.getState().setProjectName(project.name || t('home.create.unnamedAlbum'));
            // 恢复边距与间距设置
            const pm = project.margin || { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT };
            useEditorStore.getState().setPageMargin({
              top: pm.margin,
              bottom: pm.margin,
              left: pm.margin,
              right: pm.margin,
            });
            useEditorStore.getState().setSlotGap(pm.gap);

            if (project.pages.length > 0) {
              setPages(project.pages);
              useHistoryStore.getState().clear();
              useHistoryStore.getState().pushSnapshot(project.pages, null);
            } else {
              // 项目无页面：进入空状态，等待用户添加第一张页面
              setPages([]);
              useHistoryStore.getState().clear();
            }
            // 无论是否有页面都加载照片，确保“照片整理-加入相册”新建的相册
            // 也能在照片面板中看到已加入的照片（避免表现为“照片未加入成功”）。
            const savedPhotos = await loadPhotos(savedId);
            if (savedPhotos.length > 0) {
              const hasDirect = savedPhotos.some((p) => p.storageMode === 'direct');
              if (hasDirect) {
                await restoreDirectoryHandle();
              }
              let restoredCount = 0;
              let failedCount = 0;
              await Promise.all(
                savedPhotos.map(async (p) => {
                  p.albumId = savedId;
                  if (p.storageMode === 'direct') {
                    // P0-fix: 优先用 previewBlobId（1200px preview blob），避免读取原文件。
                    // P0-fix-2: 用 acquirePhotoUrl（refCount=1）pin 住 URL，防止 LRU 淘汰后被 revoke。
                    const previewId = p.previewBlobId;
                    let url: string | null = null;
                    if (previewId) {
                      url = await acquirePhotoUrl(previewId);
                    }
                    if (!url && hasDirect) {
                      url = await makeDirectPhotoUrl(p);
                    }
                    if (url) { p.src = url; restoredCount++; }
                    else { failedCount++; }
                  } else if (p.storageMode === 'import') {
                    const previewId = p.previewBlobId || p.blobId;
                    if (previewId) {
                      const url = await acquirePhotoUrl(previewId);
                      if (url) { p.src = url; restoredCount++; }
                      else { failedCount++; }
                    }
                  }
                }),
              );
              if (failedCount > 0) {
                logger.warn(`照片恢复: ${restoredCount} 张成功, ${failedCount} 张失败 (IndexedDB 数据丢失)`);
                addToast({ type: 'warning', message: t('editor.project.photosLoadFailed', { count: failedCount }) });
              }
              setPhotos(savedPhotos);
            } else {
              setPhotos([]);
            }
            addToast({ type: 'success', message: t('editor.project.opened', { name: project.name }) });
            return;
          }
        } catch {
          // 加载失败，回退到 demo
        }
      }

      // 没有已保存项目 → 创建新项目（用 demo 数据）
      const demo = getDemoProject();
      setPages(demo.pages);
      setAlbumSize(demo.size);
      useHistoryStore.getState().clear();
      useHistoryStore.getState().pushSnapshot(demo.pages, null);
      const projectId = await createAndSaveProject(t('home.create.unnamedAlbum'), demo.size, demo.pages);
      const demoPhotos = getDemoPhotos().map((p) => ({ ...p, albumId: projectId }));
      setPhotos(demoPhotos);
      await savePhotos(demoPhotos, projectId);
      addToast({ type: 'info', message: t('editor.project.created') });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 自动保存：每次 pages 或 photos 变化时调度 ──
  // 注册数据提供者，让 DB 层无需逆向依赖 store
  useEffect(() => {
    setAutoSaveProvider(() => ({
      pages: useEditorStore.getState().pages,
      photos: usePhotoStore.getState().photos,
      dirtyPhotoIds: usePhotoStore.getState().dirtyIds,
      clearDirtyPhotoIds: (ids) => usePhotoStore.getState().clearDirtyIds(ids),
    }));
    return () => setAutoSaveProvider(null);
  }, []);

  // ── 自动保存状态：连续失败时提示用户手动备份，恢复成功后自动清除 ──
  useEffect(() => {
    setAutoSaveStatusHandler((failing) => {
      setPersistWarning(
        failing ? t('editor.autosave.warning') : null,
      );
    });
    return () => {
      setAutoSaveStatusHandler(null);
      setPersistWarning(null);
    };
  }, [setPersistWarning]);

  useEffect(() => {
    if (pages.length === 0) return;
    scheduleAutoSave(2000); // 2s 防抖
  }, [pages]);

  useEffect(() => {
    if (pages.length === 0) return;
    scheduleAutoSave(2000);
  }, [photos, pages.length]);

  // ── 保存失败横幅：立即导出备份 ──
  const handleBackupNow = useCallback(async () => {
    const result = await exportBackupZip();
    addToast({
      type: result.ok ? 'success' : result.cancelled ? 'info' : 'error',
      message: result.message,
    });
  }, [addToast]);

  // ── 页面离开/返回主页时强制保存 ──
  const isEditing = !!(editFlyoutOpen && selectedSlotId);

  // 保存确认弹窗状态：点击 logo 返回主页时弹出，参考业内常用设计（Figma/Notion/VSCode）
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 实际执行保存并返回主页
  const executeSaveAndBack = useCallback(async () => {
    setIsSaving(true);
    const currentPages = useEditorStore.getState().pages;
    const currentPhotos = usePhotoStore.getState().photos;
    const albumSize = useEditorStore.getState().albumSize;
    const projectId = getCurrentProjectId();
    if (projectId) {
      try {
        const existing = await loadProject(projectId);
        if (existing) {
          await saveProject({ ...existing, pages: currentPages, size: albumSize!, updatedAt: new Date().toISOString() });
        }
        await savePhotos(currentPhotos, projectId);
      } catch (e) {
        logger.error('保存失败:', e);
      }
    }
    setIsSaving(false);
    setBackConfirmOpen(false);
    // P0: 退出编辑器前清理所有模块级缓存，释放 blob URL 和 ImageBitmap 内存。
    photoService.cleanupProjectResources();
    setPages([]);
    setPhotos([]);
    useHistoryStore.getState().clear();
    onBack?.();
  }, [onBack, setPages, setPhotos]);

  // 不保存直接返回主页（丢弃未保存的更改）
  const executeDiscardAndBack = useCallback(() => {
    setBackConfirmOpen(false);
    photoService.cleanupProjectResources();
    setPages([]);
    setPhotos([]);
    useHistoryStore.getState().clear();
    onBack?.();
  }, [onBack, setPages, setPhotos]);

  // 点击 logo → 弹出保存确认弹窗
  const handleBack = useCallback(() => {
    setBackConfirmOpen(true);
  }, []);

  // 网格视图：独立渲染，不显示编辑器 UI
  if (viewMode === 'grid') {
    return <GridView onBack={handleBack} />;
  }

  return (
    <div
      className="flex flex-col h-full relative bg-[var(--color-surface-panel)]"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-dashed border-[var(--color-primary-400)] bg-[var(--color-primary-50)]/30 pointer-events-none z-50 rounded-none" />
      )}
      <Toolbar onBack={handleBack} />
      {persistWarning && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-300/60 text-amber-800 dark:text-amber-200 text-[13px] shrink-0 z-40">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2L1.5 13.5h13L8 2z" /><path d="M8 6.5v3" /><circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
          </svg>
          <span className="flex-1">{persistWarning}</span>
          <button
            className="px-3 py-1 rounded-[var(--radius-md)] bg-amber-500 text-white text-[12px] font-[600] border-none cursor-pointer hover:bg-amber-600 transition-colors shrink-0"
            onClick={handleBackupNow}
          >
            {t('editor.autosave.backupNow')}
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-md)] bg-transparent border-none cursor-pointer text-amber-700 dark:text-amber-300 hover:bg-amber-200/60 transition-colors shrink-0"
            title={t('common.gotIt')}
            onClick={() => setPersistWarning(null)}
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧面板占满整列高度 */}
        <LeftPanel photoImport={photoImport} onNavigateToSmartLayout={onNavigateToSmartLayout} />
        {/* 右侧：画布 + 底部导航 */}
        <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 relative">
            <div className={`absolute inset-0 overflow-hidden ${isEditing ? 'z-[var(--z-overlay)]' : ''}`}>
              {pages.length === 0 ? (
                <EditorEmptyState onAddPage={() => useEditorStore.getState().addPage()} />
              ) : (
                <Canvas />
              )}
            </div>
            {/* 引导 Step 5 高亮：模拟页面区域 */}
            <div data-onboarding="canvas-page" className="absolute pointer-events-none"
              style={{ top: '12%', left: '50%', width: '44%', height: '68%', transform: 'translateX(-50%)', background: 'transparent' }} />
            <PageToolbar />
            <PageDisplayModeToggle />
            <EditFlyout />
          </div>
          <BottomNav />
        </div>
      </div>
      {showOnboarding && (
        <OnboardingTour onComplete={() => setShowOnboarding(false)} />
      )}
      <StorageModeDialog />

      {/* ── 返回主页保存确认弹窗（参考 Figma/Notion/VSCode 业内设计）── */}
      <Modal
        open={backConfirmOpen}
        onClose={() => setBackConfirmOpen(false)}
        title={t('editor.backDialog.title')}
        maxWidth="440px"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => setBackConfirmOpen(false)}
              disabled={isSaving}
              className="px-4 py-2 text-[13px] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('editor.backDialog.continue')}
            </button>
            <button
              onClick={executeDiscardAndBack}
              disabled={isSaving}
              className="px-4 py-2 text-[13px] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('editor.backDialog.discard')}
            </button>
            <button
              onClick={executeSaveAndBack}
              disabled={isSaving}
              className="px-4 py-2 text-[13px] text-white bg-[var(--color-brand)] border border-[var(--color-brand)] rounded-[var(--radius-md)] hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 min-w-[120px]"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M10 2a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  {t('editor.backDialog.saving')}
                </>
              ) : t('editor.backDialog.saveAndBack')}
            </button>
          </div>
        }
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M10 2L2.5 16.5h15L10 2z" /><path d="M10 7.5v4" /><circle cx="10" cy="13.5" r="0.7" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed pt-1.5">
            {t('editor.backDialog.message')}
          </p>
        </div>
      </Modal>
    </div>
  );
}
