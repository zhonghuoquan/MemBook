/**
 * 按时间归类工具 — 按 EXIF/文件名时间整理到 MemBook照片整理/年/月 目录
 * 仅 Tauri + 文件夹模式可用（需真实文件系统移动文件）
 *
 * 时间解析优先级：EXIF 拍摄日期 → 文件名解析 →（可选）文件修改日期
 * 支持：排除已整理文件、按格式排除、执行后自动重新扫描
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  previewOrganize,
  executeOrganize,
  type PhotoFileInfo,
  type OrganizePreviewItem,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, countByExt, type ToolProps } from './shared';
import { logger } from '../../../utils/logger';

export function OrganizeTool({ photos, rootPath, sourceMode, readPhotoData, addToast, onRescan, onBusyChange }: ToolProps) {
  const { t } = useTranslation();
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [items, setItems] = useState<OrganizePreviewItem[]>([]);
  const [noDatePhotos, setNoDatePhotos] = useState<PhotoFileInfo[]>([]);
  const [useFileDate, setUseFileDate] = useState(false);
  const [excludeSorted, setExcludeSorted] = useState(true);
  const [excludedExts, setExcludedExts] = useState<Set<string>>(new Set());

  // 通知父组件工具执行状态（previewing/executing），用于禁用标签切换
  const busy = previewing || executing;
  useEffect(() => {
    onBusyChange?.('organize', busy);
    return () => { onBusyChange?.('organize', false); };
  }, [busy, onBusyChange]);

  const canUse = isTauri() && !!rootPath && sourceMode === 'folder';

  // 所有格式列表
  const allExts = useMemo(() => {
    const set = new Set(photos.map((p) => p.ext));
    return [...set].sort();
  }, [photos]);

  // photos 变化时清除旧结果
  useEffect(() => {
    setItems([]);
    setProgress(null);
    setNoDatePhotos([]);
  }, [photos]);

  const toggleExt = (ext: string) => {
    setExcludedExts((prev) => {
      const next = new Set(prev);
      next.has(ext) ? next.delete(ext) : next.add(ext);
      return next;
    });
  };

  /** 通过 Tauri stat 获取文件修改日期 */
  const getFileDate = useCallback(async (photo: PhotoFileInfo): Promise<Date | null> => {
    if (!photo.path) return null;
    try {
      const { stat } = await import('@tauri-apps/plugin-fs');
      const s = await stat(photo.path);
      const mtime = s.mtime;
      if (mtime == null) return null;
      const ms = typeof mtime === 'number' ? (mtime > 1e12 ? mtime : mtime * 1000) : mtime.getTime();
      return new Date(ms);
    } catch (err) {
      logger.warn('[organize] 获取文件修改日期失败:', photo.path, err);
      return null;
    }
  }, []);

  const handlePreview = async () => {
    setPreviewing(true);
    setItems([]);
    const photosToOrganize = photos.filter((p) => !excludedExts.has(p.ext));
    try {
      const result = await previewOrganize(photosToOrganize, {
        readData: readPhotoData,
        useFileDate,
        excludeSorted,
        getFileDate: useFileDate ? getFileDate : undefined,
        onProgress: setProgress,
      });
      setItems(result);
      // 将移动的文件（move / rename 均会实际移动）
      const movedItems = result.filter((i) => i.conflictAction === 'move' || i.conflictAction === 'rename');
      // 已就位的文件（无需移动）
      const alreadyCount = result.filter((i) => i.conflictAction === 'skip').length;
      // 精确计算无法识别拍摄日期的文件（排除已归类 + 无结果者）
      const resultSet = new Set(result.map((i) => i.sourcePath));
      const excludedSet = new Set(
        photosToOrganize
          .filter((p) => {
            const rel = (p.relativePath || p.path || '').replace(/\\/g, '/');
            return rel.startsWith('MemBook照片整理/') || rel.includes('/MemBook照片整理/');
          })
          .map((p) => p.path || p.name),
      );
      const noDate = photosToOrganize.filter(
        (p) => !resultSet.has(p.path || p.name) && !excludedSet.has(p.path || p.name),
      );
      setNoDatePhotos(noDate);

      // 构建提示
      const parts: string[] = [t('home.organize.organize.toastPreviewMoved', { count: movedItems.length })];
      if (alreadyCount > 0) parts.push(t('home.organize.organize.toastPreviewAlready', { count: alreadyCount }));
      if (noDate.length > 0) parts.push(t('home.organize.organize.toastPreviewNoDate', { count: noDate.length }));
      addToast({ type: 'info', message: parts.join(t('home.organize.organize.toastSeparator')) });
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.organize.toastPreviewFailed', { message: (err as Error).message }) });
    } finally {
      setPreviewing(false);
      setProgress(null);
    }
  };

  const handleExecute = async () => {
    if (!rootPath) return;
    setExecuting(true);
    try {
      const { moved, skipped, failed } = await executeOrganize(items, {
        rootPath,
        onProgress: setProgress,
      });
      addToast({
        type: failed > 0 ? 'warning' : 'success',
        message: failed > 0 ? t('home.organize.organize.toastExecuteResultWithFail', { moved, skipped, failed }) : t('home.organize.organize.toastExecuteResult', { moved, skipped }),
      });
      setItems([]);
      // 执行完成后重新扫描，更新文件列表（修复：归类后旧路径导致排除逻辑失效）
      if (onRescan) {
        await onRescan();
      }
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.organize.toastExecuteFailed', { message: (err as Error).message }) });
    } finally {
      setExecuting(false);
      setProgress(null);
    }
  };

  // 将移动的文件（move / rename 均会实际移动）
  const movedItems = items.filter((i) => i.conflictAction === 'move' || i.conflictAction === 'rename');

  return (
    <ToolCard
      title={t('home.organize.organize.title')}
      description={t('home.organize.organize.description')}
      color="blue"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <rect x="3" y="4" width="14" height="13" rx="1" />
          <line x1="3" y1="8" x2="17" y2="8" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="12" y1="2" x2="12" y2="6" />
        </svg>
      }
      disabled={!canUse}
      disabledReason={!canUse ? (sourceMode === 'library' ? t('home.organize.organize.disabledReasonLibrary') : t('home.organize.organize.disabledReasonDesktop')) : undefined}
    >
      {!canUse ? (
        <span className="px-4 py-2 inline-block text-sm text-[var(--color-gray-500)]">{t('home.organize.organize.needDesktopHint')}</span>
      ) : (
        <>
          {!items.length && !previewing && (
            <div className="space-y-3">
              {/* 格式选择 */}
              {allExts.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.organize.selectFormats')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const extCounts = new Map(countByExt(photos).map(({ ext, count }) => [ext, count]));
                      return allExts.map((ext) => (
                        <button
                          key={ext}
                          onClick={() => toggleExt(ext)}
                          className={`px-2 py-1 rounded text-xs font-mono cursor-pointer border-none transition-all inline-flex items-center gap-1 ${
                            !excludedExts.has(ext)
                              ? 'bg-[var(--color-brand)] text-white'
                              : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] line-through'
                          }`}
                        >
                          {ext}
                          <span className={`text-[10px] ${!excludedExts.has(ext) ? 'text-white/70' : ''}`}>
                            {extCounts.get(ext) ?? 0}
                          </span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* 选项 */}
              <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                <input type="checkbox" checked={excludeSorted} onChange={(e) => setExcludeSorted(e.target.checked)} className="cursor-pointer" />
                {t('home.organize.organize.excludeSorted')}
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                <input type="checkbox" checked={useFileDate} onChange={(e) => setUseFileDate(e.target.checked)} className="cursor-pointer" />
                {t('home.organize.organize.useFileDate')}
              </label>

              <PrimaryButton onClick={handlePreview} disabled={photos.length === 0}>
                {t('home.organize.organize.previewButton')}
              </PrimaryButton>
            </div>
          )}

          {(previewing || executing) && <ProgressBar progress={progress} />}

          {items.length > 0 && !executing && (
            <div className="space-y-3 flex flex-col max-h-[520px]">
              {/* 左右分栏：左=正常识别待移动，右=无法识别日期，高度限制内自适应 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0">
                {/* 左：正常识别的照片及目标目录 */}
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 flex flex-col min-h-0">
                  <div className="text-sm text-blue-800 font-[600] mb-2 shrink-0">
                    {t('home.organize.organize.movedSummary', { count: movedItems.length })}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
                    {movedItems.slice(0, 100).map((item, idx) => (
                      <div key={idx} className="text-xs px-2 py-1 rounded bg-white/70 flex items-center gap-2">
                        <span className="truncate flex-1 min-w-0 text-[var(--color-gray-600)]">{item.sourcePath.split(/[\\/]/).pop()}</span>
                        <span className="text-[var(--color-gray-400)] shrink-0">→</span>
                        <span className="shrink-0 text-[var(--color-brand)]">{item.targetDir}</span>
                      </div>
                    ))}
                    {movedItems.length > 100 && (
                      <div className="text-xs text-center text-[var(--color-gray-400)] py-1">{t('home.organize.organize.moreFiles', { count: movedItems.length - 100 })}</div>
                    )}
                  </div>
                </div>

                {/* 右：无法识别拍摄日期的文件 */}
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-gray-50)] p-3 flex flex-col min-h-0">
                  <div className="text-sm text-[var(--color-gray-600)] font-[600] mb-2 shrink-0">
                    {t('home.organize.organize.noDateSummary', { count: noDatePhotos.length })}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
                    {noDatePhotos.slice(0, 100).map((p) => (
                      <div key={p.id} className="text-xs px-2 py-1 rounded bg-white/70 truncate text-[var(--color-gray-600)]">
                        {p.relativePath || p.name}
                      </div>
                    ))}
                    {noDatePhotos.length === 0 && (
                      <div className="text-xs text-[var(--color-gray-400)] py-1">{t('home.organize.organize.allIdentified')}</div>
                    )}
                    {noDatePhotos.length > 100 && (
                      <div className="text-xs text-center text-[var(--color-gray-400)] py-1">{t('home.organize.organize.moreFiles', { count: noDatePhotos.length - 100 })}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <PrimaryButton onClick={handleExecute}>
                  {t('home.organize.organize.executeButton', { count: movedItems.length })}
                </PrimaryButton>
                <PrimaryButton variant="ghost" onClick={() => setItems([])}>
                  {t('home.organize.organize.cancel')}
                </PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </ToolCard>
  );
}
