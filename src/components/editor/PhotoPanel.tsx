import { useRef, useCallback, useState, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePhotoStore, useUIStore, useEditorStore } from '../../store';
import { photoService } from '../../services/photoService';
import { readPhotoFromDB, readDirectPhoto, makeDirectPhotoUrl, isTauri } from '../../engine/storage-engine';
import { readFileAsBlobUrl } from '../../utils/tauri';
import { usePhotoSrc } from '../../hooks/usePhotoSrc';
import { logger } from '../../utils/logger';
import type { Photo } from '../../types';
import type { UsePhotoImportResult } from '../../hooks/usePhotoImport';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { PhotoPreview } from './PhotoPreview';
import { startDrag, updateDrag, endDrag } from '../../engine/drag-manager';

// ── 照片面板状态持久化（切换标签时不重置）──
const savedScrollTopRef = { current: 0 };
const savedExpandedGroupsRef = { current: new Set<string>() };

// ── 照片筛选类型与工具函数 ──
type PhotoFilter = 'all' | 'unused' | 'used';
function checkPhotoVisible(photoId: string, placedIds: Set<string>, mode: PhotoFilter): boolean {
  if (mode === 'unused') return !placedIds.has(photoId);
  if (mode === 'used') return placedIds.has(photoId);
  return true;
}

// ── 分组折叠状态（简单模块变量，直接读写）──
export function isAllGroupsExpanded() { return false; } // 默认不展开

// ── 照片自适应行布局（Justified Rows，类似 Google Photos / Flickr）──
const ITEM_GAP = 8;
const TARGET_ROW_HEIGHT = 110;
const MAX_ROW_HEIGHT = 132; // 最高高度限制，防止单张或极竖照片无限放大

interface JustifiedRow {
  photos: Photo[];
  height: number;
  width: number;
}

/** 根据容器宽度与目标行高，将照片分组为若干自适应行 */
function computeJustifiedRows(
  photos: Photo[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): JustifiedRow[] {
  if (containerWidth <= 0 || photos.length === 0) return [];
  const rows: JustifiedRow[] = [];
  let row: Photo[] = [];
  let rowRatioSum = 0;

  const flushRow = () => {
    if (row.length === 0) return;
    const gapsWidth = Math.max(0, row.length - 1) * gap;
    let height = (containerWidth - gapsWidth) / rowRatioSum;
    height = Math.min(height, MAX_ROW_HEIGHT);
    rows.push({ photos: [...row], height, width: containerWidth });
    row = [];
    rowRatioSum = 0;
  };

  for (const photo of photos) {
    const ratio = photo.width && photo.height ? photo.width / photo.height : 1;
    // 单张照片宽度超过容器宽度时，作为一行并限制高度
    if (ratio * targetRowHeight > containerWidth) {
      flushRow();
      const height = Math.min(Math.max(containerWidth / ratio, targetRowHeight * 0.6), MAX_ROW_HEIGHT);
      rows.push({ photos: [photo], height, width: containerWidth });
      continue;
    }
    // 尝试加入当前行
    const newRatioSum = rowRatioSum + ratio;
    const newGaps = Math.max(0, row.length) * gap;
    const newHeight = (containerWidth - newGaps) / newRatioSum;
    if (row.length === 0 || newHeight >= targetRowHeight * 0.75) {
      row.push(photo);
      rowRatioSum = newRatioSum;
    } else {
      flushRow();
      row.push(photo);
      rowRatioSum = ratio;
    }
  }
  flushRow();
  return rows;
}

/* ── 照片缩略图组件：走 LOD thumb 档（256px），避免加载原文件导致内存爆炸 ──
 * P0-2: 用 usePhotoSrc(photo, { level: 'thumb' }) 替代直接 photo.src
 *   - import 模式：从 IndexedDB 读 thumbBlobId（256px）
 *   - direct 模式：从 IndexedDB 读 thumbBlobId（256px，P0-1 已生成）
 *   - 旧数据无 thumbBlobId：回退到 photo.src
 * 内存对比：300 张 5000x3000 原图位图 ~18GB → 300 张 256px thumb ~75MB */
function PhotoThumbImg({ photo, onLoaded }: { photo: Photo; onLoaded?: (photoId: string) => void }) {
  // P0-2: 走 LOD thumb 档，加载 256px 缩略图而非原文件
  const thumbSrc = usePhotoSrc(photo, { level: 'thumb' });
  const [errorRetry, setErrorRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** 是否进入视口（IntersectionObserver），未进入时不挂载 <img>，避免大量图像同时解码 */
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 标记是否已上报加载完成，防止重复调用 onLoaded */
  const reportedRef = useRef(false);

  // 进入/离开视口监听：rootMargin 200px 预加载，避免滚动时出现空白。
  // 关键优化：离开视口时回收 <img>（setInView(false) + 释放已加载状态），
  // 避免 300+ 照片全部解码后常驻内存，与 imageCache LRU 协同控制峰值内存。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
          } else {
            // 离开视口：回收 <img> 释放解码位图，再次进入时会重新加载
            setInView(false);
            setLoaded(false);
            reportedRef.current = false;
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // thumbSrc 变化时重置加载状态
  useEffect(() => {
    setLoaded(false);
    reportedRef.current = false;
    setErrorRetry(0);
  }, [thumbSrc]);

  // 加载超时保护：5 秒内未触发 onLoad，主动标记一次重试
  useEffect(() => {
    if (!thumbSrc || !inView) return;
    timeoutRef.current = setTimeout(() => {
      if (imgRef.current && !imgRef.current.complete) {
        setErrorRetry((r) => (r > 0 ? r + 1 : 1));
      }
    }, 5000);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };
  }, [thumbSrc, inView]);

  // errorRetry 变化时执行重建：从 IndexedDB / 文件系统重新读取可用 URL
  useEffect(() => {
    if (errorRetry === 0 || !thumbSrc || !inView || errorRetry >= 3) return;
    let cancelled = false;
    (async () => {
      let rebuiltUrl: string | null = null;
      if (photo.storageMode === 'import') {
        // 重试时用 preview 档（1200px）作为兜底，比 thumb 更可靠
        const previewId = photo.previewBlobId || photo.blobId;
        if (previewId) rebuiltUrl = await readPhotoFromDB(previewId);
      } else if (photo.storageMode === 'direct' && photo.relativePath) {
        // 浏览器 File System Access 模式
        rebuiltUrl = await readDirectPhoto(photo.relativePath);
        // Tauri 桌面端：FSA 目录句柄无法跨会话，改用 asset 协议或 fs 直接读取
        if (!rebuiltUrl && isTauri()) {
          rebuiltUrl = await makeDirectPhotoUrl(photo);
          if (!rebuiltUrl) {
            rebuiltUrl = await readFileAsBlobUrl(photo.relativePath);
          }
        }
      }
      if (cancelled) return;
      if (rebuiltUrl && imgRef.current) {
        imgRef.current.src = rebuiltUrl;
      } else {
        setErrorRetry(3);
      }
    })();
    return () => { cancelled = true; };
  }, [errorRetry, thumbSrc, photo.storageMode, photo.previewBlobId, photo.blobId, photo.relativePath, inView]);

  // 上报加载完成：loaded 变 true 时调用一次 onLoaded
  useEffect(() => {
    if (loaded && !reportedRef.current) {
      reportedRef.current = true;
      onLoaded?.(photo.id);
    }
  }, [loaded, photo.id, onLoaded]);

  const showBroken = errorRetry >= 3;

  const placeholder = (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-gray-50)]">
      <div className="w-5 h-5 border-[2.5px] border-[var(--color-primary-200)] border-t-[var(--color-primary-500)] rounded-full animate-spin" />
    </div>
  );

  const brokenIcon = (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-gray-50)] text-[var(--color-gray-400)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-[var(--color-gray-300)]">
        <rect x="2" y="2" width="20" height="20" rx="2" strokeDasharray="2 2" />
        <circle cx="10" cy="9" r="1.5" fill="currentColor" stroke="none" />
        <path d="M3 18l6-6 3 3 4-4 5 7" strokeLinecap="round" />
        <line x1="4" y1="4" x2="20" y2="20" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-[10px] mt-1.5 max-w-[90%] truncate px-1">{photo.name}</span>
    </div>
  );

  // processing 或无 src 时显示占位 spinner，不计入缩略图加载完成
  if (photo.processing || !thumbSrc) {
    return (
      <div ref={containerRef} className="absolute inset-0">
        {placeholder}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {!loaded && !showBroken && placeholder}
      {showBroken && brokenIcon}
      {/* 仅在进入视口后才挂载 <img>，避免不可见照片排队解码阻塞可见照片 */}
      {inView && (
        <img
          ref={imgRef}
          src={thumbSrc}
          alt={photo.name}
          className={`w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setErrorRetry((r) => r + 1)}
        />
      )}
    </div>
  );
}

/* ── 格式化文件大小 ── */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ── 底部 Status Bar ── */
function PhotoPanelStatusBar({ total, selected, photos }: { total: number; selected: number; photos: Photo[] }) {
  const { t } = useTranslation();
  const totalSize = useMemo(() => photos.reduce((sum, p) => sum + (p.fileSize || 0), 0), [photos]);
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--color-gray-100)] bg-[var(--color-surface)] text-[10px] text-[var(--color-gray-400)] shrink-0">
      <span className="tabular-nums">{t('editor.photoPanel.statusBar', { total, selected, size: formatBytes(totalSize) })}</span>
    </div>
  );
}

/* ── 照片筛选栏 ── */
function PhotoFilterBar({ placedCount, unplacedCount, total, mode, onFilter, onExpandLevelChange,
  multiSelectMode, selectMode, onToggleMultiSelect, selectedCount, onEnterSelectMode, onEnterSmartLayout, onStartSmartLayout, onMissingPhotoSelect, onDeleteSelected,
  onSelectAll, onInvertSelect }: {
  placedCount: number; unplacedCount: number; total: number; mode: PhotoFilter; onFilter: (m: PhotoFilter) => void;
  onExpandLevelChange: (level: 'all' | 'month' | 'none') => void;
  multiSelectMode: boolean; selectMode: 'normal' | 'smart' | null; onToggleMultiSelect: () => void; selectedCount: number;
  onEnterSelectMode: () => void; onEnterSmartLayout: () => void;
  onStartSmartLayout: () => void;
  onMissingPhotoSelect: () => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onInvertSelect: () => void;
}) {
  const { t } = useTranslation();
  const [expandOpen, setExpandOpen] = useState(false);
  const expandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expandOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!expandRef.current?.contains(e.target as Node)) setExpandOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [expandOpen]);

  const expandOptions: { value: 'all' | 'month' | 'none'; labelKey: string }[] = [
    { value: 'all', labelKey: 'editor.photoPanel.expandAll' },
    { value: 'month', labelKey: 'editor.photoPanel.expandToMonth' },
    { value: 'none', labelKey: 'editor.photoPanel.collapseAll' },
  ];

  const tabs: { labelKey: string; value: PhotoFilter; count: number }[] = [
    { labelKey: 'editor.photoPanel.tabAll', value: 'all', count: total },
    { labelKey: 'editor.photoPanel.tabUnused', value: 'unused', count: unplacedCount },
    { labelKey: 'editor.photoPanel.tabUsed', value: 'used', count: placedCount },
  ];

  return (
    <div className="px-3 shrink-0 relative z-40 bg-[var(--color-surface)]">
      {/* ── Row 1：紧凑筛选 ── */}
      <div className={`flex items-center justify-between gap-2 py-2 transition-colors duration-200 ${multiSelectMode ? 'bg-[var(--color-primary-50)] rounded-lg px-2 -mx-2' : ''}`}>
        <div className="flex items-center gap-1 bg-[var(--color-gray-100)] rounded-full p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={`text-[11px] px-3 py-1 rounded-full transition-all duration-200 ease-out border-none cursor-pointer whitespace-nowrap font-[500] ${
                mode === tab.value
                  ? 'bg-white text-[var(--color-primary-700)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
              }`}
              onClick={() => onFilter(tab.value)}
            >
              {t(tab.labelKey)} <span className={`text-[10px] ${mode === tab.value ? 'text-[var(--color-primary-500)]' : 'text-[var(--color-gray-400)]'}`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div ref={expandRef} className="relative shrink-0">
          <button
            onClick={() => setExpandOpen((v) => !v)}
            title={t('editor.photoPanel.expandLevels')}
            className="text-[10px] px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-gray-50)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-100)] transition-all duration-200 border-none cursor-pointer flex items-center gap-1 outline-none"
          >
            {t('editor.photoPanel.expandLevels')}
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-2.5 h-2.5 text-[var(--color-gray-400)] transition-transform duration-200 ${expandOpen ? 'rotate-180' : ''}`}>
              <path d="M2 3.5l3 3 3-3"/>
            </svg>
          </button>
          {expandOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[110px] rounded-xl bg-[var(--color-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[var(--color-gray-100)] py-1 overflow-hidden">
              {expandOptions.map((opt) => (
                <button
                  key={opt.value}
                  className="w-full text-left text-[11px] px-3 py-2 text-[var(--color-gray-700)] hover:bg-[var(--color-primary-50)] hover:text-[var(--color-primary-700)] transition-colors duration-150 border-none bg-transparent cursor-pointer"
                  onClick={() => { onExpandLevelChange(opt.value); setExpandOpen(false); }}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2：主操作 + 多选操作 ── */}
      <div className="flex items-center gap-2 py-2 border-t border-[var(--color-border-light)]">
        {/* 普通模式：智能编排按钮 —— 品牌渐变 + 光晕动画，重点突出 */}
        {!multiSelectMode && (
          <button
            data-onboarding="smart-layout"
            className="group relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] text-[11px] font-[600]
                       bg-gradient-to-r from-[var(--color-brand)] to-[#8B7FFF] text-white
                       shadow-[0_1px_6px_rgba(108,99,255,0.25)]
                       hover:shadow-[0_2px_10px_rgba(108,99,255,0.35)]
                       hover:scale-[1.02] active:scale-[0.98]
                       transition-all duration-200 ease-out cursor-pointer shrink-0
                       overflow-hidden"
            onClick={onEnterSmartLayout}
          >
            {/* 光晕流动效果 */}
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent
                             translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-700 ease-out" />
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 relative z-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" fill="currentColor" fillOpacity="0.3" />
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" />
            </svg>
            <span className="relative z-10">{t('editor.photoPanel.smartLayout')}</span>
          </button>
        )}

        {/* 智能编排模式：开始编排按钮 */}
        {multiSelectMode && selectMode === 'smart' && (
          <button
            className={`group relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] text-[11px] font-[600]
                        transition-all duration-200 ease-out shrink-0 overflow-hidden ${
              selectedCount === 0
                ? 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] cursor-not-allowed'
                : 'bg-gradient-to-r from-[#22C55E] to-[#4ADE80] text-white shadow-[0_1px_6px_rgba(34,197,94,0.25)] hover:shadow-[0_2px_10px_rgba(34,197,94,0.35)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
            }`}
            onClick={() => selectedCount > 0 ? onStartSmartLayout() : onMissingPhotoSelect()}
          >
            {selectedCount > 0 && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent
                               translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-700 ease-out" />
            )}
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 relative z-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" fill="currentColor" fillOpacity="0.3" />
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" />
            </svg>
            <span className="relative z-10">{t('editor.photoPanel.startLayout')}</span>
          </button>
        )}

        {/* 普通选择模式：已选 + 删除 */}
        {multiSelectMode && selectMode === 'normal' && (
          <>
            <span className="text-[11px] font-[600] text-[var(--color-primary-700)] shrink-0 tabular-nums">
              {t('editor.photoPanel.selected', { count: selectedCount })}
            </span>
            {selectedCount > 0 && (
              <button
                className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-[var(--radius-md)] bg-white text-[var(--color-error)] border border-[var(--color-error-light)]
                           hover:bg-[var(--color-error)] hover:text-white hover:border-[var(--color-error)]
                           active:scale-[0.97]
                           transition-all duration-200 cursor-pointer shrink-0"
                onClick={onDeleteSelected}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                  <path d="M5.5 6.5v4M8.5 6.5v4" />
                </svg>
                {t('editor.photoPanel.delete')}
              </button>
            )}
          </>
        )}

        {/* 智能编排模式：已选 */}
        {multiSelectMode && selectMode === 'smart' && (
          <span className="text-[11px] font-[600] text-[var(--color-primary-700)] shrink-0 tabular-nums">
            {t('editor.photoPanel.selected', { count: selectedCount })}
          </span>
        )}

        <div className="flex-1" />

        {/* 多选模式：全选 / 反选 */}
        {multiSelectMode && (
          <>
            <button
              className="text-[11px] px-3 py-1.5 rounded-[var(--radius-md)] bg-white text-[var(--color-gray-600)] border border-[var(--color-border)]
                         hover:bg-[var(--color-gray-50)] hover:border-[var(--color-gray-300)]
                         active:scale-[0.97]
                         transition-all duration-200 cursor-pointer shrink-0"
              onClick={onSelectAll}
            >
              {t('editor.photoPanel.selectAll')}
            </button>
            <button
              className="text-[11px] px-3 py-1.5 rounded-[var(--radius-md)] bg-white text-[var(--color-gray-600)] border border-[var(--color-border)]
                         hover:bg-[var(--color-gray-50)] hover:border-[var(--color-gray-300)]
                         active:scale-[0.97]
                         transition-all duration-200 cursor-pointer shrink-0"
              onClick={onInvertSelect}
            >
              {t('editor.photoPanel.invertSelect')}
            </button>
          </>
        )}

        {/* 选择/取消按钮 */}
        {multiSelectMode ? (
          <button
            className="text-[11px] px-3 py-1.5 rounded-[var(--radius-md)] bg-white text-[var(--color-gray-600)] border border-[var(--color-border)]
                       hover:bg-[var(--color-gray-50)] hover:border-[var(--color-gray-300)]
                       active:scale-[0.97]
                       transition-all duration-200 cursor-pointer shrink-0"
            onClick={onToggleMultiSelect}
          >
            {t('editor.photoPanel.cancel')}
          </button>
        ) : (
          <button
            className="text-[11px] px-3 py-1.5 rounded-[var(--radius-md)] bg-white text-[var(--color-gray-600)] border border-[var(--color-border)]
                       hover:bg-[var(--color-gray-50)] hover:border-[var(--color-gray-300)]
                       active:scale-[0.97]
                       transition-all duration-200 cursor-pointer shrink-0"
            onClick={onEnterSelectMode}
          >
            {t('editor.photoPanel.select')}
          </button>
        )}
      </div>
    </div>
  );
}

export function PhotoPanel({ photoImport, onNavigateToSmartLayout }: { photoImport: UsePhotoImportResult; onNavigateToSmartLayout: () => void }) {
  const { t } = useTranslation();
  // 过滤封面预设照片：系统自动为封面槽位生成的占位图，仅封面显示、不出现在照片列表中（用户无感知）
  const photos = usePhotoStore((s) => s.photos).filter((p) => !p.isCoverPreset);
  const storageMode = useUIStore((s) => s.storageMode);
  const setStorageMode = useUIStore((s) => s.setStorageMode);
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 筛选状态（本地 useState，确保即时响应）
  const [filterMode, setFilterMode] = useState<PhotoFilter>('all');

  // 响应式订阅 pages，确保已添加计数随页面变化自动更新
  const pages = useEditorStore((s) => s.pages);
  const placedPhotoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const page of pages) {
      for (const pl of page.placements) {
        if (pl.photoId) ids.add(pl.photoId);
      }
    }
    return ids;
  }, [pages]);

  // 展开/折叠状态：从持久化 ref 恢复
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(savedExpandedGroupsRef.current));

  const {
    isImporting,
    importProgress,
    importCurrent,
    importTotal,
    isReading,
    readingProgress,
    readingCurrent,
    readingTotal,
    thumbnailsTotal,
    thumbnailsLoaded,
    registerThumbnailLoaded,
    cancelImport,
  } = photoImport;

  /** 导入已完成（isImporting=false）但仍有缩略图待加载时，显示"正在加载缩略图"阶段 */
  const isFinalizingThumbnails = !isImporting && !isReading && thumbnailsTotal > 0 && thumbnailsLoaded < thumbnailsTotal;
  const thumbnailProgress = thumbnailsTotal > 0 ? Math.round((thumbnailsLoaded / thumbnailsTotal) * 100) : 0;

  const [preview, setPreview] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectMode, setSelectMode] = useState<'normal' | 'smart' | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const smartLayoutSelectedIds = useUIStore((s) => s.smartLayoutSelectedIds);
  const setSmartLayoutSelectedIds = useUIStore((s) => s.setSmartLayoutSelectedIds);

  // ── 批量删除确认弹窗 ──
  const [deleteConfirm, setDeleteConfirm] = useState<{
    photoIds: string[];
    label: string;       // 如 "6月15日"、"2025年6月"、"已选照片"
    placedCount: number; // 已放入页面的照片数
  } | null>(null);

  const togglePhotoSelect = (id: string, ctrlKey: boolean = false) => {
    setSelectedPhotoIds((prev) => {
      if (multiSelectMode || ctrlKey) {
        // 多选模式或Ctrl+点击：切换选中状态
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      } else {
        // 非多选模式：单选，点击切换为仅选中这一张
        if (prev.has(id)) return new Set(); // 已选中 → 取消选中
        return new Set([id]);               // 未选中 → 替换为仅这一张
      }
    });
  };

  const toggleGroupSelect = (photoIds: string[]) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      const allSelected = photoIds.every((id) => next.has(id));
      if (allSelected) {
        for (const id of photoIds) next.delete(id);
      } else {
        for (const id of photoIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => { setSelectedPhotoIds(new Set()); };

  // 当前筛选条件下可见的照片 ID（用于全选/反选）
  const visiblePhotoIds = useMemo(() => {
    return photos.filter((p) => checkPhotoVisible(p.id, placedPhotoIds, filterMode)).map((p) => p.id);
  }, [photos, placedPhotoIds, filterMode]);

  const selectAll = useCallback(() => {
    setSelectedPhotoIds(new Set(visiblePhotoIds));
  }, [visiblePhotoIds]);

  const invertSelect = useCallback(() => {
    setSelectedPhotoIds((prev) => {
      const next = new Set<string>();
      for (const id of visiblePhotoIds) {
        if (!prev.has(id)) next.add(id);
      }
      return next;
    });
  }, [visiblePhotoIds]);

  // ── 进入选择模式 ──
  const enterSelectMode = useCallback(() => {
    if (photos.length === 0) {
      addToast({ type: 'warning', message: t('editor.photoPanel.importFirst') });
      return;
    }
    setMultiSelectMode(true);
    setSelectMode('normal');
    clearSelection();
  }, [photos.length, addToast, t]);

  // ── 进入智能编排模式（直接 GP，无模板选择） ──
  const enterSmartLayout = useCallback(() => {
    if (photos.length === 0) {
      addToast({ type: 'warning', message: t('editor.photoPanel.importFirst') });
      return;
    }
    setMultiSelectMode(true);
    setSelectMode('smart');
    clearSelection();
  }, [photos.length, addToast, t]);

  // ── 批量删除：打开确认弹窗 ──
  const confirmBatchDelete = useCallback((ids: string[], label: string) => {
    if (ids.length === 0) {
      addToast({ type: 'warning', message: t('editor.photoPanel.nothingToDelete') });
      return;
    }
    const placed = ids.filter((id) => placedPhotoIds.has(id)).length;
    setDeleteConfirm({ photoIds: ids, label, placedCount: placed });
  }, [placedPhotoIds, addToast, t]);

  // ── 执行批量删除 ──
  const executeBatchDelete = useCallback(() => {
    if (!deleteConfirm) return;
    photoService.removePhotos(deleteConfirm.photoIds);
    // 清除这些照片的选中状态
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      for (const id of deleteConfirm.photoIds) next.delete(id);
      return next;
    });
    addToast({ type: 'success', message: t('editor.photoPanel.deletedCount', { count: deleteConfirm.photoIds.length }) });
    setDeleteConfirm(null);
    // 如果照片清空，退出多选模式
    const remaining = usePhotoStore.getState().photos.length;
    if (remaining === 0 && multiSelectMode) {
      setMultiSelectMode(false);
    }
  }, [deleteConfirm, photoService.removePhotos, addToast, multiSelectMode, t]);

  // ── Delete 键删除选中照片（仅 Delete，Backspace 不触发删除） ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (selectedPhotoIds.size === 0) return;
      e.preventDefault();
      if (multiSelectMode) {
        // 多选模式：弹窗确认
        confirmBatchDelete([...selectedPhotoIds], t('editor.photoPanel.selectedPhotos'));
      } else {
        // 非多选模式：直接删除，无需弹窗
        photoService.removePhotos([...selectedPhotoIds]);
        clearSelection();
        addToast({ type: 'success', message: t('editor.photoPanel.deletedCount', { count: selectedPhotoIds.size }) });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPhotoIds, multiSelectMode, confirmBatchDelete, photoService.removePhotos, addToast, t]);

  // ── 从智能编排页返回：恢复多选状态 ──
  useEffect(() => {
    if (smartLayoutSelectedIds.length > 0) {
      setMultiSelectMode(true);
      setSelectMode('smart');
      setSelectedPhotoIds(new Set(smartLayoutSelectedIds));
    }
  }, [smartLayoutSelectedIds]);

  // ── 按年→月→日三级分组 ──
  // 年作为 sticky 分隔条展示，不折叠；月、日可折叠
  type DayGroup = { dayKey: string; dayLabel: string; photos: Photo[]; count: number };
  type MonthGroup = { monthKey: string; monthLabel: string; total: number; days: DayGroup[] };
  type YearGroup = { yearKey: string; yearLabel: string; total: number; months: MonthGroup[] };

  const yearGroups = useMemo<YearGroup[]>(() => {
    const sorted = [...photos].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const dayMap = new Map<string, Photo[]>();
    for (const photo of sorted) {
      const dk = formatDayKey(photo.date);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk)!.push(photo);
    }

    // 年 → 月 → 日
    const yearMap = new Map<string, Map<string, DayGroup[]>>();
    for (const [dayKey, dayPhotos] of dayMap) {
      const d = new Date(dayKey);
      const yearKey = `${d.getFullYear()}`;
      const monthKey = `${yearKey}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dayLabel = `${d.getDate()}日`;

      if (!yearMap.has(yearKey)) yearMap.set(yearKey, new Map());
      const monthMap = yearMap.get(yearKey)!;
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
      monthMap.get(monthKey)!.push({ dayKey, dayLabel, photos: dayPhotos, count: dayPhotos.length });
    }

    return Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([yearKey, monthMap]) => {
        const months = Array.from(monthMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([monthKey, days]) => {
            const [, m] = monthKey.split('-');
            const total = days.reduce((s, d) => s + d.count, 0);
            return { monthKey, monthLabel: `${Number(m)}月`, total, days };
          });
        const total = months.reduce((s, m) => s + m.total, 0);
        return { yearKey, yearLabel: `${yearKey}年`, total, months };
      });
  }, [photos]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── 导入照片时自动展开本次新增照片对应的月/日分组 ──
  // 用 ref 跟踪上一次的 photo id 集合，diff 出新增照片后展开其所在分组。
  // 首次挂载只初始化 ref，不展开（保留用户折叠偏好）。
  const prevPhotoIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const currentIds = new Set(photos.map((p) => p.id));
    const prevIds = prevPhotoIdsRef.current;
    prevPhotoIdsRef.current = currentIds;
    if (prevIds === null) return; // 首次挂载，不自动展开

    // 找出本次新增的照片（导入）
    const newPhotos = photos.filter((p) => !prevIds.has(p.id));
    if (newPhotos.length === 0) return;

    // 根据新照片的 date 计算需要展开的 monthKey 和 dayKey
    const keysToExpand = new Set<string>();
    for (const photo of newPhotos) {
      const d = new Date(photo.date);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dayKey = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`;
      keysToExpand.add(monthKey);
      keysToExpand.add(dayKey);
    }

    setExpandedGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const k of keysToExpand) {
        if (!next.has(k)) { next.add(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [photos]);

  // 展开层级：all=全部展开（到日），month=展开到月（日收起），none=全部收起
  const applyExpandLevel = useCallback((level: 'all' | 'month' | 'none') => {
    if (level === 'none') {
      setExpandedGroups(new Set());
      return;
    }
    const keys = new Set<string>();
    for (const year of yearGroups) {
      for (const month of year.months) {
        keys.add(month.monthKey);
        if (level === 'all') {
          for (const day of month.days) keys.add(day.dayKey);
        }
      }
    }
    setExpandedGroups(keys);
  }, [yearGroups]);

  const handleFileSelect = useCallback(async () => {
    if (isTauri()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: true,
          filters: [{ name: t('editor.photoPanel.imageFilter'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'gif'] }],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        // ✅ 优化：立即弹出存储模式对话框（若有）或直接开始读取，文件读取在用户决策后才执行，
        //    避免选择大量文件后界面长时间无响应。读取进度由 usePhotoImport 统一管理。
        photoImport.handlePaths(paths);
      } catch (err) {
        logger.error('[PhotoPanel] 打开文件对话框失败:', err);
        addToast({ type: 'error', message: t('editor.photoPanel.openDialogFailed') });
      }
      return;
    }
    fileInputRef.current?.click();
  }, [photoImport, addToast, t]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    // Tauri 桌面端：浏览器 <input> 无法提供原始路径，direct 模式会失效，统一使用 Tauri 对话框
    if (isTauri()) {
      e.target.value = '';
      addToast({ type: 'warning', message: t('editor.photoPanel.useImportButton') });
      return;
    }
    photoImport.handleFiles(e.target.files);
    e.target.value = '';
  }, [photoImport, addToast, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const sb = useScrollbarVisibility<HTMLDivElement>({ externalRef: scrollRef });

  // ── 顶部导入区自动显隐 ──
  const [isUploadHidden, setIsUploadHidden] = useState(false);
  const isUploadHiddenRef = useRef(isUploadHidden);
  useEffect(() => { isUploadHiddenRef.current = isUploadHidden; }, [isUploadHidden]);

  const lastScrollTopRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);



  // ── 照片区域容器宽度测量（用于 Justified Rows 布局）──
  // 每天照片区有 ml-3 pl-3（共 24px）缩进，布局可用宽度需扣除
  const [scrollWidth, setScrollWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollWidth(el.clientWidth);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);

  // ── 恢复滚动位置与展开状态（切换标签后保持）──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 恢复滚动位置
    if (savedScrollTopRef.current > 0) {
      el.scrollTop = savedScrollTopRef.current;
    }
    // 展开状态已在 useState 初始化时恢复
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const st = el.scrollTop;
      savedScrollTopRef.current = st;

      // 导入/读取/缩略图加载进行时保持可见，不执行自动隐藏逻辑
      if (isImporting || isReading || isFinalizingThumbnails) {
        lastScrollTopRef.current = st;
        accumulatedDeltaRef.current = 0;
        return;
      }

      const last = lastScrollTopRef.current;
      const delta = st - last;

      // 内容不足时禁用自动隐藏，避免高度变化导致抖动
      const hasScrollableContent = el.scrollHeight > el.clientHeight + 80;

      // 到达底部后忽略向下的橡皮筋/回弹抖动
      const isAtBottom = st + el.clientHeight >= el.scrollHeight - 4;
      const isAtTop = st <= 4;

      // 累加同方向滚动距离，用于滞回判断
      if (Math.abs(delta) < 1) {
        // 停止滚动时累计值归零（由 scrollEndTimer 处理）
      } else if (
        (accumulatedDeltaRef.current >= 0 && delta > 0) ||
        (accumulatedDeltaRef.current <= 0 && delta < 0)
      ) {
        accumulatedDeltaRef.current += delta;
      } else {
        // 方向反转，重置累计
        accumulatedDeltaRef.current = delta;
      }

      // 使用 requestAnimationFrame 批量处理，避免一帧内多次 setState
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        // 在底部/中间区域滚动时，仅处理向下隐藏；向上显示必须等到滚动到最顶部
        if (!isAtBottom && !isAtTop && hasScrollableContent) {
          const hidden = isUploadHiddenRef.current;
          // 滞回阈值：显示→隐藏需要向下累计 40px
          if (!hidden && accumulatedDeltaRef.current > 40) {
            setIsUploadHidden(true);
            accumulatedDeltaRef.current = 0;
          }
        }

        // 只有滚动到最顶部时才重新显示导入区
        if (isAtTop) {
          setIsUploadHidden(false);
          accumulatedDeltaRef.current = 0;
        }
      });

      // 滚动停止后清空累计，避免下次微小滚动立即触发
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(() => {
        accumulatedDeltaRef.current = 0;
        scrollEndTimerRef.current = null;
      }, 150);

      lastScrollTopRef.current = st;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, [isImporting, isReading, isFinalizingThumbnails]);

  // 导入/读取/缩略图加载过程中始终显示上传区，避免进度提示被隐藏
  useEffect(() => {
    if (isImporting || isReading || isFinalizingThumbnails) setIsUploadHidden(false);
  }, [isImporting, isReading, isFinalizingThumbnails]);

  useEffect(() => {
    return () => {
      savedExpandedGroupsRef.current = new Set(expandedGroups);
    };
  }, [expandedGroups]);

  return (
    <>
      <div
        className="flex flex-col h-full select-none"
      >
        {/* ── 上传区（拖拽/点击导入） ──
             隐藏时：wrapper 高度缩为 0，释放 flex 空间给下方的照片列表，
             让照片列表可视区域变大，展示更多照片。
        */}
        <div
          className={`mx-3 overflow-hidden transition-all duration-300 ease-out ${
            isUploadHidden
              ? 'max-h-0 opacity-0 pointer-events-none'
              : 'max-h-[300px] opacity-100'
          }`}
          style={{
            marginTop: isUploadHidden ? 0 : '0.75rem',
            marginBottom: isUploadHidden ? 0 : '0.25rem',
          }}
        >
          <div
            ref={dropZoneRef}
            data-onboarding="upload-zone"
            className={`px-3 rounded-xl text-center cursor-pointer border-2 border-dashed transition-colors duration-300 ease-out ${
              photos.length > 0 ? 'py-3' : 'py-8'
            } ${
                (isImporting || isReading || isFinalizingThumbnails) ? 'opacity-95 border-[var(--color-primary-300)] bg-[var(--color-primary-50)]/50' : ''
              } border-[var(--color-gray-200)] hover:border-[var(--color-primary-400)] hover:bg-gradient-to-b hover:from-[var(--color-primary-50)]/40 hover:to-transparent`}
              onClick={(isImporting || isReading || isFinalizingThumbnails) ? undefined : handleFileSelect}
            >
              {/* 存储模式标签：点击可重置，下次导入重新选择 */}
              {storageMode && (
                <div className="flex items-center justify-center mb-2">
                  <button
                    type="button"
                    disabled={isImporting || isReading || isFinalizingThumbnails}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStorageMode(null);
                      addToast({ type: 'info', message: t('editor.photoPanel.storageModeReset') });
                    }}
                    className="text-[10px] px-2.5 py-0.5 rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)] font-[500] border border-[var(--color-primary-100)] hover:bg-[var(--color-primary-100)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {storageMode === 'direct' ? t('editor.photoPanel.directMode') : t('editor.photoPanel.importMode')} · {t('editor.photoPanel.clickToSwitch')}
                  </button>
                </div>
              )}
              {isReading ? (
                <div className="relative z-10 flex items-center justify-center gap-2 pointer-events-auto">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary-400)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[12px] text-[var(--color-gray-700)]">
                    {readingProgress < 100 ? t('editor.photoPanel.reading', { current: readingCurrent, total: readingTotal, percent: readingProgress }) : t('editor.photoPanel.preparingImport')}
                  </span>
                  <button
                    type="button"
                    className="ml-1 text-[11px] px-2.5 py-1 rounded-full bg-white text-[var(--color-error)] border border-[var(--color-error-light)] hover:bg-[var(--color-error)] hover:text-white transition-all duration-200 cursor-pointer relative z-20"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); cancelImport(); }}
                  >
                    {t('editor.photoPanel.cancel')}
                  </button>
                </div>
              ) : isImporting ? (
                <div className="relative z-10 flex items-center justify-center gap-2 pointer-events-auto">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary-400)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[12px] text-[var(--color-gray-700)]">
                    {importProgress < 100 ? t('editor.photoPanel.importing', { current: importCurrent, total: importTotal, percent: importProgress }) : t('editor.photoPanel.saving')}
                  </span>
                  <button
                    type="button"
                    className="ml-1 text-[11px] px-2.5 py-1 rounded-full bg-white text-[var(--color-error)] border border-[var(--color-error-light)] hover:bg-[var(--color-error)] hover:text-white transition-all duration-200 cursor-pointer relative z-20"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); cancelImport(); }}
                  >
                    {t('editor.photoPanel.cancel')}
                  </button>
                </div>
              ) : isFinalizingThumbnails ? (
                <div className="relative z-10 flex items-center justify-center gap-2 pointer-events-auto">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary-400)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[12px] text-[var(--color-gray-700)]">
                    {t('editor.photoPanel.loadingThumbnails', { loaded: thumbnailsLoaded, total: thumbnailsTotal, percent: thumbnailProgress })}
                  </span>
                </div>
              ) : photos.length === 0 ? (
                <>
                  <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-[var(--color-primary-100)] to-[var(--color-primary-50)] flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-[var(--color-primary-500)]">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
                      <path d="M5 19l5-5 3 3 4-4 5 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-[var(--color-gray-700)] font-[500]">{t('editor.photoPanel.dragToUpload')}</p>
                  <p className="text-[11px] text-[var(--color-gray-400)] mt-1">{t('editor.photoPanel.formatHint')}</p>
                </>
              ) : (
                <div className="flex items-center justify-center gap-1.5">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-[var(--color-gray-400)]">
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                  <span className="text-[12px] text-[var(--color-gray-400)]">{t('editor.photoPanel.addMorePhotos')}</span>
                </div>
              )}
            </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/heic,image/heif,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />

        {/* ── 筛选栏（含多选切换） ── */}
        <PhotoFilterBar placedCount={placedPhotoIds.size} unplacedCount={photos.filter(p => !placedPhotoIds.has(p.id)).length} total={photos.length}
          mode={filterMode} onFilter={setFilterMode}
          onExpandLevelChange={applyExpandLevel}
          multiSelectMode={multiSelectMode} selectMode={selectMode} onToggleMultiSelect={() => {
            setMultiSelectMode(false);
            setSelectMode(null);
            clearSelection();
          }}
          onEnterSelectMode={enterSelectMode}
          onEnterSmartLayout={enterSmartLayout}
          onStartSmartLayout={() => {
            if (selectedPhotoIds.size === 0) {
              addToast({ type: 'warning', message: t('editor.photoPanel.selectPhotosFirst') });
              return;
            }
            setSmartLayoutSelectedIds([...selectedPhotoIds]);
            onNavigateToSmartLayout();
          }}
          onMissingPhotoSelect={() => addToast({ type: 'warning', message: t('editor.photoPanel.selectPhotosFirst') })}
          onDeleteSelected={() => confirmBatchDelete([...selectedPhotoIds], t('editor.photoPanel.selectedPhotos'))}
          selectedCount={selectedPhotoIds.size}
          onSelectAll={selectAll}
          onInvertSelect={invertSelect} />

        {/* ── 照片列表（年→月→日三级分组，年 sticky 分隔、不可折叠） ── */}
        <div
          ref={sb.ref}
          className={`flex-1 overflow-y-auto ps-scroll pl-3 pr-1 pb-2 ${sb.className}`}
          {...sb.handlers}
          onClick={(e) => {
            // 非多选模式下点击空白区域取消选中
            if (multiSelectMode) return;
            if ((e.target as HTMLElement).closest('[data-photo-item]')) return;
            setSelectedPhotoIds(new Set());
          }}
        >
          {yearGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <div className="w-14 h-14 mb-3 rounded-2xl bg-[var(--color-gray-100)] flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-7 h-7 text-[var(--color-gray-300)]">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
                  <path d="M5 19l5-5 3 3 4-4 5 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-[13px] text-[var(--color-gray-400)]">
                {t('editor.photoPanel.emptyPhotos')}
              </p>
            </div>
          ) : (
            yearGroups.map((year) => {
              // 按筛选条件过滤各层级，无可见内容则不渲染该年
              const visibleMonths = year.months
                .map((m) => ({
                  ...m,
                  days: m.days
                    .map((d) => ({ ...d, photos: d.photos.filter((p) => checkPhotoVisible(p.id, placedPhotoIds, filterMode)) }))
                    .filter((d) => d.photos.length > 0),
                }))
                .filter((m) => m.days.length > 0);
              if (visibleMonths.length === 0) return null;
              const yearPhotoCount = visibleMonths.reduce((s, m) => s + m.days.reduce((ss, d) => ss + d.photos.length, 0), 0);

              return (
                <div key={year.yearKey} className="mb-3">
                  {/* ── 年份分隔条（sticky 顶部，无 frosted 阴影底色）── */}
                  <div className="sticky top-0 z-30 flex items-center gap-2 px-0.5 pt-1 pb-2 bg-[var(--color-surface)]">
                    <span className="text-[15px] font-[800] text-[var(--color-gray-900)] tracking-tight">{year.yearLabel}</span>
                    <span className="text-[10px] text-[var(--color-gray-400)] mt-1">{yearPhotoCount}张</span>
                    <div className="flex-1 h-px bg-[var(--color-gray-200)] ml-1" />
                  </div>

                  {visibleMonths.map((month) => {
                    const monthExpanded = expandedGroups.has(month.monthKey);
                    const monthPhotoCount = month.days.reduce((s, d) => s + d.photos.length, 0);
                    return (
                      <div key={month.monthKey} className="mb-2">
                        {/* ── 月组头（sticky，紧贴年份下方，可折叠） ── */}
                        <div className="sticky top-[30px] z-20 flex items-center gap-1.5 px-0.5 py-1.5 bg-[var(--color-surface)] rounded-md hover:bg-[var(--color-gray-100)] transition-colors duration-200 group/month-header cursor-pointer" onClick={() => toggleGroup(month.monthKey)}>
                          {multiSelectMode && (
                            <div className="flex items-center justify-center w-4 h-4 shrink-0 cursor-pointer"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleGroupSelect(month.days.flatMap((d) => d.photos.map((p) => p.id))); }}>
                              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"
                                style={{ color: month.days.flatMap((d) => d.photos.map((p) => p.id)).every((id) => selectedPhotoIds.has(id)) ? 'var(--color-brand)' : 'var(--color-gray-400)' }}>
                                {month.days.flatMap((d) => d.photos.map((p) => p.id)).every((id) => selectedPhotoIds.has(id))
                                  ? <><rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="currentColor" /><path d="M4.5 7l2 2 3-4" stroke="white" /></>
                                  : <><rect x="1.5" y="1.5" width="11" height="11" rx="2" /></>}
                              </svg>
                            </div>
                          )}
                          <button className="flex items-center gap-1.5 flex-1 text-left border-none bg-transparent cursor-pointer group">
                            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                              className={`w-2.5 h-2.5 text-[var(--color-gray-500)] transition-transform duration-200 ease-out shrink-0 ${monthExpanded ? '' : '-rotate-90'}`}>
                              <path d="M3 2l4 3-4 3" /></svg>
                            <span className="text-[13px] font-[700] text-[var(--color-gray-800)]">{month.monthLabel}</span>
                            <span className="text-[10px] text-[var(--color-gray-400)] ml-0.5">{monthPhotoCount}张</span>
                          </button>
                          {/* 按月删除按钮 */}
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded-lg text-[11px]
                                       text-[var(--color-gray-300)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-light)]
                                       opacity-0 group-hover/month-header:opacity-100
                                       transition-all duration-200 ease-out
                                       cursor-pointer border-none bg-transparent shrink-0"
                            onClick={(e) => { e.stopPropagation();
                              confirmBatchDelete(month.days.flatMap((d) => d.photos.map((p) => p.id)), `${year.yearLabel}${month.monthLabel}`);
                            }}
                            title={t('editor.photoPanel.deleteGroup', { group: `${year.yearLabel}${month.monthLabel}` })}
                          >
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <path d="M1.5 3h9M4 3V2a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M9.5 3v6a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V3" />
                              <path d="M4.5 5v2.5M7.5 5v2.5" />
                            </svg>
                          </button>
                        </div>
                        {monthExpanded && (
                          <div className="ml-3 pl-3 border-l-[1.5px] border-[var(--color-gray-200)] transition-all duration-200">
                            {month.days.map((day) => {
                              const dayExpanded = expandedGroups.has(day.dayKey);
                              const dayPhotoIds = day.photos.map((p) => p.id);
                              return (
                                <div key={day.dayKey} className="mb-2">
                                  {/* ── 日组头（sticky，紧贴月份下方，可折叠） ── */}
                                  <div className="sticky top-[58px] z-10 flex items-center gap-1.5 px-0.5 py-1 bg-[var(--color-surface)] rounded-md hover:bg-[var(--color-gray-100)] transition-colors duration-200 group/day-header cursor-pointer" onClick={() => toggleGroup(day.dayKey)}>
                                    {multiSelectMode && (
                                      <div className="flex items-center justify-center w-3.5 h-3.5 shrink-0 cursor-pointer"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleGroupSelect(dayPhotoIds); }}>
                                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"
                                          style={{ color: dayPhotoIds.every((id) => selectedPhotoIds.has(id)) ? 'var(--color-brand)' : 'var(--color-gray-400)' }}>
                                          {dayPhotoIds.every((id) => selectedPhotoIds.has(id))
                                            ? <><rect x="1" y="1" width="10" height="10" rx="1.5" fill="currentColor" /><path d="M3.5 6l2 2 3-3.5" stroke="white" /></>
                                            : <rect x="1" y="1" width="10" height="10" rx="1.5" />}
                                        </svg>
                                      </div>
                                    )}
                                    <button className="flex items-center gap-1.5 flex-1 text-left border-none bg-transparent cursor-pointer group">
                                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                        className={`w-2 h-2 text-[var(--color-gray-400)] transition-transform duration-200 ease-out shrink-0 ${dayExpanded ? '' : '-rotate-90'}`}>
                                        <path d="M3 2l4 3-4 3" /></svg>
                                      <span className="text-[11px] font-[600] text-[var(--color-gray-600)]">{day.dayLabel}</span>
                                      <span className="text-[10px] text-[var(--color-gray-400)]">{day.photos.length}张</span>
                                    </button>
                                    {/* 按日删除按钮 */}
                                    <button
                                      className="w-5 h-5 flex items-center justify-center rounded-md text-[10px]
                                                 text-[var(--color-gray-300)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-light)]
                                                 opacity-0 group-hover/day-header:opacity-100
                                                 transition-all duration-200 ease-out
                                                 cursor-pointer border-none bg-transparent shrink-0"
                                      onClick={(e) => { e.stopPropagation();
                                        confirmBatchDelete(dayPhotoIds, day.dayLabel);
                                      }}
                                      title={t('editor.photoPanel.deleteGroup', { group: day.dayLabel })}
                                    >
                                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                                        <path d="M1.5 2.5h7M3.5 2.5V1.75a.25.25 0 01.25-.25H6.25a.25.25 0 01.25.25V2.5M8 2.5v5a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-5" />
                                        <path d="M4 4.25v2M6 4.25v2" />
                                      </svg>
                                    </button>
                                  </div>
                                  {dayExpanded && (() => {
                                    const visible = day.photos.filter((p) => checkPhotoVisible(p.id, placedPhotoIds, filterMode));
                                    if (visible.length === 0) return null;
                                    // 扣除外层 pl-3/pr-1、月内容区 ml-3/pl-3/border-l 的安全边距，避免右侧被裁剪
                                    const containerWidth = Math.max(0, scrollWidth - 44);
                                    const rows = computeJustifiedRows(visible, containerWidth, TARGET_ROW_HEIGHT, ITEM_GAP);
                                    // 估算高度用于 content-visibility 占位：每行高度 + gap
                                    const estimatedHeight = rows.length * (TARGET_ROW_HEIGHT + ITEM_GAP);

                                    return (
                                      // content-visibility: auto 让浏览器跳过不可见区域的布局和绘制，
                                      // contain-intrinsic-size 提供占位高度避免滚动条抖动。
                                      // 对 300+ 照片场景可减少 90% 的不可见 DOM 布局开销。
                                      <div
                                        className="mt-1"
                                        style={{
                                          contentVisibility: 'auto',
                                          containIntrinsicSize: `${estimatedHeight}px`,
                                        }}
                                      >
                                        {rows.map((row, rowIdx) => (
                                          <div key={rowIdx} className="flex" style={{ gap: ITEM_GAP, marginBottom: rowIdx < rows.length - 1 ? ITEM_GAP : 0 }}>
                                            {row.photos.map((photo) => {
                                              const ratio = photo.width && photo.height ? photo.width / photo.height : 1;
                                              const thumbW = ratio * row.height;
                                              return (
                                                <div key={`${photo.id}-${photo.src}`} style={{ width: thumbW, height: row.height }}>
                                                  <PhotoThumbItem photo={photo} thumbW={thumbW} thumbH={row.height}
                                                    multiSelectMode={multiSelectMode} selected={selectedPhotoIds.has(photo.id)}
                                                    placed={placedPhotoIds.has(photo.id)} onToggleSelect={togglePhotoSelect}
                                                    selectedPhotoIds={selectedPhotoIds}
                                                    onLoaded={registerThumbnailLoaded}
                                                    onDragEnd={() => setSelectedPhotoIds(new Set())}
                                                    onDoubleClick={() => {
                                                      if (photo.processing || multiSelectMode) return;
                                                      setPreview({ photos: day.photos, index: day.photos.findIndex((p) => p.id === photo.id) });
                                                    }}
                                                    onPreview={() => {
                                                      if (photo.processing) return;
                                                      setPreview({ photos: day.photos, index: day.photos.findIndex((p) => p.id === photo.id) });
                                                    }} />
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <PhotoPanelStatusBar total={photos.length} selected={selectedPhotoIds.size} photos={photos} />

      {/* ── 大图预览 ── */}
      {preview && (
        <PhotoPreview
          photos={preview.photos}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}

      {/* ── 批量删除确认弹窗 ── */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-[2px] animate-[fadeIn_150ms_ease-out]" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center pointer-events-none">
            <div
              className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] p-6 max-w-md w-full mx-4 pointer-events-auto animate-[scaleIn_200ms_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--color-error-light)] flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                       className="w-5 h-5 text-[var(--color-error)]">
                    <path d="M10 2L2 18h16L10 2z" /><path d="M10 8v4" /><circle cx="10" cy="14" r="0.5" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[14px] font-[600] text-[var(--color-gray-800)]">
                    {t('editor.photoPanel.confirmDeleteTitle')}
                  </h3>
                  <p className="text-[12px] text-[var(--color-gray-500)] mt-1">
                    {t('editor.photoPanel.irreversible')}
                  </p>
                  <div className="mt-3 p-3 bg-[var(--color-gray-50)] rounded-xl border border-[var(--color-gray-100)]">
                    <p className="text-[12px] text-[var(--color-gray-700)]">
                      {t('editor.photoPanel.groupLabel')}<span className="font-[600]">{deleteConfirm.label}</span>
                    </p>
                    <p className="text-[12px] text-[var(--color-gray-700)] mt-1">
                      {t('editor.photoPanel.totalPhotos', { count: deleteConfirm.photoIds.length })}
                    </p>
                    {deleteConfirm.placedCount > 0 && (
                      <p className="text-[11px] text-[var(--color-warning-text)] mt-1">
                        {t('editor.photoPanel.placedWarning', { count: deleteConfirm.placedCount })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  className="px-4 py-2 text-[12px] font-[500] text-[var(--color-gray-700)]
                             bg-white border border-[var(--color-gray-200)] rounded-lg
                             hover:bg-[var(--color-gray-50)] active:scale-[0.97]
                             transition-all duration-200 cursor-pointer"
                  onClick={() => setDeleteConfirm(null)}
                >
                  {t('editor.photoPanel.cancel')}
                </button>
                <button
                  className="px-4 py-2 text-[12px] font-[500] text-white
                             bg-[var(--color-error)] rounded-lg
                             hover:bg-[var(--color-error)]/90 hover:shadow-[0_4px_12px_rgba(239,68,68,0.3)]
                             active:scale-[0.97]
                             transition-all duration-200 cursor-pointer"
                  onClick={executeBatchDelete}
                >
                  {t('editor.photoPanel.confirmDeleteBtn', { count: deleteConfirm.photoIds.length })}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function formatDayKey(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── 照片缩略图：React.memo + getState（0 个 zustand 订阅） ── */
const PhotoThumbItem = memo(function PhotoThumbItem({ photo, thumbW, thumbH, multiSelectMode, selected, placed, onToggleSelect, onDoubleClick, onPreview, selectedPhotoIds, onLoaded, onDragEnd }: {
  photo: Photo; thumbW: number; thumbH: number; multiSelectMode: boolean; selected: boolean; placed: boolean;
  onToggleSelect: (id: string, ctrlKey: boolean) => void; onDoubleClick: () => void; onPreview: () => void;
  selectedPhotoIds: Set<string>;
  onLoaded?: (photoId: string) => void;
  onDragEnd?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-photo-item
      className={`group/thumb relative rounded-lg overflow-hidden bg-[var(--color-gray-50)] border
                 border-[var(--color-gray-200)]/60
                 hover:border-[var(--color-primary-400)] hover:shadow-[0_2px_12px_rgba(108,99,255,0.15)]
                 transition-all duration-200 ease-out cursor-grab active:cursor-grabbing
                 ${selected && !multiSelectMode ? 'border-[var(--color-brand)] border-[1.5px]' : ''}`}
      style={{ width: thumbW, height: thumbH }}
      onMouseDown={(e) => {
        if (photo.processing) return;
        // 多选模式下：
        //   - 当前照片已被选中 → 允许启动拖拽（拖拽所有选中照片）
        //   - 当前照片未被选中 → 不启动拖拽，由 onClick 切换选择
        if (multiSelectMode && !selectedPhotoIds.has(photo.id)) return;

        const ctrlOrMeta = e.ctrlKey || e.metaKey;
        // Ctrl/Cmd+单击仅用于切换选择，不进入拖拽流程（仅非多选模式）
        if (!multiSelectMode && ctrlOrMeta) {
          const onUp = (ev: MouseEvent) => {
            document.removeEventListener('mouseup', onUp);
            onToggleSelect(photo.id, ev.ctrlKey || ev.metaKey);
          };
          document.addEventListener('mouseup', onUp);
          return;
        }

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = e.currentTarget.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        // 拖拽已选中照片时，同时拖拽所有已选照片；否则只拖拽当前照片
        // 多选模式下 dragIds 始终为所有选中照片（已在上面确认当前照片被选中）
        const dragIds = selectedPhotoIds.size > 0 && selectedPhotoIds.has(photo.id)
          ? [...selectedPhotoIds]
          : [photo.id];

        let isDragging = false;
        const startDragNow = () => {
          if (isDragging) return;
          isDragging = true;
          startDrag(dragIds, startX, startY, offsetX, offsetY);
        };

        // 延迟 200ms 启动拖拽，移动超过阈值时立即启动，避免单击时误显示缩略图
        const timer = setTimeout(() => {
          startDragNow();
        }, 200);

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            clearTimeout(timer);
            startDragNow();
          }
          if (isDragging) {
            if ((ev.target as HTMLElement)?.closest?.('.fixed.inset-0')) return;
            updateDrag(ev.clientX, ev.clientY);
          }
        };

        const onUp = (ev: MouseEvent) => {
          clearTimeout(timer);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (isDragging) {
            endDrag();
            // 拖拽完成后清空多选内容，让用户进行下一次多选操作
            onDragEnd?.();
            // 拖拽完成后阻止后续 click 事件触发选择切换（多选模式下尤其重要）
            const stopClick = (clickEv: MouseEvent) => {
              clickEv.stopPropagation();
              clickEv.preventDefault();
              document.removeEventListener('click', stopClick, true);
            };
            document.addEventListener('click', stopClick, true);
          } else {
            // 未触发拖拽的 mouseup 视为单击：切换选择
            // 多选模式下由 onClick 处理选择切换，此处不重复处理
            if (!multiSelectMode) {
              onToggleSelect(photo.id, ev.ctrlKey || ev.metaKey);
            }
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }}
      onClick={(e) => {
        if (photo.processing) return;
        // 多选模式下通过点击切换选择（普通模式由 mouseup 处理）
        if (multiSelectMode) {
          onToggleSelect(photo.id, e.ctrlKey || e.metaKey);
        }
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
    >
      {photo.processing ? (
        <div className="w-full h-full flex items-center justify-center bg-[var(--color-gray-50)]">
          <div className="w-5 h-5 border-[2.5px] border-[var(--color-primary-200)] border-t-[var(--color-primary-500)] rounded-full animate-spin" />
        </div>
      ) : (
        <PhotoThumbImg key={`${photo.id}-${photo.src}`} photo={photo} onLoaded={onLoaded} />
      )}
      {/* 选中态高亮：轻微蒙层 + 内描边（inset 向内绘制，不超出边界，靠边照片也能完整显示） */}
      {selected && (
        <div className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-200 bg-[var(--color-brand)]/10 shadow-[inset_0_0_0_2.5px_var(--color-brand)]" />
      )}
      {/* 多选模式勾选框 */}
      {multiSelectMode && (
        <div className={`absolute top-1.5 left-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] border-[1.5px] z-10
          transition-all duration-200 ease-out
          ${selected
            ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white scale-100 shadow-[0_2px_6px_rgba(108,99,255,0.3)]'
            : 'bg-white/80 backdrop-blur-[2px] border-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.1)] hover:border-[var(--color-primary-300)]'
          }`}>
          {selected && (
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
              <path d="M2 5l2 2 4-4" />
            </svg>
          )}
        </div>
      )}
      {/* ── 多选模式下右上角大图预览按钮 ── */}
      {multiSelectMode && !photo.processing && (
        <div className="absolute top-1 right-1 z-10">
          <button
            className="w-6 h-6 flex items-center justify-center rounded-full
                       bg-white/30 backdrop-blur-[4px] hover:bg-white/90
                       text-[var(--color-gray-400)] hover:text-[var(--color-brand)]
                       hover:scale-110 active:scale-95
                       transition-all duration-200 ease-out
                       cursor-pointer border-none shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            title={t('editor.photoPanel.previewLarge')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <circle cx="7" cy="7" r="4.5" /><path d="M11 11l4 4" />
            </svg>
          </button>
        </div>
      )}
      {/* 已添加标记：下深上浅渐变蒙版 + 右下角勾号 */}
      {placed && (
        <>
          {/* 渐变蒙版：下深上浅，比未添加的深 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/20 to-black/5 pointer-events-none transition-opacity duration-300 group-hover/thumb:opacity-0" />
          {/* 右下角勾号标记 */}
          <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-[var(--color-success)]/85 flex items-center justify-center pointer-events-none shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-opacity duration-300 group-hover/thumb:opacity-0">
            <svg viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
              <path d="M2 5l2 2 4-4" />
            </svg>
          </div>
        </>
      )}
      {/* 非多选模式hover：仅边框效果 + 删除按钮（不添加蒙版） */}
      {!multiSelectMode && (
        <div className="absolute inset-0 transition-all duration-200 flex items-start justify-end p-1">
          <button className="w-5 h-5 flex items-center justify-center rounded-md bg-black/30 backdrop-blur-[4px] opacity-0 group-hover/thumb:opacity-100
                             text-white/80 hover:bg-[var(--color-error)] hover:text-white
                             active:scale-90
                             transition-all duration-200 text-[10px] border-none cursor-pointer"
            onClick={(e) => { e.stopPropagation(); photoService.removePhoto(photo.id); }} title={t('editor.photoPanel.deletePhoto')}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
              <path d="M2 3h8M5 3V2a.5.5 0 01.5-.5h1a.5.5 0 01.5.5v1M9 3v5.5a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5V3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
});
