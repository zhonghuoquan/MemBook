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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findSimilarPhotos,
  isTauri,
  type PhotoFileInfo,
  type SimilarGroup,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, RangeSlider, PhotoCard, useDeleteUndo, UndoBar, useLazyList, type ToolProps } from './shared';
import { PhotoQuickView } from './PhotoQuickView';

/** 相似照片面板级结果状态（与 OrganizePanel 的 SimilarPanelState 结构一致） */
export interface SimilarPanelState {
  scanned: boolean;
  groups: SimilarGroup[];
  marked: Record<string, Set<number>>;
}

/** 相似组懒加载每批数量 */
const SIMILAR_GROUP_BATCH = 10;

interface SimilarToolProps extends ToolProps {
  autoRunToken?: number;
  isAutoRunTarget?: boolean;
  /** 面板级持久化的相似分析结果（切换标签/离开面板不丢） */
  similarResult?: SimilarPanelState;
  onSimilarStateChange?: (s: SimilarPanelState) => void;
}

export function SimilarTool({ photos, readPhotoData, addToast, onBusyChange, onResultSummary, sourceMode, onPhotosUpdate, checkWritePermission, similarResult, onSimilarStateChange, autoRunToken, isAutoRunTarget, albumActive, onAlbumChange }: SimilarToolProps) {
  const { t } = useTranslation();
  // 写操作一致性：删除可撤销（与去重/人脸/日历统一）
  const { lastDeleted, runDelete, undoDelete } = useDeleteUndo({ sourceMode, addToast, onPhotosUpdate });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 相似分组 / 是否已扫描 / 标记删除 均提升到面板级（受控，由父组件持久化）
  const groups = similarResult?.groups ?? [];
  const scanned = similarResult?.scanned ?? false;
  const markedDelete = similarResult?.marked ?? {};
  const updateSimilar = useCallback((next: SimilarPanelState) => { onSimilarStateChange?.(next); }, [onSimilarStateChange]);
  const [deleting, setDeleting] = useState(false);
  // 相似程度：只用一个滑块调节上限（越严格/越宽松）。
  // 下限固定为 6（≤6 属于“重复”，交给照片去重功能处理），用户无需调节。
  const MIN_DISTANCE = 6;
  const [maxDistance, setMaxDistance] = useState(15);
  const abortRef = useRef<AbortController | null>(null);
  // 懒加载：相似组多时按批渲染，滚动到底自动追加
  const { visibleCount: groupVisible, sentinelRef: groupSentinel } = useLazyList(groups.length, SIMILAR_GROUP_BATCH);

  // 通知父组件工具执行状态（running / deleting），用于禁用标签切换
  const busy = running || deleting;
  useEffect(() => {
    onBusyChange?.('similar', busy);
    return () => { onBusyChange?.('similar', false); };
  }, [busy, onBusyChange]);

  /** 查找相似照片 */
  const handleStart = async () => {
    if (photos.length < 2) return;
    // 分析对全部用户开放（含 Free）：相似照片组可查看、可标记；
    // 落地删除操作才由 checkWritePermission 收口到 Pro。
    abortRef.current = new AbortController();
    setRunning(true);
    updateSimilar({ scanned: false, groups: [], marked: {} });

    try {
      let failedCount = 0;
      const res = await findSimilarPhotos(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
        minDistance: MIN_DISTANCE,
        maxDistance,
        readData: readPhotoData,
        onFailure: (count) => { failedCount = count; },
      });
      updateSimilar({ scanned: true, groups: res, marked: {} });
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
      // 单张失败温和降级：部分照片读取/解码失败不中断，其余正常分析，完成后提示
      if (failedCount > 0) {
        addToast({
          type: 'warning',
          message: t('home.organize.similar.toastSomeFailed', { failed: failedCount }),
        });
      }
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
      const cur = new Set(markedDelete[g.groupId] ?? []);
      if (cur.has(idx)) {
        cur.delete(idx);
      } else {
        // 允许整组全部标记删除（不再强制保留一张）
        cur.add(idx);
      }
      updateSimilar({ scanned, groups, marked: { ...markedDelete, [g.groupId]: cur } });
    },
    [scanned, groups, markedDelete, updateSimilar],
  );

  // 标记删除的照片列表（每轮渲染重新计算）
  const markedList: PhotoFileInfo[] = groups.flatMap((g) => {
    const marks = markedDelete[g.groupId];
    if (!marks) return [];
    return g.files.filter((_, i) => marks.has(i));
  });

  // 保留的照片列表（未标记删除的，供“加入相册”使用；memo 保持引用稳定避免上报触发面板重渲染）
  const keptList: PhotoFileInfo[] = useMemo(() => groups.flatMap((g) => {
    const marks = markedDelete[g.groupId];
    if (!marks) return g.files;
    return g.files.filter((_, i) => !marks.has(i));
  }), [groups, markedDelete]);

  // 上报「当前有效结果集」：相似组中保留的照片可统一加入相册
  useEffect(() => {
    if (albumActive) onAlbumChange?.(groups.length > 0 ? keptList : null);
  }, [albumActive, onAlbumChange, groups.length, keptList]);

  // 统计：总组数 / 涉及照片数 / 已标记删除数
  const totalGroups = groups.length;
  const photosInvolved = groups.reduce((s, g) => s + g.files.length, 0);
  const markedCount = markedList.length;

  // 删除仅在 Tauri folder 模式可用
  const canDelete = sourceMode === 'folder' && isTauri();

  /** 删除用户标记的照片（移入系统回收站） */
  const handleDelete = async () => {
    if (deleting || markedCount === 0) return;
    // 写操作授权：删除照片需 Pro（激活或试用期内）；Free 弹激活窗并中止
    if (checkWritePermission && !checkWritePermission()) return;
    if (!canDelete) {
      addToast({ type: 'warning', message: t('home.organize.similar.deleteDisabled') });
      return;
    }
    setDeleting(true);
    try {
      // 统一走共享删除（library 移除 / folder 进回收站），并记录最近删除供撤销
      await runDelete(markedList);
      // 删除成功后清空结果（与去重工具一致，用户可重新扫描）
      updateSimilar({ scanned: false, groups: [], marked: {} });
      // 删除完成后重新上报摘要，同步更新报告页数据
      onResultSummary?.({
        tool: 'similar',
        hasResult: false,
        count: 0,
        label: t('home.organize.similar.summaryNone'),
        targetTool: 'similar',
        color: 'amber',
      });
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
          {groups.slice(0, groupVisible).map((g, gi) => (
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
                      <PhotoCard
                        key={f.id}
                        photo={f}
                        readPhotoData={readPhotoData}
                        onPreview={() => openPreview(g, i)}
                        onToggle={() => toggleMark(g, i)}
                        state={isMarked ? 'delete' : isSuggest ? 'keep' : 'none'}
                        stateLabel={isSuggest && !isMarked ? t('home.organize.similar.suggestKeep') : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          {/* 懒加载哨兵：滚动进入视口时追加下一批相似组 */}
          {groupVisible < groups.length && <div ref={groupSentinel} className="h-2" />}
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

      {/* 删除撤销提示栏（与去重/人脸/日历统一） */}
      <UndoBar count={lastDeleted?.length ?? 0} onUndo={undoDelete} />

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
