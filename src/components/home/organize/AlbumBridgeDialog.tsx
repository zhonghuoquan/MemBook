/**
 * AlbumBridgeDialog — 一键成册联动对话框
 *
 * 将整理工具中选中的照片加入相册项目。
 * 用户每次选择存储策略：
 * - direct: 引用原文件路径（folder 模式）或 photoId（library 模式），不复制数据
 * - import: 复制照片数据到相册项目库内独立管理
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AlbumProject, Photo } from '../../../types';
import { listProjects, loadPhotos, savePhotoChanges } from '../../../db';
import { importPhotoToDB } from '../../../engine/storage/import-store';
import { ensureSupportedFormat } from '../../../engine/storage/heic-converter';
import { isHeicFile } from '../../../engine/storage/utils';
import type { PhotoFileInfo, ToolProgress } from '../../../photo-tools';
import { ProgressBar } from './shared';
import { logger } from '../../../utils/logger';

interface AlbumBridgeDialogProps {
  open: boolean;
  onClose: () => void;
  photos: PhotoFileInfo[]; // selected photos to add
  sourceMode: 'folder' | 'library';
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
  /** 读取照片数据（统一入口，屏蔽 folder/library/Tauri/Web 差异），import 模式必需 */
  readPhotoData: (photo: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>;
}

type Strategy = 'direct' | 'import';

/** 格式化日期显示为 YYYY-MM-DD */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

/** 相册类型 emoji 映射 */
function albumTypeIcon(type?: string): string {
  const map: Record<string, string> = {
    travel: '✈️', family: '👨‍👩‍👧', wedding: '💒', growth: '🌱', pet: '🐾', other: '📷',
  };
  return map[type || ''] || '📷';
}

/** 根据宽高推断方向 */
function orientationOf(w: number, h: number): Photo['orientation'] {
  if (!w || !h) return 'landscape';
  if (w > h) return 'landscape';
  if (w < h) return 'portrait';
  return 'square';
}

export function AlbumBridgeDialog({
  open,
  onClose,
  photos,
  sourceMode,
  addToast,
  readPhotoData,
}: AlbumBridgeDialogProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<AlbumProject[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('direct');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);

  // 防止并发触发（按钮 disabled 在同一 tick 内可能尚未生效）
  const processingRef = useRef(false);

  // 弹窗打开时加载项目列表 + 各项目照片数量
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedProjectId(null);
    setStrategy('direct');
    setProgress(null);
    listProjects()
      .then(async (list) => {
        setProjects(list);
        const counts: Record<string, number> = {};
        await Promise.all(
          list.map(async (p) => {
            try {
              const ps = await loadPhotos(p.id);
              counts[p.id] = ps.length;
            } catch {
              counts[p.id] = 0;
            }
          }),
        );
        setPhotoCounts(counts);
      })
      .catch((err) => logger.warn('[AlbumBridge] 加载项目失败:', err))
      .finally(() => setLoading(false));
  }, [open]);

  // ESC 关闭（处理中禁止 ESC）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processingRef.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleConfirm() {
    if (!selectedProjectId || photos.length === 0 || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    setProgress({ phase: 'bridge', current: 0, total: photos.length });

    const newPhotos: Photo[] = [];

    try {
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        setProgress({
          phase: 'bridge',
          current: i,
          total: photos.length,
          message: p.name,
        });

        try {
          // HEIC 格式浏览器无法原生解码（direct 模式下 asset:// URL 也无法显示），
          // 必须走 import 模式：转换为 JPEG 后存为 blob，否则相册照片列表会加载失败
          const isHeic = isHeicFile(p.name);
          const effectiveStrategy: Strategy = isHeic ? 'import' : strategy;

          // 获取照片实际尺寸：优先用已有值，缺失时通过 createImageBitmap 读取
          // HEIC 文件需先转换为 JPEG 才能解码
          let imgWidth = p.width || 0;
          let imgHeight = p.height || 0;
          if ((imgWidth === 0 || imgHeight === 0) && effectiveStrategy === 'direct') {
            try {
              const buf = await readPhotoData(p);
              if (buf) {
                let blob = new Blob([buf], { type: p.mimeType || 'image/jpeg' });
                if (isHeic) {
                  const file = new File([buf], p.name, { type: p.mimeType || 'image/heic' });
                  const jpegFile = await ensureSupportedFormat(file);
                  blob = new Blob([await jpegFile.arrayBuffer()], { type: 'image/jpeg' });
                }
                const bitmap = await createImageBitmap(blob);
                imgWidth = bitmap.width;
                imgHeight = bitmap.height;
                bitmap.close();
              }
            } catch {
              logger.warn(`[AlbumBridge] 获取照片尺寸失败: ${p.name}`);
            }
          }

          if (effectiveStrategy === 'direct') {
            if (sourceMode === 'folder') {
              // folder 模式：引用原文件路径，不复制数据
              newPhotos.push({
                id: crypto.randomUUID(),
                src: p.path || '',
                name: p.name,
                date: p.dateTaken || new Date().toISOString(),
                width: imgWidth,
                height: imgHeight,
                orientation: orientationOf(imgWidth, imgHeight),
                fileSize: p.size,
                storageMode: 'direct',
                relativePath: p.relativePath || p.path || '',
                latitude: p.gpsLat,
                longitude: p.gpsLon,
                albumId: selectedProjectId,
              });
            } else {
              // library 模式：引用已有 blobId，不复制数据
              newPhotos.push({
                id: crypto.randomUUID(),
                src: '',
                name: p.name,
                date: p.dateTaken || new Date().toISOString(),
                width: imgWidth,
                height: imgHeight,
                orientation: orientationOf(imgWidth, imgHeight),
                fileSize: p.size,
                storageMode: 'direct',
                blobId: p.blobId,
                originalBlobId: p.blobId,
                latitude: p.gpsLat,
                longitude: p.gpsLon,
                albumId: selectedProjectId,
              });
            }
          } else {
            // import 模式：读取照片数据，压缩后存为新 blob
            // HEIC 文件会在此被 ensureSupportedFormat 自动转换为 JPEG
            const buffer = await readPhotoData(p);
            if (!buffer) {
              logger.warn(`[AlbumBridge] 读取照片数据失败，跳过: ${p.name}`);
              continue;
            }
            const file = new File([buffer], p.name, { type: p.mimeType });
            // HEIC 文件通过 ensureSupportedFormat 转换为 JPEG（含 Tauri Rust 路径优先）
            const processedFile = isHeic ? await ensureSupportedFormat(file) : file;
            const result = await importPhotoToDB(processedFile);
            newPhotos.push({
              id: crypto.randomUUID(),
              src: result.previewUrl,
              name: p.name,
              // HEIC 转换后扩展名变为 .jpg，但保留原名便于用户识别
              date: p.dateTaken || new Date().toISOString(),
              width: result.originalWidth,
              height: result.originalHeight,
              orientation: orientationOf(result.originalWidth, result.originalHeight),
              fileSize: p.size,
              storageMode: 'import',
              blobId: result.originalBlobId || result.previewBlobId,
              originalBlobId: result.originalBlobId,
              previewBlobId: result.previewBlobId,
              thumbBlobId: result.thumbBlobId,
              latitude: p.gpsLat,
              longitude: p.gpsLon,
              albumId: selectedProjectId,
            });
          }
        } catch (err) {
          logger.warn(`[AlbumBridge] 处理照片失败，跳过: ${p.name}`, err);
        }
      }

      // 更新最终进度
      setProgress({ phase: 'bridge', current: photos.length, total: photos.length });

      // 增量保存（不清除已有照片，仅写入新增）
      if (newPhotos.length > 0) {
        await savePhotoChanges(newPhotos, selectedProjectId);
      }

      const project = projects.find((pr) => pr.id === selectedProjectId);
      addToast({
        type: 'success',
        message: t('home.organize.albumBridge.success', {
          count: newPhotos.length,
          name: project?.name || '',
        }),
      });
      onClose();
    } catch (err) {
      logger.warn('[AlbumBridge] 加入相册失败:', err);
      addToast({
        type: 'error',
        message: t('home.organize.albumBridge.failed', {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      processingRef.current = false;
      setProcessing(false);
      setProgress(null);
    }
  }

  if (!open) return null;

  const canConfirm = selectedProjectId !== null && !processing && photos.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={processing ? undefined : onClose}
      />

      {/* 内容区 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-[var(--color-brand)]"
            >
              <rect x="2" y="3" width="12" height="11" rx="1.5" />
              <path d="M2 6h12" />
              <path d="M5 3v3" />
              <path d="M11 3v3" />
            </svg>
            <h2 className="text-lg font-[700] text-[var(--color-text-primary)]">
              {t('home.organize.albumBridge.title')}
            </h2>
          </div>
          <button
            onClick={processing ? undefined : onClose}
            disabled={processing}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-gray-100)] transition-colors border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="w-4 h-4 text-[var(--color-gray-500)]"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* 描述 */}
        <div className="px-6 pt-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('home.organize.albumBridge.description', { count: photos.length })}
          </p>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 custom-scrollbar">
          {/* 选择目标相册 */}
          <div>
            <h3 className="text-sm font-[700] text-[var(--color-text-primary)] mb-2">
              {t('home.organize.albumBridge.selectProject')}
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <svg
                  className="w-6 h-6 animate-spin text-[var(--color-brand)]"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                  />
                  <path
                    d="M21 12a9 9 0 00-9-9"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="ml-2 text-sm text-[var(--color-gray-500)]">
                  {t('home.organize.albumBridge.loadingProjects')}
                </span>
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-[var(--color-gray-100)] flex items-center justify-center mb-3">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-7 h-7 text-[var(--color-gray-400)]"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('home.organize.albumBridge.noProject')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {projects.map((project) => {
                  const selected = project.id === selectedProjectId;
                  const count = photoCounts[project.id] ?? 0;
                  return (
                    <button
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      disabled={processing}
                      className={`text-left p-3 rounded-xl border transition-all duration-200 bg-white cursor-pointer disabled:cursor-not-allowed
                        ${selected
                          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/20 shadow-sm'
                          : 'border-[var(--color-border)] hover:border-[var(--color-brand)] hover:shadow-sm'}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-bg)] flex items-center justify-center text-base shrink-0">
                          {albumTypeIcon(project.albumType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-[600] text-[var(--color-text-primary)] truncate">
                            {project.name}
                          </div>
                          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 flex items-center gap-1.5">
                            <span className="text-[var(--color-brand)] font-[600]">{count}</span>
                            <span className="text-[var(--color-border)]">·</span>
                            <span>{formatDate(project.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 存储方式 */}
          {selectedProjectId && (
            <div>
              <h3 className="text-sm font-[700] text-[var(--color-text-primary)] mb-2">
                {t('home.organize.albumBridge.storageStrategy')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* 引用原文件 */}
                <button
                  onClick={() => setStrategy('direct')}
                  disabled={processing}
                  className={`text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer disabled:cursor-not-allowed
                    ${strategy === 'direct'
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)] ring-2 ring-[var(--color-brand)]/15'
                      : 'border-[var(--color-border)] hover:border-[var(--color-brand)] bg-white'}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all
                      ${strategy === 'direct' ? 'border-[var(--color-brand)]' : 'border-[var(--color-gray-300)]'}`}
                    >
                      {strategy === 'direct' && (
                        <span className="w-2 h-2 rounded-full bg-[var(--color-brand)]" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-[600] text-[var(--color-text-primary)]">
                        {t('home.organize.albumBridge.direct')}
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                        {t('home.organize.albumBridge.directDesc')}
                      </p>
                    </div>
                  </div>
                </button>

                {/* 复制到库内 */}
                <button
                  onClick={() => setStrategy('import')}
                  disabled={processing}
                  className={`text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer disabled:cursor-not-allowed
                    ${strategy === 'import'
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)] ring-2 ring-[var(--color-brand)]/15'
                      : 'border-[var(--color-border)] hover:border-[var(--color-brand)] bg-white'}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all
                      ${strategy === 'import' ? 'border-[var(--color-brand)]' : 'border-[var(--color-gray-300)]'}`}
                    >
                      {strategy === 'import' && (
                        <span className="w-2 h-2 rounded-full bg-[var(--color-brand)]" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-[600] text-[var(--color-text-primary)]">
                        {t('home.organize.albumBridge.import')}
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                        {t('home.organize.albumBridge.importDesc')}
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {/* 库内模式 direct 引用风险提示：跨项目引用原 blobId，原项目删除照片会导致本相册失效 */}
              {sourceMode === 'library' && strategy === 'direct' && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"
                  >
                    <path d="M8 1.5l6.5 11.25H1.5L8 1.5z" />
                    <path d="M8 6v3.5" />
                    <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
                  </svg>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    {t('home.organize.albumBridge.libraryDirectWarning')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 进度条 */}
          {progress && <ProgressBar progress={progress} />}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            disabled={processing}
            className="px-4 py-2 rounded-lg text-sm font-[600] border border-[var(--color-border)] text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('home.organize.albumBridge.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-sm font-[600] border-none cursor-pointer transition-all bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? t('home.organize.shared.processing') : t('home.organize.albumBridge.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
