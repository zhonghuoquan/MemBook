/**
 * 相似照片聚类工具 — 查找 pHash 距离 6-15 的视觉相似照片（连拍 / 同场景）
 *
 * 与去重工具的区别：
 * - 去重：找精确重复（SHA256 或 pHash ≤ 5），算法自动建议删除项
 * - 相似：找 pHash 6-15 的相似照片，只展示不自动勾选，用户手动标记删除
 *
 * 用户交互：
 * - 算法计算 keepIndex 作为建议保留项（绿色边框 + "建议保留"标签）
 * - 用户点击缩略图切换"标记删除"状态（红色边框 + ✕）
 * - 删除操作仅 Tauri folder 模式可用（移入系统回收站，可恢复）
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findSimilarPhotos,
  isTauri,
  formatBytes,
  type PhotoFileInfo,
  type SimilarGroup,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, ThumbImage, type ToolProps } from './shared';
import { PhotoQuickView } from './PhotoQuickView';

export function SimilarTool({ photos, readPhotoData, addToast, onBusyChange, sourceMode }: ToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [groups, setGroups] = useState<SimilarGroup[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [minDistance, setMinDistance] = useState(6);
  const [maxDistance, setMaxDistance] = useState(15);
  // 用户标记删除的索引：groupId → Set<文件索引>
  const [markedDelete, setMarkedDelete] = useState<Record<string, Set<number>>>({});
  const abortRef = useRef<AbortController | null>(null);

  // 通知父组件工具执行状态（running / deleting），用于禁用标签切换
  const busy = running || deleting;
  useEffect(() => {
    onBusyChange?.('similar', busy);
    return () => { onBusyChange?.('similar', false); };
  }, [busy, onBusyChange]);

  /** 查找相似照片 */
  const handleStart = async () => {
    if (photos.length < 2) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setScanned(false);
    setGroups([]);
    setMarkedDelete({});

    try {
      const res = await findSimilarPhotos(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
        minDistance,
        maxDistance,
        readData: readPhotoData,
      });
      setGroups(res);
      setScanned(true);
      if (res.length > 0) {
        const photoCount = res.reduce((s, g) => s + g.files.length, 0);
        addToast({
          type: 'info',
          message: t('home.organize.similar.toastFound', { groups: res.length, photos: photoCount }),
        });
      } else {
        addToast({ type: 'success', message: t('home.organize.similar.toastNoResult') });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast({ type: 'error', message: t('home.organize.similar.toastFailed', { message: (err as Error).message }) });
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  // 大图预览
  const [previewGroup, setPreviewGroup] = useState<SimilarGroup | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const openPreview = useCallback((g: SimilarGroup, idx: number) => {
    setPreviewGroup(g);
    setPreviewIndex(idx);
  }, []);
  const closePreview = useCallback(() => setPreviewGroup(null), []);

  /** 切换某张照片的标记删除状态 */
  const toggleMark = useCallback(
    (g: SimilarGroup, idx: number) => {
      setMarkedDelete((prev) => {
        const cur = new Set(prev[g.groupId] ?? []);
        if (cur.has(idx)) {
          cur.delete(idx);
        } else {
          // 每组至少保留 1 张（避免整组误删）
          if (cur.size >= g.files.length - 1) {
            addToast({ type: 'warning', message: t('home.organize.similar.keepAtLeastOne') });
            return prev;
          }
          cur.add(idx);
        }
        return { ...prev, [g.groupId]: cur };
      });
    },
    [t, addToast],
  );

  // 标记删除的照片列表（每轮渲染重新计算）
  const markedList: PhotoFileInfo[] = groups.flatMap((g) => {
    const marks = markedDelete[g.groupId];
    if (!marks) return [];
    return g.files.filter((_, i) => marks.has(i));
  });

  // 统计：总组数 / 涉及照片数 / 已标记删除数
  const totalGroups = groups.length;
  const photosInvolved = groups.reduce((s, g) => s + g.files.length, 0);
  const markedCount = markedList.length;

  // 删除仅在 Tauri folder 模式可用
  const canDelete = sourceMode === 'folder' && isTauri();

  /** 删除用户标记的照片（移入系统回收站） */
  const handleDelete = async () => {
    if (deleting || markedCount === 0) return;
    if (!canDelete) {
      addToast({ type: 'warning', message: t('home.organize.similar.deleteDisabled') });
      return;
    }
    setDeleting(true);
    let ok = 0, fail = 0;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const paths = markedList.map((f) => f.path).filter((p): p is string => Boolean(p));
      if (paths.length > 0) {
        try {
          await invoke('trash_files', { paths });
          ok = paths.length;
          fail = markedList.length - paths.length;
        } catch {
          // 批量失败时逐个移入回收站，定位失败文件
          for (const f of markedList) {
            try {
              if (f.path) { await invoke('trash_files', { paths: [f.path] }); ok++; } else fail++;
            } catch { fail++; }
          }
        }
      } else {
        fail = markedList.length;
      }

      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: fail > 0
          ? t('home.organize.similar.toastDeletedWithFail', { ok, fail })
          : t('home.organize.similar.toastDeleted', { ok }),
      });

      // 删除成功后清空结果（与去重工具一致，用户可重新扫描）
      setGroups([]);
      setMarkedDelete({});
      setScanned(false);
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.similar.toastDeleteFailed', { message: (err as Error).message }) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ToolCard
      title={t('home.organize.similar.title')}
      description={t('home.organize.similar.description')}
      color="orange"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <rect x="2" y="4" width="11" height="11" rx="2" />
          <rect x="7" y="7" width="11" height="11" rx="2" />
        </svg>
      }
    >
      {/* 距离范围设置 + 查找按钮 */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-secondary)] whitespace-nowrap">{t('home.organize.similar.minDistance')}</span>
          <input
            type="range" min={0} max={20} value={minDistance}
            onChange={(e) => setMinDistance(Math.min(Number(e.target.value), maxDistance - 1))}
            className="w-24"
          />
          <span className="text-xs font-mono w-5 text-[var(--color-gray-600)]">{minDistance}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-secondary)] whitespace-nowrap">{t('home.organize.similar.maxDistance')}</span>
          <input
            type="range" min={1} max={30} value={maxDistance}
            onChange={(e) => setMaxDistance(Math.max(Number(e.target.value), minDistance + 1))}
            className="w-24"
          />
          <span className="text-xs font-mono w-5 text-[var(--color-gray-600)]">{maxDistance}</span>
        </label>
        <span className="text-xs text-[var(--color-text-secondary)]">{t('home.organize.similar.distanceHint')}</span>
        {!running && (
          <PrimaryButton onClick={handleStart} disabled={photos.length < 2}>
            {groups.length > 0 ? t('home.organize.similar.rescan') : t('home.organize.similar.startScan')}
          </PrimaryButton>
        )}
      </div>

      {/* 进度条 + 取消按钮 */}
      {running && (
        <div>
          <ProgressBar progress={progress} />
          <button onClick={handleCancel} className="mt-2 px-3 py-1.5 rounded text-xs border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
            {t('home.organize.similar.cancel')}
          </button>
        </div>
      )}

      {/* 无结果提示 */}
      {scanned && groups.length === 0 && !running && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">{t('home.organize.similar.noResult')}</div>
      )}

      {/* 相似组列表 */}
      {groups.length > 0 && (
        <div className="mt-3 space-y-3 max-h-[600px] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {groups.map((g, gi) => (
            <div key={g.groupId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              {/* 组头：编号 + 照片数 + 平均距离 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-gray-50)] text-xs">
                <span className="font-[600] text-[var(--color-gray-700)]">#{gi + 1}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {t('home.organize.similar.groupLabel', { count: g.files.length, avg: g.avgDistance.toFixed(1) })}
                </span>
              </div>

              {/* 缩略图网格 */}
              <div className="p-3">
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  {g.files.map((f, i) => {
                    const isSuggest = i === g.keepIndex;
                    const isMarked = markedDelete[g.groupId]?.has(i) ?? false;
                    return (
                      <div
                        key={f.id}
                        className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                          isMarked ? 'border-red-400' : isSuggest ? 'border-green-400' : 'border-transparent'
                        }`}
                        onClick={() => toggleMark(g, i)}
                        title={t('home.organize.similar.clickToToggle')}
                      >
                        {/* 标记删除徽章（右上角 ✕ 红叉） */}
                        {isMarked && (
                          <div
                            className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-white shadow-lg ring-2 ring-white"
                            style={{ background: '#ef4444' }}
                          >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4">
                              <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                          </div>
                        )}

                        {/* 建议保留标签（左上角） */}
                        {isSuggest && !isMarked && (
                          <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-500/85 text-white backdrop-blur-sm shadow-sm">
                            {t('home.organize.similar.suggestKeep')}
                          </span>
                        )}

                        {/* 缩略图：使用共享 ThumbImage，支持异步加载与点击预览 */}
                        <ThumbImage
                          photo={f}
                          readPhotoData={readPhotoData}
                          onPreview={() => openPreview(g, i)}
                          size="medium"
                        />

                        {/* 文件信息 */}
                        <div className="px-2 py-1.5 bg-[var(--color-surface)] text-[10px] leading-tight">
                          <div className="font-medium text-[var(--color-gray-800)] truncate" title={f.name}>{f.name}</div>
                          <div className="text-[var(--color-gray-400)] mt-0.5">{formatBytes(f.size)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 统计 + 删除操作 */}
      {groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {t('home.organize.similar.stats', { groups: totalGroups, photos: photosInvolved, marked: markedCount })}
          </span>
          <PrimaryButton variant="danger" onClick={handleDelete} disabled={markedCount === 0 || !canDelete} loading={deleting}>
            {t('home.organize.similar.deleteSelected', { count: markedCount })}
          </PrimaryButton>
          {!canDelete && (
            <span className="text-xs text-[var(--color-text-secondary)]">{t('home.organize.similar.deleteDisabled')}</span>
          )}
        </div>
      )}

      {/* 照片大图预览 */}
      {previewGroup && (
        <PhotoQuickView
          photos={previewGroup.files}
          initialIndex={previewIndex}
          onClose={closePreview}
          readPhotoData={readPhotoData}
        />
      )}
    </ToolCard>
  );
}
