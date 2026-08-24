/**
 * 批量改 EXIF 工具 — 修改拍摄日期 / 添加 GPS
 * JPEG 用 piexifjs 写入（全平台，保留原有 EXIF）
 * PNG / WebP 通过手动插入 eXIf / EXIF chunk 写入
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTauri,
  geocode,
  writeExifDate,
  writeExifGps,
  parseFilenameDate,
  convertToJpg,
  type ToolProgress,
  type PhotoFileInfo,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, EXIF_WRITABLE_EXTS, downloadBlob, ThumbImage, useLazyList, type ToolProps } from './shared';
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

/** 将 Date 格式化为输入框标准格式 YYYY-MM-DD HH:MM:SS */
function formatDateForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 单张照片转 JPEG：读取原图 → convertToJpg → 写回（folder+Tauri）或其他模式仅下载。
 * 供单行“转格式”按钮与“全部转换”共用的底层操作（单一来源）。
 * @returns 若为写回模式则返回更新后的 PhotoFileInfo，非写回模式返回 null（仅下载，不更新列表）。
 */
async function convertPhotoToJpeg(
  photo: PhotoFileInfo,
  readPhotoData: ToolProps['readPhotoData'],
  sourceMode: ToolProps['sourceMode'],
): Promise<{ updated: PhotoFileInfo | null }> {
  const data = await readPhotoData(photo);
  if (!data) throw new Error('readFailed');
  const { blob } = await convertToJpg(data, photo.ext, { quality: 0.95, filePath: photo.path });
  const jpgName = photo.name.replace(/\.[^.]+$/, '.jpg');
  if (isTauri() && photo.path && sourceMode === 'folder') {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const { invoke } = await import('@tauri-apps/api/core');
    const jpgPath = photo.path.replace(/\.[^.]+$/, '.jpg');
    const buf = await blob.arrayBuffer();
    await writeFile(jpgPath, new Uint8Array(buf));
    // 仅当新路径与原路径不同时才删除原文件（JPG 重编码时路径相同，无需删除）
    if (jpgPath !== photo.path) {
      try { await invoke('trash_files', { paths: [photo.path] }); } catch { /* ignore */ }
    }
    return {
      updated: {
        ...photo,
        name: jpgName,
        ext: '.jpg',
        mimeType: 'image/jpeg',
        path: jpgPath,
        relativePath: photo.relativePath ? photo.relativePath.replace(/\.[^.]+$/, '.jpg') : photo.relativePath,
        size: buf.byteLength,
      },
    };
  }
  downloadBlob(blob, jpgName);
  return { updated: null };
}

/**
 * 单张照片写入拍摄日期 EXIF。
 * 供单行“修改”按钮与“全部修改”共用的底层操作（单一来源）。
 */
async function writeDateToPhoto(
  photo: PhotoFileInfo,
  date: Date,
  readPhotoData: ToolProps['readPhotoData'],
  sourceMode: ToolProps['sourceMode'],
): Promise<void> {
  const data = await readPhotoData(photo);
  if (!data) throw new Error('readFailed');
  const modified = await writeExifDate(data, photo.ext, date, undefined);
  if (isTauri() && photo.path && sourceMode === 'folder') {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(photo.path, new Uint8Array(modified));
  } else {
    downloadBlob(new Blob([modified], { type: photo.mimeType || 'image/jpeg' }), photo.name);
  }
}

export function ExifTool({ photos, sourceMode, readPhotoData, onPhotosUpdate, addToast, onBusyChange, proFeature, checkProFeature }: ToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'date' | 'gps'>('date');

  // 日期表单
  const [dateInput, setDateInput] = useState('');
  const [preserveTime, setPreserveTime] = useState(true);
  const [excludeSorted, setExcludeSorted] = useState(true);

  // 日期修改范围（按是否已有拍摄日期分组勾选）
  // 默认仅勾选「无拍摄日期」组（避免覆盖已有日期的照片）
  const [scopeWithDate, setScopeWithDate] = useState(false);
  const [scopeWithoutDate, setScopeWithoutDate] = useState(true);

  // GPS 修改范围（按是否已有 GPS 参数分组勾选）
  // 默认仅勾选「无 GPS」组（避免覆盖已有 GPS 的照片）
  const [gpsScopeWith, setGpsScopeWith] = useState(false);
  const [gpsScopeWithout, setGpsScopeWithout] = useState(true);

  // GPS 表单
  const [gpsMode, setGpsMode] = useState<'coord' | 'place'>('coord');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [geocoding, setGeocoding] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 无拍摄日期照片列表展开/折叠
  const [showNoDateList, setShowNoDateList] = useState(false);
  // 无 GPS 照片列表展开/折叠
  const [showNoGpsList, setShowNoGpsList] = useState(false);
  // 批量转格式 / 批量写入日期 状态
  const [convertingAll, setConvertingAll] = useState(false);
  const [writingAll, setWritingAll] = useState(false);

  // 无日期列表中各行的当前可执行状态（由 NoDatePhotoRow 上报）：
  // convertTargets = 已出现「转格式」按钮的照片 id；modifyQueue = 已输入日期的照片 id → Date
  const [convertTargets, setConvertTargets] = useState<Set<string>>(new Set());
  const [modifyQueue, setModifyQueue] = useState<Map<string, Date>>(new Map());

  // 子行状态上报：转换候选 / 已输入日期是否变化，驱动「全部转换 / 全部修改」的可点性
  const handleReport = useCallback(
    (id: string, r: { convert: boolean; date: Date | null }) => {
      setConvertTargets((prev) => {
        if (r.convert === prev.has(id)) return prev;
        const n = new Set(prev);
        if (r.convert) n.add(id);
        else n.delete(id);
        return n;
      });
      setModifyQueue((prev) => {
        const prevDate = prev.get(id) ?? null;
        // 按时间值比较（r.date 每次渲染都是新 Date 引用，不能用 ===）
        if ((prevDate?.getTime() ?? null) === (r.date?.getTime() ?? null)) return prev;
        const n = new Map(prev);
        if (r.date) n.set(id, r.date);
        else n.delete(id);
        return n;
      });
    },
    [],
  );

  // 通知父组件工具执行状态（running/geocoding/批量操作），用于禁用标签切换
  const busy = running || geocoding || convertingAll || writingAll;
  useEffect(() => {
    onBusyChange?.('exif', busy);
    return () => { onBusyChange?.('exif', false); };
  }, [busy, onBusyChange]);

  const writablePhotos = photos.filter((p) => {
    if (!EXIF_WRITABLE_EXTS.has(p.ext)) return false;
    if (excludeSorted) {
      const rel = (p.relativePath || p.path || '').replace(/\\/g, '/');
      if (rel.startsWith('MemBook照片整理/') || rel.includes('/MemBook照片整理/')) return false;
    }
    return true;
  });

  // 当前待转换 / 待写入日期的候选照片（用于按钮禁用态与批量执行）
  // 候选由 NoDatePhotoRow 经 handleReport 上报，必须列在 writablePhotos 之后定义
  const convertCandidates = useMemo(
    () => writablePhotos.filter((p) => convertTargets.has(p.id)),
    [writablePhotos, convertTargets],
  );
  const modifyCandidates = useMemo(
    () => writablePhotos.filter((p) => modifyQueue.has(p.id) && !!modifyQueue.get(p.id)),
    [writablePhotos, modifyQueue],
  );

  const parsedDate = mode === 'date' ? parseDateInput(dateInput) : null;

  // 按是否已有拍摄日期分组统计
  const photosWithDate = writablePhotos.filter((p) => !!p.dateTaken);
  const photosWithoutDate = writablePhotos.filter((p) => !p.dateTaken);

  // 按是否已有 GPS 参数分组统计
  const hasGps = (p: (typeof writablePhotos)[number]) =>
    typeof p.gpsLat === 'number' && typeof p.gpsLon === 'number';
  const photosWithGps = writablePhotos.filter(hasGps);
  const photosWithoutGps = writablePhotos.filter((p) => !hasGps(p));

  // 无日期 / 无 GPS 列表懒加载（初始一批 200，滚动到底自动追加，最终全部可展示）
  const noDateList = useLazyList(photosWithoutDate.length, 200);
  const noGpsList = useLazyList(photosWithoutGps.length, 200);

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
    // Pro 授权守卫：点击“定位”时才检查并提示激活
    if (proFeature && checkProFeature && !checkProFeature(proFeature, t('license.photoToolRequiresPro'))) {
      return;
    }
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
    // Pro 授权守卫：点击“应用修改”时才检查并提示激活
    if (proFeature && checkProFeature && !checkProFeature(proFeature, t('license.photoToolRequiresPro'))) {
      return;
    }
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

  // 全部转换：逐张转换列表中已出现「转格式」按钮的照片（非 JPEG / 修改失败过的 JPEG）
  // 目标来自 NoDatePhotoRow 上报的 convertTargets，确保「一键转换」只作用在用户可见的转换项上
  const handleConvertAll = useCallback(async () => {
    const targets = convertCandidates; // 点击时的快照，避免执行中因列表变化导致循环失真
    if (targets.length === 0) {
      addToast({ type: 'info', message: t('home.organize.exif.convertAllNoTarget') });
      return;
    }
    // Pro 授权守卫：点击“全部转换”时才检查并提示激活
    if (proFeature && checkProFeature && !checkProFeature(proFeature, t('license.photoToolRequiresPro'))) {
      return;
    }
    setConvertingAll(true);
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const photo = targets[i];
        try {
          const { updated } = await convertPhotoToJpeg(photo, readPhotoData, sourceMode);
          if (updated) {
            // 更新照片信息（原生路径变化，照片移出时 NoDatePhotoRow 会自动撤销 convert 上报）
            onPhotosUpdate((prev) => prev.map((item) => (item.id === photo.id ? updated : item)));
          }
          ok++;
        } catch (err) {
          logger.warn(`[exif-convertall] ${photo.name}`, err);
          fail++;
        }
        setProgress({ phase: 'execute', current: i + 1, total: targets.length, message: t('home.organize.exif.convertAllProgress', { current: i + 1, total: targets.length }) });
      }
      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: t('home.organize.exif.convertAllSuccess', { ok, fail }),
      });
    } catch (err) {
      addToast({ type: 'error', message: (err as Error).message });
    } finally {
      setConvertingAll(false);
      setProgress(null);
    }
  }, [convertCandidates, readPhotoData, sourceMode, onPhotosUpdate, addToast, t, proFeature, checkProFeature]);

  // 全部修改：逐张写入列表中「已录入/识别到有效日期」照片的拍摄日期（来自 modifyQueue）
  // 与单行「修改」按钮共用 writeDateToPhoto，确保批量与单文件行为一致
  const handleWriteAll = useCallback(async () => {
    const targets = modifyCandidates; // 点击时的快照
    if (targets.length === 0) {
      addToast({ type: 'info', message: t('home.organize.exif.writeAllNoTarget') });
      return;
    }
    // Pro 授权守卫：点击“全部修改”时才检查并提示激活
    if (proFeature && checkProFeature && !checkProFeature(proFeature, t('license.photoToolRequiresPro'))) {
      return;
    }
    setWritingAll(true);
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const photo = targets[i];
        const parsedDate = modifyQueue.get(photo.id);
        if (!parsedDate) { fail++; continue; }
        try {
          await writeDateToPhoto(photo, parsedDate, readPhotoData, sourceMode);
          // 更新照片 dateTaken，照片会被移出无日期列表
          onPhotosUpdate((prev) => prev.map((item) => (item.id === photo.id ? { ...item, dateTaken: parsedDate.toISOString() } : item)));
          ok++;
        } catch (err) {
          logger.warn(`[exif-writeall] ${photo.name}`, err);
          fail++;
        }
        setProgress({ phase: 'execute', current: i + 1, total: targets.length, message: t('home.organize.exif.writeAllProgress', { current: i + 1, total: targets.length }) });
      }
      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: t('home.organize.exif.writeAllSuccess', { ok, fail }),
      });
    } catch (err) {
      addToast({ type: 'error', message: (err as Error).message });
    } finally {
      setWritingAll(false);
      setProgress(null);
    }
  }, [modifyCandidates, modifyQueue, readPhotoData, sourceMode, onPhotosUpdate, addToast, t, proFeature, checkProFeature]);

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
                {/* 无拍摄日期照片列表（可折叠，支持单文件自动识别+修改 EXIF） */}
                {photosWithoutDate.length > 0 && (
                  <div className="mt-1">
                    <button
                      onClick={() => setShowNoDateList((v) => !v)}
                      className="text-xs text-[var(--color-brand)] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <svg viewBox="0 0 12 12" className={`w-3 h-3 transition-transform ${showNoDateList ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 2l4 4-4 4" />
                      </svg>
                      {showNoDateList ? t('home.organize.exif.hideNoDateList') : t('home.organize.exif.showNoDateList', { count: photosWithoutDate.length })}
                    </button>
                    {showNoDateList && (
                      <div className="mt-2 max-h-[360px] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
                        {/* 自适应网格：面板越宽列数越多（典型宽度下约 3~4 列），缩略图加大便于查看 */}
                        <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(205px,1fr))]">
                          {photosWithoutDate.slice(0, noDateList.visibleCount).map((p) => (
                            <NoDatePhotoRow
                              key={p.id}
                              photo={p}
                              sourceMode={sourceMode}
                              readPhotoData={readPhotoData}
                              addToast={addToast}
                              onReport={handleReport}
                              onDateUpdated={(newDate) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? { ...item, dateTaken: newDate } : item)))}
                              onPhotoConverted={(updated) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? updated : item)))}
                            />
                          ))}
                        </div>
                        {/* 懒加载哨兵：滚动接近底部自动加载下一批，加载完消失 */}
                        {noDateList.visibleCount < photosWithoutDate.length && <div ref={noDateList.sentinelRef} className="h-1" />}
                      </div>
                    )}
                    {/* 两个批量操作按钮：全部转换（转 JPEG）+ 全部修改（写入日期） */}
                    {photosWithoutDate.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 全部转换：一键转换列表中已出现「转格式」按钮的照片（无目标时禁用） */}
                          <button
                            onClick={handleConvertAll}
                            disabled={convertingAll || busy || convertCandidates.length === 0}
                            className="px-3 py-1.5 rounded-lg text-xs font-[600] border-none cursor-pointer transition-all
                                       bg-orange-500 text-white hover:opacity-90
                                       disabled:opacity-40 disabled:cursor-not-allowed
                                       inline-flex items-center gap-1.5"
                            title={t('home.organize.exif.convertAllHint')}
                          >
                            <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5" />
                              <path d="M12 2v3h-3" />
                              <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9" />
                              <path d="M2 12V9h3" />
                            </svg>
                            {convertingAll ? t('home.organize.exif.convertingAll') : t('home.organize.exif.convertAll')}
                          </button>
                          {/* 全部修改：一键写入列表中已录入/识别到日期的照片（无目标时禁用） */}
                          <button
                            onClick={handleWriteAll}
                            disabled={writingAll || busy || modifyCandidates.length === 0}
                            className="px-3 py-1.5 rounded-lg text-xs font-[600] border-none cursor-pointer transition-all
                                       bg-[var(--color-brand)] text-white hover:opacity-90
                                       disabled:opacity-40 disabled:cursor-not-allowed
                                       inline-flex items-center gap-1.5"
                            title={t('home.organize.exif.writeAllHint')}
                          >
                            <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 7l3 3 7-7" />
                            </svg>
                            {writingAll ? t('home.organize.exif.writingAll') : t('home.organize.exif.writeAll')}
                          </button>
                        </div>
                        {/* 无目标时的禁用原因提示 */}
                        {convertCandidates.length === 0 && (
                          <p className="text-[10px] text-orange-500 leading-tight">{t('home.organize.exif.convertAllNoTarget')}</p>
                        )}
                        {modifyCandidates.length === 0 && (
                          <p className="text-[10px] text-orange-500 leading-tight">{t('home.organize.exif.writeAllNoTarget')}</p>
                        )}
                        <p className="text-[10px] text-[var(--color-gray-400)] leading-tight">
                          {t('home.organize.exif.batchHint')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
                {/* 无 GPS 照片列表（可折叠，支持单文件输入坐标+修改 EXIF） */}
                {photosWithoutGps.length > 0 && (
                  <div className="mt-1">
                    <button
                      onClick={() => setShowNoGpsList((v) => !v)}
                      className="text-xs text-[var(--color-brand)] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <svg viewBox="0 0 12 12" className={`w-3 h-3 transition-transform ${showNoGpsList ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 2l4 4-4 4" />
                      </svg>
                      {showNoGpsList ? t('home.organize.exif.hideNoGpsList') : t('home.organize.exif.showNoGpsList', { count: photosWithoutGps.length })}
                    </button>
                    {showNoGpsList && (
                      <div className="mt-2 max-h-[360px] overflow-y-auto overflow-x-hidden space-y-1.5 pr-1 custom-scrollbar">
                        {photosWithoutGps.slice(0, noGpsList.visibleCount).map((p) => (
                          <NoGpsPhotoRow
                            key={p.id}
                            photo={p}
                            sourceMode={sourceMode}
                            readPhotoData={readPhotoData}
                            addToast={addToast}
                            onGpsUpdated={(newLon, newLat) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? { ...item, gpsLon: newLon, gpsLat: newLat } : item)))}
                          />
                        ))}
                        {/* 懒加载哨兵：滚动接近底部自动加载下一批，加载完消失 */}
                        {noGpsList.visibleCount < photosWithoutGps.length && <div ref={noGpsList.sentinelRef} className="h-1" />}
                      </div>
                    )}
                  </div>
                )}
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

// ── 无拍摄日期照片单行（自动识别文件名日期 + 单文件修改 EXIF） ─────────────

interface NoDatePhotoRowProps {
  photo: PhotoFileInfo;
  sourceMode: import('../../../photo-tools').DataSourceMode;
  readPhotoData: (photo: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>;
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
  /** 向父组件上报本行的「可转换 / 已录入日期」状态，驱动「全部转换 / 全部修改」候选与禁用态 */
  onReport: (id: string, r: { convert: boolean; date: Date | null }) => void;
  /** 日期写入成功后回调，传入新的 dateTaken ISO 字符串 */
  onDateUpdated: (newDateIso: string) => void;
  /** 转换格式成功后回调，传入更新后的 PhotoFileInfo（ext/path/name 变为 jpg） */
  onPhotoConverted: (updated: PhotoFileInfo) => void;
}

function NoDatePhotoRow({ photo, sourceMode, readPhotoData, addToast, onReport, onDateUpdated, onPhotoConverted }: NoDatePhotoRowProps) {
  const { t } = useTranslation();
  // 从文件名自动识别日期（parseFilenameDate 支持 9 种常见命名格式）
  const recognizedDate = useMemo(() => parseFilenameDate(photo.name), [photo.name]);
  const recognizedStr = recognizedDate ? formatDateForInput(recognizedDate) : '';

  // 输入框初始值：识别到则预填，未识别则空
  const [dateInput, setDateInput] = useState(recognizedStr);
  const [modifying, setModifying] = useState(false);
  const [converting, setConverting] = useState(false);
  const [done, setDone] = useState(false);
  // 修改失败标记：显示转格式按钮
  const [modifyFailed, setModifyFailed] = useState(false);

  const parsedDate = parseDateInput(dateInput);
  const canModify = !!parsedDate && !modifying && !done && !converting;
  // 非 JPEG 格式或修改失败时显示转格式按钮（JPEG 已可正常写 EXIF）
  const showConvertBtn = (modifyFailed || photo.ext !== '.jpg') && !done && !converting;
  // 上报用标记：忽略 converting 瞬时态，保证转换期间候选不丢失；完成/移出列表后清空
  const reportConvert = (modifyFailed || photo.ext !== '.jpg') && !done;

  // 向父组件上报本行候选状态（deps 用 dateInput 原始串而非 parsedDate，避免每次渲染的新 Date 引用引发父组件死循环）
  useEffect(() => {
    onReport(photo.id, { convert: reportConvert, date: done ? null : parsedDate });
  }, [photo.id, reportConvert, done, dateInput, onReport]);

  const handleModify = useCallback(async () => {
    if (!parsedDate || modifying || done) return;
    setModifying(true);
    setModifyFailed(false);
    try {
      const data = await readPhotoData(photo);
      if (!data) throw new Error(t('home.organize.exif.readFailed'));

      // 写入拍摄日期（这些照片无原日期，preserveTime 不适用，直接写入 parsedDate）
      const modified = await writeExifDate(data, photo.ext, parsedDate, undefined);

      // 保存：folder + Tauri 写回文件，library / Web 下载到本地
      if (isTauri() && photo.path && sourceMode === 'folder') {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(photo.path, new Uint8Array(modified));
      } else {
        downloadBlob(new Blob([modified], { type: photo.mimeType || 'image/jpeg' }), photo.name);
      }

      onDateUpdated(parsedDate.toISOString());
      setDone(true);
      addToast({ type: 'success', message: t('home.organize.exif.toastSingleSuccess', { name: photo.name, date: formatDateForInput(parsedDate) }) });
    } catch (err) {
      logger.warn(`[exif-single] ${photo.name}`, err);
      setModifyFailed(true);
      addToast({ type: 'error', message: t('home.organize.exif.toastSingleFailed', { name: photo.name, message: (err as Error).message }) });
    } finally {
      setModifying(false);
    }
  }, [parsedDate, modifying, done, readPhotoData, photo, sourceMode, onDateUpdated, addToast, t]);

  // 转换格式为 JPEG：读取原图 → convertToJpg → 写回文件（同目录同名 .jpg）
  // 转换成功后删除原文件，更新 photo 信息（ext/path/name），用户可重新修改
  const handleConvert = useCallback(async () => {
    if (converting) return;
    setConverting(true);
    try {
      const data = await readPhotoData(photo);
      if (!data) throw new Error(t('home.organize.exif.readFailed'));

      const { blob } = await convertToJpg(data, photo.ext, { quality: 0.95, filePath: photo.path });
      const jpgName = photo.name.replace(/\.[^.]+$/, '.jpg');

      if (isTauri() && photo.path && sourceMode === 'folder') {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const { invoke } = await import('@tauri-apps/api/core');
        const jpgPath = photo.path.replace(/\.[^.]+$/, '.jpg');
        const buf = await blob.arrayBuffer();
        await writeFile(jpgPath, new Uint8Array(buf));
        // 仅当新路径与原路径不同时才删除原文件（JPG 重编码时路径相同，无需删除）
        if (jpgPath !== photo.path) {
          try { await invoke('trash_files', { paths: [photo.path] }); } catch { /* ignore */ }
        }
        // 通知父组件更新照片信息
        onPhotoConverted({
          ...photo,
          name: jpgName,
          ext: '.jpg',
          mimeType: 'image/jpeg',
          path: jpgPath,
          relativePath: photo.relativePath ? photo.relativePath.replace(/\.[^.]+$/, '.jpg') : photo.relativePath,
          size: buf.byteLength,
        });
      } else {
        downloadBlob(blob, jpgName);
      }
      setModifyFailed(false);
      addToast({ type: 'success', message: t('home.organize.exif.convertSuccess', { name: photo.name }) });
    } catch (err) {
      logger.warn(`[exif-convert] ${photo.name}`, err);
      addToast({ type: 'error', message: t('home.organize.exif.convertFailed', { name: photo.name, message: (err as Error).message }) });
    } finally {
      setConverting(false);
    }
  }, [converting, readPhotoData, photo, sourceMode, onPhotoConverted, addToast, t]);

  if (done) {
    // 修改成功后显示简洁的成功状态（照片会被父组件移出无日期列表，但有动画过渡）
    return (
      <div className="px-2.5 py-2 rounded bg-green-50 text-green-700 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-6" />
          </svg>
          <span className="truncate">{photo.name}</span>
        </div>
        <span className="text-green-600 font-mono text-[10px]">{dateInput}</span>
      </div>
    );
  }

  // 点击文件名复制到剪贴板
  const handleCopyName = useCallback(async () => {
    const name = photo.name;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(name);
      } else {
        // 降级：隐藏 textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = name;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        document.body.removeChild(ta);
      }
    } catch { /* 剪贴板不可用时不报错，仍提示 */ }
    addToast({ type: 'info', message: t('home.organize.exif.copyNameToast', { name }) });
  }, [photo.name, addToast, t]);

  return (
    <div className="px-2.5 py-2 rounded bg-white/80 border border-[var(--color-border)]/50 flex gap-2 min-w-0">
      {/* 缩略图（拉伸到与右侧信息区等高，object-cover 铺满）；底部条标注识别状态 */}
      <div className="relative shrink-0 w-14 self-stretch overflow-hidden rounded border border-[var(--color-border)]/50">
        <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" aspect="fill" />
        <span
          className={`absolute left-0 right-0 bottom-0 text-[9px] leading-[13px] text-center font-medium ${
            recognizedDate ? 'bg-green-600/85 text-white' : 'bg-black/40 text-white/90'
          }`}
        >
          {recognizedDate ? t('home.organize.exif.autoRecognized') : t('home.organize.exif.notRecognized')}
        </span>
      </div>
      {/* 右侧信息区 */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* 文件名字：点击快捷复制 */}
        <button
          type="button"
          onClick={handleCopyName}
          title={t('home.organize.exif.copyNameHint')}
          className="flex items-center gap-1 min-w-0 w-full text-left group cursor-pointer"
        >
          <span className="text-xs text-[var(--color-gray-700)] truncate group-hover:text-[var(--color-brand)]">{photo.name}</span>
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 text-[var(--color-gray-400)] group-hover:text-[var(--color-brand)]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2.5" width="6" height="7" rx="1" />
            <path d="M8 2.5v-.5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
          </svg>
        </button>
        {/* 日期输入框 */}
        <input
          type="text"
          placeholder={t('home.organize.exif.singleDatePlaceholder')}
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canModify) handleModify(); }}
          className={`w-full min-w-0 px-2 py-1 rounded text-xs border focus:outline-none transition-colors ${
            dateInput && !parsedDate
              ? 'border-red-300 text-red-600'
              : 'border-[var(--color-border)] text-[var(--color-gray-700)] focus:border-[var(--color-brand)]'
          }`}
        />
        {/* 无效日期 / 修改失败提示 */}
        {dateInput && !parsedDate && (
          <p className="text-[10px] text-red-500">{t('home.organize.exif.invalidDateFormat')}</p>
        )}
        {modifyFailed && (
          <p className="text-[10px] text-orange-600 leading-relaxed">{t('home.organize.exif.fixAllHint')}</p>
        )}
        {/* 按钮行 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleModify}
            disabled={!canModify}
            className="shrink-0 px-2.5 py-1 rounded text-xs font-[600] border-none cursor-pointer transition-all
                       bg-[var(--color-brand)] text-white hover:opacity-90
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {modifying ? t('home.organize.exif.modifying') : t('home.organize.exif.modify')}
          </button>
          {showConvertBtn && (
            <button
              onClick={handleConvert}
              disabled={converting || modifying}
              className="shrink-0 px-2 py-1 rounded text-xs font-[600] border-none cursor-pointer transition-all
                         bg-orange-500 text-white hover:opacity-90
                         disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('home.organize.exif.convertFormat')}
            >
              {converting ? t('home.organize.exif.converting') : t('home.organize.exif.convertFormat')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 无 GPS 照片单行（输入坐标/地名 + 单文件写入 GPS EXIF） ─────────────

interface NoGpsPhotoRowProps {
  photo: PhotoFileInfo;
  sourceMode: import('../../../photo-tools').DataSourceMode;
  readPhotoData: (photo: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>;
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
  /** GPS 写入成功后回调，传入新的经度和纬度 */
  onGpsUpdated: (newLon: number, newLat: number) => void;
}

function NoGpsPhotoRow({ photo, sourceMode, readPhotoData, addToast, onGpsUpdated }: NoGpsPhotoRowProps) {
  const { t } = useTranslation();
  const [lonInput, setLonInput] = useState('');
  const [latInput, setLatInput] = useState('');
  const [placeInput, setPlaceInput] = useState('');
  const [modifying, setModifying] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [done, setDone] = useState(false);

  const parsedLon = parseFloat(lonInput);
  const parsedLat = parseFloat(latInput);
  const hasCoord =
    lonInput.trim() !== '' && latInput.trim() !== '' &&
    !Number.isNaN(parsedLon) && !Number.isNaN(parsedLat) &&
    parsedLon >= -180 && parsedLon <= 180 && parsedLat >= -90 && parsedLat <= 90;
  const canModify = hasCoord && !modifying && !done;

  const handleGeocode = useCallback(async () => {
    if (!placeInput.trim() || querying) return;
    setQuerying(true);
    try {
      const result = await geocode(placeInput);
      if (result) {
        setLonInput(result.lon.toFixed(6));
        setLatInput(result.lat.toFixed(6));
        addToast({ type: 'success', message: t('home.organize.exif.toastLocated', { name: result.displayName.slice(0, 40) }) });
      } else {
        addToast({ type: 'error', message: t('home.organize.exif.toastPlaceNotFound') });
      }
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.exif.toastGeocodeFailed', { message: (err as Error).message }) });
    } finally {
      setQuerying(false);
    }
  }, [placeInput, querying, addToast, t]);

  const handleModify = useCallback(async () => {
    if (!hasCoord || modifying || done) return;
    setModifying(true);
    try {
      const data = await readPhotoData(photo);
      if (!data) throw new Error(t('home.organize.exif.readFailed'));

      const modified = await writeExifGps(data, photo.ext, parsedLon, parsedLat);

      if (isTauri() && photo.path && sourceMode === 'folder') {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(photo.path, new Uint8Array(modified));
      } else {
        downloadBlob(new Blob([modified], { type: photo.mimeType || 'image/jpeg' }), photo.name);
      }

      onGpsUpdated(parsedLon, parsedLat);
      setDone(true);
      addToast({
        type: 'success',
        message: t('home.organize.exif.toastSingleGpsSuccess', { name: photo.name, lon: parsedLon.toFixed(6), lat: parsedLat.toFixed(6) }),
      });
    } catch (err) {
      logger.warn(`[exif-gps-single] ${photo.name}`, err);
      addToast({ type: 'error', message: t('home.organize.exif.toastSingleGpsFailed', { name: photo.name, message: (err as Error).message }) });
    } finally {
      setModifying(false);
    }
  }, [hasCoord, modifying, done, readPhotoData, photo, sourceMode, parsedLon, parsedLat, onGpsUpdated, addToast, t]);

  if (done) {
    return (
      <div className="text-xs px-2.5 py-1.5 rounded bg-green-50 text-green-700 flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6l3 3 5-6" />
        </svg>
        <span className="truncate flex-1" title={photo.name}>{photo.name}</span>
        <span className="shrink-0 text-green-600 font-mono">{parsedLon.toFixed(4)},{parsedLat.toFixed(4)}</span>
      </div>
    );
  }

  return (
    <div className="px-2.5 py-2 rounded bg-white/80 border border-[var(--color-border)]/50 space-y-1.5">
      {/* 第一行：文件名 + 状态标记 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs text-[var(--color-gray-700)] truncate flex-1" title={photo.relativePath || photo.name}>
          {photo.name}
        </span>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-gray-100)] text-[var(--color-gray-400)]">
          {t('home.organize.exif.noGpsBadge')}
        </span>
      </div>
      {/* 第二行：地名查询（可选） */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          placeholder={t('home.organize.exif.placeNamePlaceholder')}
          value={placeInput}
          onChange={(e) => setPlaceInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && placeInput.trim()) handleGeocode(); }}
          className="flex-1 min-w-0 px-2 py-1 rounded text-xs border border-[var(--color-border)] text-[var(--color-gray-700)] focus:outline-none focus:border-[var(--color-brand)]"
        />
        <button
          onClick={handleGeocode}
          disabled={!placeInput.trim() || querying}
          className="shrink-0 px-2 py-1 rounded text-xs border-none cursor-pointer bg-[var(--color-gray-100)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-200)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {querying ? t('home.organize.exif.querying') : t('home.organize.exif.query')}
        </button>
      </div>
      {/* 第三行：经纬度输入 + 修改按钮 */}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step="0.000001"
          placeholder={t('home.organize.exif.longitudeShort')}
          value={lonInput}
          onChange={(e) => setLonInput(e.target.value)}
          className={`w-[80px] shrink-0 px-2 py-1 rounded text-xs border focus:outline-none transition-colors ${
            lonInput && !hasCoord
              ? 'border-red-300 text-red-600'
              : 'border-[var(--color-border)] text-[var(--color-gray-700)] focus:border-[var(--color-brand)]'
          }`}
        />
        <input
          type="number"
          step="0.000001"
          placeholder={t('home.organize.exif.latitudeShort')}
          value={latInput}
          onChange={(e) => setLatInput(e.target.value)}
          className={`w-[80px] shrink-0 px-2 py-1 rounded text-xs border focus:outline-none transition-colors ${
            latInput && !hasCoord
              ? 'border-red-300 text-red-600'
              : 'border-[var(--color-border)] text-[var(--color-gray-700)] focus:border-[var(--color-brand)]'
          }`}
        />
        <button
          onClick={handleModify}
          disabled={!canModify}
          className="shrink-0 px-2.5 py-1 rounded text-xs font-[600] border-none cursor-pointer transition-all
                     bg-[var(--color-brand)] text-white hover:opacity-90
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {modifying ? t('home.organize.exif.modifying') : t('home.organize.exif.modify')}
        </button>
      </div>
      {(lonInput || latInput) && !hasCoord && (
        <p className="text-[10px] text-red-500">{t('home.organize.exif.invalidCoord')}</p>
      )}
    </div>
  );
}
