/**
 * 人脸聚类工具卡 — 按人物归类照片
 *
 * 基于 face-api.js 的人脸检测 + 128维 descriptor + 层次聚类：
 *   1. 加载模型（TinyFaceDetector + FaceLandmark68 + FaceRecognition）
 *   2. 检测每张照片中的人脸并提取 descriptor
 *   3. 欧氏距离 + complete linkage 层次聚类
 *
 * 关键优化：
 *   - 检测与聚类分离：调阈值时仅重跑 recluster（毫秒级），无需重新检测
 *   - 阈值使用欧氏距离，默认 0.5（越小越严格、越不易误合并，兼顾准确率与召回）
 *   - 人脸缩略图按人脸区域裁剪放大，清晰可辨
 *   - 模型加载失败时显示明确 toast，不再误报"未检测到人脸"
 *   - 支持手动合并聚类组
 *   - 支持组命名
 *   - 人脸裁剪预览（Canvas 按坐标裁剪代表性人脸）
 *
 * 全平台可用（纯前端 face-api，不限 Tauri/folder）
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  detectFaces,
  recluster,
  type PhotoFileInfo,
  type FaceCluster,
  type FaceRecord,
  type FaceClusterResult,
  type FaceDetectionResult,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, AddToAlbumButton, ThumbImage, ThumbWithMenu, deletePhotos, RangeSlider, useTabCachedResult, type ToolProps } from './shared';
import { AlbumBridgeDialog } from './AlbumBridgeDialog';
import { PhotoQuickView } from './PhotoQuickView';
import { getFaceThumbUrl } from './thumbCache';

/** 聚类阶段定义（对应 progress.phase） */
const STAGES: Array<{ phase: string; label: string }> = [
  { phase: 'loading', label: '加载模型' },
  { phase: 'detecting', label: '检测人脸' },
  { phase: 'clustering', label: '聚类' },
];

/** 缩略图网格最多显示数量 */
const MAX_THUMBS = 6;

/**
 * 人脸组编号色板 — 每个分组使用独立的高饱和配色，
 * 与浅色底色形成明显区分，避免色块与底色重合导致不美观。
 * index 超过色板长度时循环取色。
 */
const CLUSTER_COLOR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#E74C3C', fg: '#FFFFFF' }, // 红
  { bg: '#E67E22', fg: '#FFFFFF' }, // 橙
  { bg: '#27AE60', fg: '#FFFFFF' }, // 绿
  { bg: '#2980B9', fg: '#FFFFFF' }, // 蓝
  { bg: '#8E44AD', fg: '#FFFFFF' }, // 紫
  { bg: '#16A085', fg: '#FFFFFF' }, // 青
  { bg: '#C0392B', fg: '#FFFFFF' }, // 深红
  { bg: '#D35400', fg: '#FFFFFF' }, // 深橙
  { bg: '#2C3E50', fg: '#FFFFFF' }, // 深灰蓝
  { bg: '#7F8C8D', fg: '#FFFFFF' }, // 灰
  { bg: '#3498DB', fg: '#FFFFFF' }, // 亮蓝
  { bg: '#9B59B6', fg: '#FFFFFF' }, // 亮紫
];
/** 取指定分组的配色（循环取色） */
function getClusterColor(index: number) {
  return CLUSTER_COLOR_PALETTE[index % CLUSTER_COLOR_PALETTE.length];
}

export function FaceClusterTool({ photos, readPhotoData, addToast, onBusyChange, sourceMode, onPhotosUpdate, tabId, autoRunToken, isAutoRunTarget }: ToolProps & { autoRunToken?: number; isAutoRunTarget?: boolean }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  // 检测/聚类结果按标签缓存：切换路径标签时保留各路径的人脸识别结果
  const [result, setResult] = useTabCachedResult<FaceClusterResult | null>(tabId, null);
  /**
   * 距离阈值（欧氏距离）：值越小越严格（分出更多组），值越大越宽松（合并更多）
   * 默认 0.5，兼顾准确率与召回（欧氏距离越小越严格、越不易误合并）
   */
  const [threshold, setThreshold] = useState(0.5);
  // 缓存检测结果（descriptor 数组），调阈值时复用，避免重新检测；按标签缓存
  const [detection, setDetection] = useTabCachedResult<FaceDetectionResult | null>(tabId, null);
  // 选中的照片 ID 集合
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 无人脸照片区域折叠状态
  const [noFaceExpanded, setNoFaceExpanded] = useState(false);
  // 加入相册对话框
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
  // 选中的聚类组（用于合并操作）
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  // 组内照片展开状态（默认折叠，仅显示前 MAX_THUMBS 张；展开后查看全部）
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  // 组名映射（clusterId → 用户输入的名称）
  const [clusterNames, setClusterNames] = useState<Map<string, string>>(new Map());
  // 正在编辑名称的组 ID
  const [editingNameClusterId, setEditingNameClusterId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 大图预览（预览当前分组内的照片）
  const [previewGroup, setPreviewGroup] = useState<PhotoFileInfo[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  /** 删除单张照片（共享逻辑，含确认弹窗由 ThumbWithMenu 处理） */
  const handleDeletePhoto = useCallback(
    (photo: PhotoFileInfo) => {
      void deletePhotos([photo], sourceMode, onPhotosUpdate, addToast, t);
      // 同步从选中集合中移除
      setSelectedIds((prev) => {
        if (!prev.has(photo.id)) return prev;
        const n = new Set(prev);
        n.delete(photo.id);
        return n;
      });
      // 同步从聚类结果与检测缓存中移除，保证界面显示即时更新
      setResult((prev) => {
        if (!prev) return prev;
        let hasFace = false;
        const clusters = prev.clusters
          .map((c) => {
            const photos = c.photos.filter((p) => p.id !== photo.id);
            const faces = c.faces.filter((f) => f.photoId !== photo.id);
            // 照片未命中本组，原样返回
            if (photos.length === c.photos.length && faces.length === c.faces.length) return c;
            if (c.faces.length > faces.length) hasFace = true;
            // 组内照片删光则整组移除
            if (photos.length === 0) return null;
            return {
              ...c,
              photos,
              faces,
              representativeFace: faces.length > 0
                ? faces.reduce((best, f) => (f.width * f.height * f.score > best.width * best.height * best.score ? f : best), faces[0])
                : c.representativeFace,
              photoCount: photos.length,
            };
          })
          .filter((c): c is FaceCluster => c !== null);
        const noFacePhotos = prev.noFacePhotos.filter((p) => p.id !== photo.id);
        // 照片整体数量、有人脸照片数、无人脸照片数同步递减
        const totalPhotos = Math.max(0, prev.totalPhotos - 1);
        const photosWithFaces = Math.max(0, prev.photosWithFaces - (hasFace ? 1 : 0));
        return { ...prev, clusters, noFacePhotos, totalPhotos, photosWithFaces };
      });
      setDetection((prev) => {
        if (!prev) return prev;
        const faces = prev.faces.filter((f) => f.photoId !== photo.id);
        const nextSet = new Set(prev.photosWithFacesSet);
        nextSet.delete(photo.id);
        return {
          ...prev,
          faces,
          photosWithFacesSet: nextSet,
          totalPhotos: Math.max(0, prev.totalPhotos - 1),
        };
      });
    },
    [sourceMode, onPhotosUpdate, addToast, t],
  );

  // 通知父组件工具执行状态
  useEffect(() => {
    onBusyChange?.('faceCluster', running);
    return () => { onBusyChange?.('faceCluster', false); };
  }, [running, onBusyChange]);

  /** 开始人脸检测（只检测，不聚类） */
  const handleStart = async () => {
    if (photos.length === 0) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setResult(null);
    setDetection(null);
    setSelectedIds(new Set());
    setSelectedClusters(new Set());
    setExpandedClusters(new Set());
    setNoFaceExpanded(false);

    try {
      const det = await detectFaces(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
        readData: readPhotoData,
      });

      setDetection(det);

      // 模型加载失败
      if (det.modelLoadFailed) {
        const errMsg = det.loadErrorMessage
          ? t('home.organize.faceCluster.toastModelFailedDetail', {
              message: det.loadErrorMessage,
              defaultValue: '人脸识别初始化失败：{{message}}',
            })
          : t('home.organize.faceCluster.toastModelFailed', {
              defaultValue: '人脸识别模型加载失败，请确认模型文件存在后重试',
            });
        addToast({ type: 'error', message: errMsg });
        return;
      }

      // 检测完成，立即聚类
      setProgress({ phase: 'clustering', current: 0, total: det.faces.length, message: `聚类 ${det.faces.length} 个人脸...` });
      const res = recluster(det, threshold, photos);
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

  // “一键分析”自动触发：仅当本工具是当前分析目标且令牌变化时，自动开始人脸识别
  const prevToken = useRef(0);
  useEffect(() => {
    if (isAutoRunTarget && autoRunToken && autoRunToken !== prevToken.current) {
      prevToken.current = autoRunToken;
      if (!running && photos.length > 0) {
        void handleStart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken, isAutoRunTarget]);

  /** 调整阈值后即时重聚类（使用缓存的检测结果，毫秒级） */
  const handleRecluster = useCallback(() => {
    if (!detection) return;
    const res = recluster(detection, threshold, photos);
    setResult(res);
    setSelectedIds(new Set());
    setSelectedClusters(new Set());
    setExpandedClusters(new Set());
  }, [detection, threshold, photos]);

  /** 阈值滑块变化时自动重聚类（仅在有检测结果时） */
  useEffect(() => {
    if (detection && !running) {
      handleRecluster();
    }
  }, [threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 全选/取消全选某个人脸分组 */
  const toggleSelectGroup = useCallback((cluster: FaceCluster) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const groupIds = cluster.photos.map((p) => p.id);
      const allSelected = groupIds.every((id) => next.has(id));
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
      } else {
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  /** 切换聚类组选中（用于合并操作） */
  const toggleSelectCluster = useCallback((clusterId: string) => {
    setSelectedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }, []);

  /** 合并选中的聚类组 */
  const handleMergeClusters = useCallback(() => {
    if (selectedClusters.size < 2 || !result) return;
    setResult((prev) => {
      if (!prev) return prev;
      // 合并所有选中组的 faces 和 photos
      const mergedFaces: typeof prev.clusters[0]['faces'] = [];
      const mergedPhotoIds = new Set<string>();
      for (const c of prev.clusters) {
        if (selectedClusters.has(c.clusterId)) {
          mergedFaces.push(...c.faces);
          c.photos.forEach((p) => mergedPhotoIds.add(p.id));
        }
      }
      const photoById = new Map<string, PhotoFileInfo>();
      for (const p of photos) photoById.set(p.id, p);
      const mergedPhotos = [...mergedPhotoIds].map((id) => photoById.get(id)).filter((p): p is PhotoFileInfo => !!p);
      const representativeFace = mergedFaces.reduce((best, f) => {
        const bestScore = best.width * best.height * best.score;
        const fScore = f.width * f.height * f.score;
        return fScore > bestScore ? f : best;
      });
      const mergedCluster: FaceCluster = {
        clusterId: `face-merged-${Date.now()}`,
        faces: mergedFaces,
        photos: mergedPhotos,
        representativeFace,
        photoCount: mergedPhotos.length,
      };
      // 移除被合并的组，添加合并后的组
      const remaining = prev.clusters.filter((c) => !selectedClusters.has(c.clusterId));
      return { ...prev, clusters: [mergedCluster, ...remaining] };
    });
    setSelectedClusters(new Set());
    addToast({ type: 'success', message: t('home.organize.faceCluster.toastMerged', { defaultValue: '已合并 {{count}} 个人脸组', count: selectedClusters.size }) });
  }, [selectedClusters, result, photos, addToast, t]);

  /** 设置组名 */
  const handleRenameCluster = useCallback((clusterId: string, name: string) => {
    setClusterNames((prev) => {
      const next = new Map(prev);
      if (name.trim()) next.set(clusterId, name.trim());
      else next.delete(clusterId);
      return next;
    });
    setEditingNameClusterId(null);
  }, []);

  /** 选中的照片列表 */
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

  /** 加入相册 */
  const handleAddToAlbum = () => {
    if (selectedIds.size === 0) {
      addToast({ type: 'warning', message: t('home.organize.faceCluster.selectPhotosFirst') });
      return;
    }
    setAlbumBridgeOpen(true);
  };

  /** 当前阶段索引 */
  const currentStageIdx = progress
    ? STAGES.findIndex((s) => s.phase === progress.phase)
    : -1;

  return (
    <ToolCard
      title={t('home.organize.faceCluster.title', '人脸聚类')}
      description={t('home.organize.faceCluster.description', '按人物归类照片，自动识别同一人的不同照片')}
      color="violet"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <circle cx="12" cy="12" r="10" />
          <circle cx="9" cy="10" r="0.8" fill="currentColor" />
          <circle cx="15" cy="10" r="0.8" fill="currentColor" />
          <path d="M8 15c1 1 2.5 1.5 4 1.5s3-0.5 4-1.5" />
        </svg>
      }
    >
      {/* 固定“加入相册”浮动按钮（与日历/时间线一致：固定在右上角，样式统一） */}
      {result && (
        <div className="absolute top-4 right-4 z-20">
          <AddToAlbumButton
            count={selectedIds.size}
            onClick={handleAddToAlbum}
          />
        </div>
      )}

      {/* ── 顶部：距离阈值滑块 + 操作按钮 ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs text-[var(--color-text-secondary)] block mb-1">
            {t('home.organize.faceCluster.threshold', '识别灵敏度')}
          </label>
          <RangeSlider
            min={0.3}
            max={0.9}
            step={0.05}
            value={threshold}
            onChange={(v) => setThreshold(v)}
            disabled={running}
            accent="#8B6BB0"
          />
        </div>
        {!running ? (
          <PrimaryButton onClick={handleStart} disabled={photos.length === 0}>
            {detection
              ? t('home.organize.faceCluster.redetect', '重新检测')
              : t('home.organize.faceCluster.start', '开始分析')}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={handleStart} disabled>
            {t('home.organize.faceCluster.running', '分析中...')}
          </PrimaryButton>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-gray-500)] mt-1">
        {t('home.organize.faceCluster.thresholdHint', '数值越小识别越严格（分组更多更精细），数值越大识别越宽松（同一个人更易被归为一组）')}
      </p>

      {/* ── 中部：进度条 + 三阶段指示 ── */}
      {running && (
        <div className="mt-3">
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
          <ProgressBar progress={progress} onCancel={handleCancel} cancelLabel={t('home.organize.faceCluster.cancel', '取消')} />
        </div>
      )}

      {/* ── 底部：统计信息 + 分组列表 ── */}
      {result && (
        <>
          {/* 统计信息 */}
          <div className="mt-3 flex gap-2 flex-wrap">
            <StatCard label={t('home.organize.faceCluster.statTotal', '总照片')} value={result.totalPhotos} color="gray" />
            <StatCard label={t('home.organize.faceCluster.statWithFaces', '有人脸')} value={result.photosWithFaces} color="green" />
            <StatCard label={t('home.organize.faceCluster.statClusters', '人脸组')} value={result.clusters.length} color="purple" />
            <StatCard label={t('home.organize.faceCluster.statNoFace', '无人脸')} value={result.noFacePhotos.length} color="gray" />
            {(result.failedPhotos ?? 0) > 0 && (
              <StatCard label={t('home.organize.faceCluster.statFailed', '失败')} value={result.failedPhotos} color="red" />
            )}
          </div>

          {/* 合并操作栏 */}
          {selectedClusters.size >= 2 && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-[#F1E9F8] border border-[#C4A5E0] flex items-center justify-between">
              <span className="text-xs text-[#8B6BB0]">
                {t('home.organize.faceCluster.mergeSelected', { count: selectedClusters.size, defaultValue: '已选 {{count}} 个组' })}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setSelectedClusters(new Set())} className="text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] cursor-pointer bg-transparent border-none">
                  {t('home.organize.faceCluster.cancelMerge', '取消')}
                </button>
                <button onClick={handleMergeClusters} className="text-xs text-white bg-[#8B6BB0] hover:opacity-90 px-3 py-1 rounded cursor-pointer border-none">
                  {t('home.organize.faceCluster.confirmMerge', '合并')}
                </button>
              </div>
            </div>
          )}

          {/* 选中计数提示（加入相册按钮已固定在卡片右上角） */}
          {selectedIds.size > 0 && (
            <div className="mt-2 text-xs text-[var(--color-gray-500)]">
              {t('home.organize.faceCluster.selectedCount', { count: selectedIds.size, defaultValue: '已选中 {{count}} 张照片' })}
            </div>
          )}

          {/* 人脸分组列表 */}
          {result.clusters.length > 0 && (
            <div className="mt-3 space-y-2 max-h-[480px] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {result.clusters.map((cluster, idx) => (
                <FaceClusterGroupItem
                  key={cluster.clusterId}
                  cluster={cluster}
                  index={idx}
                  selectedIds={selectedIds}
                  selectedClusters={selectedClusters}
                  onToggleSelect={toggleSelectGroup}
                  onToggleClusterSelect={toggleSelectCluster}
                  onRenameCluster={handleRenameCluster}
                  clusterName={clusterNames.get(cluster.clusterId)}
                  editingName={editingNameClusterId === cluster.clusterId}
                  onSetEditingName={setEditingNameClusterId}
                  readPhotoData={readPhotoData}
                  expanded={expandedClusters.has(cluster.clusterId)}
                  onToggleExpand={(id) => {
                    setExpandedClusters((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onToggleSingle={(photoId) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(photoId)) next.delete(photoId);
                      else next.add(photoId);
                      return next;
                    });
                  }}
                  onViewPhoto={(group, index) => {
                    setPreviewGroup(group);
                    setPreviewIndex(index);
                  }}
                  onDeletePhoto={handleDeletePhoto}
                />
              ))}
            </div>
          )}

          {/* 无人脸照片 */}
          {result.noFacePhotos.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setNoFaceExpanded(!noFaceExpanded)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] cursor-pointer bg-transparent border-none"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 transition-transform ${noFaceExpanded ? 'rotate-90' : ''}`}>
                  <path d="M4 2l4 4-4 4" />
                </svg>
                {t('home.organize.faceCluster.noFacePhotos', { count: result.noFacePhotos.length, defaultValue: '无人脸照片 ({{count}})' })}
              </button>
              {noFaceExpanded && (
                <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
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

      <AlbumBridgeDialog
        open={albumBridgeOpen}
        onClose={() => setAlbumBridgeOpen(false)}
        photos={selectedPhotos}
        sourceMode={sourceMode}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />

      {/* 大图预览 */}
      {previewGroup && previewGroup.length > 0 && (
        <PhotoQuickView
          photos={previewGroup}
          initialIndex={previewIndex}
          onClose={() => setPreviewGroup(null)}
          readPhotoData={readPhotoData}
        />
      )}
    </ToolCard>
  );
}

// ── 子组件 ────────────────────────────────────────────────

/** 统计卡片 */
function StatCard({ label, value, color }: { label: string; value: number; color: 'gray' | 'green' | 'purple' | 'red' }) {
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

/** 人脸分组项 */
function FaceClusterGroupItem({
  cluster,
  index,
  selectedIds,
  selectedClusters,
  onToggleSelect,
  onToggleClusterSelect,
  onRenameCluster,
  clusterName,
  editingName,
  onSetEditingName,
  readPhotoData,
  expanded,
  onToggleExpand,
  onToggleSingle,
  onViewPhoto,
  onDeletePhoto,
}: {
  cluster: FaceCluster;
  index: number;
  selectedIds: Set<string>;
  selectedClusters: Set<string>;
  onToggleSelect: (cluster: FaceCluster) => void;
  onToggleClusterSelect: (clusterId: string) => void;
  onToggleSingle: (photoId: string) => void;
  onRenameCluster: (clusterId: string, name: string) => void;
  clusterName?: string;
  editingName: boolean;
  onSetEditingName: (id: string | null) => void;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 组内照片是否展开（展开后查看全部并支持单张选择） */
  expanded: boolean;
  onToggleExpand: (clusterId: string) => void;
  /** 查看某张照片大图（需传当前组全部照片与索引） */
  onViewPhoto: (group: PhotoFileInfo[], index: number) => void;
  /** 删除某张照片 */
  onDeletePhoto: (photo: PhotoFileInfo) => void;
}) {
  const { t } = useTranslation();
  const [nameInput, setNameInput] = useState('');
  const groupIds = cluster.photos.map((p) => p.id);
  const selectedCount = groupIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectedCount === groupIds.length;
  const isClusterSelected = selectedClusters.has(cluster.clusterId);

  // 折叠时仅显示前 MAX_THUMBS 张；展开后显示全部（支持单张选择）
  const displayPhotos = expanded ? cluster.photos : cluster.photos.slice(0, MAX_THUMBS);
  const extraCount = cluster.photos.length - MAX_THUMBS;

  // 建立 photoId → 人脸记录 映射，用于裁剪出清晰人脸缩略图
  const faceByPhoto = useMemo(() => {
    const map = new Map<string, FaceRecord>();
    for (const f of cluster.faces) {
      // 优先保留面积更大的那张脸
      const prev = map.get(f.photoId);
      if (!prev || (f.width * f.height > prev.width * prev.height)) map.set(f.photoId, f);
    }
    return map;
  }, [cluster.faces]);

  const handleNameSubmit = () => {
    onRenameCluster(cluster.clusterId, nameInput);
  };

  // 分组配色（每个分组独立色块，与浅色底色明显区分）
  const clusterColor = getClusterColor(index);

  return (
    <div className={`rounded-lg border overflow-hidden transition-all ${
      isClusterSelected ? 'border-[#8B6BB0] ring-1 ring-[#8B6BB0]/30' : 'border-[var(--color-border)]'
    }`}>
      {/* 组头 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 min-w-0">
          {/* 合并选择复选框 */}
          <input
            type="checkbox"
            checked={isClusterSelected}
            onChange={() => onToggleClusterSelect(cluster.clusterId)}
            className="shrink-0 w-3.5 h-3.5 accent-[#8B6BB0] cursor-pointer"
            title={t('home.organize.faceCluster.selectForMerge', '选择用于合并')}
          />
          {/* 组编号/名称 */}
          {editingName ? (
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') onSetEditingName(null); }}
              placeholder={t('home.organize.faceCluster.namePlaceholder', '输入名称')}
              autoFocus
              className="text-sm px-2 py-0.5 rounded border border-[#C4A5E0] outline-none bg-white text-[var(--color-gray-800)] w-32"
            />
          ) : (
            <button
              onClick={() => { setNameInput(clusterName ?? ''); onSetEditingName(cluster.clusterId); }}
              className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer hover:opacity-70"
            >
              <span
                className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shadow-sm"
                style={{ backgroundColor: clusterColor.bg, color: clusterColor.fg }}
              >
                {index + 1}
              </span>
              <span className="text-sm text-[var(--color-gray-800)] font-medium">
                {clusterName ?? t('home.organize.faceCluster.groupTitle', { index: index + 1, defaultValue: '人物 {{index}}' })}
              </span>
              {!clusterName && (
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 text-[var(--color-gray-400)]">
                  <path d="M8 1.5l2.5 2.5L4.5 10H2V7.5L8 1.5z" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
          <span className="text-xs text-[var(--color-gray-500)]">
            {t('home.organize.faceCluster.photosCount', { count: cluster.photoCount, defaultValue: '{{count}} 张照片' })}
            {cluster.faces.length > cluster.photoCount && (
              <span className="ml-1 text-[var(--color-gray-400)]">· {cluster.faces.length} 个人脸</span>
            )}
          </span>
          {selectedCount > 0 && (
            <span className="shrink-0 text-[10px] text-[#8B6BB0] font-medium px-1.5 py-0.5 rounded bg-[#F1E9F8]">
              {t('home.organize.faceCluster.selectedInGroup', { count: selectedCount, defaultValue: '已选 {{count}}' })}
            </span>
          )}
        </div>
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

      {/* 缩略图网格（折叠与展开统一为 6 列，照片尺寸保持一致） */}
      <div className="px-3 pb-3 pt-2">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          {displayPhotos.map((photo, i) => {
            const isSelected = selectedIds.has(photo.id);
            const showExtraOverlay = !expanded && i === MAX_THUMBS - 1 && extraCount > 0;
            const face = faceByPhoto.get(photo.id);
            const thumbNode = face
              ? <FaceCropThumb photo={photo} face={face} readPhotoData={readPhotoData} />
              : <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" />;
            return (
              <ThumbWithMenu
                key={photo.id}
                photo={photo}
                readPhotoData={readPhotoData}
                selected={isSelected}
                onClick={() => {
                  // 组内单张选择
                  onToggleSingle(photo.id);
                }}
                onView={() => onViewPhoto(cluster.photos, i)}
                onDelete={() => onDeletePhoto(photo)}
                thumb={
                  <div className="relative aspect-square w-full h-full">
                    {thumbNode}
                    {showExtraOverlay && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-mono font-bold">
                        +{extraCount}
                      </div>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>

        {/* 展开/收起全部照片 */}
        {cluster.photos.length > MAX_THUMBS && (
          <button
            onClick={() => onToggleExpand(cluster.clusterId)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#8B6BB0] hover:text-[#6d5094] bg-transparent border-none cursor-pointer font-[600]"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}>
              <path d="M2 4l4 4 4-4" />
            </svg>
            {expanded
              ? t('home.organize.faceCluster.collapseGroup', '收起全部')
              : t('home.organize.faceCluster.expandGroup', { count: cluster.photos.length, defaultValue: '查看全部 {{count}} 张' })}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 人脸裁剪缩略图 — 根据人脸相对位置裁剪放大，让人脸清晰可辨
 * 解决“有人脸照片缩略图显示模糊”的问题
 */
function FaceCropThumb({
  photo,
  face,
  readPhotoData,
}: {
  photo: PhotoFileInfo;
  face: FaceRecord;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFaceThumbUrl(photo, face, readPhotoData).then((u) => {
      if (!cancelled && u) setUrl(u);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, face, readPhotoData]);

  if (url) {
    return <img src={url} alt={photo.name} className="w-full h-full object-cover" draggable={false} loading="lazy" />;
  }
  return (
    <div className="w-full h-full bg-[var(--color-gray-100)] flex items-center justify-center">
      <div className="w-4 h-4 border-2 border-[var(--color-gray-300)] border-t-[var(--color-gray-500)] rounded-full animate-spin" />
    </div>
  );
}
