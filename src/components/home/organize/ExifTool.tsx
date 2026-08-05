/**
 * 批量改 EXIF 工具 — 修改拍摄日期 / 添加 GPS
 * JPEG 用 piexifjs 写入（全平台，保留原有 EXIF）
 * PNG / WebP 通过手动插入 eXIf / EXIF chunk 写入
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  geocode,
  writeExifDate,
  writeExifGps,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, EXIF_WRITABLE_EXTS, downloadBlob, type ToolProps } from './shared';
import { logger } from '../../../utils/logger';

/** 智能解析日期输入，支持多种格式：
 * 2024-01-15 / 2024:01:15 / 2024/01/15 / 20240115
 * 2024-01-15 14:30 / 2024-01-15 14:30:00
 */
function parseDateInput(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  // YYYY-MM-DD HH:MM:SS
  let m = s.match(/^(\d{4})[-:\/](\d{1,2})[-:\/](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // YYYY-MM-DD HH:MM
  m = s.match(/^(\d{4})[-:\/](\d{1,2})[-:\/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
  // YYYY-MM-DD / YYYY:MM:DD / YYYY/MM/DD
  m = s.match(/^(\d{4})[-:\/](\d{1,2})[-:\/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  return null;
}

export function ExifTool({ photos, sourceMode, readPhotoData, addToast }: ToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'date' | 'gps'>('date');

  // 日期表单
  const [dateInput, setDateInput] = useState('');
  const [preserveTime, setPreserveTime] = useState(true);
  const [excludeSorted, setExcludeSorted] = useState(true);

  // 日期修改范围（按是否已有拍摄日期分组勾选）
  const [scopeWithDate, setScopeWithDate] = useState(true);
  const [scopeWithoutDate, setScopeWithoutDate] = useState(true);

  // GPS 修改范围（按是否已有 GPS 参数分组勾选）
  const [gpsScopeWith, setGpsScopeWith] = useState(true);
  const [gpsScopeWithout, setGpsScopeWithout] = useState(true);

  // GPS 表单
  const [gpsMode, setGpsMode] = useState<'coord' | 'place'>('coord');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [geocoding, setGeocoding] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);

  const writablePhotos = photos.filter((p) => {
    if (!EXIF_WRITABLE_EXTS.has(p.ext)) return false;
    if (excludeSorted) {
      const rel = (p.relativePath || p.path || '').replace(/\\/g, '/');
      if (rel.startsWith('MemBook照片整理/') || rel.includes('/MemBook照片整理/')) return false;
    }
    return true;
  });
  const parsedDate = mode === 'date' ? parseDateInput(dateInput) : null;

  // 按是否已有拍摄日期分组统计
  const photosWithDate = writablePhotos.filter((p) => !!p.dateTaken);
  const photosWithoutDate = writablePhotos.filter((p) => !p.dateTaken);

  // 按是否已有 GPS 参数分组统计
  const hasGps = (p: (typeof writablePhotos)[number]) =>
    typeof p.gpsLat === 'number' && typeof p.gpsLon === 'number';
  const photosWithGps = writablePhotos.filter(hasGps);
  const photosWithoutGps = writablePhotos.filter((p) => !hasGps(p));

  // 根据勾选范围筛选实际要处理的照片（日期模式按拍摄日期、GPS 模式按是否已有 GPS）
  const effectivePhotos =
    mode === 'date'
      ? writablePhotos.filter((p) => (p.dateTaken ? scopeWithDate : scopeWithoutDate))
      : writablePhotos.filter((p) => (hasGps(p) ? gpsScopeWith : gpsScopeWithout));

  // photos 变化时重置
  useEffect(() => {
    setProgress(null);
  }, [photos]);

  const handleGeocode = async () => {
    if (!placeName.trim()) return;
    setGeocoding(true);
    try {
      const result = await geocode(placeName);
      if (result) {
        setLon(result.lon.toFixed(6));
        setLat(result.lat.toFixed(6));
        addToast({ type: 'success', message: t('home.organize.exif.toastLocated', { name: result.displayName.slice(0, 40) }) });
      } else {
        addToast({ type: 'error', message: t('home.organize.exif.toastPlaceNotFound') });
      }
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.exif.toastGeocodeFailed', { message: (err as Error).message }) });
    } finally {
      setGeocoding(false);
    }
  };

  const canExecute =
    mode === 'date'
      ? !!parsedDate && effectivePhotos.length > 0
      : !!lon && !!lat && effectivePhotos.length > 0;

  const handleExecute = async () => {
    const targetPhotos = effectivePhotos;
    if (targetPhotos.length === 0 || !canExecute) return;
    setRunning(true);
    let ok = 0, fail = 0;

    try {
      for (let i = 0; i < targetPhotos.length; i++) {
        const photo = targetPhotos[i];
        try {
          const data = await readPhotoData(photo);
          if (!data) throw new Error('读取失败');

          let modified = data;
          if (mode === 'date' && parsedDate) {
            const oldDate = photo.dateTaken ? new Date(photo.dateTaken) : undefined;
            modified = await writeExifDate(modified, photo.ext, parsedDate, preserveTime ? oldDate : undefined);
          }
          if (mode === 'gps' && lon && lat) {
            modified = await writeExifGps(modified, photo.ext, parseFloat(lon), parseFloat(lat));
          }

          // 保存：folder + Tauri 写回文件，library / Web 下载到本地
          if (isTauri() && photo.path && sourceMode === 'folder') {
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(photo.path, new Uint8Array(modified));
          } else {
            downloadBlob(new Blob([modified], { type: photo.mimeType || 'image/jpeg' }), photo.name);
          }
          ok++;
        } catch (err) {
          logger.warn(`[exif] ${photo.name}`, err);
          fail++;
        }
        setProgress({ phase: 'execute', current: i + 1, total: targetPhotos.length, message: `${i + 1}/${targetPhotos.length}` });
      }

      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: fail > 0 ? t('home.organize.exif.toastSuccessWithFail', { ok, fail }) : t('home.organize.exif.toastSuccess', { ok }),
      });
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.exif.toastExecuteFailed', { message: (err as Error).message }) });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const isDesktop = isTauri();

  return (
    <ToolCard
      title={t('home.organize.exif.title')}
      description={t('home.organize.exif.description', { count: writablePhotos.length })}
      color="green"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <line x1="7" y1="7" x2="13" y2="7" />
          <line x1="7" y1="10" x2="13" y2="10" />
          <line x1="7" y1="13" x2="10" y2="13" />
        </svg>
      }
    >
      {writablePhotos.length === 0 ? (
        <span className="px-4 py-2 inline-block text-sm text-[var(--color-gray-500)]">{t('home.organize.exif.noWritablePhotos')}</span>
      ) : (
        <>
          {/* 模式切换 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('date')}
              className={`px-3 py-1.5 rounded-lg text-sm font-[600] border-none cursor-pointer transition-all ${
                mode === 'date' ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)]'
              }`}
            >
              {t('home.organize.exif.modeDate')}
            </button>
            <button
              onClick={() => setMode('gps')}
              className={`px-3 py-1.5 rounded-lg text-sm font-[600] border-none cursor-pointer transition-all ${
                mode === 'gps' ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)]'
              }`}
            >
              {t('home.organize.exif.modeGps')}
            </button>
          </div>

          {/* 通用选项 */}
          <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer mb-4">
            <input type="checkbox" checked={excludeSorted} onChange={(e) => setExcludeSorted(e.target.checked)} className="cursor-pointer" />
            {t('home.organize.exif.excludeSorted')}
          </label>

          {/* 日期表单 */}
          {mode === 'date' && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm text-[var(--color-gray-600)] mb-1 block">{t('home.organize.exif.targetDate')}</span>
                <input
                  type="text"
                  placeholder={t('home.organize.exif.targetDatePlaceholder')}
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-brand)]"
                />
                {dateInput && !parsedDate && (
                  <span className="text-xs text-red-500 mt-1 block">{t('home.organize.exif.invalidDateFormat')}</span>
                )}
                {parsedDate && (
                  <span className="text-xs text-green-600 mt-1 block">
                    {t('home.organize.exif.parsedAs', { date: parsedDate.toLocaleString('zh-CN') })}
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                <input type="checkbox" checked={preserveTime} onChange={(e) => setPreserveTime(e.target.checked)} className="cursor-pointer" />
                {t('home.organize.exif.preserveTime')}
              </label>
              <div className="mt-3 rounded-lg bg-[var(--color-gray-50)] p-3 space-y-2">
                <p className="text-xs font-[600] text-[var(--color-gray-600)]">{t('home.organize.exif.dateScopeTitle')}</p>
                <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                  <input type="checkbox" checked={scopeWithDate} onChange={(e) => setScopeWithDate(e.target.checked)} className="cursor-pointer" />
                  {t('home.organize.exif.scopeWithDate', { count: photosWithDate.length })}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                  <input type="checkbox" checked={scopeWithoutDate} onChange={(e) => setScopeWithoutDate(e.target.checked)} className="cursor-pointer" />
                  {t('home.organize.exif.scopeWithoutDate', { count: photosWithoutDate.length })}
                </label>
                <p className="text-xs text-[var(--color-gray-400)] leading-relaxed">
                  {t('home.organize.exif.dateScopeHint')}
                </p>
              </div>
            </div>
          )}

          {/* GPS 表单 */}
          {mode === 'gps' && (
            <div className="space-y-3">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setGpsMode('coord')} className={`px-3 py-1 rounded text-xs ${gpsMode === 'coord' ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-gray-100)]'}`}>
                  {t('home.organize.exif.gpsModeCoord')}
                </button>
                <button onClick={() => setGpsMode('place')} className={`px-3 py-1 rounded text-xs ${gpsMode === 'place' ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-gray-100)]'}`}>
                  {t('home.organize.exif.gpsModePlace')}
                </button>
              </div>

              {gpsMode === 'place' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t('home.organize.exif.placeNamePlaceholder')}
                    value={placeName}
                    onChange={(e) => setPlaceName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-brand)]"
                  />
                  <PrimaryButton onClick={handleGeocode} loading={geocoding} variant="ghost">
                    {t('home.organize.exif.query')}
                  </PrimaryButton>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-[var(--color-gray-600)] mb-1 block">{t('home.organize.exif.longitude')}</span>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="116.397128"
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-brand)]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-[var(--color-gray-600)] mb-1 block">{t('home.organize.exif.latitude')}</span>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="39.916527"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-brand)]"
                  />
                </label>
              </div>

              <div className="mt-3 rounded-lg bg-[var(--color-gray-50)] p-3 space-y-2">
                <p className="text-xs font-[600] text-[var(--color-gray-600)]">{t('home.organize.exif.gpsScopeTitle')}</p>
                <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                  <input type="checkbox" checked={gpsScopeWith} onChange={(e) => setGpsScopeWith(e.target.checked)} className="cursor-pointer" />
                  {t('home.organize.exif.scopeWithGps', { count: photosWithGps.length })}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
                  <input type="checkbox" checked={gpsScopeWithout} onChange={(e) => setGpsScopeWithout(e.target.checked)} className="cursor-pointer" />
                  {t('home.organize.exif.scopeWithoutGps', { count: photosWithoutGps.length })}
                </label>
                <p className="text-xs text-[var(--color-gray-400)] leading-relaxed">
                  {t('home.organize.exif.gpsScopeHint')}
                </p>
              </div>
            </div>
          )}

          {/* 操作区 */}
          <div className="mt-4">
            {(!isDesktop || sourceMode === 'library') && (
              <p className="text-xs text-[var(--color-gray-500)] mb-2">{sourceMode === 'library' ? t('home.organize.exif.libraryDownloadHint') : t('home.organize.exif.webDownloadHint')}</p>
            )}
            <PrimaryButton onClick={handleExecute} disabled={!canExecute} loading={running}>
              {mode === 'date' ? t('home.organize.exif.executeDate', { count: effectivePhotos.length }) : t('home.organize.exif.executeGps', { count: effectivePhotos.length })}
            </PrimaryButton>
            <ProgressBar progress={progress} />
          </div>
        </>
      )}
    </ToolCard>
  );
}
