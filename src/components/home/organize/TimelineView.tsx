/**
 * TimelineView — 时间线视图
 *
 * 按 年-月 或 相册路径 分组展示照片，支持：
 * - 异常日期标记（年份 < 2000 或 > 当前年+1 标红，显示"日期异常"）
 * - 每个月份/路径分组默认收起（仅显示一行照片预览，避免大量照片一次性加载），点击表头展开即显示该组全部照片
 * - 月份分组表头 sticky 吸顶：照片多时往下滑动，月份表头固定保留在最上方
 * - 缩略图网格，使用共享 ThumbImage 异步加载
 * - 多选模式：分组级全选/取消全选（月份级 + 路径级）
 * - 月份分组提供"在日历中查看"按钮，跳转到对应月份的日历视图
 * - 顶部统计信息 + 月份照片量高度条可视化
 *
 * 月份分组按时间倒序排列（最新的在前）；无法识别日期的照片归入"未知日期"分组置于末尾。
 */

import { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePhotoDate, type PhotoFileInfo, type TimelineGroup } from '../../../photo-tools';
import { ThumbWithMenu, deletePhotos } from './shared';
import { PhotoQuickView } from './PhotoQuickView';

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
 * 缩略图组件（使用共享 ThumbWithMenu：查看/删除三点菜单）
 * - 点击切换选中状态；选中时显示勾选标记
 * - 异常日期照片红框 + "日期异常"小标签
 * - 鼠标悬浮右上角显示三点菜单，可查看 / 删除
 */
function Thumb({
  photo,
  selected,
  anomaly,
  anomalyLabel,
  readPhotoData,
  onClick,
  onView,
  onDelete,
}: {
  photo: PhotoFileInfo;
  selected: boolean;
  anomaly: boolean;
  anomalyLabel: string;
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

/** 时间线缩略图固定边长（96px，与人脸识别一致） */
const THUMB_SIZE = 96;
/** 缩略图之间间隙（px） */
const THUMB_GAP = 8;

/**
 * 折叠态照片行（限定的框内预览）
 *
 * - 仅在限定的框内展示前几张能放下的照片，不再渲染全部照片、无需横向滚动
 * - 行末固定一个与照片同尺寸（96px）的颜色框：显示“还有 N 张”（未展示的剩余照片数量）
 * - 点击表头展开分组即可查看全部照片
 */
function CollapsedRow({
  items,
  selected,
  anomalyIds,
  anomalyLabel,
  readPhotoData,
  onClickThumb,
  onView,
  onDelete,
}: {
  items: PhotoFileInfo[];
  selected: Set<string>;
  anomalyIds: Set<string>;
  anomalyLabel: string;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  onClickThumb: (id: string) => void;
  onView: (index: number) => void;
  onDelete: (photo: PhotoFileInfo) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // 当前容器可视宽度（用于计算限定的框内能放下多少张照片）
  const [rowWidth, setRowWidth] = useState(0);

  // 用 ResizeObserver 实时测量容器宽度，窗口变化/面板拉伸时自动重排
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setRowWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 限定的框内能放下的照片数 = floor((宽度 - 间隙) / (缩略图+间隙))
  const fitCount = Math.max(1, Math.floor((rowWidth - THUMB_GAP) / (THUMB_SIZE + THUMB_GAP)));
  // 预留最后一个位置给“剩余数量”框，真正展示的照片数为 fitCount - 1
  const visibleCount = Math.max(0, fitCount - 1);
  // 只在照片总数超过展示数量时才显示剩余数量框
  const showCounter = items.length > visibleCount;
  // 剩余数量 = 总照片数 - 已展示数量
  const remaining = items.length - visibleCount;
  // 只展示限定的框内能放下的前几张照片，其余照片不再渲染、无需滚动
  const visibleItems = showCounter ? items.slice(0, visibleCount) : items;

  return (
    <div ref={rowRef} className="flex gap-2 overflow-hidden">
      {visibleItems.map((p, i) => (
        <div key={p.id} className="shrink-0" style={{ width: THUMB_SIZE }}>
          <Thumb
            photo={p}
            selected={selected.has(p.id)}
            anomaly={anomalyIds.has(p.id)}
            anomalyLabel={anomalyLabel}
            readPhotoData={readPhotoData}
            onClick={() => onClickThumb(p.id)}
            onView={() => onView(i)}
            onDelete={() => onDelete(p)}
          />
        </div>
      ))}

      {/* 行末：限定的框内最后一个位置展示剩余照片数量 */}
      {showCounter && (
        <div
          className="shrink-0 rounded-lg border border-[var(--color-brand)]/25 bg-gradient-to-br from-[var(--color-brand-bg)] to-[var(--color-brand)]/10 flex flex-col items-center justify-center gap-1 select-none"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
          title={String(items.length)}
        >
          <span className="text-[var(--color-brand)] font-[700] text-base leading-none">+{remaining}</span>
          <span className="text-[var(--color-text-secondary)] text-[10px] leading-none">
            {items.length}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 照片列表（月份/路径分组内容）
 *
 * - 分组折叠（collapsed）时：显示一行自适应预览，不参与多选点击；
 * - 分组展开时：以网格形式展示该组全部照片，点击表头即可展开查看全部。
 *
 * 说明：点击表头展开分组即显示全部照片，不再需要额外的“查看全部/+N 更多块”二次展开。
 */
function PhotoRow({
  items,
  selected,
  anomalyIds,
  anomalyLabel,
  readPhotoData,
  onClickThumb,
  onView,
  onDelete,
  collapsed = false,
}: {
  items: PhotoFileInfo[];
  selected: Set<string>;
  anomalyIds: Set<string>;
  anomalyLabel: string;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  onClickThumb: (id: string) => void;
  onView: (index: number) => void;
  onDelete: (photo: PhotoFileInfo) => void;
  /** 分组折叠时仅显示一行预览：不展开网格、不参与多选点击 */
  collapsed?: boolean;
}) {
  // 折叠态：单行预览，仅在限定的框内展示前几张照片，
  // 行末固定一个与照片同尺寸的颜色框显示“还有 N 张”（剩余照片数量）。
  if (collapsed) {
    return (
      <CollapsedRow
        items={items}
        selected={selected}
        anomalyIds={anomalyIds}
        anomalyLabel={anomalyLabel}
        readPhotoData={readPhotoData}
        onClickThumb={onClickThumb}
        onView={onView}
        onDelete={onDelete}
      />
    );
  }

  // 展开态：网格展示全部照片
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
      {items.map((p, i) => (
        <Thumb
          key={p.id}
          photo={p}
          selected={selected.has(p.id)}
          anomaly={anomalyIds.has(p.id)}
          anomalyLabel={anomalyLabel}
          readPhotoData={readPhotoData}
          onClick={() => onClickThumb(p.id)}
          onView={() => onView(i)}
          onDelete={() => onDelete(p)}
        />
      ))}
    </div>
  );
}

export function TimelineView({
  photos,
  readPhotoData,
  onSelectionChange,
  onViewInCalendar,
  sourceMode,
  onPhotosUpdate,
  addToast,
}: {
  photos: PhotoFileInfo[];
  /** 读取照片数据（统一入口，用于缩略图异步加载） */
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 选择变化回调（用于父组件跟踪选中照片，支持一键成册联动） */
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** 在日历中查看指定月份（year, month 1-12），跳转到日历视图 */
  onViewInCalendar?: (year: number, month: number) => void;
  /** 数据来源模式（删除照片时区分 library / folder） */
  sourceMode: 'folder' | 'library';
  /** 更新照片列表（删除后刷新） */
  onPhotosUpdate: (updater: (prev: PhotoFileInfo[]) => PhotoFileInfo[]) => void;
  /** 全局 toast 提示 */
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
}) {
  const { t } = useTranslation();

  // 分组模式：按月份 / 按路径
  const [groupMode, setGroupMode] = useState<'month' | 'path'>('month');

  // 按月分组
  const { groups, undated, anomalyIds, anomalyCount } = useMemo(() => groupByMonth(photos), [photos]);
  // 按路径分组
  const pathGroups = useMemo(() => groupByPath(photos), [photos]);

  // 照片大图预览
  const [previewGroup, setPreviewGroup] = useState<PhotoFileInfo[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 折叠状态：默认全部收起（避免大量照片一次性加载，仅显示一行照片预览）。
  // 用 expanded 记录“用户已展开”的分组；不在其中的分组默认收起。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((key: string) => {
    setExpanded((prev) => {
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

  /** 打开大图预览 */
  const openPreview = useCallback((group: PhotoFileInfo[], index: number) => {
    setPreviewGroup(group);
    setPreviewIndex(index);
  }, []);

  /** 删除单张照片（共享逻辑，含确认弹窗由 ThumbWithMenu 处理） */
  const handleDeletePhoto = useCallback(
    (photo: PhotoFileInfo) => {
      void deletePhotos([photo], sourceMode, onPhotosUpdate, addToast, t);
      // 同步从选中集合中移除
      setSelected((prev) => {
        if (!prev.has(photo.id)) return prev;
        const n = new Set(prev);
        n.delete(photo.id);
        onSelectionChange?.(n);
        return n;
      });
    },
    [sourceMode, onPhotosUpdate, addToast, t, onSelectionChange],
  );


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
    const isCollapsed = !expanded.has(key);
    const groupIds = items.map((p) => p.id);
    const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
    const headerBgCls =
      accent === 'red'
        ? 'bg-red-50/60'
        : accent === 'amber'
          ? 'bg-amber-50/60'
          : '';
    // 月份表头吸顶时的实色背景（遮挡下方滚动内容，保持可读性）
    const stickyBgCls =
      accent === 'red'
        ? 'bg-red-50'
        : accent === 'amber'
          ? 'bg-amber-50'
          : 'bg-white';
    const badgeCls =
      accent === 'red'
        ? 'bg-red-100 text-red-600'
        : accent === 'amber'
          ? 'bg-amber-100 text-amber-700'
          : '';
    return (
      <div key={key} className={`bg-white ${headerBgCls}`}>
        {/* 分组头：sticky 吸顶，滚动时月份表头固定在最上方 */}
        <div
          className={`sticky top-0 z-10 flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--color-surface-hover)] text-left ${stickyBgCls}`}
        >
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

        {/* 缩略图列表：折叠时单行预览，展开时网格展示全部照片 */}
        <div className="px-4 pb-3 bg-white">
          <PhotoRow
            items={items}
            selected={selected}
            anomalyIds={anomalyIds}
            anomalyLabel={anomalyLabel}
            readPhotoData={readPhotoData}
            onClickThumb={toggleSelect}
            onView={(i) => openPreview(items, i)}
            onDelete={handleDeletePhoto}
            collapsed={isCollapsed}
          />
        </div>
      </div>
    );
  };

  /** 渲染单个路径分组 */
  const renderPathGroup = (g: PathGroup) => {
    const key = g.key;
    const isCollapsed = !expanded.has(key);
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

        <div className="px-4 pb-3">
          <PhotoRow
            items={g.photos}
            selected={selected}
            anomalyIds={anomalyIds}
            anomalyLabel={anomalyLabel}
            readPhotoData={readPhotoData}
            onClickThumb={toggleSelect}
            onView={(i) => openPreview(g.photos, i)}
            onDelete={handleDeletePhoto}
            collapsed={isCollapsed}
          />
        </div>
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

      {/* 分组列表（色块化：整体一个圆角容器，分组间用 gap-px 分隔）
          注意：不使用 overflow-hidden，否则会破坏月份表头 sticky 吸顶（overflow 会阻断相对滚动容器的定位） */}
      <div className="rounded-xl bg-[var(--color-surface-panel)]">
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

      {/* 大图预览 */}
      {previewGroup && previewGroup.length > 0 && (
        <PhotoQuickView
          photos={previewGroup}
          initialIndex={previewIndex}
          onClose={() => setPreviewGroup(null)}
          readPhotoData={readPhotoData}
        />
      )}
    </div>
  );
}
