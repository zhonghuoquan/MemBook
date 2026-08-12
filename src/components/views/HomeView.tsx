import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../common/Logo';
import { AppHeader } from '../common/AppHeader';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { ProjectGrid } from './../home/ProjectGrid';
import { TemplateGallery } from './../home/TemplateGallery';
import { StickerGallery } from './../home/StickerGallery';
import { OrganizePanel } from './../home/OrganizePanel';
import { CreateDialog } from './../home/CreateDialog';
import { AboutDialog } from '../common/AboutDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { HomeOnboardingTour, shouldShowHomeOnboarding } from '../editor/OnboardingTour';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { createAndSaveProject, savePhotos, loadPhotos, setCurrentProjectId } from '../../db';
import { restoreDirectoryHandle, makeDirectPhotoUrl, acquirePhotoUrl } from '../../engine/storage-engine';
import { photoService } from '../../services/photoService';

import { useLicenseStore } from '../../license';
import {
  exportAllData, importAllData, saveBackupFile, pickZipFile,
  type ExportProgress, type ExportResult, type ImportProgress, type ImportResult, type MergeMode,
} from '../../utils/dataMigration';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT, DEFAULT_SLOT_CORNER_RADIUS, findTemplateById } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { APP_VERSION } from '../../version';
import type { AlbumSize, AlbumPage, AlbumProject, PageMargin } from '../../types';
import type { HomeTab } from '../../types';
import type { ThemeMode } from '../../contexts/ThemeContext';

const NAV_SESSION_KEY = 'membook-home-nav';

interface HomeViewProps {
  onNavigateToEditor: () => void;
}

export function HomeView({ onNavigateToEditor }: HomeViewProps) {
  const { t } = useTranslation();
  const { mode, toggle } = useTheme();
  const [showCreate, setShowCreate] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [projectGridKey, setProjectGridKey] = useState(0);
  const [importDialog, setImportDialog] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; type: 'export' | 'import' | null; title: string; message: string }>({
    open: false,
    type: null,
    title: '',
    message: '',
  });
  const [progress, setProgress] = useState<{ type: 'export' | 'import'; phase: string; current: number; total: number; message?: string } | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [showHomeTour, setShowHomeTour] = useState(false);
  const [activeNav, setActiveNav] = useState<HomeTab>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_SESSION_KEY);
      if (saved === 'create' || saved === 'albums' || saved === 'templates' || saved === 'organize' || saved === 'stickers') return saved;
      // 兼容旧版本 sessionStorage 中遗留的 'projects' 值
      if (saved === 'projects') return 'albums';
    } catch { /* ignore */ }
    return 'albums';
  });

  // 持久化当前导航 Tab
  useEffect(() => {
    try { sessionStorage.setItem(NAV_SESSION_KEY, activeNav); } catch { /* ignore */ }
  }, [activeNav]);

  // 首次进入主页时弹出引导教程
  useEffect(() => {
    if (!shouldShowHomeOnboarding()) return;
    const timer = setTimeout(() => setShowHomeTour(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const setPages = useEditorStore((s) => s.setPages);
  const setAlbumSize = useEditorStore((s) => s.setAlbumSize);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const setStorageMode = useUIStore((s) => s.setStorageMode);
  const addToast = useUIStore((s) => s.addToast);
  const clearSmartLayoutState = useUIStore((s) => s.clearSmartLayoutState);
  const canCreateProject = useLicenseStore((s) => s.canCreateProject);
  const isActivated = useLicenseStore((s) => s.isActivated);
  const openLicenseDialog = useLicenseStore((s) => s.openDialog);
  const hasLicense = useLicenseStore((s) => s.hasLicense);
  const trial = useLicenseStore((s) => s.trial);
  void setStorageMode;

  // 试用期到期后自动弹出激活提示（仅弹一次）
  const [trialExpiredShown, setTrialExpiredShown] = useState(false);
  useEffect(() => {
    if (!hasLicense && !trial.isActive && !trialExpiredShown) {
      const timer = setTimeout(() => {
        openLicenseDialog(t('home.trial.expiredMessage'));
        setTrialExpiredShown(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [hasLicense, trial.isActive, trialExpiredShown, openLicenseDialog, t]);

  /** 点击导出按钮：先显示说明确认弹窗 */
  const handleExport = () => {
    setConfirmDialog({
      open: true,
      type: 'export',
      title: t('home.dataTools.exportTitle'),
      message: t('home.dataTools.exportConfirmMessage'),
    });
  };

  /** 确认后执行导出 */
  const executeExport = async () => {
    try {
      setProgress({ type: 'export', phase: 'pack', current: 0, total: 1, message: t('home.dataTools.packing') });
      const onProgress = (p: ExportProgress) => {
        setProgress({ type: 'export', phase: p.phase, current: p.current, total: p.total, message: p.message });
      };
      const { blob, warnings }: ExportResult = await exportAllData({ onProgress });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `membook-backup-${ts}.zip`;
      const saved = await saveBackupFile(blob, filename);
      if (saved.downloaded) {
        const baseMsg = saved.path ? t('home.dataTools.backupSavedTo', { path: saved.path }) : t('home.dataTools.backupDownloaded');
        addToast({
          type: warnings.length > 0 ? 'warning' : 'success',
          message: warnings.length > 0 ? `${baseMsg}（${t('home.dataTools.warningsCount', { count: warnings.length })}）` : baseMsg,
        });
        warnings.forEach((w) => addToast({ type: 'warning', message: w }));
      } else {
        addToast({ type: 'info', message: t('home.dataTools.exportCancelled') });
      }
    } catch (e) {
      addToast({ type: 'error', message: t('home.dataTools.exportFailed', { message: (e as Error).message }) });
    } finally {
      setProgress(null);
    }
  };

  /** 点击导入按钮：先显示说明确认弹窗 */
  const handleImport = () => {
    if (!isActivated) {
      openLicenseDialog(t('home.dataTools.importRequiresActivation'));
      return;
    }
    setConfirmDialog({
      open: true,
      type: 'import',
      title: t('home.dataTools.importTitle'),
      message: t('home.dataTools.importConfirmMessage'),
    });
  };

  /** 确认后选择备份文件并打开合并模式弹窗 */
  const executeImportPick = async () => {
    const file = await pickZipFile();
    if (!file) return;
    setImportDialog({ open: true, file });
  };

  /** 执行导入 */
  const executeImport = async (mergeMode: MergeMode) => {
    const file = importDialog.file;
    if (!file) return;
    setImportDialog({ open: false, file: null });
    try {
      setProgress({ type: 'import', phase: 'reading', current: 0, total: 1, message: t('home.dataTools.readingBackup') });
      const onProgress = (p: ImportProgress) => {
        setProgress({ type: 'import', phase: p.phase, current: p.current, total: p.total, message: p.message });
      };
      const blob = await file.arrayBuffer().then((buf) => new Blob([buf]));
      const result: ImportResult = await importAllData(blob, { mergeMode, onProgress });
      const parts: string[] = [];
      if (result.projects.added > 0) parts.push(t('home.dataTools.projectsAdded', { count: result.projects.added }));
      if (result.projects.overwritten > 0) parts.push(t('home.dataTools.projectsOverwritten', { count: result.projects.overwritten }));
      if (result.projects.skipped > 0) parts.push(t('home.dataTools.projectsSkipped', { count: result.projects.skipped }));
      if (result.photos.added > 0) parts.push(t('home.dataTools.photosAdded', { count: result.photos.added }));
      if (result.photos.overwritten > 0) parts.push(t('home.dataTools.photosOverwritten', { count: result.photos.overwritten }));
      if (result.photos.skipped > 0) parts.push(t('home.dataTools.photosSkipped', { count: result.photos.skipped }));
      if (result.customTemplates.added > 0) parts.push(t('home.dataTools.templatesAdded', { count: result.customTemplates.added }));
      if (result.blobs > 0) parts.push(t('home.dataTools.imagesCount', { count: result.blobs }));
      let message = parts.length > 0 ? parts.join('，') : t('home.dataTools.noChanges');
      if (result.warnings.length > 0) message += `，${t('home.dataTools.warningsCount', { count: result.warnings.length })}`;
      if (result.errors.length > 0) message += `，${t('home.dataTools.errorsCount', { count: result.errors.length })}`;
      addToast({
        type: result.errors.length > 0 ? 'warning' : 'success',
        message,
      });
      // 刷新项目列表，不强制 reload
      setProjectGridKey((k) => k + 1);
    } catch (e) {
      addToast({ type: 'error', message: t('home.dataTools.importFailed', { message: (e as Error).message }) });
    } finally {
      setProgress(null);
    }
  };

  /** 确认说明弹窗：点击确认后执行对应操作 */
  const handleConfirmAction = () => {
    const type = confirmDialog.type;
    setConfirmDialog({ open: false, type: null, title: '', message: '' });
    if (type === 'export') {
      executeExport();
    } else if (type === 'import') {
      executeImportPick();
    }
  };

  const handleCancelConfirm = () => {
    setConfirmDialog({ open: false, type: null, title: '', message: '' });
  };

  /** 处理创建相册前的权限检查 */
  const handleRequestCreate = () => {
    if (canCreateProject(projectCount)) {
      setShowCreate(true);
    } else {
      openLicenseDialog(t('home.create.projectLimit'));
    }
  };

  const handleCreateAlbum = async (
    _name: string,
    _size: AlbumSize,
    _margin: PageMargin,
    albumType?: string,
    description?: string,
    cornerRadius?: number,
  ) => {
    // P0: 新建项目前清理旧项目缓存，释放 blob URL 和 ImageBitmap 内存
    photoService.cleanupProjectResources();
    // 新相册初始不创建任何页面，进入编辑器后显示引导添加第一张页面
    setPages([]);
    // P0-fix: 重置 currentPageIndex，避免上次会话遗留的越界索引导致 Canvas 首次渲染时 currentPage 为 undefined
    useEditorStore.setState({ currentPageIndex: 0 });
    setAlbumSize(_size);
    useEditorStore.getState().setProjectName(_name || t('home.create.unnamedAlbum'));
    // 应用边距、间距与圆角设置，后续点击添加页面时会继承这些参数
    useEditorStore.getState().setPageMargin({
      top: _margin.margin,
      bottom: _margin.margin,
      left: _margin.margin,
      right: _margin.margin,
    });
    useEditorStore.getState().setSlotGap(_margin.gap);
    useEditorStore.getState().setDefaultSlotCornerRadius(cornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS);
    // 创建新相册时，"应用到全部页面"默认开启，确保后续添加的页面继承统一设置
    useEditorStore.getState().setApplyMarginToAll(true);
    const projectId = await createAndSaveProject(
      _name || t('home.create.unnamedAlbum'),
      _size,
      [],
      _margin,
      albumType as AlbumProject['albumType'],
      description,
    );
    setPhotos([]);
    await savePhotos([], projectId);
      setStorageMode(null);  // 重置存储偏好，下次导入时重新选择
      clearSmartLayoutState();
      useUIStore.getState().setCanvasZoom(1); // 新相册重置缩放为 100%
      onNavigateToEditor();
    };

  const handleCreateFromTemplate = async (
    templateId: string,
    name: string,
    size: AlbumSize,
    margin: PageMargin,
    albumType?: string,
    description?: string,
    cornerRadius?: number,
  ) => {
    if (!canCreateProject(projectCount)) {
      openLicenseDialog(t('home.create.projectLimit'));
      return;
    }
    const template = findTemplateById(templateId);
    if (!template) return;

    // P0: 从模板新建前清理旧项目缓存
    photoService.cleanupProjectResources();

    const page: AlbumPage = {
      id: `page-${Date.now()}`,
      templateId,
      placements: template.slots.map((slot) => ({
        slotId: slot.id,
        photoId: null,
      })),
      background: '#FFFFFF',
      slotCornerRadius: cornerRadius,
    };

    setPages([page]);
    setAlbumSize(size);
    useEditorStore.getState().setProjectName(name || t('home.create.unnamedAlbum'));
    useEditorStore.getState().setPageMargin({
      top: margin.margin,
      bottom: margin.margin,
      left: margin.margin,
      right: margin.margin,
    });
    useEditorStore.getState().setSlotGap(margin.gap);
    useEditorStore.getState().setDefaultSlotCornerRadius(cornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS);
    const projectId = await createAndSaveProject(
      name || t('home.create.unnamedAlbum'),
      size,
      [page],
      margin,
      albumType as AlbumProject['albumType'],
      description,
    );
    setPhotos([]);
    await savePhotos([], projectId);
      setStorageMode(null);  // 重置存储偏好，下次导入时重新选择
      clearSmartLayoutState();
      useUIStore.getState().setCanvasZoom(1); // 新相册重置缩放为 100%
      onNavigateToEditor();
    };

  const handleOpenProject = async (project: AlbumProject) => {
    // P0: 打开项目前清理旧项目缓存，释放 blob URL 和 ImageBitmap 内存
    photoService.cleanupProjectResources();
    setAlbumSize(project.size);
    useEditorStore.getState().setProjectName(project.name || t('home.create.unnamedAlbum'));
    setCurrentProjectId(project.id);

    // 恢复项目的边距与间距设置，确保空状态预览和新增页面继承原设置
    const pm = project.margin || { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT };
    useEditorStore.getState().setPageMargin({
      top: pm.margin,
      bottom: pm.margin,
      left: pm.margin,
      right: pm.margin,
    });
    useEditorStore.getState().setSlotGap(pm.gap);

    if (project.pages && project.pages.length > 0) {
      setPages(project.pages);
    } else {
      // 项目没有任何页面时进入编辑器空状态，由用户点击添加第一张页面
      setPages([]);
      // P0-fix: 重置 currentPageIndex，避免越界索引导致 Canvas 首次渲染 hook 数量不一致（React #310）
      useEditorStore.setState({ currentPageIndex: 0 });
    }

    // 加载当前项目的照片（修复首次进入编辑器照片不显示的 bug）
    // 注意：必须无页面（如“照片整理-加入相册”新建的相册，尚无页面）也加载照片，
    // 否则通过整理工具加入相册的照片在相册中看不到（表现为“照片未加入成功”）。
    const savedPhotos = await loadPhotos(project.id);
    if (savedPhotos.length > 0) {
      const hasDirect = savedPhotos.some((p) => p.storageMode === 'direct');
      if (hasDirect) {
        await restoreDirectoryHandle();
      }
      await Promise.all(
        savedPhotos.map(async (p) => {
          // 确保运行时 albumId 与当前项目一致
          p.albumId = project.id;
          if (p.storageMode === 'direct') {
            // P0-fix: 优先用 previewBlobId（1200px preview blob），避免读取原文件。
            // P0-fix-2: 用 acquirePhotoUrl（refCount=1）替代 readPhotoFromDB（refCount=0），
            //   pin 住 URL 防止 LRU 淘汰后被 revoke，彻底解决第一页偶现空白问题。
            //   退出编辑器时 cleanupProjectResources → revokeAllBlobUrls 会强制释放。
            const previewId = p.previewBlobId;
            let url: string | null = null;
            if (previewId) {
              url = await acquirePhotoUrl(previewId);
            }
            if (!url && hasDirect) {
              url = await makeDirectPhotoUrl(p);
            }
            if (url) p.src = url;
          } else if (p.storageMode === 'import') {
            const previewId = p.previewBlobId || p.blobId;
            if (previewId) {
              const url = await acquirePhotoUrl(previewId);
              if (url) p.src = url;
            }
          }
        }),
      );
      setPhotos(savedPhotos);
    } else {
      setPhotos([]);
    }
    clearSmartLayoutState();
    useUIStore.getState().setCanvasZoom(1); // 进入编辑器时重置缩放为 100%
    onNavigateToEditor();
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Top Header Bar (custom title bar + app nav) ── */}
      <AppHeader height="home">
        {/* Logo + Product Name */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] bg-white/60 shadow-[var(--shadow-xs)] backdrop-blur-sm">
            <Logo className="w-7 h-7" />
          </div>
          <span
            className="text-[1.5rem] font-[700] text-[var(--color-gray-800)] tracking-tight"
            style={{ fontFamily: "'Quicksand', sans-serif" }}
          >
            MemBook
          </span>
        </div>

        <div className="flex-1" />

        {/* 试用期倒计时 / 激活入口（仅未激活时显示） */}
        {!hasLicense && (trial.isActive ? (
          /* 试用期内：显示倒计时 */
          <button
            type="button"
            onClick={() => openLicenseDialog(t('home.trial.activeHint'))}
            className="mr-3 px-3 h-8 rounded-full text-[12px] font-[600] flex items-center gap-1.5
                       bg-[var(--color-warning-light)] text-[var(--color-warning-dark)]
                       border border-[var(--color-warning-border)]
                       hover:bg-[var(--color-warning)] hover:text-white transition-all
                       cursor-pointer"
            data-tauri-drag-region="false"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('home.trial.remainingDays', { days: trial.remainingDays })}
          </button>
        ) : (
          /* 试用期已过：显示醒目的激活按钮 */
          <button
            type="button"
            onClick={() => openLicenseDialog(t('home.trial.expiredMessage'))}
            className="mr-3 px-3.5 h-8 rounded-full text-[12px] font-[600] text-white
                       bg-[var(--color-error)] hover:opacity-90
                       shadow-[0_2px_8px_rgba(239,68,68,0.3)] transition-all
                       border-none cursor-pointer flex items-center gap-1.5 animate-pulse"
            data-tauri-drag-region="false"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <circle cx="6" cy="8" r="3" />
              <path d="M8.5 5.5l4.5-4.5" />
              <path d="M12 2l1 1" />
            </svg>
            {t('home.trial.expired')}
          </button>
        ))}

        {/* 语言切换 */}
        <LanguageSwitcher compact className="mr-1" />

        {/* 数据迁移工具 */}
        <div className="flex items-center gap-1 mr-2" data-no-drag data-onboarding="home-data-tools">
          <IconBtn onClick={handleImport} label={t('home.dataTools.restoreFromBackup')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M10 3v10m0 0l-3-3m3 3l3-3" />
              <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
            </svg>
          </IconBtn>
          <IconBtn onClick={handleExport} label={t('home.dataTools.exportBackup')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M10 13V3m0 0L7 6m3-3l3 3" />
              <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
            </svg>
          </IconBtn>
          <IconBtn onClick={() => setShowAbout(true)} label={t('home.dataTools.aboutApp', { version: APP_VERSION })}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <circle cx="10" cy="10" r="7" />
              <line x1="10" y1="8" x2="10" y2="13" />
              <circle cx="10" cy="6" r="0.6" fill="currentColor" />
            </svg>
          </IconBtn>
        </div>
      </AppHeader>

      {/* ── Body: Nav + Content ── */}
      <div className="flex flex-1 overflow-hidden bg-[var(--color-surface-panel)]">
        <nav className="w-[var(--layout-nav-width)] bg-[image:var(--gradient-sidebar)]
                        flex flex-col items-center py-4 gap-2 shrink-0"
             data-no-drag
             data-onboarding="home-nav">
          <HomeNavItem active={activeNav === 'albums'} label={t('home.nav.albums')} onClick={() => setActiveNav('albums')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="11" y="3" width="6" height="6" rx="1" />
              <rect x="3" y="11" width="6" height="6" rx="1" />
              <rect x="11" y="11" width="6" height="6" rx="1" />
            </svg>
          </HomeNavItem>
          <HomeNavItem active={activeNav === 'templates'} label={t('home.nav.templates')} onClick={() => setActiveNav('templates')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <rect x="5" y="5" width="10" height="10" rx="1" />
              <line x1="5" y1="9" x2="15" y2="9" />
              <line x1="10" y1="5" x2="10" y2="15" />
            </svg>
          </HomeNavItem>
          <HomeNavItem active={activeNav === 'stickers'} label={t('home.nav.stickers')} onClick={() => setActiveNav('stickers')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M14.5 2.5l3 3a1.5 1.5 0 0 1 0 2.1l-9.9 9.9a1.5 1.5 0 0 1-1 .4H4a1.5 1.5 0 0 1-1.5-1.5v-2.6a1.5 1.5 0 0 1 .4-1l9.9-9.9a1.5 1.5 0 0 1 2.1 0z" />
              <path d="M12 5l3 3" />
              <circle cx="15" cy="14" r="3" />
            </svg>
          </HomeNavItem>
          <HomeNavItem active={activeNav === 'organize'} label={t('home.nav.organize')} onClick={() => setActiveNav('organize')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M3 6l3-3 8 8-3 3z" />
              <path d="M14 17l5-5" />
              <path d="M6 3l11 11" />
            </svg>
          </HomeNavItem>

          {/* 推到导航底部 */}
          <div className="flex-1" />

          {/* 主题切换按钮 */}
          <button
            onClick={toggle}
            title={mode === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
            data-tauri-drag-region="false"
            className="flex flex-col items-center justify-center w-12 py-2.5 px-1.5
                       border-none rounded-[var(--radius-lg)] cursor-pointer select-none
                       text-[var(--color-gray-500)] text-[var(--text-nano)] font-[600]
                       bg-transparent hover:bg-white/60 hover:text-[var(--color-gray-700)]
                       transition-all duration-200 mb-1 hover:scale-[1.03]"
          >
            <ThemeIcon mode={mode} className="w-5 h-5" />
            <span className="mt-1 text-[10px]">
              {mode === 'light' ? t('theme.light') : t('theme.dark')}
            </span>
          </button>
        </nav>

        {/* Content — 白色卡片容器 */}
        <div className="flex-1 p-3 min-w-0">
          <div className="h-full w-full bg-[image:var(--gradient-surface)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-soft)] overflow-hidden">
            {activeNav === 'albums' && (
              <ProjectGrid
                key={projectGridKey}
                onOpenProject={handleOpenProject}
                onCreateNew={handleRequestCreate}
                onProjectCountChange={setProjectCount}
              />
            )}
            {activeNav === 'templates' && (
              <TemplateGallery onCreateFromTemplate={handleCreateFromTemplate} />
            )}
            {activeNav === 'stickers' && (
              <StickerGallery />
            )}
            {/* 整理面板始终挂载，仅用 CSS 隐藏，避免切换 Tab 时丢失已选文件夹路径 */}
            <div className={activeNav === 'organize' ? 'h-full' : 'hidden'}>
              <OrganizePanel active={activeNav === 'organize'} />
            </div>
          </div>
        </div>
      </div>

      <CreateDialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setActiveNav('albums'); }}
        onCreate={handleCreateAlbum}
      />

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />

      {/* 导出/导入前说明确认弹窗 */}
      <Modal
        open={confirmDialog.open}
        onClose={handleCancelConfirm}
        title={confirmDialog.title}
        maxWidth="480px"
        footer={
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={handleCancelConfirm}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleConfirmAction}>{t('common.confirm')}</Button>
          </div>
        }
      >
        <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
          {confirmDialog.message}
        </p>
      </Modal>

      {/* 导入策略选择弹窗 */}
      {importDialog.open && importDialog.file && (
        <ImportConfirmDialog
          fileName={importDialog.file.name}
          onCancel={() => setImportDialog({ open: false, file: null })}
          onConfirm={executeImport}
        />
      )}

      {/* 导入/导出进度遮罩 */}
      {progress && (
        <OperationProgressOverlay
          title={progress.type === 'export' ? t('home.dataTools.exporting') : t('home.dataTools.importing')}
          message={progress.message || (progress.type === 'export' ? t('home.dataTools.packing') : t('home.dataTools.restoring'))}
          current={progress.current}
          total={progress.total}
        />
      )}

      {/* 主页首次使用引导 */}
      {showHomeTour && (
        <HomeOnboardingTour onComplete={() => setShowHomeTour(false)} />
      )}

    </div>
  );
}

function ImportConfirmDialog({
  fileName,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  onCancel: () => void;
  onConfirm: (mode: MergeMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] p-6 max-w-md w-full mx-4 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[var(--color-brand-bg)] flex items-center justify-center shrink-0">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                   className="w-5 h-5 text-[var(--color-brand)]">
                <path d="M10 3v10m0 0l-3-3m3 3l3-3" />
                <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)]">
                {t('home.dataTools.restoreTitle')}
              </h3>
              <p className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] mt-1">
                {t('home.dataTools.fileLabel', { fileName })}
              </p>
              <p className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] mt-1">
                {t('home.dataTools.chooseStrategy')}
              </p>
              <ul className="mt-2 space-y-1 text-[var(--text-body-sm)] text-[var(--color-gray-700)]">
                <li>· <b>{t('home.dataTools.skip')}</b>：{t('home.dataTools.strategySkip')}</li>
                <li>· <b>{t('home.dataTools.overwrite')}</b>：{t('home.dataTools.strategyOverwrite')}</li>
                <li>· <b>{t('home.dataTools.rename')}</b>：{t('home.dataTools.strategyRename')}</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)]
                         bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                         hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-white
                         bg-[var(--color-brand)] rounded-[var(--radius-md)]
                         hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => onConfirm('skip')}
            >
              {t('home.dataTools.skip')}
            </button>
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-white
                         bg-[var(--color-brand)] rounded-[var(--radius-md)]
                         hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => onConfirm('overwrite')}
            >
              {t('home.dataTools.overwrite')}
            </button>
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-white
                         bg-[var(--color-brand)] rounded-[var(--radius-md)]
                         hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => onConfirm('rename')}
            >
              {t('home.dataTools.rename')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── 导入/导出进度遮罩 ── */
function OperationProgressOverlay({
  title,
  message,
  current,
  total,
}: {
  title: string;
  message: string;
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] p-6 w-[min(420px,90vw)] pointer-events-auto">
        <h3 className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)] mb-1">{title}</h3>
        <p className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] mb-4">{message}</p>
        <div className="h-2 w-full bg-[var(--color-gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-brand)] transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-right text-[var(--text-nano)] text-[var(--color-gray-500)] mt-2">{pct}%</p>
      </div>
    </div>
  );
}

function HomeNavItem({
  active = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-tauri-drag-region="false"
      className={`
        flex flex-col items-center justify-center w-[52px] py-2.5 px-1.5 mx-1
        border-none rounded-[var(--radius-xl)] cursor-pointer select-none
        text-[var(--text-nano)] font-[600]
        transition-all duration-200
        ${active
          ? 'bg-white text-[var(--color-brand)] shadow-[var(--shadow-md)]'
          : 'bg-transparent text-[var(--color-gray-500)]'
        }
        hover:scale-[1.05]
        ${active ? '' : 'hover:bg-white/50 hover:text-[var(--color-gray-700)]'}
      `}
      onClick={onClick}
    >
      {children}
      <span className="mt-1">{label}</span>
    </button>
  );
}

/* ── Header icon button ── */
function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
    type="button"
    title={label}
    onClick={onClick}
    data-tauri-drag-region="false"
    className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)]
               text-[var(--color-gray-600)] bg-white/40
               hover:bg-white/80 hover:text-[var(--color-brand)]
               transition-all duration-150 border-none cursor-pointer backdrop-blur-sm"
  >
    {children}
  </button>
  );
}

/* ── 主题图标组件 ── */
function ThemeIcon({ mode, className }: { mode: ThemeMode; className?: string }) {
  if (mode === 'light') {
    // 太阳图标
    return (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
        <circle cx="10" cy="10" r="3.5" />
        <line x1="10" y1="2" x2="10" y2="4" />
        <line x1="10" y1="16" x2="10" y2="18" />
        <line x1="2" y1="10" x2="4" y2="10" />
        <line x1="16" y1="10" x2="18" y2="10" />
        <line x1="3.5" y1="3.5" x2="5" y2="5" />
        <line x1="15" y1="15" x2="16.5" y2="16.5" />
        <line x1="3.5" y1="16.5" x2="5" y2="15" />
        <line x1="15" y1="5" x2="16.5" y2="3.5" />
      </svg>
    );
  }
  // 月亮图标（dark / fallback）
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M16.5 12.5A6.5 6.5 0 0 1 7.5 3.5a6.5 6.5 0 1 0 9 9z" />
    </svg>
  );
}
