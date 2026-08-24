/**
 * 一键成册 3 步向导
 *
 * 从照片整理中选中的照片，一键生成可导出的相册：
 *   Step 1 选版式（布局密度 + 相册尺寸）
 *   Step 2 确认照片
 *   Step 3 生成相册（自动排版成页）并打开编辑器导出
 *
 * 复用 googlePhotosLayout 智能排版引擎自动生成页面，风格与 SmartLayoutView 一致。
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  googlePhotosLayout,
  type GooglePhotosDensity,
  type GooglePhotosLayoutResult,
} from '../../../engine/google-photos-layout';
import { createAndSaveProject, savePhotoChanges } from '../../../db';
import { importPhotoToDB, ensureSupportedFormat, isHeicFile } from '../../../engine/storage-engine';
import {
  ALBUM_SIZES,
  PAGE_MARGIN_DEFAULT,
  PAGE_GAP_DEFAULT,
  GOOGLE_PHOTOS_TEMPLATE_ID,
  type AlbumPage,
  type PhotoPlacement,
  type SlotOverride,
  type Photo,
} from '../../../types';
import type { PhotoFileInfo } from '../../../photo-tools';
import { ThumbImage } from './shared';

const MM_TO_PX = 2;

/** 布局密度档位（一键成册的"版式模板"） */
const LAYOUT_STYLES: { id: GooglePhotosDensity; labelKey: string }[] = [
  { id: 'sparse', labelKey: 'organize.oneClickAlbum.styleSparse' },
  { id: 'balanced', labelKey: 'organize.oneClickAlbum.styleBalanced' },
  { id: 'compact', labelKey: 'organize.oneClickAlbum.styleCompact' },
];

type Step = 1 | 2 | 3;

export function OneClickAlbumWizard({
  open,
  onClose,
  photos,
  readPhotoData,
  addToast,
  onOpenInEditor,
}: {
  open: boolean;
  onClose: () => void;
  photos: PhotoFileInfo[];
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  addToast: (t: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
  /** 创建完成后打开编辑器（供用户导出/打印） */
  onOpenInEditor: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [density, setDensity] = useState<GooglePhotosDensity>('balanced');
  const [sizeId, setSizeId] = useState('v-210');
  const [albumName, setAlbumName] = useState('');
  const [generating, setGenerating] = useState(false);

  const albumSize = useMemo(() => {
    return ALBUM_SIZES.find((s) => s.id === sizeId) ?? ALBUM_SIZES[1];
  }, [sizeId]);

  /** 将 PhotoFileInfo 转为 googlePhotosLayout 所需的 Photo */
  const layoutPhotos: Photo[] = useMemo(() => {
    return photos.map((p) => ({
      id: p.id,
      src: p.path || '',
      name: p.name,
      date: p.dateTaken || new Date().toISOString(),
      width: p.width || 3000,
      height: p.height || 3000,
      orientation: p.width !== undefined && p.height !== undefined
        ? p.width > p.height ? 'landscape' : p.width < p.height ? 'portrait' : 'square'
        : 'square',
    }));
  }, [photos]);

  /** 预览排版结果（仅统计，用于 Step 2/3 展示） */
  const previewLayout = useMemo<GooglePhotosLayoutResult | null>(() => {
    if (layoutPhotos.length === 0) return null;
    try {
      return googlePhotosLayout(layoutPhotos, {
        pageWidth: albumSize.width,
        pageHeight: albumSize.height,
        margin: {
          top: PAGE_MARGIN_DEFAULT,
          bottom: PAGE_MARGIN_DEFAULT,
          left: PAGE_MARGIN_DEFAULT,
          right: PAGE_MARGIN_DEFAULT,
        },
        gap: PAGE_GAP_DEFAULT,
        density,
      });
    } catch {
      return null;
    }
  }, [layoutPhotos, albumSize, density]);

  if (!open) return null;

  const canNext = photos.length > 0 && !!albumSize.width && !!albumSize.height;

  /** 生成相册：用 googlePhotosLayout 自动排版成页，保存项目 + 照片，打开编辑器 */
  const handleGenerate = async () => {
    if (!previewLayout || generating) return;
    setGenerating(true);
    try {
      const now = Date.now();
      const newPages: AlbumPage[] = previewLayout.pages.map((gpPage, pageIdx) => {
        const placements: PhotoPlacement[] = [];
        const slotOverrides: Record<string, SlotOverride> = {};
        const mmLayout: Array<{ photoId: string; x: number; y: number; width: number; height: number }> = [];
        gpPage.photos.forEach((pr) => {
          const slotId = `gp-${pageIdx}-${pr.photoId}`;
          placements.push({ slotId, photoId: pr.photoId });
          slotOverrides[slotId] = {
            x: pr.x * MM_TO_PX,
            y: pr.y * MM_TO_PX,
            width: pr.width * MM_TO_PX,
            height: pr.height * MM_TO_PX,
          };
          mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
        });
        return {
          id: `page-gp-${now}-${pageIdx}`,
          templateId: GOOGLE_PHOTOS_TEMPLATE_ID,
          placements,
          background: '#FFFFFF',
          slotOverrides,
          googlePhotosMmLayout: mmLayout,
          googlePhotosBaseMmLayout: mmLayout,
          googlePhotosMmConfig: { margin: { top: PAGE_MARGIN_DEFAULT, bottom: PAGE_MARGIN_DEFAULT, left: PAGE_MARGIN_DEFAULT, right: PAGE_MARGIN_DEFAULT }, gap: PAGE_GAP_DEFAULT },
          googlePhotosInternalRows: previewLayout.internalRows[pageIdx],
          googlePhotosLayoutRows: previewLayout.layoutRows[pageIdx],
          googlePhotosBaseLayoutRows: previewLayout.layoutRows[pageIdx],
          googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
          perPageTierPattern: previewLayout.tierPatterns[pageIdx],
        };
      });

      const name = albumName.trim() || t('organize.oneClickAlbum.defaultName', '一键成册');
      const margin = { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT };
      const projectId = await createAndSaveProject(name, albumSize, newPages, margin);

      // 保存照片（import 到库内）：读取原数据 → 压缩生成 thumb/preview/original 三级 blob 存入 IndexedDB，
      // 并回填 blobId 字段，确保进入编辑器后照片列表/页面缩略图能正常加载。
      const savedPhotos: Photo[] = [];
      for (const p of photos) {
        try {
          const buf = await readPhotoData(p);
          if (!buf) continue;
          let file = new File([buf], p.name, { type: p.mimeType || 'image/jpeg' });
          // HEIC 浏览器无法原生解码，先转换为 JPEG（与正常导入流程一致）
          if (isHeicFile(p.name)) {
            file = await ensureSupportedFormat(file);
          }
          // 完整导入：thumb(256px) + preview(1200px) + original，压缩后存入 IndexedDB
          const imported = await importPhotoToDB(file, {
            originalWidth: p.width,
            originalHeight: p.height,
          });
          savedPhotos.push({
            id: p.id,
            src: imported.previewUrl,
            name: p.name,
            date: p.dateTaken || new Date().toISOString(),
            width: imported.previewWidth,
            height: imported.previewHeight,
            orientation: p.width !== undefined && p.height !== undefined
              ? p.width > p.height ? 'landscape' : p.width < p.height ? 'portrait' : 'square'
              : 'square',
            fileSize: p.size,
            storageMode: 'import',
            albumId: projectId,
            blobId: imported.originalBlobId,
            originalBlobId: imported.originalBlobId,
            previewBlobId: imported.previewBlobId,
            thumbBlobId: imported.thumbBlobId,
          });
        } catch {
          // 单张照片导入失败时跳过，其余照片继续
        }
      }
      if (savedPhotos.length > 0) {
        await savePhotoChanges(savedPhotos, projectId);
      }

      addToast({ type: 'success', message: t('organize.oneClickAlbum.generated', { pages: newPages.length }) });
      onClose();
      onOpenInEditor(projectId);
    } catch (err) {
      addToast({ type: 'error', message: t('organize.oneClickAlbum.generateFailed', { message: (err as Error).message }) });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-surface-overlay)] backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-card)] rounded-2xl shadow-2xl max-w-2xl w-full border border-[var(--color-border)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-[var(--color-primary-600)] to-[var(--color-primary-800)] text-white">
          <button
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 transition-colors border-none cursor-pointer"
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="text-xl font-[600] tracking-tight">{t('organize.oneClickAlbum.title', '一键成册')}</h2>
          <p className="text-[13px] text-white/90 mt-1.5">{t('organize.oneClickAlbum.subtitle', '把选中的照片一键排版成可导出的相册')}</p>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {([1, 2, 3] as const).map((s) => (
            <div key={s} className={`flex items-center gap-1.5 ${s > 1 ? 'ml-1' : ''}`}>
              {s > 1 && <div className="w-4 h-px bg-[var(--color-border)]" />}
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-[700] ${step >= s ? 'bg-[var(--color-primary-600)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)]'}`}>
                {s}
              </span>
              <span className={`text-[11px] font-[500] ${step >= s ? 'text-[var(--color-gray-800)]' : 'text-[var(--color-gray-400)]'}`}>
                {t(`organize.oneClickAlbum.step${s}`)}
              </span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 bg-[var(--color-surface)] max-h-[70vh] overflow-y-auto custom-scrollbar">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">
                  {t('organize.oneClickAlbum.pickStyle', '选择版式')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {LAYOUT_STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDensity(s.id)}
                      className={`p-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        density === s.id
                          ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)]'
                          : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-300)]'
                      }`}
                    >
                      <span className={`block text-[12px] font-[600] ${density === s.id ? 'text-[var(--color-primary-700)]' : 'text-[var(--color-gray-700)]'}`}>
                        {t(s.labelKey)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">
                  {t('organize.oneClickAlbum.pickSize', '选择相册尺寸')}
                </label>
                <select
                  value={sizeId}
                  onChange={(e) => setSizeId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-[13px] focus:outline-none focus:border-[var(--color-primary-400)]"
                >
                  {ALBUM_SIZES.filter((s) => s.id !== 'custom').map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {s.desc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">
                  {t('organize.oneClickAlbum.albumName', '相册名称')}
                </label>
                <input
                  type="text"
                  value={albumName}
                  onChange={(e) => setAlbumName(e.target.value)}
                  placeholder={t('organize.oneClickAlbum.defaultName', '一键成册')}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-[13px] focus:outline-none focus:border-[var(--color-primary-400)]"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--color-gray-700)]">
                {t('organize.oneClickAlbum.photoCount', '已选择 {{count}} 张照片，将自动排版为 {{pages}} 页。', {
                  count: photos.length,
                  pages: previewLayout?.totalPages ?? 0,
                })}
              </p>
              {previewLayout && (
                <div className="rounded-lg bg-[var(--color-gray-50)] border border-[var(--color-border)] p-3 text-[12px] text-[var(--color-text-secondary)]">
                  {t('organize.oneClickAlbum.preview', '版式：{{style}} · 尺寸：{{size}} · 预计 {{pages}} 页', {
                    style: t(LAYOUT_STYLES.find((s) => s.id === density)?.labelKey ?? ''),
                    size: `${albumSize.width}×${albumSize.height}mm`,
                    pages: previewLayout.totalPages,
                  })}
                </div>
              )}
              <div className="grid grid-cols-6 gap-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                {photos.slice(0, 40).map((p) => (
                  <div key={p.id} className="aspect-square rounded-md bg-[var(--color-gray-100)] overflow-hidden">
                    <ThumbImage
                      photo={p}
                      readPhotoData={readPhotoData}
                      aspect="square"
                      size="small"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-center py-2">
              <div className="text-4xl mb-2">📖</div>
              <p className="text-[13px] text-[var(--color-gray-700)]">
                {t('organize.oneClickAlbum.ready', '已准备就绪：{{pages}} 页 · {{photos}} 张照片', {
                  pages: previewLayout?.totalPages ?? 0,
                  photos: photos.length,
                })}
              </p>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {t('organize.oneClickAlbum.generateHint', '点击"生成并打开"后，将在编辑器中完成排版，可继续导出 PDF / 打印 / 分享。')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-1 bg-[var(--color-surface)] flex gap-2">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-gray-700)] text-[13px] font-[500] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('organize.oneClickAlbum.back', '上一步')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-gray-700)] text-[13px] font-[500] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('common.cancel', '取消')}
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary-600)] text-white text-[13px] font-[600] cursor-pointer hover:bg-[var(--color-primary-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('organize.oneClickAlbum.next', '下一步')}
            </button>
          ) : (
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary-600)] text-white text-[13px] font-[600] cursor-pointer hover:bg-[var(--color-primary-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? t('organize.oneClickAlbum.generating', '正在生成…') : t('organize.oneClickAlbum.generateAndOpen', '生成并打开')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
