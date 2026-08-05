/**
 * 格式转换工具 — 多种格式 → JPG
 * 支持：livp / HEIC / HEIF（heic2any 或 Rust WIC）
 *       png / webp / bmp / tiff / gif（Canvas API）
 * 支持格式选择（类似时间归类的格式排除）
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  convertToJpg,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, CONVERTIBLE_EXTS, downloadBlob, type ToolProps } from './shared';
import { logger } from '../../../utils/logger';
import { invoke } from '@tauri-apps/api/core';

export function ConvertTool({ photos, sourceMode, readPhotoData, onPhotosUpdate, addToast }: ToolProps) {
  const { t } = useTranslation();
  const [quality, setQuality] = useState(0.95);
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [excludedExts, setExcludedExts] = useState<Set<string>>(new Set());

  const convertiblePhotos = photos.filter((p) => CONVERTIBLE_EXTS.has(p.ext));
  const isDesktop = isTauri();
  const canWriteFile = isDesktop && sourceMode === 'folder';

  // 所有可转换格式列表
  const allExts = useMemo(() => {
    const set = new Set(convertiblePhotos.map((p) => p.ext));
    return [...set].sort();
  }, [convertiblePhotos]);

  // 选中的照片（排除未选格式）
  const selectedPhotos = convertiblePhotos.filter((p) => !excludedExts.has(p.ext));

  // photos 变化时重置
  useEffect(() => {
    setProgress(null);
  }, [photos]);

  const toggleExt = (ext: string) => {
    setExcludedExts((prev) => {
      const next = new Set(prev);
      next.has(ext) ? next.delete(ext) : next.add(ext);
      return next;
    });
  };

  const handleExecute = async () => {
    if (selectedPhotos.length === 0) return;
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
      color="purple"
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
                {allExts.map((ext) => (
                  <button
                    key={ext}
                    onClick={() => toggleExt(ext)}
                    className={`px-2 py-1 rounded text-xs font-mono cursor-pointer border-none transition-all ${
                      !excludedExts.has(ext)
                        ? 'bg-[var(--color-brand)] text-white'
                        : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] line-through'
                    }`}
                  >
                    {ext}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 质量滑块 */}
          <label className="block">
            <div className="flex justify-between mb-1">
              <span className="text-sm text-[var(--color-gray-600)]">{t('home.organize.convert.jpgQuality')}</span>
              <span className="text-sm font-mono text-[var(--color-brand)]">{Math.round(quality * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
            />
          </label>

          {/* 删除原文件（仅 folder + 桌面端） */}
          {canWriteFile && (
            <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
              <input type="checkbox" checked={deleteOriginal} onChange={(e) => setDeleteOriginal(e.target.checked)} className="cursor-pointer" />
              {t('home.organize.convert.deleteOriginal')}
            </label>
          )}

          {/* 文件列表预览 */}
          <div className="max-h-[120px] overflow-auto space-y-1">
            {selectedPhotos.slice(0, 20).map((p) => (
              <div key={p.id} className="text-xs px-2 py-1 rounded bg-[var(--color-gray-50)] text-[var(--color-gray-600)] flex items-center gap-2">
                <span className="text-[var(--color-brand)] font-mono">{p.ext}</span>
                <span className="truncate flex-1">{p.name}</span>
                <span className="text-[var(--color-gray-400)]">→ .jpg</span>
              </div>
            ))}
            {selectedPhotos.length > 20 && (
              <div className="text-xs text-center text-[var(--color-gray-400)] py-1">{t('home.organize.convert.moreFiles', { count: selectedPhotos.length - 20 })}</div>
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
