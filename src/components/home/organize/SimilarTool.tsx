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
import { ToolCard, ProgressBar, PrimaryButton, RangeSlider, AddToAlbumButton, ThumbImage, useTabCachedResult, type ToolProps } from './shared';
import { PhotoQuickView } from './PhotoQuickView';
import { AlbumBridgeDialog } from './AlbumBridgeDialog';

export function SimilarTool({ photos, readPhotoData, addToast, onBusyChange, onResultSummary, sourceMode, tabId, autoRunToken, isAutoRunTarget }: ToolProps & { autoRunToken?: number; isAutoRunTarget?: boolean }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 相似分组 / 是否已扫描 / 标记删除 均按标签缓存，切换路径时保留各路径结果
  const [groups, setGroups] = useTabCachedResult<SimilarGroup[]>(tabId, []);
  const [deleting, setDeleting] = useState(false);
  const [scanned, setScanned] = useTabCachedResult<boolean>(tabId, false);
  // 相似程度：只用一个滑块调节上限（越严格/越宽松）。
  // 下限固定为 6（≤6 属于“重复”，交给照片去重功能处理），用户无需调节。
  const MIN_DISTANCE = 6;
  const [maxDistance, setMaxDistance] = useState(15);
  // 加入相册对话框
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
  // 用户标记删除的索引：groupId → Set<文件索引>（按标签缓存）
  const [markedDelete, setMarkedDelete] = useTabCachedResult<Record<string, Set<number>>>(tabId, {});
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
        minDistance: MIN_DISTANCE,
        maxDistance,
        readData: readPhotoData,
      });
      setGroups(res);
      setScanned(true);
      // 上报结果摘要（供“一键分析结果报告页”展示）
      const photoCount = res.reduce((s, g) => s + g.files.length, 0);
      onResultSummary?.({
        tool: 'similar',
        hasResult: res.length > 0,
        count: res.length,
        subCount: photoCount,
        label: res.length > 0
          ? t('home.organize.similar.summaryFound', { groups: res.length, photos: photoCount })
          : t('home.organize.similar.summaryNone'),
        targetTool: 'similar',
        color: 'amber',
      });
      if (res.length > 0) {
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

  // “一键分析”自动触发：仅当本工具是当前分析目标且令牌变化时，自动开始相似照片分析
  const prevToken = useRef(0);
  useEffect(() => {
    if (isAutoRunTarget && autoRunToken && autoRunToken !== prevToken.current) {
      prevToken.current = autoRunToken;
      if (!running && !deleting && photos.length > 0) {
        void handleStart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken, isAutoRunTarget]);

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

  // 保留的照片列表（未标记删除的，供“加入相册”使用）
  const keptList: PhotoFileInfo[] = groups.flatMap((g) => {
    const marks = markedDelete[g.groupId];
    if (!marks) return g.files;
    return g.files.filter((_, i) => !marks.has(i));
  });

  // 加入相册
  const handleAddToAlbum = () => {
    if (keptList.length === 0) {
      addToast({ type: 'warning', message: t('home.organize.albumBridge.selectPhotosFirst') });
      return;
    }
    setAlbumBridgeOpen(true);
  };

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
      color="amber"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <rect x="2" y="4" width="11" height="11" rx="2" />
          <rect x="7" y="7" width="11" height="11" rx="2" />
        </svg>
      }
    >
      {/* 固定“加入相册”浮动按钮（与日历/人脸聚类一致：右上角，样式统一） */}
      {groups.length > 0 && (
        <div className="absolute top-4 right-4 z-20">
          <AddToAlbumButton
            count={keptList.length}
            onClick={handleAddToAlbum}
          />
        </div>
      )}

      {/* 相似程度设置 + 查找按钮（单滑块调节上限，下限固定为 6，交由去重功能处理重复照片） */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('home.organize.similar.distanceLabel', '相似程度')}
            </span>
          </div>
          <RangeSlider
            min={6}
            max={30}
            value={maxDistance}
            step={1}
            disabled={running}
            onChange={(v) => setMaxDistance(v)}
            accent="#C95A4D"
          />
          <p className="text-[11px] text-[var(--color-gray-500)] mt-1">
            {t('home.organize.similar.distanceHint')}
          </p>
        </div>
        {!running && (
          <PrimaryButton onClick={handleStart} disabled={photos.length < 2}>
            {groups.length > 0 ? t('home.organize.similar.rescan') : t('home.organize.similar.startScan')}
          </PrimaryButton>
        )}
      </div>

      {/* 进度条 + 取消按钮（取消按钮统一放进度条右侧） */}
      {running && (
        <div className="mt-3">
          <ProgressBar progress={progress} onCancel={handleCancel} cancelLabel={t('home.organize.similar.cancel')} />
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

      {/* 加入相册对话框 */}
      <AlbumBridgeDialog
        open={albumBridgeOpen}
        onClose={() => setAlbumBridgeOpen(false)}
        photos={keptList}
        sourceMode={sourceMode}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />
    </ToolCard>
  );
}
