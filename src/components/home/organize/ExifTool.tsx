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
import { PhotoQuickView } from './PhotoQuickView';
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

export type ExifFilter = 'all' | 'noDate' | 'noGps' | 'both' | 'complete';

/**
 * 判断照片是否有「实际可用」的 GPS 坐标。
 * 仅当 lng/lat 都是有效数字，且不是 (0,0)（无定位时设备常写入零坐标）、且在合法范围内才算有 GPS。
 * 供列表过滤（candidatePhotos）、批量范围（effectivePhotos）、卡片渲染（NoDatePhotoRow）统一使用。
 */
export function hasGps(p: { gpsLat?: number; gpsLon?: number }): boolean {
  const { gpsLat, gpsLon } = p;
  if (typeof gpsLat !== 'number' || typeof gpsLon !== 'number') return false;
  if (gpsLat === 0 && gpsLon === 0) return false;
  return gpsLon >= -180 && gpsLon <= 180 && gpsLat >= -90 && gpsLat <= 90;
}

// 批量输入区统一控件样式（目标日期 / 位置两列共用，保证视觉一致）
const EXIF_FIELD_LABEL_CLS =
  'block text-[11px] font-[600] text-[var(--color-gray-600)] mb-1';
const EXIF_INPUT_CLS =
  'w-full min-w-0 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-gray-700)] placeholder-[var(--color-gray-400)] focus:outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15 transition-colors';
const EXIF_PANEL_CLS =
  'rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)]/60 p-3 space-y-2 min-w-0 flex flex-col';

export function ExifTool({ photos, sourceMode, readPhotoData, onPhotosUpdate, addToast, onBusyChange, proFeature, checkProFeature, albumActive, onAlbumChange }: ToolProps) {
  const { t } = useTranslation();

  // 筛选条件：决定待补照片列表展示范围（合并日期 + GPS，不在顶部切表）
  const [filter, setFilter] = useState<ExifFilter>('all');

  // 日期表单
  const [dateInput, setDateInput] = useState('');
  const [preserveTime, setPreserveTime] = useState(true);
  const [excludeSorted, setExcludeSorted] = useState(true);

  // GPS 表单
  const [gpsMode, setGpsMode] = useState<'coord' | 'place'>('coord');
  const [lon, setLon] = useState('');
  const [lat, setLat] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [geocoding, setGeocoding] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 无拍摄日期照片列表展开/折叠（默认展开，便于直接查看照片卡片）
  const [showNoDateList, setShowNoDateList] = useState(true);
  // 无日期照片大图预览（点击缩略图查看大图，支持左右切换）
  const [preview, setPreview] = useState<{ list: PhotoFileInfo[]; index: number } | null>(null);
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

  const parsedDate = parseDateInput(dateInput);

  // 按是否已有拍摄日期分组统计（memo 保持引用稳定，避免上报触发面板重渲染）
  const photosWithDate = useMemo(() => writablePhotos.filter((p) => !!p.dateTaken), [writablePhotos]);

  // 按是否已有「实际可用」GPS 判定（复用共享的 hasGps，排除 0,0 / 越界坐标）

  // 待补照片（缺日期或缺 GPS）按筛选条件过滤 — 合并日期与 GPS 后统一在此展示与批量处理
  const candidatePhotos = useMemo<PhotoFileInfo[]>(
    () =>
      writablePhotos.filter((p) => {
        const noDate = !p.dateTaken;
        const noGps = !hasGps(p);
        if (filter === 'noDate') return noDate;
        if (filter === 'noGps') return noGps;
        if (filter === 'both') return noDate && noGps;
        if (filter === 'complete') return !noDate && !noGps;
        return noDate || noGps; // 'all'
      }),
    [writablePhotos, filter],
  );

  // 待补照片列表懒加载（初始一批 200，滚动到底自动追加，最终全部可展示）；切换筛选时重置回首批，避免旧筛选收敛导致新列表首屏为空
  const candidateList = useLazyList(candidatePhotos.length, 200, filter);

  // 各筛选条件下的待补照片数量（用于筛选按钮右上角计数显示）
  const filterCounts = useMemo(() => {
    const counts: Record<ExifFilter, number> = { all: 0, noDate: 0, noGps: 0, both: 0, complete: 0 };
    for (const p of writablePhotos) {
      const noDate = !p.dateTaken;
      const noGps = !hasGps(p);
      if (noDate) counts.noDate++;
      if (noGps) counts.noGps++;
      if (noDate && noGps) counts.both++;
      if (noDate || noGps) counts.all++;
      if (!noDate && !noGps) counts.complete++;
    }
    return counts;
  }, [writablePhotos]);

  // 大图预览：点击缩略图打开（预览列表与网格一致，支持左右切换）
  const openNoDatePreview = useCallback((index: number) => {
    setPreview({ list: candidatePhotos, index });
  }, [candidatePhotos]);

  // 上报「当前有效结果集」：已具备有效拍摄日期的照片可统一加入相册
  useEffect(() => {
    if (albumActive) onAlbumChange?.(photosWithDate.length > 0 ? photosWithDate : null);
  }, [albumActive, onAlbumChange, photosWithDate]);

  // 实际要批量处理的照片 = 当前筛选下的待补照片
  const effectivePhotos = candidatePhotos;

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
    effectivePhotos.length > 0 && (!!parsedDate || (!!lon && !!lat));

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
          const hasDateVal = !!parsedDate;
          const hasGpsVal = !!lon && !!lat;
          if (hasDateVal) {
            const oldDate = photo.dateTaken ? new Date(photo.dateTaken) : undefined;
            modified = await writeExifDate(modified, photo.ext, parsedDate!, preserveTime ? oldDate : undefined);
          }
          if (hasGpsVal) {
            modified = await writeExifGps(modified, photo.ext, parseFloat(lon), parseFloat(lat));
          }
          if (!hasDateVal && !hasGpsVal) throw new Error('没有可写入的内容');

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
          {/* 筛选条件：待补照片（缺日期 / 缺GPS）范围 */}
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'noDate', 'noGps', 'both', 'complete'] as ExifFilter[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-[600] border-none cursor-pointer transition-all inline-flex items-center gap-1.5 ${
                    filter === key ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)]'
                  }`}
                >
                  {t(`home.organize.exif.filter.${key}`)}
                  <span className={`min-w-4 text-center text-[10px] leading-[14px] px-1 rounded-full ${
                    filter === key ? 'bg-white/25' : 'bg-white/70 text-[var(--color-gray-500)]'
                  }`}>
                    {filterCounts[key]}
                  </span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)] cursor-pointer">
              <input type="checkbox" checked={excludeSorted} onChange={(e) => setExcludeSorted(e.target.checked)} className="cursor-pointer" />
              {t('home.organize.exif.excludeSorted')}
            </label>
          </div>

          {/* 统一批量输入：目标日期 + 位置（左右两列，统一卡片视觉，尽量少占纵向空间） */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* 左列：目标日期 */}
            <div className={EXIF_PANEL_CLS}>
              <div className="flex items-center gap-1.5">
                <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-[var(--color-brand)]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2.5" width="10" height="9.5" rx="1.5" />
                  <line x1="2" y1="5.5" x2="12" y2="5.5" />
                  <line x1="4.8" y1="1" x2="4.8" y2="3" />
                  <line x1="9.2" y1="1" x2="9.2" y2="3" />
                </svg>
                <span className="text-xs font-[600] text-[var(--color-gray-800)]">{t('home.organize.exif.targetDate')}</span>
              </div>
              <div className="min-w-0">
                <input
                  type="text"
                  placeholder={t('home.organize.exif.targetDatePlaceholder')}
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className={EXIF_INPUT_CLS}
                />
                {dateInput && !parsedDate && (
                  <span className="flex items-center gap-1 text-[11px] text-red-500 mt-1">
                    <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="6" r="4.4" /><line x1="6" y1="3.4" x2="6" y2="6.4" /><line x1="6" y1="8" x2="6" y2="8" /></svg>
                    {t('home.organize.exif.invalidDateFormat')}
                  </span>
                )}
                {parsedDate && (
                  <span className="flex items-center gap-1 text-[11px] text-green-600 mt-1">
                    <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-6" /></svg>
                    {t('home.organize.exif.parsedAs', { date: parsedDate.toLocaleString('zh-CN') })}
                  </span>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-gray-600)] cursor-pointer select-none mt-auto pt-0.5">
                <input type="checkbox" checked={preserveTime} onChange={(e) => setPreserveTime(e.target.checked)} className="accent-[var(--color-brand)] cursor-pointer" />
                <span>{t('home.organize.exif.preserveTime')}</span>
              </label>
            </div>

            {/* 右列：位置 */}
            <div className={EXIF_PANEL_CLS}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-[var(--color-brand)]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 12.5s-4-3.4-4-6.4a4 4 0 1 1 8 0c0 3-4 6.4-4 6.4z" />
                    <circle cx="7" cy="6" r="1.4" />
                  </svg>
                  <span className="text-xs font-[600] text-[var(--color-gray-800)]">{t('home.organize.exif.positionTitle')}</span>
                </div>
                {/* 输入方式：坐标 / 地名 */}
                <div className="flex p-0.5 rounded-lg bg-[var(--color-gray-100)]">
                  {(['coord', 'place'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setGpsMode(mode)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-[600] border-none cursor-pointer transition-all ${
                        gpsMode === mode ? 'bg-white text-[var(--color-brand)] shadow-sm' : 'text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
                      }`}
                    >
                      {t(`home.organize.exif.gpsMode${mode === 'coord' ? 'Coord' : 'Place'}`)}
                    </button>
                  ))}
                </div>
              </div>

              {gpsMode === 'place' ? (
                <div className="flex gap-2 items-stretch">
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      placeholder={t('home.organize.exif.placeNamePlaceholder')}
                      value={placeName}
                      onChange={(e) => setPlaceName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
                      className={EXIF_INPUT_CLS}
                    />
                  </div>
                  <PrimaryButton onClick={handleGeocode} loading={geocoding} variant="ghost">
                    {t('home.organize.exif.query')}
                  </PrimaryButton>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="min-w-0">
                    <span className={EXIF_FIELD_LABEL_CLS}>{t('home.organize.exif.longitude')}</span>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="116.397128"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      className={EXIF_INPUT_CLS}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className={EXIF_FIELD_LABEL_CLS}>{t('home.organize.exif.latitude')}</span>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="39.916527"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      className={EXIF_INPUT_CLS}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

            {/* 待补照片列表（按筛选条件展示；每张卡片可单独改日期 / 坐标） */}
            {candidatePhotos.length > 0 && (
              <div className="mt-1 border-t border-[var(--color-border)]/60 pt-2">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 flex-wrap bg-[var(--color-surface-panel)]/95 backdrop-blur-sm rounded-lg py-1.5 px-1 shadow-[var(--shadow-sm)]">
                  <button
                    onClick={() => setShowNoDateList((v) => !v)}
                    className="text-xs text-[var(--color-brand)] hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <svg viewBox="0 0 12 12" className={`w-3 h-3 transition-transform ${showNoDateList ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    {showNoDateList ? t('home.organize.exif.hideNoDateList') : t('home.organize.exif.showNoDateList', { count: candidatePhotos.length })}
                  </button>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={handleConvertAll}
                      disabled={convertingAll || busy || convertCandidates.length === 0}
                      className="px-2.5 py-1 rounded-md text-xs font-[600] border-none cursor-pointer transition-all
                                 bg-orange-500 text-white hover:opacity-90
                                 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      title={t('home.organize.exif.convertAllHint')}
                    >
                      <svg viewBox="0 0 14 14" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7a5 5 0 0 1 8.5-3.5L12 5" /><path d="M12 2v3h-3" /><path d="M12 7a5 5 0 0 1-8.5 3.5L2 9" /><path d="M2 12V9h3" /></svg>
                      {convertingAll ? t('home.organize.exif.convertingAll') : t('home.organize.exif.convertAll')}
                    </button>
                    <button
                      onClick={handleWriteAll}
                      disabled={writingAll || busy || modifyCandidates.length === 0}
                      className="px-2.5 py-1 rounded-md text-xs font-[600] border-none cursor-pointer transition-all
                                 bg-[var(--color-brand)] text-white hover:opacity-90
                                 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      title={t('home.organize.exif.writeAllHint')}
                    >
                      <svg viewBox="0 0 14 14" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
                      {writingAll ? t('home.organize.exif.writingAll') : t('home.organize.exif.writeAll')}
                    </button>
                  </div>
                </div>
                {showNoDateList && (
                  <div className="mt-2 max-h-[56vh] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
                    {/* 照片卡片网格：点击缩略图查看大图；卡内按缺失项显示日期 / 坐标编辑 */}
                    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                      {candidatePhotos.slice(0, candidateList.visibleCount).map((p, idx) => (
                        <NoDatePhotoRow
                          key={p.id}
                          photo={p}
                          sourceMode={sourceMode}
                          readPhotoData={readPhotoData}
                          addToast={addToast}
                          onReport={handleReport}
                          onPreview={() => openNoDatePreview(idx)}
                          onDateUpdated={(newDate) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? { ...item, dateTaken: newDate } : item)))}
                          onGpsUpdated={(newLon, newLat) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? { ...item, gpsLon: newLon, gpsLat: newLat } : item)))}
                          onPhotoConverted={(updated) => onPhotosUpdate((prev) => prev.map((item) => (item.id === p.id ? updated : item)))}
                        />
                      ))}
                    </div>
                    {/* 懒加载哨兵：滚动接近底部自动加载下一批，加载完消失 */}
                    {candidateList.visibleCount < candidatePhotos.length && <div ref={candidateList.sentinelRef} className="h-1" />}
                  </div>
                )}
                <p className="text-[10px] text-[var(--color-gray-400)] leading-tight mt-1">
                  {t('home.organize.exif.batchHint')}
                </p>
              </div>
            )}
            <p className="text-xs text-[var(--color-gray-400)] leading-relaxed">
            {t('home.organize.exif.mergeHint')}
          </p>

          {/* 操作区 */}
          <div className="mt-4">
            {(!isDesktop || sourceMode === 'library') && (
              <p className="text-xs text-[var(--color-gray-500)] mb-2">{sourceMode === 'library' ? t('home.organize.exif.libraryDownloadHint') : t('home.organize.exif.webDownloadHint')}</p>
            )}
            <PrimaryButton onClick={handleExecute} disabled={!canExecute} loading={running}>
              {t('home.organize.exif.executeMerge', { count: effectivePhotos.length })}
            </PrimaryButton>
            <ProgressBar progress={progress} />
          </div>
        </>
      )}
      {/* 无日期照片大图预览（点击缩略图打开，支持左右切换） */}
      {preview && (
        <PhotoQuickView
          photos={preview.list}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
          readPhotoData={readPhotoData}
        />
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
  /** 坐标写入成功后回调，传入新的经度和纬度 */
  onGpsUpdated: (newLon: number, newLat: number) => void;
  /** 转换格式成功后回调，传入更新后的 PhotoFileInfo（ext/path/name 变为 jpg） */
  onPhotoConverted: (updated: PhotoFileInfo) => void;
  /** 点击缩略图查看大图 */
  onPreview?: () => void;
}

function NoDatePhotoRow({ photo, sourceMode, readPhotoData, addToast, onReport, onDateUpdated, onGpsUpdated, onPhotoConverted, onPreview }: NoDatePhotoRowProps) {
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

  // 该照片是否缺失日期 / GPS（决定卡片展示哪类编辑区）
  const hasGpsVal = hasGps(photo);
  const needsDate = !photo.dateTaken;
  const needsGps = !hasGpsVal;

  // GPS 编辑状态（可选：坐标直填）
  const [gpsLonInput, setGpsLonInput] = useState(photo.gpsLon != null ? String(photo.gpsLon) : '');
  const [gpsLatInput, setGpsLatInput] = useState(photo.gpsLat != null ? String(photo.gpsLat) : '');
  const [gpsModifying, setGpsModifying] = useState(false);
  const [gpsDone, setGpsDone] = useState(false);
  const [gpsFailed, setGpsFailed] = useState(false);
  const parsedGpsLon = parseFloat(gpsLonInput);
  const parsedGpsLat = parseFloat(gpsLatInput);
  const canModifyGps =
    !Number.isNaN(parsedGpsLon) && !Number.isNaN(parsedGpsLat) &&
    parsedGpsLon >= -180 && parsedGpsLon <= 180 && parsedGpsLat >= -90 && parsedGpsLat <= 90 &&
    !gpsModifying && !gpsDone && needsGps;

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

  // 单独写入该照片的 GPS 坐标（写入 EXIF，folder+Tauri 写回文件，其他模式下载）
  const handleModifyGps = useCallback(async () => {
    if (!canModifyGps) return;
    setGpsModifying(true);
    setGpsFailed(false);
    try {
      const data = await readPhotoData(photo);
      if (!data) throw new Error(t('home.organize.exif.readFailed'));

      const modified = await writeExifGps(data, photo.ext, parsedGpsLon, parsedGpsLat);

      if (isTauri() && photo.path && sourceMode === 'folder') {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(photo.path, new Uint8Array(modified));
      } else {
        downloadBlob(new Blob([modified], { type: photo.mimeType || 'image/jpeg' }), photo.name);
      }

      onGpsUpdated(parsedGpsLon, parsedGpsLat);
      setGpsDone(true);
      addToast({ type: 'success', message: t('home.organize.exif.toastSingleGpsSuccess', { name: photo.name, lon: parsedGpsLon.toFixed(6), lat: parsedGpsLat.toFixed(6) }) });
    } catch (err) {
      logger.warn(`[exif-gps-single] ${photo.name}`, err);
      setGpsFailed(true);
      addToast({ type: 'error', message: t('home.organize.exif.toastSingleGpsFailed', { name: photo.name, message: (err as Error).message }) });
    } finally {
      setGpsModifying(false);
    }
  }, [canModifyGps, parsedGpsLon, parsedGpsLat, readPhotoData, photo, sourceMode, onGpsUpdated, addToast, t]);

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
    <div className="overflow-hidden rounded-lg bg-white/80 border border-[var(--color-border)]/50 flex flex-col min-w-0 shadow-sm">
      {/* 大缩略图：点击查看大图（与截图识别一致） */}
      <button
        type="button"
        onClick={onPreview}
        title={t('home.organize.exif.viewLarge')}
        className="relative w-full aspect-[4/3] overflow-hidden cursor-zoom-in bg-black/5 group border-b border-[var(--color-border)]/40"
      >
        <ThumbImage photo={photo} readPhotoData={readPhotoData} size="medium" aspect="4/3" />
        {/* hover 放大提示 */}
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white bg-black/0 group-hover:bg-black/30 transition-colors opacity-0 group-hover:opacity-100">
          {t('home.organize.exif.viewLarge')}
        </span>
        {/* 自动识别状态角标 */}
        <span
          className={`absolute left-1.5 top-1.5 text-[9px] leading-[14px] px-1 rounded font-medium ${
            recognizedDate ? 'bg-green-600/90 text-white' : 'bg-black/40 text-white/90'
          }`}
        >
          {recognizedDate ? t('home.organize.exif.autoRecognized') : t('home.organize.exif.notRecognized')}
        </span>
      </button>
      {/* 底部信息 + 操作 */}
      <div className="px-2 py-2 space-y-2 flex-1 min-w-0">
        {/* 文件名 + 复制 */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[11px] text-[var(--color-gray-700)] truncate flex-1" title={photo.name}>{photo.name}</span>
          <button
            type="button"
            onClick={handleCopyName}
            title={t('home.organize.exif.copyNameHint')}
            className="shrink-0 text-[var(--color-gray-400)] hover:text-[var(--color-brand)] cursor-pointer"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2.5" width="6" height="7" rx="1" />
              <path d="M8 2.5v-.5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
            </svg>
          </button>
        </div>

        {/* 日期编辑区（仅当缺拍摄日期） */}
        {needsDate && (
          <div className="space-y-1">
            {done ? (
              <div className="px-1.5 py-1 rounded bg-green-50 text-green-700 flex items-center gap-1 text-[11px]">
                <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-6" /></svg>
                <span className="truncate">{dateInput}</span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder={t('home.organize.exif.singleDatePlaceholder')}
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canModify) handleModify(); }}
                  className={`w-full min-w-0 px-1.5 py-1 rounded text-xs border focus:outline-none transition-colors ${
                    dateInput && !parsedDate
                      ? 'border-red-300 text-red-600'
                      : 'border-[var(--color-border)] text-[var(--color-gray-700)] focus:border-[var(--color-brand)]'
                  }`}
                />
                {dateInput && !parsedDate && (
                  <p className="text-[10px] text-red-500">{t('home.organize.exif.invalidDateFormat')}</p>
                )}
                {modifyFailed && (
                  <p className="text-[10px] text-orange-600 leading-relaxed">{t('home.organize.exif.fixAllHint')}</p>
                )}
                <button
                  onClick={handleModify}
                  disabled={!canModify}
                  className="w-full px-2 py-1 rounded text-[11px] font-[600] border-none cursor-pointer transition-all
                             bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {modifying ? t('home.organize.exif.modifying') : t('home.organize.exif.modify')}
                </button>
              </>
            )}
          </div>
        )}

        {/* GPS 编辑区（仅当缺 GPS 坐标） */}
        {needsGps && (
          <div className="space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <input
                type="number"
                step="0.000001"
                placeholder={t('home.organize.exif.longitude')}
                value={gpsLonInput}
                onChange={(e) => setGpsLonInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canModifyGps) handleModifyGps(); }}
                className="w-full min-w-0 px-1.5 py-1 rounded text-[11px] border border-[var(--color-border)] text-[var(--color-gray-700)] focus:outline-none focus:border-[var(--color-brand)]"
              />
              <input
                type="number"
                step="0.000001"
                placeholder={t('home.organize.exif.latitude')}
                value={gpsLatInput}
                onChange={(e) => setGpsLatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canModifyGps) handleModifyGps(); }}
                className="w-full min-w-0 px-1.5 py-1 rounded text-[11px] border border-[var(--color-border)] text-[var(--color-gray-700)] focus:outline-none focus:border-[var(--color-brand)]"
              />
            </div>
            {(gpsFailed || gpsDone) && (
              <p className={`text-[10px] leading-tight ${gpsDone ? 'text-green-600' : 'text-red-500'}`}>
                {gpsDone ? `${gpsLonInput},${gpsLatInput}` : t('home.organize.exif.toastSingleGpsFailed', { name: photo.name, message: '' })}
              </p>
            )}
            <button
              onClick={handleModifyGps}
              disabled={!canModifyGps}
              className="w-full px-2 py-1 rounded text-[11px] font-[600] border-none cursor-pointer transition-all
                         bg-teal-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {gpsModifying ? t('home.organize.exif.writingGps') : t('home.organize.exif.writeGps')}
            </button>
          </div>
        )}

        {/* 转格式（非 JPEG / 日期修改失败时出现） */}
        {showConvertBtn && (
          <button
            onClick={handleConvert}
            disabled={converting || modifying}
            className="w-full px-2 py-1 rounded text-[11px] font-[600] border-none cursor-pointer transition-all
                       bg-orange-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('home.organize.exif.convertFormat')}
          >
            {converting ? t('home.organize.exif.converting') : t('home.organize.exif.convertFormat')}
          </button>
        )}
      </div>
    </div>
  );
}
