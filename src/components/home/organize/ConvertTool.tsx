/**
 * 格式转换工具 — 多种格式 → JPG
 * 支持：livp / HEIC / HEIF（heic2any 或 Rust WIC）
 *       png / webp / bmp / tiff / gif / jpg / jpeg（Canvas API）
 * 支持格式选择（类似时间归类的格式排除）与「指定照片选择」：
 *   - 可通过点击缩略图勾选/取消勾选要转换的具体照片（默认全选）
 *   - 可按格式快捷筛选
 *   - JPG/JPEG 也可被强制重编码转换（修复损坏/非标准 EXIF 的 JPEG）
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  convertToJpg,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, CONVERTIBLE_EXTS, countByExt, downloadBlob, estimateJpgSize, formatBytes, RangeSlider, ThumbImage, useLazyList, type ToolProps } from './shared';
import { logger } from '../../../utils/logger';
import { invoke } from '@tauri-apps/api/core';

export function ConvertTool({ photos, sourceMode, readPhotoData, onPhotosUpdate, addToast, onBusyChange, proFeature, checkProFeature }: ToolProps) {
  const { t } = useTranslation();
  const [quality, setQuality] = useState(0.95);
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [excludedExts, setExcludedExts] = useState<Set<string>>(new Set());
  // 未选中的照片 ID 集合。默认全选所有可转换照片，仅在用户取消勾选时记录到此处；
  // 这样新加入的照片无需额外 setState 即默认为选中，避免在 effect 中同步 setState。
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());

  // 通知父组件工具执行状态（running），用于禁用标签切换
  useEffect(() => {
    onBusyChange?.('convert', running);
    return () => { onBusyChange?.('convert', false); };
  }, [running, onBusyChange]);

  const convertiblePhotos = photos.filter((p) => CONVERTIBLE_EXTS.has(p.ext));
  const isDesktop = isTauri();
  const canWriteFile = isDesktop && sourceMode === 'folder';

  // 所有可转换格式列表
  const allExts = useMemo(() => {
    const set = new Set(convertiblePhotos.map((p) => p.ext));
    return [...set].sort();
  }, [convertiblePhotos]);

  // 当前生效的可转换照片（排除未选格式）
  const filteredPhotos = useMemo(
    () => convertiblePhotos.filter((p) => !excludedExts.has(p.ext)),
    [convertiblePhotos, excludedExts],
  );

  const toggleExt = (ext: string) => {
    setExcludedExts((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });
  };

  /** 切换单张照片选中状态 */
  const toggleSelect = (id: string) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 全选当前生效列表 */
  const selectAll = () => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      filteredPhotos.forEach((p) => next.delete(p.id));
      return next;
    });
  };

  /** 取消全选当前生效列表 */
  const deselectAll = () => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      filteredPhotos.forEach((p) => next.add(p.id));
      return next;
    });
  };

  // 最终待转换照片：生效列表中未被取消勾选的照片
  const selectedPhotos = filteredPhotos.filter((p) => !deselectedIds.has(p.id));
  const allSelected =
    filteredPhotos.length > 0 && filteredPhotos.every((p) => !deselectedIds.has(p.id));

  // 照片选择网格 + 文件预览列表懒加载（初始一批，滚动到底自动追加，最终全部可展示）
  const gridList = useLazyList(filteredPhotos.length, 200);
  const previewList = useLazyList(selectedPhotos.length, 50);

  const handleExecute = async () => {
    if (selectedPhotos.length === 0) return;
    // Pro 授权守卫：点击"开始转换"时才检查并提示激活
    if (proFeature && checkProFeature && !checkProFeature(proFeature, t('license.photoToolRequiresPro'))) {
      return;
    }
    setRunning(true);
    let ok = 0, fail = 0;
    const convertedIds: string[] = [];
    const errors: string[] = [];

    try {
      for (let i = 0; i < selectedPhotos.length; i++) {
        const photo = selectedPhotos[i];
        try {
          const data = await readPhotoData(photo);
          if (!data) throw new Error('读取失败');

          const { blob } = await convertToJpg(data, photo.ext, { quality, filePath: photo.path });
          const jpgName = photo.name.replace(/\.[^.]+$/, '.jpg');

          if (canWriteFile && photo.path) {
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            const jpgPath = photo.path.replace(/\.[^.]+$/, '.jpg');
            const buf = await blob.arrayBuffer();
            await writeFile(jpgPath, new Uint8Array(buf));
            if (deleteOriginal) {
              try { await invoke('trash_files', { paths: [photo.path] }); convertedIds.push(photo.id); } catch { /* 移入回收站失败不阻断 */ }
            }
          } else {
            downloadBlob(blob, jpgName);
          }
          ok++;
        } catch (err) {
          logger.warn(`[convert] ${photo.name}`, err);
          errors.push(`${photo.name}: ${(err as Error).message}`);
          fail++;
        }
        setProgress({ phase: 'convert', current: i + 1, total: selectedPhotos.length, message: `${i + 1}/${selectedPhotos.length}` });
      }

      // 如果删除了原文件，从列表中移除
      if (convertedIds.length > 0) {
        const ids = new Set(convertedIds);
        onPhotosUpdate((prev) => prev.filter((p) => !ids.has(p.id)));
      }

      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: fail > 0 ? t('home.organize.convert.toastSuccessWithFail', { ok, fail }) : t('home.organize.convert.toastSuccess', { ok }),
      });
      // 如果有失败，打印详细错误
      if (errors.length > 0) {
        logger.warn('[convert] 失败详情:', errors);
      }
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.convert.toastFailed', { message: (err as Error).message }) });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <ToolCard
      title={t('home.organize.convert.title')}
      description={t('home.organize.convert.description', { count: convertiblePhotos.length })}
      color="pink"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M4 4h12v12H4z" />
          <path d="M4 14l4-4 3 3 5-5" />
        </svg>
      }
      disabled={convertiblePhotos.length === 0}
      disabledReason={convertiblePhotos.length === 0 ? t('home.organize.convert.disabledReason') : undefined}
    >
      {convertiblePhotos.length === 0 ? (
        <span className="px-4 py-2 inline-block text-sm text-[var(--color-gray-500)]">{t('home.organize.convert.noConvertibleFiles')}</span>
      ) : (
        <div className="space-y-3">
          {/* 格式选择 */}
          {allExts.length > 0 && (
            <div>
              <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.convert.selectFormats')}</span>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const extCounts = new Map(countByExt(convertiblePhotos).map(({ ext, count }) => [ext, count]));
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

          {/* 指定照片选择网格 */}
          {filteredPhotos.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--color-gray-600)]">
                  {t('home.organize.convert.selectPhotos', { count: selectedPhotos.length, total: filteredPhotos.length })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    disabled={allSelected}
                    className="text-xs text-[var(--color-brand)] hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-default"
                  >
                    {t('home.organize.convert.selectAll')}
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    disabled={selectedPhotos.length === 0}
                    className="text-xs text-[var(--color-gray-500)] hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-default"
                  >
                    {t('home.organize.convert.deselectAll')}
                  </button>
                </div>
              </div>
              <div className="grid gap-1.5 max-h-[280px] overflow-y-auto overflow-x-hidden p-0.5 custom-scrollbar" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {filteredPhotos.slice(0, gridList.visibleCount).map((p) => {
                  const selected = !deselectedIds.has(p.id);
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSelect(p.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(p.id); } }}
                      className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all group ${
                        selected
                          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]'
                          : 'border-transparent hover:border-[var(--color-border)]'
                      }`}
                      title={p.name}
                    >
                      <ThumbImage photo={p} readPhotoData={readPhotoData} size="small" />
                      {/* 选中标记 */}
                      <span
                        className={`absolute top-1 left-1 z-10 w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shadow-sm transition-all ${
                          selected ? 'opacity-100 bg-[var(--color-brand)]' : 'opacity-0 bg-black/40 group-hover:opacity-60'
                        }`}
                      >
                        ✓
                      </span>
                      {/* 格式角标 */}
                      <span className="absolute bottom-0.5 right-0.5 z-10 text-[9px] leading-none px-1 py-0.5 rounded bg-black/50 text-white font-mono">
                        {p.ext.replace('.', '')}
                      </span>
                    </div>
                  );
                })}
                {/* 懒加载哨兵：滚动接近底部自动加载下一批，加载完消失 */}
                {gridList.visibleCount < filteredPhotos.length && <div ref={gridList.sentinelRef} className="h-1" />}
              </div>
            </div>
          )}

          {/* 质量滑块（使用共享 RangeSlider，与其他滑块样式统一） */}
          <div className="block">
            <div className="flex justify-between mb-1">
              <span className="text-sm text-[var(--color-gray-600)]">{t('home.organize.convert.jpgQuality')}</span>
              <span className="text-sm font-mono text-[var(--color-brand)]">{Math.round(quality * 100)}%</span>
            </div>
            <RangeSlider
              min={0.5}
              max={1}
              step={0.05}
              value={quality}
              onChange={(v) => setQuality(v)}
            />
          </div>

          {/* 删除原文件（仅 folder + 桌面端） */}
          {canWriteFile && (
            <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
              <input type="checkbox" checked={deleteOriginal} onChange={(e) => setDeleteOriginal(e.target.checked)} className="cursor-pointer" />
              {t('home.organize.convert.deleteOriginal')}
            </label>
          )}

          {/* 文件列表预览（含原大小 + 预估 JPG 大小，懒加载） */}
          <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
            {selectedPhotos.slice(0, previewList.visibleCount).map((p) => {
              const estSize = estimateJpgSize(p.size, p.ext, quality);
              const isExpanding = estSize > p.size;
              return (
                <div key={p.id} className="text-xs px-2 py-1 rounded bg-[var(--color-gray-50)] text-[var(--color-gray-600)] flex items-center gap-2">
                  <span className="text-[var(--color-brand)] font-mono shrink-0">{p.ext}</span>
                  <span className="truncate flex-1 min-w-0" title={p.name}>{p.name}</span>
                  <span className="text-[var(--color-gray-400)] shrink-0 tabular-nums">{formatBytes(p.size)}</span>
                  <span className="text-[var(--color-gray-400)] shrink-0">→</span>
                  <span className={`shrink-0 tabular-nums ${isExpanding ? 'text-orange-500' : 'text-green-600'}`} title={t('home.organize.convert.estimatedSizeHint')}>
                    {formatBytes(estSize)}
                  </span>
                </div>
              );
            })}
            {/* 懒加载哨兵：滚动接近底部自动加载下一批，加载完消失 */}
            {previewList.visibleCount < selectedPhotos.length && <div ref={previewList.sentinelRef} className="h-1" />}
            {/* 汇总：原总大小 → 预估总大小 */}
            {selectedPhotos.length > 0 && (
              <div className="text-xs px-2 py-1.5 rounded bg-[var(--color-brand-bg)] text-[var(--color-brand)] flex items-center gap-2 font-[600] mt-1">
                <span>{t('home.organize.convert.totalSummary')}</span>
                <span className="tabular-nums">{formatBytes(selectedPhotos.reduce((s, p) => s + p.size, 0))}</span>
                <span>→</span>
                <span className="tabular-nums">{formatBytes(selectedPhotos.reduce((s, p) => s + estimateJpgSize(p.size, p.ext, quality), 0))}</span>
              </div>
            )}
          </div>

          {!canWriteFile && (
            <p className="text-xs text-[var(--color-gray-500)]">{sourceMode === 'library' ? t('home.organize.convert.libraryDownloadHint') : t('home.organize.convert.webDownloadHint')}</p>
          )}

          <PrimaryButton onClick={handleExecute} loading={running} disabled={selectedPhotos.length === 0}>
            {t('home.organize.convert.executeButton', { count: selectedPhotos.length })}
          </PrimaryButton>
          <ProgressBar progress={progress} />
        </div>
      )}
    </ToolCard>
  );
}
