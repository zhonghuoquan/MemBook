/**
 * 人脸聚类工具卡 — 按人物归类照片
 *
 * 基于 face-api.js 的人脸检测 + 128维 descriptor + 层次聚类：
 *   1. 加载模型（TinyFaceDetector + FaceLandmark68 + FaceRecognition）
 *   2. 检测每张照片中的人脸并提取 descriptor
 *   3. 余弦相似度 + 层次聚类，将同一人的照片归为一组
 *
 * 用户交互：
 * - 调节相似度阈值滑块（值越低分越细，越高合越多）
 * - 查看聚类分组，每组显示缩略图网格（最多 6 张，超出显示 "+N"）
 * - "全选"按钮一键选中该组所有照片
 * - 无人脸照片折叠显示
 *
 * 全平台可用（纯前端 face-api，不限 Tauri/folder）
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  clusterFaces,
  type PhotoFileInfo,
  type FaceCluster,
  type FaceClusterResult,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, ThumbImage, type ToolProps } from './shared';
import { AlbumBridgeDialog } from './AlbumBridgeDialog';

/** 聚类阶段定义（对应 progress.phase） */
const STAGES: Array<{ phase: string; label: string }> = [
  { phase: 'loading', label: '加载模型' },
  { phase: 'detecting', label: '检测人脸' },
  { phase: 'clustering', label: '聚类' },
];

/** 缩略图网格最多显示数量 */
const MAX_THUMBS = 6;

export function FaceClusterTool({ photos, readPhotoData, addToast, onBusyChange, sourceMode }: ToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [result, setResult] = useState<FaceClusterResult | null>(null);
  // 相似度阈值：0.3-0.8，默认 0.6（值越低分越细，越高合越多）
  const [threshold, setThreshold] = useState(0.6);
  // 选中的照片 ID 集合（通过"全选"按钮加入）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 无人脸照片区域折叠状态
  const [noFaceExpanded, setNoFaceExpanded] = useState(false);
  // 加入相册对话框
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 通知父组件工具执行状态，用于禁用标签切换
  useEffect(() => {
    onBusyChange?.('faceCluster', running);
    return () => { onBusyChange?.('faceCluster', false); };
  }, [running, onBusyChange]);

  /** 开始人脸聚类分析 */
  const handleStart = async () => {
    if (photos.length === 0) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setResult(null);
    setSelectedIds(new Set());
    setNoFaceExpanded(false);

    try {
      const res = await clusterFaces(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
        similarityThreshold: threshold,
        readData: readPhotoData,
      });
      setResult(res);
      if (res.clusters.length > 0) {
        addToast({
          type: 'info',
          message: t('home.organize.faceCluster.toastFound', {
            clusters: res.clusters.length,
            faces: res.photosWithFaces,
            defaultValue: '找到 {{clusters}} 个人脸组，涉及 {{faces}} 张照片',
          }),
        });
      } else {
        addToast({
          type: 'warning',
          message: t('home.organize.faceCluster.toastNoFaces', '未检测到人脸'),
        });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast({
          type: 'error',
          message: t('home.organize.faceCluster.toastFailed', {
            message: (err as Error).message,
            defaultValue: '人脸聚类失败：{{message}}',
          }),
        });
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  /** 取消分析 */
  const handleCancel = () => abortRef.current?.abort();

  /** 全选/取消全选某个人脸分组 */
  const toggleSelectGroup = useCallback((cluster: FaceCluster) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const groupIds = cluster.photos.map((p) => p.id);
      const allSelected = groupIds.every((id) => next.has(id));
      if (allSelected) {
        // 已全选 → 取消全选
        groupIds.forEach((id) => next.delete(id));
      } else {
        // 未全选 → 全选
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  /** 选中的照片列表（从 result.clusters 中按 selectedIds 过滤） */
  const selectedPhotos = useMemo<PhotoFileInfo[]>(() => {
    if (!result || selectedIds.size === 0) return [];
    const out: PhotoFileInfo[] = [];
    for (const cluster of result.clusters) {
      for (const p of cluster.photos) {
        if (selectedIds.has(p.id)) out.push(p);
      }
    }
    return out;
  }, [result, selectedIds]);

  /** 加入相册：无选中时提示，有选中时打开对话框 */
  const handleAddToAlbum = () => {
    if (selectedIds.size === 0) {
      addToast({ type: 'warning', message: t('home.organize.faceCluster.selectPhotosFirst') });
      return;
    }
    setAlbumBridgeOpen(true);
  };

  /** 当前阶段索引（-1 表示未开始/未知阶段） */
  const currentStageIdx = progress
    ? STAGES.findIndex((s) => s.phase === progress.phase)
    : -1;

  return (
    <ToolCard
      title={t('home.organize.faceCluster.title', '人脸聚类')}
      description={t('home.organize.faceCluster.description', '按人物归类照片，自动识别同一人的不同照片')}
      color="purple"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <circle cx="12" cy="12" r="10" />
          <circle cx="9" cy="10" r="0.8" fill="currentColor" />
          <circle cx="15" cy="10" r="0.8" fill="currentColor" />
          <path d="M8 15c1 1 2.5 1.5 4 1.5s3-0.5 4-1.5" />
        </svg>
      }
    >
      {/* ── 顶部：相似度阈值滑块 + 操作按钮 ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <label className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
            {t('home.organize.faceCluster.threshold', '相似度阈值')}
          </label>
          <input
            type="range"
            min={0.3}
            max={0.8}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            disabled={running}
            className="flex-1 accent-[#8B6BB0] cursor-pointer"
          />
          <span className="text-xs font-mono text-[var(--color-gray-600)] w-10 text-right">
            {threshold.toFixed(2)}
          </span>
        </div>
        {!running ? (
          <PrimaryButton onClick={handleStart} disabled={photos.length === 0}>
            {t('home.organize.faceCluster.start', '开始分析')}
          </PrimaryButton>
        ) : (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded text-xs border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-gray-600)] bg-transparent"
          >
            {t('home.organize.faceCluster.cancel', '取消')}
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-gray-500)] mt-1">
        {t('home.organize.faceCluster.thresholdHint', '值越低分越细，越高合越多')}
      </p>

      {/* ── 中部：进度条 + 三阶段指示 ── */}
      {running && (
        <div className="mt-3">
          {/* 三阶段指示器：加载模型 → 检测人脸 → 聚类 */}
          <div className="flex items-center gap-2 mb-2">
            {STAGES.map((stage, i) => {
              const isActive = i === currentStageIdx;
              const isDone = currentStageIdx > i;
              return (
                <div
                  key={stage.phase}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                    isActive
                      ? 'bg-[#F1E9F8] text-[#8B6BB0] border-[#C4A5E0]'
                      : isDone
                        ? 'bg-green-50 text-green-600 border-green-200'
                        : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] border-transparent'
                  }`}
                >
                  {isDone && '✓ '}{stage.label}
                </div>
              );
            })}
          </div>
          <ProgressBar progress={progress} />
        </div>
      )}

      {/* ── 底部：统计信息 + 分组列表 ── */}
      {result && (
        <>
          {/* 统计信息：总照片 / 有人脸 / 人脸组 / 无人脸 / 失败 */}
          <div className="mt-3 flex gap-2 flex-wrap">
            <StatCard
              label={t('home.organize.faceCluster.statTotal', '总照片')}
              value={result.totalPhotos}
              color="gray"
            />
            <StatCard
              label={t('home.organize.faceCluster.statWithFaces', '有人脸')}
              value={result.photosWithFaces}
              color="green"
            />
            <StatCard
              label={t('home.organize.faceCluster.statClusters', '人脸组')}
              value={result.clusters.length}
              color="purple"
            />
            <StatCard
              label={t('home.organize.faceCluster.statNoFace', '无人脸')}
              value={result.noFacePhotos.length}
              color="gray"
            />
            {(result.failedPhotos ?? 0) > 0 && (
              <StatCard
                label={t('home.organize.faceCluster.statFailed', '失败')}
                value={result.failedPhotos}
                color="red"
              />
            )}
          </div>

          {/* 选中计数 + 加入相册按钮 */}
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            {selectedIds.size > 0 && (
              <span className="text-xs text-[var(--color-gray-500)]">
                {t('home.organize.faceCluster.selectedCount', {
                  count: selectedIds.size,
                  defaultValue: '已选中 {{count}} 张照片',
                })}
              </span>
            )}
            {/* 加入相册按钮：未选照片时置灰，点击提示 */}
            <button
              type="button"
              onClick={handleAddToAlbum}
              disabled={selectedIds.size === 0}
              title={selectedIds.size === 0 ? t('home.organize.faceCluster.selectPhotosFirst') : t('home.organize.faceCluster.addToAlbum')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer transition-all border-none ${
                selectedIds.size > 0
                  ? 'bg-[var(--color-brand)] text-white hover:opacity-90'
                  : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] cursor-not-allowed'
              }`}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M8 3v10M3 8h10" />
              </svg>
              {t('home.organize.faceCluster.addToAlbum')}
              {selectedIds.size > 0 && <span className="opacity-80">· {selectedIds.size}</span>}
            </button>
          </div>

          {/* 人脸分组列表 */}
          {result.clusters.length > 0 && (
            <div className="mt-3 space-y-2 max-h-[480px] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {result.clusters.map((cluster, idx) => (
                <FaceClusterGroupItem
                  key={cluster.clusterId}
                  cluster={cluster}
                  index={idx}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelectGroup}
                  readPhotoData={readPhotoData}
                />
              ))}
            </div>
          )}

          {/* 无人脸照片（折叠显示） */}
          {result.noFacePhotos.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setNoFaceExpanded(!noFaceExpanded)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] cursor-pointer bg-transparent border-none"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 transition-transform ${noFaceExpanded ? 'rotate-90' : ''}`}>
                  <path d="M4 2l4 4-4 4" />
                </svg>
                {t('home.organize.faceCluster.noFacePhotos', {
                  count: result.noFacePhotos.length,
                  defaultValue: '无人脸照片 ({{count}})',
                })}
              </button>
              {noFaceExpanded && (
                <div
                  className="grid gap-1.5 mt-2"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
                >
                  {result.noFacePhotos.map((p) => (
                    <div key={p.id} className="aspect-square rounded-md overflow-hidden">
                      <ThumbImage photo={p} readPhotoData={readPhotoData} size="small" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 加入相册对话框 */}
      <AlbumBridgeDialog
        open={albumBridgeOpen}
        onClose={() => setAlbumBridgeOpen(false)}
        photos={selectedPhotos}
        sourceMode={sourceMode}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />
    </ToolCard>
  );
}

// ── 子组件 ────────────────────────────────────────────────

/** 统计卡片 */
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'gray' | 'green' | 'purple' | 'red';
}) {
  const colors = {
    gray: 'bg-[var(--color-gray-50)] text-[var(--color-gray-700)]',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-[#F1E9F8] text-[#8B6BB0]',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${colors[color]}`}>
      <div className="text-lg font-bold font-mono leading-tight">{value}</div>
      <div className="text-[10px] mt-0.5 opacity-80">{label}</div>
    </div>
  );
}

/** 人脸分组项：编号 + 照片数 + 缩略图网格 + 全选按钮 */
function FaceClusterGroupItem({
  cluster,
  index,
  selectedIds,
  onToggleSelect,
  readPhotoData,
}: {
  cluster: FaceCluster;
  index: number;
  selectedIds: Set<string>;
  onToggleSelect: (cluster: FaceCluster) => void;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
}) {
  const { t } = useTranslation();
  const groupIds = cluster.photos.map((p) => p.id);
  const selectedCount = groupIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectedCount === groupIds.length;

  // 最多显示 MAX_THUMBS 张缩略图，超出在第 6 张上叠加 "+N"
  const visiblePhotos = cluster.photos.slice(0, MAX_THUMBS);
  const extraCount = cluster.photos.length - MAX_THUMBS;

  return (
    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* 组头：编号 + 照片数 + 全选按钮 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 min-w-0">
          {/* 组编号徽章 */}
          <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#D7C5EC] text-[#8B6BB0] text-xs font-bold">
            {index + 1}
          </span>
          <span className="text-sm text-[var(--color-gray-800)] font-medium">
            {t('home.organize.faceCluster.groupTitle', {
              index: index + 1,
              defaultValue: '人物 {{index}}',
            })}
          </span>
          <span className="text-xs text-[var(--color-gray-500)]">
            {t('home.organize.faceCluster.photosCount', {
              count: cluster.photoCount,
              defaultValue: '{{count}} 张照片',
            })}
            {cluster.faces.length > cluster.photoCount && (
              <span className="ml-1 text-[var(--color-gray-400)]">
                · {cluster.faces.length} 个人脸
              </span>
            )}
          </span>
          {selectedCount > 0 && (
            <span className="shrink-0 text-[10px] text-[#8B6BB0] font-medium px-1.5 py-0.5 rounded bg-[#F1E9F8]">
              {t('home.organize.faceCluster.selectedInGroup', {
                count: selectedCount,
                defaultValue: '已选 {{count}}',
              })}
            </span>
          )}
        </div>
        {/* 全选按钮 */}
        <button
          onClick={() => onToggleSelect(cluster)}
          className={`shrink-0 text-[11px] px-2.5 py-1 rounded border cursor-pointer transition-all ${
            allSelected
              ? 'bg-[#8B6BB0] text-white border-[#8B6BB0] hover:opacity-90'
              : 'bg-transparent text-[var(--color-gray-600)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {allSelected
            ? t('home.organize.faceCluster.deselectAll', '取消全选')
            : t('home.organize.faceCluster.selectAll', '全选')}
        </button>
      </div>

      {/* 缩略图网格：最多 6 张，超出在第 6 张叠加 "+N" */}
      <div className="px-3 pb-3 pt-2">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
        >
          {visiblePhotos.map((photo, i) => {
            const isSelected = selectedIds.has(photo.id);
            const showExtraOverlay = i === MAX_THUMBS - 1 && extraCount > 0;
            return (
              <div
                key={photo.id}
                className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                  isSelected ? 'border-[#8B6BB0] ring-1 ring-[#8B6BB0]' : 'border-transparent'
                }`}
                title={photo.name}
              >
                <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" />
                {/* 超出数量叠加层 */}
                {showExtraOverlay && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-mono font-bold">
                    +{extraCount}
                  </div>
                )}
                {/* 选中标记 */}
                {isSelected && (
                  <div className="absolute top-1 right-1 z-10 w-4 h-4 rounded-full bg-[#8B6BB0] flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                    ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


