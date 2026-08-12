/**
 * 截图识别工具 — 自动从照片库中识别出屏幕截图（聊天/网页/验证码截图等）
 *
 * 与真实拍摄照片分离，支持：
 * - 一键筛出截图 → 预览确认（点击缩略图查看大图）
 * - 移入回收站（Tauri folder 模式，可恢复）
 * - 加入相册（把保留的正常照片加入相册）
 * - 疑似截图独立展示，供用户复核
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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

export function ScreenshotTool({ photos, readPhotoData, addToast, onBusyChange, sourceMode, onPhotosUpdate }: ToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [scanned, setScanned] = useState(false);
  // 识别结果
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [suspects, setSuspects] = useState<ScreenshotItem[]>([]);
  const [normalPhotos, setNormalPhotos] = useState<PhotoFileInfo[]>([]);
  const [failedPhotos, setFailedPhotos] = useState(0);
  // 当前展示 Tab
  const [tab, setTab] = useState<'screenshots' | 'suspects' | 'normal'>('screenshots');
  // 加入相册
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
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
  }, [tab, screenshots, suspects, sourceMode, onPhotosUpdate, addToast, t]);

  // 加入相册：正常照片（非截图）+ 未被删除的
  const handleAddToAlbum = () => {
    if (normalPhotos.length === 0) {
      addToast({ type: 'warning', message: t('home.organize.albumBridge.selectPhotosFirst') });
      return;
    }
    setAlbumBridgeOpen(true);
  };

  // 渲染单个结果网格
  const renderGrid = (list: ScreenshotItem[], showReasons: boolean) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
      {list.map((item, idx) => (
        <div key={item.photo.id} className="relative">
          <div
            className="relative group rounded-lg border-2 border-transparent transition-all cursor-pointer hover:border-[var(--color-border)] overflow-hidden"
            title={item.photo.name}
            onClick={() => openPreview(list.map((s) => s.photo), idx)}
          >
            <ThumbImage photo={item.photo} readPhotoData={readPhotoData} size="small" />
            {/* 删除按钮：固定显示在照片右上角 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(item.photo);
              }}
              className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-red-600 transition-colors cursor-pointer border-none"
              title={t('home.organize.shared.delete')}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16" />
                <path d="M9 7V4h6v3" />
                <path d="M6 7l1 13h10l1-13" />
                <path d="M10 11v5M14 11v5" />
              </svg>
            </button>
          </div>
          {showReasons && item.reasons.length > 0 && (
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
      ))}
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
      {/* 固定“加入相册”浮动按钮（与相似/人脸识别一致） */}
      {scanned && normalPhotos.length > 0 && (
        <div className="absolute top-4 right-4 z-20">
          <AddToAlbumButton count={normalPhotos.length} onClick={handleAddToAlbum} />
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
              onClick={() => setTab('screenshots')}
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
              onClick={() => setTab('suspects')}
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
              onClick={() => setTab('normal')}
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
                {renderGrid(screenshots, true)}
              </div>
            )}
            {tab === 'suspects' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--color-gray-500)]">{t('home.organize.screenshot.suspectsDesc')}</p>
                {renderGrid(suspects, true)}
              </div>
            )}
            {tab === 'normal' && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--color-gray-500)]">{t('home.organize.screenshot.normalDesc')}</p>
                {renderGrid(normalPhotos.map((p) => ({ photo: p, confidence: 'suspect' as const, reasons: [] })), false)}
              </div>
            )}
          </div>

          {/* 批量删除操作 */}
          {(tab === 'screenshots' || tab === 'suspects') && (tab === 'screenshots' ? screenshots.length : suspects.length) > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <PrimaryButton variant="danger" onClick={handleDeleteAll}>
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
        onClose={() => setAlbumBridgeOpen(false)}
        photos={normalPhotos}
        sourceMode={sourceMode}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />
    </ToolCard>
  );
}
