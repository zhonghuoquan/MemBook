/**
 * 批量重命名工具 — 按模板批量重命名照片文件名
 * 仅 Tauri + 文件夹模式可用（需真实文件系统重命名操作）
 *
 * 模板变量：{date} {location} {seq} {camera} {original}
 * 支持：自定义模板、序号设置、地点层级、格式排除
 * 执行后自动重新扫描
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  previewRename,
  executeRename,
  resolvePhotoDate,
  type PhotoFileInfo,
  type RenamePreviewItem,
  type ToolProgress,
  type LocationLevel,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, countByExt, type ToolProps } from './shared';
import { logger } from '../../../utils/logger';

/**
 * 本地模板预览：根据模板和当前 seq 设置，对样例照片（或第一张照片）做字符串替换，
 * 不调用 geocode（location 用占位符或已知结果），用于在用户编辑模板时实时展示效果。
 */
function localPreviewTemplate(
  template: string,
  photo: PhotoFileInfo | null,
  seqStart: number,
  seqDigits: number,
): string {
  if (!template) return '';
  // 选择样例照片：传入的照片优先，否则用模拟数据
  const sample = photo ?? {
    id: 'sample',
    name: 'IMG_20240115_142030.jpg',
    dateTaken: '2024-01-15T14:20:30Z',
    gpsLat: 39.9042,
    gpsLon: 116.4074,
  } as PhotoFileInfo;

  // 解析 date
  let date = '2024-01-15';
  const d = resolvePhotoDate(sample);
  if (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    date = `${y}-${m}-${day}`;
  }

  // location：样例用"北京市"（无 geocode，仅展示效果）
  const location = '北京市';

  // seq
  const seqStr = String(seqStart).padStart(seqDigits, '0');

  // camera
  let camera = 'iPhone15Pro';
  if (sample.cameraMake || sample.cameraModel) {
    const parts = [sample.cameraMake, sample.cameraModel]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s && s.length > 0);
    if (parts.length > 0) camera = parts.join(' ');
  }

  // original
  const dot = sample.name.lastIndexOf('.');
  const original = dot === -1 ? sample.name : sample.name.slice(0, dot);

  // 替换模板变量
  const result = template
    .replace(/\{date\}/g, date)
    .replace(/\{location\}/g, location)
    .replace(/\{seq\}/g, seqStr)
    .replace(/\{camera\}/g, camera)
    .replace(/\{original\}/g, original);

  // 附加原扩展名
  const ext = dot === -1 ? '' : sample.name.slice(dot);
  return result + ext;
}

export function RenameTool({ photos, rootPath, sourceMode, addToast, onRescan, onBusyChange }: ToolProps) {
  const { t } = useTranslation();
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [items, setItems] = useState<RenamePreviewItem[]>([]);
  const [noInfoPhotos, setNoInfoPhotos] = useState<PhotoFileInfo[]>([]);
  const [excludedExts, setExcludedExts] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState('{date}_{location}_{seq}');
  const [seqStart, setSeqStart] = useState(1);
  const [seqDigits, setSeqDigits] = useState(3);
  const [locationLevel, setLocationLevel] = useState<LocationLevel>('city'); // 文件名用市级更简洁
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  // 通知父组件工具执行状态（previewing/executing），用于禁用标签切换
  const busy = previewing || executing;
  useEffect(() => {
    onBusyChange?.('rename', busy);
    return () => { onBusyChange?.('rename', false); };
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
    setNoInfoPhotos([]);
  }, [photos]);

  const toggleExt = useCallback((ext: string) => {
    setExcludedExts((prev) => {
      const next = new Set(prev);
      next.has(ext) ? next.delete(ext) : next.add(ext);
      return next;
    });
  }, []);

  /** 点击变量 chip 时，将变量插入到模板输入框光标位置 */
  const insertVar = useCallback((varStr: string) => {
    const input = templateInputRef.current;
    if (!input) {
      setTemplate((prev) => prev + varStr);
      return;
    }
    const start = input.selectionStart ?? template.length;
    const end = input.selectionEnd ?? template.length;
    const next = template.slice(0, start) + varStr + template.slice(end);
    setTemplate(next);
    // 异步聚焦并把光标移到插入后位置
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + varStr.length;
      input.setSelectionRange(pos, pos);
    });
  }, [template]);

  /** 实时示例：基于第一张照片（或 null 用模拟数据）+ 当前模板/seq 设置 */
  const examplePreview = useMemo(() => {
    if (!template.trim()) return '';
    const firstPhoto = photos.length > 0 ? photos[0] : null;
    return localPreviewTemplate(template, firstPhoto, seqStart, seqDigits);
  }, [template, photos, seqStart, seqDigits]);

  // 模板变量定义：变量名 + i18n 描述 key
  const templateVars: Array<{ var: string; descKey: string }> = [
    { var: '{date}', descKey: 'home.organize.rename.templateVarDate' },
    { var: '{location}', descKey: 'home.organize.rename.templateVarLocation' },
    { var: '{seq}', descKey: 'home.organize.rename.templateVarSeq' },
    { var: '{camera}', descKey: 'home.organize.rename.templateVarCamera' },
    { var: '{original}', descKey: 'home.organize.rename.templateVarOriginal' },
  ];

  /** 逆向 geocode：GPS 坐标 → 地名（Tauri 端调用 Rust reverse_geocode）
   *  {location} 模板变量依赖它才能输出真实地名，否则永远为"未知" */
  const reverseGeocode = useCallback(async (lon: number, lat: number): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string | null>('reverse_geocode', { latitude: lat, longitude: lon });
    } catch (err) {
      logger.warn('[rename] 逆向 geocode 失败:', lon, lat, err);
      return null;
    }
  }, []);

  const handlePreview = async () => {
    setPreviewing(true);
    setItems([]);
    const photosToRename = photos.filter((p) => !excludedExts.has(p.ext));
    try {
      const result = await previewRename(photosToRename, {
        template,
        seqStart,
        seqDigits,
        locationLevel,
        reverseGeocode: isTauri() ? reverseGeocode : undefined,
        onProgress: setProgress,
      });
      setItems(result);

      // 计算无日期/GPS的照片（信息不完整，新文件名中会含占位符如"未知日期"/"未知"）
      const noInfo = photosToRename.filter((p) => {
        const hasDate = !!p.dateTaken;
        const hasGps = p.gpsLon != null && p.gpsLat != null;
        return !hasDate || !hasGps;
      });
      setNoInfoPhotos(noInfo);

      // 构建提示
      const parts: string[] = [t('home.organize.rename.toastPreviewCount', { count: result.length })];
      if (noInfo.length > 0) parts.push(t('home.organize.rename.toastPreviewNoInfo', { count: noInfo.length }));
      addToast({ type: 'info', message: parts.join(t('home.organize.rename.toastSeparator')) });
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.rename.toastPreviewFailed', { message: (err as Error).message }) });
    } finally {
      setPreviewing(false);
      setProgress(null);
    }
  };

  const handleExecute = async () => {
    if (!rootPath) return;
    setExecuting(true);
    try {
      const { renamed, failed } = await executeRename(items, rootPath, {
        onProgress: setProgress,
      });
      addToast({
        type: failed > 0 ? 'warning' : 'success',
        message: failed > 0
          ? t('home.organize.rename.toastExecuteResultWithFail', { renamed, failed })
          : t('home.organize.rename.toastExecuteResult', { renamed }),
      });
      setItems([]);
      // 执行完成后重新扫描，更新文件列表
      if (onRescan) {
        await onRescan();
      }
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.rename.toastExecuteFailed', { message: (err as Error).message }) });
    } finally {
      setExecuting(false);
      setProgress(null);
    }
  };

  return (
    <ToolCard
      title={t('home.organize.rename.title')}
      description={t('home.organize.rename.description')}
      color="teal"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M3 14l5-5 3 3-5 5H3v-3z" />
          <path d="M13 4l2-2 3 3-2 2" />
          <line x1="11" y1="6" x2="14" y2="9" />
        </svg>
      }
      disabled={!canUse}
      disabledReason={!canUse ? (sourceMode === 'library' ? t('home.organize.rename.disabledReasonLibrary') : t('home.organize.rename.disabledReasonDesktop')) : undefined}
    >
      {!canUse ? (
        <span className="px-4 py-2 inline-block text-sm text-[var(--color-gray-500)]">{t('home.organize.rename.needDesktopHint')}</span>
      ) : (
        <>
          {!items.length && !previewing && (
            <div className="space-y-3">
              {/* 模板输入 */}
              <div>
                <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.rename.templateLabel')}</span>
                <input
                  ref={templateInputRef}
                  type="text"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder={t('home.organize.rename.templatePlaceholder')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm font-mono focus:outline-none focus:border-[var(--color-brand)]"
                />
                {/* 变量列表：点击插入到光标位置，旁边显示中文释义 */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {templateVars.map(({ var: varStr, descKey }) => (
                    <button
                      key={varStr}
                      type="button"
                      onClick={() => insertVar(varStr)}
                      title={t(descKey)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-[var(--color-border)] bg-[var(--color-gray-50)] hover:bg-[var(--color-brand-bg)] hover:border-[var(--color-brand)]/40 cursor-pointer transition-colors"
                    >
                      <span className="font-mono text-[var(--color-brand)]">{varStr}</span>
                      <span className="text-[var(--color-gray-500)]">{t(descKey)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 实时示例效果：随模板/seq 变化即时更新 */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-gray-50)] px-3 py-2">
                <div className="text-[11px] text-[var(--color-gray-500)] mb-0.5">{t('home.organize.rename.templateExampleLabel')}</div>
                {examplePreview ? (
                  <div className="text-sm font-mono text-[#4A9C6B] break-all">{examplePreview}</div>
                ) : (
                  <div className="text-sm text-[var(--color-gray-400)]">{t('home.organize.rename.templateExampleEmpty')}</div>
                )}
              </div>

              {/* 序号设置 + 地点层级 */}
              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.rename.seqStart')}</span>
                  <input
                    type="number"
                    min={1}
                    value={seqStart}
                    onChange={(e) => setSeqStart(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 px-2 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:border-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.rename.seqDigits')}</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={seqDigits}
                    onChange={(e) => setSeqDigits(Math.min(6, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-20 px-2 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:border-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.rename.locationLevel')}</span>
                  <select
                    value={locationLevel}
                    onChange={(e) => setLocationLevel(e.target.value as LocationLevel)}
                    className="px-2 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:border-[var(--color-brand)] cursor-pointer"
                  >
                    <option value="city">{t('home.organize.rename.locationCity')}</option>
                    <option value="district">{t('home.organize.rename.locationDistrict')}</option>
                  </select>
                </div>
              </div>

              {/* 格式选择 */}
              {allExts.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--color-gray-600)] mb-1.5 block">{t('home.organize.rename.selectFormats')}</span>
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

              <PrimaryButton onClick={handlePreview} disabled={photos.length === 0}>
                {t('home.organize.rename.previewButton')}
              </PrimaryButton>
            </div>
          )}

          {(previewing || executing) && <ProgressBar progress={progress} />}

          {items.length > 0 && !executing && (
            <div className="space-y-3 flex flex-col max-h-[520px]">
              {/* 左右分栏：左=重命名列表，右=无日期/GPS的照片 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0">
                {/* 左：重命名列表 */}
                <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 flex flex-col min-h-0">
                  <div className="text-sm text-green-800 font-[600] mb-2 shrink-0">
                    {t('home.organize.rename.renameSummary', { count: items.length })}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
                    {items.slice(0, 20).map((item, idx) => (
                      <div key={idx} className="text-xs px-2 py-1 rounded bg-white/70 flex items-center gap-2">
                        <span className="truncate flex-1 min-w-0 text-[var(--color-gray-600)]">{item.oldName}</span>
                        <span className="text-[var(--color-gray-400)] shrink-0">→</span>
                        <span className="shrink-0 text-[#4A9C6B]">{item.newName}</span>
                      </div>
                    ))}
                    {items.length > 20 && (
                      <div className="text-xs text-center text-[var(--color-gray-400)] py-1">{t('home.organize.rename.moreFiles', { count: items.length - 20 })}</div>
                    )}
                  </div>
                </div>

                {/* 右：无日期/GPS的照片 */}
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-gray-50)] p-3 flex flex-col min-h-0">
                  <div className="text-sm text-[var(--color-gray-600)] font-[600] mb-2 shrink-0">
                    {t('home.organize.rename.noInfoSummary', { count: noInfoPhotos.length })}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
                    {noInfoPhotos.slice(0, 100).map((p) => (
                      <div key={p.id} className="text-xs px-2 py-1 rounded bg-white/70 truncate text-[var(--color-gray-600)]">
                        {p.relativePath || p.name}
                      </div>
                    ))}
                    {noInfoPhotos.length === 0 && (
                      <div className="text-xs text-[var(--color-gray-400)] py-1">{t('home.organize.rename.allComplete')}</div>
                    )}
                    {noInfoPhotos.length > 100 && (
                      <div className="text-xs text-center text-[var(--color-gray-400)] py-1">{t('home.organize.rename.moreFiles', { count: noInfoPhotos.length - 100 })}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <PrimaryButton onClick={handleExecute}>
                  {t('home.organize.rename.executeButton', { count: items.length })}
                </PrimaryButton>
                <PrimaryButton variant="ghost" onClick={() => setItems([])}>
                  {t('home.organize.rename.cancel')}
                </PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </ToolCard>
  );
}
