/**
 * CalendarView — 日历视图
 *
 * 月历方式展示照片：
 * - 7 列网格（周一到周日为首列），每格显示当天照片数 + 缩略图（1-3 张叠加，异步加载）
 * - 上一月 / 下一月切换 + 当前月份显示
 * - 异常日期标记（年份 < 2000 或 > 当前年+1 标红）
 * - 点击某天展开当天照片列表（缩略图网格，支持单选/全选）
 * - 固定"加入相册"按钮（未选照片时置灰并提示）
 *
 * 顶部用按月分组（TimelineGroup）统计当月照片数，作为月份切换栏的辅助信息。
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePhotoDate, type PhotoFileInfo, type TimelineGroup } from '../../../photo-tools';
import { ThumbImage, ThumbWithMenu, deletePhotos } from './shared';
import { PhotoQuickView } from './PhotoQuickView';

/** 当前年份（用于异常日期判断） */
const CURRENT_YEAR = new Date().getFullYear();

/** 判断日期是否异常：年份 < 2000 或 > 当前年+1 */
function isAnomalyYear(year: number): boolean {
  return year < 2000 || year > CURRENT_YEAR + 1;
}

/** 生成日期键 YYYY-MM-DD（用于按天分组） */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 判断两个 Date 是否同一天 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 按年-月分组（复用 TimelineGroup 类型）
 * 用于统计各月份照片数，供日历头部"本月 N 张"展示。
 */
function groupByMonth(photos: PhotoFileInfo[]): TimelineGroup[] {
  const map = new Map<string, TimelineGroup>();
  for (const photo of photos) {
    const date = resolvePhotoDate(photo);
    if (!date) continue;
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    let g = map.get(key);
    if (!g) {
      g = { key, year, month, photos: [], hasAnomaly: false };
      map.set(key, g);
    }
    g.photos.push(photo);
    if (isAnomalyYear(year)) g.hasAnomaly = true;
  }
  return [...map.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.month - a.month,
  );
}

/** 按天分组：返回 dayKey → 当天照片列表 */
function groupByDay(photos: PhotoFileInfo[]): Map<string, PhotoFileInfo[]> {
  const map = new Map<string, PhotoFileInfo[]>();
  for (const photo of photos) {
    const date = resolvePhotoDate(photo);
    if (!date) continue;
    const key = dayKey(date);
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(photo);
  }
  return map;
}

/**
 * 日历格子内的小缩略图（最多 5 张，照片间留间隙、尺寸更大）
 */
function StackedThumb({
  photo,
  readPhotoData,
}: {
  photo: PhotoFileInfo;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
}) {
  return (
    <div className="w-11 h-11 rounded-md shrink-0 overflow-hidden border border-white shadow-sm bg-[var(--color-gray-200)]">
      <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" />
    </div>
  );
}

/** 选中日期展开列表中的缩略图（较大，可点击选中；支持查看/删除） */
function DayGridThumb({
  photo,
  anomaly,
  anomalyLabel,
  selected,
  readPhotoData,
  onClick,
  onView,
  onDelete,
}: {
  photo: PhotoFileInfo;
  anomaly: boolean;
  anomalyLabel: string;
  selected: boolean;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  onClick: () => void;
  onView: () => void;
  onDelete: () => void;
}) {
  return (
    <ThumbWithMenu
      photo={photo}
      readPhotoData={readPhotoData}
      selected={selected}
      anomaly={anomaly}
      anomalyLabel={anomalyLabel}
      onClick={onClick}
      onView={onView}
      onDelete={onDelete}
    />
  );
}

export function CalendarView({
  photos,
  readPhotoData,
  selectedIds,
  onSelectionChange,
  initialView,
  sourceMode,
  onPhotosUpdate,
  addToast,
}: {
  photos: PhotoFileInfo[];
  /** 读取照片数据（统一入口，用于缩略图异步加载） */
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 当前选中照片 ID 集合（由父组件管理，支持加入相册联动） */
  selectedIds: Set<string>;
  /** 选择变化回调 */
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** 初始查看的年/月（从时间线"在日历中查看"跳转） */
  initialView?: { year: number; month: number };
  /** 数据来源模式（删除照片时区分 library / folder） */
  sourceMode: 'folder' | 'library';
  /** 更新照片列表（删除后刷新） */
  onPhotosUpdate: (updater: (prev: PhotoFileInfo[]) => PhotoFileInfo[]) => void;
  /** 全局 toast 提示 */
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
}) {
  const { t } = useTranslation();

  // 周一为首的星期标题（i18n 数组）
  const weekdays = useMemo(() => {
    const raw = t('home.organize.calendar.weekdays', { returnObjects: true }) as unknown;
    return Array.isArray(raw) ? (raw as string[]) : ['一', '二', '三', '四', '五', '六', '日'];
  }, [t]);

  // 按月分组（用于头部"本月 N 张"）+ 按天分组（用于日历格子）
  const monthGroups = useMemo(() => groupByMonth(photos), [photos]);
  const byDay = useMemo(() => groupByDay(photos), [photos]);

  const today = new Date();
  // 当前查看的年/月（合并为单一状态，便于函数式更新）；支持 initialView 跳转
  const [view, setView] = useState(() =>
    initialView
      ? { year: initialView.year, month: initialView.month - 1 } // initialView.month 是 1-12，Date month 是 0-11
      : { year: today.getFullYear(), month: today.getMonth() },
  );
  // 选中的日期
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // 响应 initialView 变化：从时间线“在日历中查看”跳转后，即使日历已挂载也能重新定位到目标月份
  useEffect(() => {
    if (!initialView) return;
    setView({ year: initialView.year, month: initialView.month - 1 });
    setSelectedDay(null);
  }, [initialView]);

  // 上一月 / 下一月
  const goPrevMonth = () => {
    setSelectedDay(null);
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };

  const goNextMonth = () => {
    setSelectedDay(null);
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };

  // 当月照片数（从月分组中查找）
  const monthCount = useMemo(() => {
    const key = `${view.year}-${String(view.month + 1).padStart(2, '0')}`;
    return monthGroups.find((g) => g.key === key)?.photos.length ?? 0;
  }, [monthGroups, view]);

  // 构建当月日历网格（6 行 × 7 列 = 42 格，周一首）
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    // 周一为首：把周日(0)映射到 6，其余减 1
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(view.year, view.month, 1 - startOffset);
    const list: { date: Date; isCurrentMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      list.push({ date: d, isCurrentMonth: d.getMonth() === view.month });
    }
    return list;
  }, [view]);

  const anomalyLabel = t('home.organize.calendar.anomalyLabel');

  // 选中日期当天的照片
  const selectedDayPhotos = useMemo(() => {
    if (!selectedDay) return [];
    return byDay.get(dayKey(selectedDay)) ?? [];
  }, [selectedDay, byDay]);

  /** 切换单张照片选中状态 */
  const toggleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange?.(next);
    },
    [selectedIds, onSelectionChange],
  );

  /** 全选/取消全选当天照片 */
  const toggleSelectDay = useCallback(() => {
    if (selectedDayPhotos.length === 0) return;
    const dayIds = selectedDayPhotos.map((p) => p.id);
    const allSelected = dayIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      dayIds.forEach((id) => next.delete(id));
    } else {
      dayIds.forEach((id) => next.add(id));
    }
    onSelectionChange?.(next);
  }, [selectedDayPhotos, selectedIds, onSelectionChange]);

  // 大图预览
  const [previewIndex, setPreviewIndex] = useState(-1);

  /** 删除单张照片（共享逻辑，含确认弹窗由 ThumbWithMenu 处理） */
  const handleDeletePhoto = useCallback(
    (photo: PhotoFileInfo) => {
      void deletePhotos([photo], sourceMode, onPhotosUpdate, addToast, t);
      // 同步从选中集合中移除
      if (selectedIds.has(photo.id)) {
        const next = new Set(selectedIds);
        next.delete(photo.id);
        onSelectionChange?.(next);
      }
    },
    [sourceMode, onPhotosUpdate, addToast, t, selectedIds, onSelectionChange],
  );

  const monthTitle = t('home.organize.calendar.monthTitle', {
    year: view.year,
    month: String(view.month + 1).padStart(2, '0'),
  });

  const isEmpty = byDay.size === 0;
  const dayAllSelected =
    selectedDayPhotos.length > 0 && selectedDayPhotos.every((p) => selectedIds.has(p.id));

  return (
    <div className="space-y-3">
      {/* 顶部：月份切换控件（标题居中） */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={goPrevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-600)] cursor-pointer transition-colors"
          title={t('home.organize.calendar.prevMonth')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>

        {/* 标题居中 */}
        <div className="flex-1 flex items-center justify-center gap-2">
          <span className="text-sm font-[700] text-[var(--color-gray-800)]">{monthTitle}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-brand-bg)] text-[var(--color-brand)] font-[600]">
            {t('home.organize.calendar.monthCount', { count: monthCount })}
          </span>
        </div>

        <button
          type="button"
          onClick={goNextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-600)] cursor-pointer transition-colors"
          title={t('home.organize.calendar.nextMonth')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 主体：日历色块网格（整体一个圆角容器，无独立 cell border） */}
      <div className="rounded-xl bg-[var(--color-surface-panel)] overflow-hidden">
        {/* 星期标题行 */}
        <div className="grid grid-cols-7">
          {weekdays.map((w, i) => (
            <div
              key={i}
              className={`text-center text-[11px] font-[600] py-1 ${
                i === 5 || i === 6
                  ? 'text-[var(--color-gray-400)]'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        {/* 日期格子（无 border，用背景色区分状态） */}
        <div className="grid grid-cols-7 gap-px bg-[var(--color-border)]/30">
          {cells.map((cell, idx) => {
            const key = dayKey(cell.date);
            const dayPhotos = byDay.get(key) ?? [];
            const anomaly = dayPhotos.length > 0 && isAnomalyYear(cell.date.getFullYear());
            const isToday = isSameDay(cell.date, today);
            const isSelected = selectedDay ? isSameDay(cell.date, selectedDay) : false;
            const hasPhotos = dayPhotos.length > 0;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedDay(new Date(cell.date))}
                className={`relative min-h-[86px] p-1 text-left transition-colors flex flex-col gap-0.5 cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--color-brand-bg)] ring-1 ring-inset ring-[var(--color-brand)]'
                    : !cell.isCurrentMonth
                      ? 'bg-[var(--color-gray-50)]/60 opacity-40'
                      : anomaly
                        ? 'bg-red-50/80 hover:bg-red-100/80'
                        : hasPhotos
                          ? 'bg-white hover:bg-[var(--color-brand-bg)]/50'
                          : 'bg-white hover:bg-[var(--color-surface-hover)]'
                }`}
                title={hasPhotos ? `${cell.date.getDate()} · ${dayPhotos.length}` : undefined}
              >
                {/* 日期数字 + 照片数 */}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] font-[600] flex items-center justify-center ${
                      isToday
                        ? 'w-[18px] h-[18px] rounded-full bg-[var(--color-brand)] text-white'
                        : anomaly
                          ? 'text-red-600'
                          : hasPhotos
                            ? 'text-[var(--color-brand)] font-[700]'
                            : 'text-[var(--color-gray-600)]'
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>
                  {hasPhotos && (
                    <span
                      className={`text-[9px] px-1 rounded font-[600] ${
                        anomaly ? 'bg-red-200 text-red-700' : 'bg-[var(--color-brand)] text-white'
                      }`}
                    >
                      {dayPhotos.length}
                    </span>
                  )}
                </div>

                {/* 缩略图（最多 5 张，照片间留间隙，尺寸更大） */}
                {hasPhotos && (
                  <div className="flex flex-wrap gap-1 mt-auto">
                    {dayPhotos.slice(0, 5).map((p) => (
                      <StackedThumb key={p.id} photo={p} readPhotoData={readPhotoData} />
                    ))}
                  </div>
                )}

                {/* 异常日期小标签 */}
                {anomaly && (
                  <span className="text-[7px] leading-none text-red-600 font-[600] truncate">
                    {anomalyLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 提示 */}
      <div className="text-[10px] text-[var(--color-gray-500)]">
        {t('home.organize.calendar.selectDayHint')}
      </div>

      {/* 底部：选中日期的照片列表（折叠展开） */}
      {selectedDay && (
        <div className="rounded-xl bg-[var(--color-surface-panel)] p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="font-[700] text-[var(--color-gray-800)] text-sm">
              {t('home.organize.calendar.monthTitle', {
                year: selectedDay.getFullYear(),
                month: String(selectedDay.getMonth() + 1).padStart(2, '0'),
              })}
              -{String(selectedDay.getDate()).padStart(2, '0')}
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('home.organize.calendar.photosCount', { count: selectedDayPhotos.length })}
            </span>
            {/* 全选/取消全选当天 */}
            {selectedDayPhotos.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectDay}
                className={`text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-all border-none ${
                  dayAllSelected
                    ? 'bg-[var(--color-brand)] text-white hover:opacity-90'
                    : 'bg-white text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {dayAllSelected ? t('home.organize.calendar.deselectDay') : t('home.organize.calendar.selectAllDay')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="ml-auto text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] cursor-pointer"
            >
              {t('home.organize.timeline.collapse')}
            </button>
          </div>

          {selectedDayPhotos.length > 0 ? (
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
            >
              {selectedDayPhotos.map((p, i) => {
                const d = resolvePhotoDate(p);
                const anomaly = d ? isAnomalyYear(d.getFullYear()) : false;
                return (
                  <DayGridThumb
                    key={p.id}
                    photo={p}
                    anomaly={anomaly}
                    anomalyLabel={anomalyLabel}
                    selected={selectedIds.has(p.id)}
                    readPhotoData={readPhotoData}
                    onClick={() => toggleSelect(p.id)}
                    onView={() => setPreviewIndex(i)}
                    onDelete={() => handleDeletePhoto(p)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-gray-400)] py-2">
              {t('home.organize.calendar.noPhotos')}
            </div>
          )}
        </div>
      )}

      {/* 大图预览 */}
      {previewIndex >= 0 && selectedDayPhotos.length > 0 && (
        <PhotoQuickView
          photos={selectedDayPhotos}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(-1)}
          readPhotoData={readPhotoData}
        />
      )}

      {/* 空状态 */}
      {isEmpty && (
        <div className="text-center py-8 text-[var(--color-gray-400)] text-sm">
          {t('home.organize.calendar.empty')}
        </div>
      )}
    </div>
  );
}
