/**
 * TimelineView — 时间线视图
 *
 * 按 年-月 或 相册路径 分组展示照片，支持：
 * - 异常日期标记（年份 < 2000 或 > 当前年+1 标红，显示"日期异常"）
 * - 每个月份/路径分组可折叠/展开
 * - 缩略图网格（最多 12 张，超出显示"+N张"），使用共享 ThumbImage 异步加载
 * - 多选模式：分组级全选/取消全选（月份级 + 路径级）
 * - 月份分组提供"在日历中查看"按钮，跳转到对应月份的日历视图
 * - 顶部统计信息 + 月份照片量高度条可视化
 *
 * 月份分组按时间倒序排列（最新的在前）；无法识别日期的照片归入"未知日期"分组置于末尾。
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePhotoDate, type PhotoFileInfo, type TimelineGroup } from '../../../photo-tools';
import { ThumbImage } from './shared';

/** 当前年份（用于异常日期判断，模块级常量避免每次渲染重算） */
const CURRENT_YEAR = new Date().getFullYear();

/** 判断日期是否异常：年份 < 2000 或 > 当前年+1 */
function isAnomalyDate(date: Date): boolean {
  const y = date.getFullYear();
  return y < 2000 || y > CURRENT_YEAR + 1;
}

/** 分组结果：含按月分组、未知日期照片、异常照片 ID 集合与异常计数 */
interface GroupResult {
  groups: TimelineGroup[];
  undated: PhotoFileInfo[];
  anomalyIds: Set<string>;
  anomalyCount: number;
}

/**
 * 按 年-月 分组照片（用 resolvePhotoDate 解析每张照片的日期）
 * - 无日期照片归入 undated
 * - 异常日期照片记入 anomalyIds，所属分组 hasAnomaly 置 true
 * - 分组按时间倒序（最新的在前）
 */
function groupByMonth(photos: PhotoFileInfo[]): GroupResult {
  const map = new Map<string, TimelineGroup>();
  const undated: PhotoFileInfo[] = [];
  const anomalyIds = new Set<string>();
  let anomalyCount = 0;

  for (const photo of photos) {
    const date = resolvePhotoDate(photo);
    if (!date) {
      undated.push(photo);
      continue;
    }
    const anomaly = isAnomalyDate(date);
    if (anomaly) {
      anomalyIds.add(photo.id);
      anomalyCount++;
    }
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    let g = map.get(key);
    if (!g) {
      g = { key, year, month, photos: [], hasAnomaly: false };
      map.set(key, g);
    }
    g.photos.push(photo);
    if (anomaly) g.hasAnomaly = true;
  }

  // 按时间倒序：年降序，同年月降序
  const groups = [...map.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.month - a.month,
  );

  return { groups, undated, anomalyIds, anomalyCount };
}

/** 路径分组项 */
interface PathGroup {
  key: string;
  /** 显示名（目录名或根） */
  label: string;
  /** 完整路径（用于 tooltip） */
  fullPath: string;
  photos: PhotoFileInfo[];
}

/**
 * 按相册路径（relativePath 的父目录）分组照片
 * - 无 relativePath 的照片归入"根目录"
 * - 分组按照片数降序
 */
function groupByPath(photos: PhotoFileInfo[]): PathGroup[] {
  const map = new Map<string, PathGroup>();
  for (const photo of photos) {
    const rel = (photo.relativePath || photo.name || '').replace(/\\/g, '/');
    // 父目录：去掉最后一段文件名
    const slashIdx = rel.lastIndexOf('/');
    const dir = slashIdx > 0 ? rel.slice(0, slashIdx) : '';
    const key = dir || '__root__';
    let g = map.get(key);
    if (!g) {
      const label = dir ? dir.split('/').pop() || dir : '根目录';
      g = { key, label, fullPath: dir, photos: [] };
      map.set(key, g);
    }
    g.photos.push(photo);
  }
  return [...map.values()].sort((a, b) => b.photos.length - a.photos.length);
}

/**
 * 缩略图组件（使用共享 ThumbImage 异步加载）
 * - 点击切换选中状态；选中时显示勾选标记
 * - 异常日期照片红框 + "日期异常"小标签
 */
function Thumb({
  photo,
  selected,
  anomaly,
  anomalyLabel,
  readPhotoData,
  onClick,
}: {
  photo: PhotoFileInfo;
  selected: boolean;
  anomaly: boolean;
  anomalyLabel: string;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
        selected
          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]'
          : anomaly
            ? 'border-red-300'
            : 'border-transparent hover:border-[var(--color-border)]'
      }`}
      title={photo.name}
    >
      <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" />

      {/* 选中标记（左上角） */}
      <span
        className={`absolute top-1 left-1 z-10 w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shadow-sm transition-all ${
          selected ? 'opacity-100 bg-[var(--color-brand)]' : 'opacity-0 bg-black/40'
        }`}
      >
        ✓
      </span>

      {/* 异常日期标签（右下角） */}
      {anomaly && (
        <span className="absolute bottom-0.5 right-0.5 z-10 text-[8px] leading-none px-1 py-0.5 rounded bg-red-500 text-white font-[600]">
          {anomalyLabel}
        </span>
      )}
    </div>
  );
}

export function TimelineView({
  photos,
  readPhotoData,
  onSelectionChange,
  onViewInCalendar,
}: {
  photos: PhotoFileInfo[];
  /** 读取照片数据（统一入口，用于缩略图异步加载） */
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 选择变化回调（用于父组件跟踪选中照片，支持一键成册联动） */
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** 在日历中查看指定月份（year, month 1-12），跳转到日历视图 */
  onViewInCalendar?: (year: number, month: number) => void;
}) {
  const { t } = useTranslation();

  // 分组模式：按月份 / 按路径
  const [groupMode, setGroupMode] = useState<'month' | 'path'>('month');

  // 按月分组
  const { groups, undated, anomalyIds, anomalyCount } = useMemo(() => groupByMonth(photos), [photos]);
  // 按路径分组
  const pathGroups = useMemo(() => groupByPath(photos), [photos]);

  // 折叠状态：默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  // 多选状态
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const syncSelection = useCallback(
    (next: Set<string>) => {
      setSelected(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );
  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        onSelectionChange?.(n);
        return n;
      });
    },
    [onSelectionChange],
  );
  const clearSelection = useCallback(() => syncSelection(new Set()), [syncSelection]);

  /** 全选/取消全选一组照片 */
  const toggleSelectGroup = useCallback(
    (groupPhotoIds: string[]) => {
      setSelected((prev) => {
        const n = new Set(prev);
        const allSelected = groupPhotoIds.every((id) => n.has(id));
        if (allSelected) {
          groupPhotoIds.forEach((id) => n.delete(id));
        } else {
          groupPhotoIds.forEach((id) => n.add(id));
        }
        onSelectionChange?.(n);
        return n;
      });
    },
    [onSelectionChange],
  );

  const anomalyLabel = t('home.organize.timeline.anomalyLabel');

  /** 渲染单个月份分组 */
  const renderMonthGroup = (
    key: string,
    title: string,
    items: PhotoFileInfo[],
    hasAnomaly: boolean,
    accent: 'red' | 'amber' | 'default',
    year?: number,
    month?: number,
  ) => {
    const isCollapsed = collapsed.has(key);
    const shown = items.slice(0, 12);
    const overflow = items.length - shown.length;
    const groupIds = items.map((p) => p.id);
    const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
    const headerBgCls =
      accent === 'red'
        ? 'bg-red-50/60'
        : accent === 'amber'
          ? 'bg-amber-50/60'
          : '';
    const badgeCls =
      accent === 'red'
        ? 'bg-red-100 text-red-600'
        : accent === 'amber'
          ? 'bg-amber-100 text-amber-700'
          : '';
    return (
      <div key={key} className={`bg-white ${headerBgCls}`}>
        {/* 分组头 */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--color-surface-hover)] text-left">
          <button
            type="button"
            onClick={() => toggleCollapse(key)}
            className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer bg-transparent border-none p-0"
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
            <span className="font-[700] text-[var(--color-gray-800)] text-sm">{title}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('home.organize.timeline.photosUnit', { count: items.length })}
            </span>
            {hasAnomaly && accent === 'red' && (
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-[600] ${badgeCls}`}>
                {anomalyLabel}
              </span>
            )}
          </button>

          {/* 分组操作按钮区 */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 全选/取消全选本月 */}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => toggleSelectGroup(groupIds)}
                className={`text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-all border-none ${
                  allSelected
                    ? 'bg-[var(--color-brand)] text-white hover:opacity-90'
                    : 'bg-[var(--color-surface-panel)] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {allSelected ? t('home.organize.timeline.deselectMonth') : t('home.organize.timeline.selectAllInMonth')}
              </button>
            )}
            {/* 在日历中查看（仅月份分组且有年月信息） */}
            {year != null && month != null && onViewInCalendar && items.length > 0 && (
              <button
                type="button"
                onClick={() => onViewInCalendar(year, month)}
                className="text-[11px] px-2 py-1 rounded-lg bg-[var(--color-surface-panel)] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] cursor-pointer transition-all inline-flex items-center gap-1 border-none"
                title={t('home.organize.timeline.viewInCalendar')}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <rect x="2" y="3" width="12" height="11" rx="1" />
                  <line x1="2" y1="6" x2="14" y2="6" />
                  <line x1="5" y1="2" x2="5" y2="4" />
                  <line x1="11" y1="2" x2="11" y2="4" />
                </svg>
                {t('home.organize.timeline.viewInCalendar')}
              </button>
            )}
            <span className="text-[var(--color-gray-400)] text-xs">
              {isCollapsed ? t('home.organize.timeline.expand') : t('home.organize.timeline.collapse')}
            </span>
          </div>
        </div>

        {/* 缩略图网格 */}
        {!isCollapsed && (
          <div className="px-4 pb-3 bg-white">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
            >
              {shown.map((p) => (
                <Thumb
                  key={p.id}
                  photo={p}
                  selected={selected.has(p.id)}
                  anomaly={anomalyIds.has(p.id)}
                  anomalyLabel={anomalyLabel}
                  readPhotoData={readPhotoData}
                  onClick={() => toggleSelect(p.id)}
                />
              ))}
              {overflow > 0 && (
                <div className="aspect-square rounded-lg bg-[var(--color-gray-100)] flex items-center justify-center text-[var(--color-gray-500)] text-sm font-[600]">
                  +{overflow}
                  {t('home.organize.timeline.overflowSuffix')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /** 渲染单个路径分组 */
  const renderPathGroup = (g: PathGroup) => {
    const key = g.key;
    const isCollapsed = collapsed.has(key);
    const shown = g.photos.slice(0, 12);
    const overflow = g.photos.length - shown.length;
    const groupIds = g.photos.map((p) => p.id);
    const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
    return (
      <div key={key} className="bg-white">
        {/* 分组头 */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--color-surface-hover)] text-left">
          <button
            type="button"
            onClick={() => toggleCollapse(key)}
            className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer bg-transparent border-none p-0"
            title={g.fullPath || g.label}
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)]">
              <path d="M14 11V5a2 2 0 00-2-2H8l-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2z" />
            </svg>
            <span className="font-[700] text-[var(--color-gray-800)] text-sm truncate">{g.label}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('home.organize.timeline.photosUnit', { count: g.photos.length })}
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {g.photos.length > 0 && (
              <button
                type="button"
                onClick={() => toggleSelectGroup(groupIds)}
                className={`text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-all border-none ${
                  allSelected
                    ? 'bg-[var(--color-brand)] text-white hover:opacity-90'
                    : 'bg-[var(--color-surface-panel)] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {allSelected ? t('home.organize.timeline.deselectPath') : t('home.organize.timeline.selectAllInPath')}
              </button>
            )}
            <span className="text-[var(--color-gray-400)] text-xs">
              {isCollapsed ? t('home.organize.timeline.expand') : t('home.organize.timeline.collapse')}
            </span>
          </div>
        </div>

        {!isCollapsed && (
          <div className="px-4 pb-3">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
            >
              {shown.map((p) => (
                <Thumb
                  key={p.id}
                  photo={p}
                  selected={selected.has(p.id)}
                  anomaly={anomalyIds.has(p.id)}
                  anomalyLabel={anomalyLabel}
                  readPhotoData={readPhotoData}
                  onClick={() => toggleSelect(p.id)}
                />
              ))}
              {overflow > 0 && (
                <div className="aspect-square rounded-lg bg-[var(--color-gray-100)] flex items-center justify-center text-[var(--color-gray-500)] text-sm font-[600]">
                  +{overflow}
                  {t('home.organize.timeline.overflowSuffix')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const isEmpty = groups.length === 0 && undated.length === 0;

  return (
    <div className="space-y-3">
      {/* 统计信息 + 分组模式切换 */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="px-3 py-1.5 rounded-lg bg-[var(--color-brand-bg)] text-[var(--color-brand)] font-[600]">
          {t('home.organize.timeline.totalPhotos', { count: photos.length })}
        </span>
        {anomalyCount > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 font-[600]">
            {t('home.organize.timeline.anomalyCount', { count: anomalyCount })}
          </span>
        )}
        {undated.length > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 font-[600]">
            {t('home.organize.timeline.undatedCount', { count: undated.length })}
          </span>
        )}
        {selected.size > 0 && (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-[600]">
            {t('home.organize.timeline.selected', { count: selected.size })}
            <button
              type="button"
              onClick={clearSelection}
              className="underline hover:no-underline cursor-pointer"
            >
              {t('home.organize.timeline.clearSelection')}
            </button>
          </span>
        )}
        {/* 分组模式切换 */}
        <div className="ml-auto flex gap-1 p-1 rounded-lg bg-[var(--color-surface-panel)]">
          {(['month', 'path'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setGroupMode(mode)}
              className={`px-2.5 py-1 rounded text-xs font-[600] transition-all cursor-pointer border-none ${
                groupMode === mode
                  ? 'bg-white text-[var(--color-brand)] shadow-sm'
                  : 'text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
              }`}
            >
              {mode === 'month' ? t('home.organize.timeline.groupByMonth') : t('home.organize.timeline.groupByPath')}
            </button>
          ))}
        </div>
      </div>

      {/* 分组列表（色块化：整体一个圆角容器，分组间用 gap-px 分隔） */}
      <div className="rounded-xl bg-[var(--color-surface-panel)] overflow-hidden">
        <div className="grid gap-px bg-[var(--color-border)]/30">
          {groupMode === 'month' ? (
            <>
              {groups.map((g) =>
                renderMonthGroup(
                  g.key,
                  t('home.organize.timeline.monthTitle', {
                    year: g.year,
                    month: String(g.month).padStart(2, '0'),
                  }),
                  g.photos,
                  g.hasAnomaly,
                  g.hasAnomaly ? 'red' : 'default',
                  g.year,
                  g.month,
                ),
              )}

              {/* 未知日期分组（末尾） */}
              {undated.length > 0 &&
                renderMonthGroup(
                  '__undated__',
                  t('home.organize.timeline.unknownDate'),
                  undated,
                  false,
                  'amber',
                )}
            </>
          ) : (
            <>
              {pathGroups.map((g) => renderPathGroup(g))}
              {pathGroups.length === 0 && (
                <div className="text-center py-8 text-[var(--color-gray-400)] text-sm bg-white">
                  {t('home.organize.timeline.empty')}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 空状态 */}
      {isEmpty && (
        <div className="text-center py-8 text-[var(--color-gray-400)] text-sm">
          {t('home.organize.timeline.empty')}
        </div>
      )}
    </div>
  );
}
