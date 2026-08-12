/**
 * 截图识别工具 — 自动从照片库中识别出屏幕截图（聊天/网页/验证码截图等）
 *
 * 与真实拍摄照片分离，支持：
 * - 一键筛出截图 → 点击缩略图查看大图
 * - 缩略图左上角勾选 → 批量加入相册 / 批量删除
 * - 缩略图右上角删除按钮 → 单张快速删除（去掉三点菜单，缩短操作路径）
 * - 加入相册（把保留的正常照片加入相册）
 * - 疑似截图独立展示，供用户复核
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  detectScreenshots,
  type PhotoFileInfo,
  type ScreenshotItem,
  type ToolProgress,
} from '../../../photo-tools';
import {
  ToolCard,
  ProgressBar,
  PrimaryButton,
  AddToAlbumButton,
  ThumbImage,
  deletePhotos,
  useTabCachedResult,
  type ToolProps,
} from './shared';
import { PhotoQuickView } from './PhotoQuickView';
import { AlbumBridgeDialog } from './AlbumBridgeDialog';

/** 判定依据信号 → i18n key 后缀 */
const SIGNAL_KEY: Record<string, string> = {
  filename: 'filename',
  noCamera: 'noCamera',
  software: 'software',
  screenRes: 'screenRes',
  screenRatio: 'screenRatio',
  pngNoExif: 'pngNoExif',
};

interface ScreenshotToolProps extends ToolProps {
  /** “一键分析”触发令牌（递增触发一次自动运行） */
  autoRunToken?: number;
  /** 当前是否为“一键分析”的目标工具（仅目标工具自动运行） */
  isAutoRunTarget?: boolean;
}

export function ScreenshotTool({
  photos, readPhotoData, addToast, onBusyChange, sourceMode, onPhotosUpdate, tabId,
  autoRunToken, isAutoRunTarget,
}: ScreenshotToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 识别结果按标签缓存，切换路径时保留各路径的截图识别结果
  const [scanned, setScanned] = useTabCachedResult<boolean>(tabId, false);
  // 识别结果
  const [screenshots, setScreenshots] = useTabCachedResult<ScreenshotItem[]>(tabId, []);
  const [suspects, setSuspects] = useTabCachedResult<ScreenshotItem[]>(tabId, []);
  const [normalPhotos, setNormalPhotos] = useTabCachedResult<PhotoFileInfo[]>(tabId, []);
  const [failedPhotos, setFailedPhotos] = useTabCachedResult<number>(tabId, 0);
  // 当前展示 Tab
  const [tab, setTab] = useState<'screenshots' | 'suspects' | 'normal'>('screenshots');
  // 多选（勾选）的照片 ID
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 加入相册
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
  // 加入相册的目标照片
  const [albumTarget, setAlbumTarget] = useState<PhotoFileInfo[]>([]);
  // 大图预览
  const [previewList, setPreviewList] = useState<PhotoFileInfo[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // 通知父组件工具执行状态
  const busy = running;
  useEffect(() => {
    onBusyChange?.('screenshot', busy);
    return () => { onBusyChange?.('screenshot', false); };
  }, [busy, onBusyChange]);

  /** 开始识别截图 */
  const handleStart = async () => {
    if (photos.length === 0) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setScanned(false);
    setScreenshots([]);
    setSuspects([]);
    setNormalPhotos([]);
    setFailedPhotos(0);
    setSelectedIds(new Set());

    try {
      const res = await detectScreenshots(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
        readData: readPhotoData,
      });
      setScreenshots(res.screenshots);
      setSuspects(res.suspects);
      setNormalPhotos(res.normalPhotos);
      setFailedPhotos(res.failedPhotos);
      setScanned(true);
      setTab(res.screenshots.length > 0 ? 'screenshots' : res.suspects.length > 0 ? 'suspects' : 'normal');

      if (res.screenshots.length > 0) {
        addToast({
          type: 'info',
          message: t('home.organize.screenshot.toastFound', { count: res.screenshots.length }),
        });
      } else {
        addToast({ type: 'success', message: t('home.organize.screenshot.toastNoResult') });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast({ type: 'error', message: t('home.organize.screenshot.toastFailed', { message: (err as Error).message }) });
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  // “一键分析”自动触发：仅当本工具是当前分析目标且令牌变化时，自动开始识别
  const prevToken = useRef(0);
  useEffect(() => {
    if (isAutoRunTarget && autoRunToken && autoRunToken !== prevToken.current) {
      prevToken.current = autoRunToken;
      if (!running && photos.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void handleStart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken, isAutoRunTarget]);

  // 大图预览
  const openPreview = useCallback((list: PhotoFileInfo[], idx: number) => {
    setPreviewList(list);
    setPreviewIndex(idx);
  }, []);
  const closePreview = useCallback(() => setPreviewList([]), []);

  // 删除单张截图（统一入口）
  const handleDelete = useCallback(
    (photo: PhotoFileInfo) => {
      void deletePhotos([photo], sourceMode, onPhotosUpdate, addToast, t);
      // 从结果中移除
      setScreenshots((prev) => prev.filter((s) => s.photo.id !== photo.id));
      setSuspects((prev) => prev.filter((s) => s.photo.id !== photo.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
    },
    [sourceMode, onPhotosUpdate, addToast, t],
  );

  // 删除当前 tab 下所有照片
  const handleDeleteAll = useCallback(() => {
    const list = tab === 'screenshots' ? screenshots : suspects;
    if (list.length === 0) return;
    const targets = list.map((s) => s.photo);
    void deletePhotos(targets, sourceMode, onPhotosUpdate, addToast, t);
    const ids = new Set(targets.map((p) => p.id));
    setScreenshots((prev) => prev.filter((s) => !ids.has(s.photo.id)));
    setSuspects((prev) => prev.filter((s) => !ids.has(s.photo.id)));
    setSelectedIds(new Set());
  }, [tab, screenshots, suspects, sourceMode, onPhotosUpdate, addToast, t]);

  // 勾选/取消勾选
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 当前 Tab 下的结果列表
  const currentList = useMemo<ScreenshotItem[]>(() => {
    if (tab === 'screenshots') return screenshots;
    if (tab === 'suspects') return suspects;
    return [];
  }, [tab, screenshots, suspects]);

  // 删除选中照片
  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const targets = currentList
      .filter((s) => selectedIds.has(s.photo.id))
      .map((s) => s.photo);
    if (targets.length === 0) return;
    void deletePhotos(targets, sourceMode, onPhotosUpdate, addToast, t);
    const ids = new Set(targets.map((p) => p.id));
    setScreenshots((prev) => prev.filter((s) => !ids.has(s.photo.id)));
    setSuspects((prev) => prev.filter((s) => !ids.has(s.photo.id)));
    setSelectedIds(new Set());
  }, [selectedIds, currentList, sourceMode, onPhotosUpdate, addToast, t]);

  // 加入相册：选中的照片（勾选）
  const handleAddSelectedToAlbum = useCallback(() => {
    if (selectedIds.size === 0) return;
    const targets = currentList
      .filter((s) => selectedIds.has(s.photo.id))
      .map((s) => s.photo);
    if (targets.length === 0) return;
    setAlbumTarget(targets);
    setAlbumBridgeOpen(true);
  }, [selectedIds, currentList]);

  // 加入相册：正常照片（非截图）
  const handleAddNormalToAlbum = () => {
    if (normalPhotos.length === 0) {
      addToast({ type: 'warning', message: t('home.organize.albumBridge.selectPhotosFirst') });
      return;
    }
    setAlbumTarget(normalPhotos);
    setAlbumBridgeOpen(true);
  };

  // 切换 Tab 时清空勾选
  const switchTab = (next: 'screenshots' | 'suspects' | 'normal') => {
    setTab(next);
    setSelectedIds(new Set());
  };

  // 渲染单个缩略图（带左上角勾选 + 删除按钮，点击查看大图）
  const renderThumb = (item: ScreenshotItem, list: ScreenshotItem[], idx: number) => {
    const photo = item.photo;
    const isSelected = selectedIds.has(photo.id);
    return (
      <div key={photo.id} className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => openPreview(list.map((s) => s.photo), idx)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openPreview(list.map((s) => s.photo), idx); }}
          className={`relative rounded-lg overflow-hidden group cursor-zoom-in border-2 transition-all ${
            isSelected ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]' : 'border-transparent hover:border-[var(--color-border)]'
          }`}
          title={photo.name}
        >
          <ThumbImage photo={photo} readPhotoData={readPhotoData} size="medium" />

          {/* 左上角：勾选按钮 */}
          <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
            {/* 勾选添加/删除 */}
            <span
              role="checkbox"
              aria-checked={isSelected}
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); toggleSelect(photo.id); }}
              className={`w-5 h-5 flex items-center justify-center rounded-full border-2 transition-all cursor-pointer shadow-sm ${
                isSelected
                  ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white'
                  : 'bg-white/80 border-[var(--color-gray-300)] text-transparent hover:border-[var(--color-brand)]'
              }`}
              title={t('home.organize.screenshot.selectForAlbum', { defaultValue: '勾选：加入相册或删除' })}
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M2 6l3 3 5-6" />
              </svg>
            </span>
          </div>

          {/* 右上角：单张删除（替代原三点菜单） */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(t('home.organize.shared.deleteConfirm', { name: photo.name }))) {
                handleDelete(photo);
              }
            }}
            className="absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500/90 transition-all cursor-pointer border-none"
            title={t('home.organize.shared.delete')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
              <path d="M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>

        {/* 判定依据信号标签 */}
        {item.reasons.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.reasons.slice(0, 3).map((r) => (
              <span
                key={r}
                className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-brand-bg)] text-[var(--color-brand)] font-[500]"
              >
                {t(`home.organize.screenshot.signal.${SIGNAL_KEY[r] ?? r}`)}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 渲染普通照片缩略图（点击查看大图 + 单张删除）
  const renderNormalThumb = (photo: PhotoFileInfo, list: PhotoFileInfo[], idx: number) => {
    return (
      <div key={photo.id} className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => openPreview(list, idx)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openPreview(list, idx); }}
          className="relative rounded-lg overflow-hidden group cursor-zoom-in border-2 border-transparent hover:border-[var(--color-border)] transition-all"
          title={photo.name}
        >
          <ThumbImage photo={photo} readPhotoData={readPhotoData} size="medium" />
          {/* 单张删除（右上角） */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(t('home.organize.shared.deleteConfirm', { name: photo.name }))) {
                void deletePhotos([photo], sourceMode, onPhotosUpdate, addToast, t);
                setNormalPhotos((prev) => prev.filter((p) => p.id !== photo.id));
              }
            }}
            className="absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500/90 transition-all cursor-pointer border-none"
            title={t('home.organize.shared.delete')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
              <path d="M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // 渲染结果网格
  const renderGrid = (list: ScreenshotItem[]) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
      {list.map((item, idx) => renderThumb(item, list, idx))}
    </div>
  );

  return (
    <ToolCard
      title={t('home.organize.screenshot.title')}
      description={t('home.organize.screenshot.description')}
      color="teal"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <rect x="3" y="3" width="14" height="11" rx="1.5" />
          <path d="M7 18h6" />
          <path d="M10 14v4" />
          <path d="M8 6.5a2 2 0 104 0" />
          <path d="M8 9.5h4" />
        </svg>
      }
    >
      {/* 固定“加入相册”浮动按钮（把保留的正常照片加入相册，与相似/人脸识别一致） */}
      {scanned && tab === 'normal' && normalPhotos.length > 0 && (
        <div className="absolute top-4 right-4 z-20">
          <AddToAlbumButton count={normalPhotos.length} onClick={handleAddNormalToAlbum} />
        </div>
      )}

      {/* 识别操作区 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--color-text-secondary)]">
          {t('home.organize.screenshot.detectHint', { total: photos.length })}
        </span>
        {!running && (
          <PrimaryButton onClick={handleStart} disabled={photos.length === 0}>
            {scanned ? t('home.organize.screenshot.rescan') : t('home.organize.screenshot.startScan')}
          </PrimaryButton>
        )}
      </div>

      {/* 进度条 + 取消 */}
      {running && (
        <div className="mt-3">
          <ProgressBar progress={progress} onCancel={handleCancel} cancelLabel={t('home.organize.screenshot.cancel')} />
        </div>
      )}

      {/* 无结果提示 */}
      {scanned && screenshots.length === 0 && suspects.length === 0 && !running && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">
          {t('home.organize.screenshot.noResult')}
        </div>
      )}

      {/* 统计 + Tab 切换 + 批量操作 */}
      {scanned && (screenshots.length > 0 || suspects.length > 0) && !running && (
        <div className="mt-3">
          {/* Tab 切换 */}
          <div className="flex items-center gap-1 mb-3">
            <button
              type="button"
              onClick={() => switchTab('screenshots')}
              className={`px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer transition-all border-none ${
                tab === 'screenshots'
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-200)]'
              }`}
            >
              {t('home.organize.screenshot.tabScreenshots', { count: screenshots.length })}
            </button>
            <button
              type="button"
              onClick={() => switchTab('suspects')}
              className={`px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer transition-all border-none ${
                tab === 'suspects'
                  ? 'bg-[#C99A24] text-white'
                  : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-200)]'
              }`}
            >
              {t('home.organize.screenshot.tabSuspects', { count: suspects.length })}
            </button>
            <button
              type="button"
              onClick={() => switchTab('normal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer transition-all border-none ${
                tab === 'normal'
                  ? 'bg-green-600 text-white'
                  : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-200)]'
              }`}
            >
              {t('home.organize.screenshot.tabNormal', { count: normalPhotos.length })}
            </button>
          </div>

          {/* 结果网格 */}
          <div className="max-h-[520px] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
            {tab === 'screenshots' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--color-gray-500)]">{t('home.organize.screenshot.screenshotsDesc')}</p>
                {renderGrid(screenshots)}
              </div>
            )}
            {tab === 'suspects' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--color-gray-500)]">{t('home.organize.screenshot.suspectsDesc')}</p>
                {renderGrid(suspects)}
              </div>
            )}
            {tab === 'normal' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--color-gray-500)]">{t('home.organize.screenshot.normalDesc')}</p>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                  {normalPhotos.map((p, idx) => renderNormalThumb(p, normalPhotos, idx))}
                </div>
              </div>
            )}
          </div>

          {/* 勾选后的批量操作条 */}
          {selectedIds.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--color-gray-600)]">
                {t('home.organize.screenshot.selectedCount', { count: selectedIds.size, defaultValue: '已选 {{count}} 张' })}
              </span>
              <PrimaryButton onClick={handleAddSelectedToAlbum}>
                {t('home.organize.albumBridge.buttonLabel', { defaultValue: '加入相册' })}
              </PrimaryButton>
              <PrimaryButton variant="danger" onClick={handleDeleteSelected}>
                {t('home.organize.screenshot.deleteSelected', { count: selectedIds.size, defaultValue: '删除选中 ({{count}})' })}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] bg-transparent border-none cursor-pointer"
              >
                {t('home.organize.screenshot.clearSelection', { defaultValue: '取消选择' })}
              </button>
            </div>
          )}

          {/* 批量删除操作（未勾选时整组删除入口） */}
          {selectedIds.size === 0 && (tab === 'screenshots' || tab === 'suspects') && (tab === 'screenshots' ? screenshots.length : suspects.length) > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <PrimaryButton variant="danger" onClick={() => handleDeleteAll()}>
                {t('home.organize.screenshot.deleteAll', { count: tab === 'screenshots' ? screenshots.length : suspects.length })}
              </PrimaryButton>
              <span className="text-xs text-[var(--color-text-secondary)]">{t('home.organize.screenshot.deleteHint')}</span>
            </div>
          )}
        </div>
      )}

      {/* 失败提示 */}
      {scanned && failedPhotos > 0 && (
        <div className="mt-2 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs">
          {t('home.organize.screenshot.failedHint', { count: failedPhotos })}
        </div>
      )}

      {/* 大图预览 */}
      {previewList.length > 0 && (
        <PhotoQuickView
          photos={previewList}
          initialIndex={previewIndex}
          onClose={closePreview}
          readPhotoData={readPhotoData}
        />
      )}

      {/* 加入相册对话框 */}
      <AlbumBridgeDialog
        open={albumBridgeOpen}
        onClose={() => { setAlbumBridgeOpen(false); setAlbumTarget([]); }}
        photos={albumTarget}
        sourceMode={sourceMode}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />
    </ToolCard>
  );
}
