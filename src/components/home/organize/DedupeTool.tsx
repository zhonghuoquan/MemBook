/**
 * 去重工具 — 四级去重（size → 头部4KB → 全量 SHA256 → pHash 感知哈希）
 *
 * Phase 1-3：精确字节匹配（SHA256 完全相同）
 * Phase 4  ：视觉相似匹配（pHash 汉明距离 ≤ 阈值，识别 EXIF 差异/重新压缩等衍生文件）
 *
 * 用户交互：
 * - 算法计算 keepIndex 作为默认保留项（绿色 ✓ 标记）
 * - 用户可点击卡片切换保留(绿✓)/删除(红✗)，覆盖算法建议
 * - 点击缩略图打开 PhotoQuickView 大图预览
 * - 组头提供"按建议重置"、"全部保留"快捷操作
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deduplicatePhotos,
  formatBytes,
  isTauri,
  type PhotoFileInfo,
  type DedupeResult,
  type DedupeGroup,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, ThumbImage, type ToolProps } from './shared';
import { PhotoQuickView } from './PhotoQuickView';
import { evictFromCache } from './thumbCache';

interface DedupeToolProps extends ToolProps {
  /** 去重结果（受控，由父组件持久化到 tab 级别，切换标签不丢失） */
  dedupeResult?: DedupeResult | null;
  /** 去重用户覆盖（保留/删除手动调整） */
  dedupeOverrides?: Record<string, Set<number>>;
  /** 去重状态变化通知（result + overrides 一起更新，避免分步调用产生中间态） */
  onDedupeStateChange?: (result: DedupeResult | null, overrides: Record<string, Set<number>>) => void;
  /** “一键分析”触发令牌（递增触发一次自动运行） */
  autoRunToken?: number;
  /** 当前是否为“一键分析”的目标工具（仅目标工具自动运行） */
  isAutoRunTarget?: boolean;
}

export function DedupeTool({ photos, sourceMode, onPhotosUpdate, addToast, readPhotoData, onBusyChange, onResultSummary, dedupeResult, dedupeOverrides, onDedupeStateChange, autoRunToken, isAutoRunTarget }: DedupeToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 最近删除的照片（用于撤销）
  const [lastDeleted, setLastDeleted] = useState<PhotoFileInfo[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 受控状态：result 和 overrides 由父组件持久化（切换标签不丢失）
  // DedupeTool 通过 key={tabId} 在标签切换时重新挂载，从 props 初始化
  const result = dedupeResult ?? null;
  const overrides = dedupeOverrides ?? {};

  /** 统一更新去重状态（result + overrides 一起更新，避免分步调用产生中间态） */
  const updateDedupeState = useCallback(
    (newResult: DedupeResult | null, newOverrides: Record<string, Set<number>>) => {
      onDedupeStateChange?.(newResult, newOverrides);
    },
    [onDedupeStateChange],
  );

  // 照片预览
  const [previewGroup, setPreviewGroup] = useState<DedupeGroup | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 通知父组件工具执行状态（running/deleting），用于禁用标签切换
  const busy = running || deleting;
  useEffect(() => {
    onBusyChange?.('dedupe', busy);
    return () => { onBusyChange?.('dedupe', false); };
  }, [busy, onBusyChange]);

  // 去重结果被清除时（重新扫描 / 切换到无结果标签），重置本地 UI 状态
  useEffect(() => {
    if (!dedupeResult) {
      setConfirmMode(false);
      setProgress(null);
    }
  }, [dedupeResult]);

  const handleStart = async () => {
    if (photos.length < 2) return;
    abortRef.current = new AbortController();
    setRunning(true);
    updateDedupeState(null, {});
    setConfirmMode(false);

    try {
      const res = await deduplicatePhotos(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
      });
      updateDedupeState(res, {});
      // 上报结果摘要（供“一键分析结果报告页”展示）
      onResultSummary?.({
        tool: 'dedupe',
        hasResult: res.totalGroups > 0,
        count: res.totalGroups,
        subCount: res.duplicateCount,
        label: res.totalGroups > 0
          ? t('home.organize.dedupe.summaryFound', { groups: res.totalGroups, count: res.duplicateCount, size: formatBytes(res.freedBytes) })
          : t('home.organize.dedupe.summaryClean'),
        targetTool: 'dedupe',
        color: 'coral',
      });
      if (res.totalGroups > 0) {
        addToast({
          type: 'info',
          message: t('home.organize.dedupe.toastFound', { groups: res.totalGroups, count: res.duplicateCount, size: formatBytes(res.freedBytes) }),
        });
      } else {
        addToast({ type: 'success', message: t('home.organize.dedupe.toastNoDuplicates') });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast({ type: 'error', message: t('home.organize.dedupe.toastDedupeFailed', { message: (err as Error).message }) });
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  // “一键分析”自动触发：仅当本工具是当前分析目标且令牌变化时，自动开始去重
  const prevToken = useRef(0);
  useEffect(() => {
    if (isAutoRunTarget && autoRunToken && autoRunToken !== prevToken.current) {
      prevToken.current = autoRunToken;
      if (!running && !deleting && photos.length >= 2) {
        void handleStart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken, isAutoRunTarget]);

  /** 获取某组实际保留的索引集合（用户覆盖优先，否则回退算法 keepIndex） */
  const getKeepSet = useCallback(
    (g: DedupeGroup): Set<number> => overrides[g.groupId] ?? new Set([g.keepIndex]),
    [overrides],
  );

  /** 切换某张照片的保留/删除状态 */
  const toggleKeep = useCallback(
    (g: DedupeGroup, idx: number) => {
      const cur = new Set(overrides[g.groupId] ?? [g.keepIndex]);
      if (cur.has(idx)) {
        // 取消保留：若当前只剩 1 张保留，禁止
        if (cur.size <= 1) {
          addToast({ type: 'warning', message: t('home.organize.dedupe.keepAtLeastOne') });
          return;
        }
        cur.delete(idx);
      } else {
        cur.add(idx);
      }
      updateDedupeState(result, { ...overrides, [g.groupId]: cur });
    },
    [overrides, result, updateDedupeState, addToast, t],
  );

  /** 批量操作：按算法建议重置 */
  const resetGroup = useCallback((g: DedupeGroup) => {
    const n = { ...overrides };
    delete n[g.groupId];
    updateDedupeState(result, n);
  }, [overrides, result, updateDedupeState]);

  /** 批量操作：全部保留 */
  const keepAll = useCallback((g: DedupeGroup) => {
    updateDedupeState(result, {
      ...overrides,
      [g.groupId]: new Set(g.files.map((_, i) => i)),
    });
  }, [overrides, result, updateDedupeState]);

  /** 全局重置 */
  const resetAll = useCallback(() => updateDedupeState(result, {}), [result, updateDedupeState]);

  /** 计算实际待删除的照片列表 */
  const toDelete = useMemo<PhotoFileInfo[]>(() => {
    if (!result) return [];
    const list: PhotoFileInfo[] = [];
    for (const g of result.groups) {
      const keep = getKeepSet(g);
      g.files.forEach((f, i) => { if (!keep.has(i)) list.push(f); });
    }
    return list;
  }, [result, getKeepSet]);

  /** 实际删除统计 */
  const deleteStats = useMemo(() => {
    const count = toDelete.length;
    const bytes = toDelete.reduce((sum, f) => sum + f.size, 0);
    return { count, bytes };
  }, [toDelete]);

  /** 打开预览 */
  const openPreview = useCallback((g: DedupeGroup, idx: number) => {
    setPreviewGroup(g);
    setPreviewIndex(idx);
  }, []);

  const closePreview = useCallback(() => setPreviewGroup(null), []);

  const handleDelete = async () => {
    if (!result || deleting) return;
    if (toDelete.length === 0) {
      addToast({ type: 'warning', message: t('home.organize.dedupe.nothingToDelete') });
      return;
    }
    setDeleting(true);
    // 保存删除前的照片列表，用于撤销
    const deletedPhotos = [...toDelete];

    let ok = 0, fail = 0;
    try {
      if (sourceMode === 'library') {
        for (const f of toDelete) {
          if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
          // 清理 thumbCache 中缓存的此照片缩略图
          evictFromCache(f.id);
          ok++;
        }
      } else if (isTauri()) {
        // 与 ConvertTool 一致：移入系统回收站（可恢复），而非物理删除
        const { invoke } = await import('@tauri-apps/api/core');
        const paths = toDelete.map((f) => f.path).filter((p): p is string => Boolean(p));
        if (paths.length > 0) {
          try {
            await invoke('trash_files', { paths });
            ok = paths.length;
            // 无 path 的条目（理论上不应出现）计为失败
            fail = toDelete.length - paths.length;
          } catch {
            // 批量失败时尝试逐个移入回收站，定位失败文件
            for (const f of toDelete) {
              try {
                if (f.path) { await invoke('trash_files', { paths: [f.path] }); ok++; } else fail++;
              } catch { fail++; }
            }
          }
        } else {
          fail = toDelete.length;
        }
      } else {
        for (const f of toDelete) {
          if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
          ok++;
        }
      }

      const deleteIds = new Set(toDelete.map((f) => f.id));
      onPhotosUpdate((prev) => prev.filter((p) => !deleteIds.has(p.id)));

      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: fail > 0 ? t('home.organize.dedupe.toastDeletedWithFail', { ok, fail }) : t('home.organize.dedupe.toastDeleted', { ok }),
      });
      setLastDeleted(deletedPhotos);
      // 撤销倒计时：5秒后自动清除撤销状态
      setTimeout(() => setLastDeleted(null), 5000);
      updateDedupeState(null, {});
      setConfirmMode(false);
      // 删除完成后重新上报摘要，同步更新报告页数据
      onResultSummary?.({
        tool: 'dedupe',
        hasResult: false,
        count: 0,
        label: t('home.organize.dedupe.summaryClean'),
        targetTool: 'dedupe',
        color: 'coral',
      });
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.dedupe.toastDeleteFailed', { message: (err as Error).message }) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ToolCard
      title={t('home.organize.dedupe.title')}
      description={t('home.organize.dedupe.description')}
      color="coral"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M9 2a7 7 0 105.293 11.707l3.707 3.707" />
          <path d="M15 15l3 3" />
          <line x1="18" y1="9" x2="12" y2="15" />
        </svg>
      }
    >
      {!result && !running && (
        <PrimaryButton onClick={handleStart} disabled={photos.length < 2}>
          {t('home.organize.dedupe.startScan')}
        </PrimaryButton>
      )}

      {running && (
        <div className="mt-3">
          <ProgressBar progress={progress} onCancel={handleCancel} cancelLabel={t('home.organize.dedupe.cancel')} />
        </div>
      )}

      {result && result.totalGroups > 0 && (
        <DedupeResults
          result={result}
          overrides={overrides}
          getKeepSet={getKeepSet}
          onToggleKeep={toggleKeep}
          onResetGroup={resetGroup}
          onKeepAll={keepAll}
          onResetAll={resetAll}
          onPreview={openPreview}
          readPhotoData={readPhotoData}
          deleteCount={deleteStats.count}
          deleteBytes={deleteStats.bytes}
          confirmMode={confirmMode}
          onToggleConfirm={() => setConfirmMode(!confirmMode)}
          onDelete={handleDelete}
          deleting={deleting}
        />
      )}

      {result && result.totalGroups === 0 && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">{t('home.organize.dedupe.noDuplicatesResult')}</div>
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

      {/* 撤销删除栏 */}
      {lastDeleted && lastDeleted.length > 0 && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between">
          <span className="text-xs text-amber-800">
            {t('home.organize.dedupe.undoHint', {
              count: lastDeleted.length,
              defaultValue: '已删除 {{count}} 张照片',
            })}
          </span>
          <button
            onClick={() => {
              // 通过 onPhotosUpdate 恢复被删除的照片
              onPhotosUpdate((prev) => {
                const existingIds = new Set(prev.map((p) => p.id));
                const toRestore = lastDeleted.filter((p) => !existingIds.has(p.id));
                return [...prev, ...toRestore];
              });
              setLastDeleted(null);
              addToast({ type: 'info', message: t('home.organize.dedupe.undoDone', '已撤销删除') });
            }}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded border-none cursor-pointer transition-colors"
          >
            {t('home.organize.dedupe.undo', '撤销')}
          </button>
        </div>
      )}
    </ToolCard>
  );
}

function DedupeResults({
  result,
  overrides,
  getKeepSet,
  onToggleKeep,
  onResetGroup,
  onKeepAll,
  onResetAll,
  onPreview,
  readPhotoData,
  deleteCount,
  deleteBytes,
  confirmMode,
  onToggleConfirm,
  onDelete,
  deleting,
}: {
  result: DedupeResult;
  overrides: Record<string, Set<number>>;
  getKeepSet: (g: DedupeGroup) => Set<number>;
  onToggleKeep: (g: DedupeGroup, idx: number) => void;
  onResetGroup: (g: DedupeGroup) => void;
  onKeepAll: (g: DedupeGroup) => void;
  onResetAll: () => void;
  onPreview: (g: DedupeGroup, idx: number) => void;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  deleteCount: number;
  deleteBytes: number;
  confirmMode: boolean;
  onToggleConfirm: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  // 扫描完成后默认全部展开，方便用户一眼看到所有重复组
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(result.groups.map((g) => g.groupId)));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // 有手动调整时显示"全部重置"按钮
  const hasOverride = Object.keys(overrides).length > 0;

  return (
    <div className="mt-3 space-y-3">
      {/* 汇总条 */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-orange-50 text-sm">
        <span className="text-orange-800">
          {t('home.organize.dedupe.foundSummary', { groups: result.totalGroups, count: result.duplicateCount })}
        </span>
        <span className="text-orange-600 font-mono text-xs">
          {t('home.organize.dedupe.willFree', { count: deleteCount, size: formatBytes(deleteBytes) })}
        </span>
      </div>

      {/* 精确/视觉重复分类统计 */}
      {((result.exactGroups ?? 0) > 0 || (result.visualGroups ?? 0) > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {(result.exactGroups ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              {t('home.organize.dedupe.exactBadge', { count: result.exactGroups })}
            </span>
          )}
          {(result.visualGroups ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t('home.organize.dedupe.visualBadge', { count: result.visualGroups })}
            </span>
          )}
        </div>
      )}

      {/* 图例 + 全部重置 */}
      <div className="flex items-center gap-3 text-[11px] text-[var(--color-gray-500)] flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-500 inline-flex items-center justify-center text-white text-[8px] font-bold">✓</span>
          {t('home.organize.dedupe.legendKeep')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-flex items-center justify-center text-white text-[8px] font-bold">✗</span>
          {t('home.organize.dedupe.legendDelete')}
        </span>
        <span className="ml-auto">
          {t('home.organize.dedupe.tipClickToToggle')}
          {hasOverride && (
            <button onClick={onResetAll} className="ml-2 text-blue-600 hover:underline">
              {t('home.organize.dedupe.resetAll')}
            </button>
          )}
        </span>
      </div>

      {/* 重复组列表 */}
      <div className="max-h-[480px] overflow-y-auto overflow-x-hidden space-y-2 pr-1 custom-scrollbar">
        {result.groups.map((g) => {
          const keepSet = getKeepSet(g);
          const isOverridden = overrides[g.groupId] !== undefined;
          return (
            <div key={g.groupId} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
              {/* 组头 */}
              <div className="flex items-center">
                <button
                  onClick={() => toggle(g.groupId)}
                  className="flex-1 px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--color-surface-hover)] border-none cursor-pointer bg-transparent"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform ${expanded.has(g.groupId) ? 'rotate-90' : ''}`}>
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  {g.similarity === 'visual' ? (
                    <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-[600] bg-amber-50 text-amber-700 border border-amber-200" title={t('home.organize.dedupe.visualTooltip')}>
                      {t('home.organize.dedupe.visualLabel')}
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-[600] bg-blue-50 text-blue-700 border border-blue-200" title={t('home.organize.dedupe.exactTooltip')}>
                      {t('home.organize.dedupe.exactLabel')}
                    </span>
                  )}
                  <span className="font-mono text-xs text-[var(--color-gray-500)]">{g.hashShort}</span>
                  <span className="text-xs text-[var(--color-text-secondary)]">{t('home.organize.dedupe.filesCount', { count: g.files.length, size: formatBytes(g.fileSize) })}</span>
                  {isOverridden && (
                    <span className="shrink-0 text-[10px] text-amber-600 font-medium px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">
                      {t('home.organize.dedupe.manuallyAdjusted')}
                    </span>
                  )}
                  {g.similarity === 'visual' && g.distance !== undefined && g.distance > 0 && (
                    <span className="ml-auto shrink-0 text-[10px] text-amber-600 font-mono">d={g.distance}</span>
                  )}
                </button>
                {/* 组快捷操作 */}
                {expanded.has(g.groupId) && (
                  <div className="flex items-center gap-1 px-2 shrink-0">
                    <button
                      onClick={() => onResetGroup(g)}
                      disabled={!isOverridden}
                      className="text-[10px] px-2 py-1 rounded text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t('home.organize.dedupe.resetGroup')}
                    >
                      {t('home.organize.dedupe.resetGroup')}
                    </button>
                    <button
                      onClick={() => onKeepAll(g)}
                      className="text-[10px] px-2 py-1 rounded text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]"
                      title={t('home.organize.dedupe.keepAll')}
                    >
                      {t('home.organize.dedupe.keepAll')}
                    </button>
                  </div>
                )}
              </div>

              {/* 展开的卡片网格 */}
              {expanded.has(g.groupId) && (
                <div className="px-3 pb-3">
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                    {g.files.map((f, i) => {
                      const isKeep = keepSet.has(i);
                      const stateIcon = isKeep ? '✓' : '✗';
                      return (
                        <div
                          key={f.id}
                          className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                            isKeep ? 'border-green-400' : 'border-red-300'
                          }`}
                          onClick={() => onToggleKeep(g, i)}
                          title={t('home.organize.dedupe.clickToToggle')}
                        >
                          {/* 状态徽章（右上角，白色描边 + 阴影，在图片上更显眼） */}
                          <div
                            className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ring-2 ring-white"
                            style={{
                              background: isKeep ? '#22c55e' : '#ef4444',
                              textShadow: '0 0 2px rgba(0,0,0,0.5)',
                            }}
                          >
                            {stateIcon}
                          </div>

                          {/* 缩略图（可点击预览，不触发切换） */}
                          <ThumbImage
                            photo={f}
                            onPreview={() => onPreview(g, i)}
                            readPhotoData={readPhotoData}
                            aspect="4/3"
                            size="medium"
                          />

                          {/* 日期标签（右下角，叠在缩略图上） */}
                          <div className="absolute bottom-1.5 right-1.5 z-10">
                            {f.dateTaken ? (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-500/85 text-white backdrop-blur-sm shadow-sm">
                                {t('home.organize.dedupe.hasDateLabel')}
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/85 text-white backdrop-blur-sm shadow-sm">
                                {t('home.organize.dedupe.noDateLabel')}
                              </span>
                            )}
                          </div>

                          {/* 文件信息 */}
                          <div className="px-2 py-1.5 bg-[var(--color-surface)] text-[10px] leading-tight">
                            <div className="font-medium text-[var(--color-gray-800)] truncate" title={f.name}>{f.name}</div>
                            {(f.relativePath || f.path) && (
                              <div className="text-[var(--color-gray-500)] truncate" title={f.relativePath || f.path}>
                                {f.relativePath || f.path}
                              </div>
                            )}
                            <div className="text-[var(--color-gray-400)] mt-0.5">
                              {formatBytes(f.size)}
                              {isKeep && <span className="ml-1 text-green-600 font-medium">{t('home.organize.dedupe.keep')}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部操作 */}
      <div className="flex gap-2 pt-1">
        {!confirmMode ? (
          <PrimaryButton variant="danger" onClick={onToggleConfirm} disabled={deleteCount === 0}>
            {t('home.organize.dedupe.confirmDeleteButton', { count: deleteCount })}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton variant="danger" onClick={onDelete} loading={deleting}>
              {t('home.organize.dedupe.confirmExecuteDelete')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={onToggleConfirm} disabled={deleting}>
              {t('home.organize.dedupe.backToPreview')}
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
}
