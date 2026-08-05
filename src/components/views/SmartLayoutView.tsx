import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore, usePhotoStore } from '../../store';
import { GOOGLE_PHOTOS_TEMPLATE_ID, DEFAULT_SLOT_CORNER_RADIUS } from '../../types';
import type { Photo, AlbumPage, PhotoPlacement, SlotOverride } from '../../types';
import type { SmartLayoutSettings } from '../../store';
import {
  layoutSinglePage,
  refitPageWithRotation,
  generateMultipleLayouts,
  type GooglePhotosDensity, type GooglePhotosLayoutRhythm, type GooglePhotosDateGrouping, type TierPattern, type PageOverride,
} from '../../engine/google-photos-layout';
import {
  analyzePhotoWithFaces,
  ensurePhotoAnalyzed,
  type PhotoContentInfo,
} from '../../engine/content-aware';
import { shuffleWithSeed } from '../../utils/shufflePagePhotos';
import { AppHeader } from '../common/AppHeader';
import { SLOT_PALETTE, SLOT_BORDER_COLORS } from '../../constants/templatePalette';
import { photoService } from '../../services/photoService';
import { readPhotoFromDB, makeDirectPhotoUrl } from '../../engine/storage-engine';
import { readFileAsBlobUrl } from '../../utils/tauri';
import { isTauri } from '../../utils/tauri';
import { logger } from '../../utils/logger';

/** 模式中文标签（供预览展示）── */
const TIER_PATTERN_LABEL_KEYS: Record<TierPattern, string> = {
  'hero-first': 'editor.smartLayout.pattern.leader',
  highlight: 'editor.smartLayout.pattern.mainPair',
  alternate: 'editor.smartLayout.pattern.alternate',
  cascade: 'editor.smartLayout.pattern.cascade',
  diamond: 'editor.smartLayout.pattern.diamond',
  'all-hero': 'editor.smartLayout.pattern.fullBleed',
  'center-focus': 'editor.smartLayout.pattern.centerFocus',
  'tail-hero': 'editor.smartLayout.pattern.tailHero',
  opening: 'editor.smartLayout.pattern.opening',
  closing: 'editor.smartLayout.pattern.closing',
  'hero-tail': 'editor.smartLayout.pattern.heroTail',
  'double-hero': 'editor.smartLayout.pattern.doubleHero',
  wave: 'editor.smartLayout.pattern.wave',
  valley: 'editor.smartLayout.pattern.valley',
  mosaic: 'editor.smartLayout.pattern.mosaic',
  filmstrip: 'editor.smartLayout.pattern.filmstrip',
  'panorama-hero': 'editor.smartLayout.pattern.panorama',
  magazine: 'editor.smartLayout.pattern.magazine',
  bold: 'editor.smartLayout.pattern.bold',
  asymmetric: 'editor.smartLayout.pattern.asymmetric',
};

const RHYTHM_OPTS: { id: GooglePhotosLayoutRhythm; labelKey: string; descKey: string }[] = [
  { id: 'auto', labelKey: 'editor.smartLayout.rhythm.auto.label', descKey: 'editor.smartLayout.rhythm.auto.desc' },
  { id: 'uniform', labelKey: 'editor.smartLayout.rhythm.uniform.label', descKey: 'editor.smartLayout.rhythm.uniform.desc' },
  { id: 'subtle', labelKey: 'editor.smartLayout.rhythm.subtle.label', descKey: 'editor.smartLayout.rhythm.subtle.desc' },
  { id: 'moderate', labelKey: 'editor.smartLayout.rhythm.moderate.label', descKey: 'editor.smartLayout.rhythm.moderate.desc' },
  { id: 'rich', labelKey: 'editor.smartLayout.rhythm.rich.label', descKey: 'editor.smartLayout.rhythm.rich.desc' },
];

const MM_TO_PX = 2;
const THUMB_MAX_SIZE = 400; // 缩略图最大边长，足够 200px 卡片显示

/**
 * 解析照片的可加载 URL，考虑存储模式与缓存。
 * 与 gridThumbnailRenderer.ts 的 resolveGridPhotoSrc 同策略：
 * - import 模式：优先从 IndexedDB 读取 thumbBlobId（256px），失败回退 photo.src
 * - direct 模式：优先 thumbBlobId，失败回退 makeDirectPhotoUrl（处理 Tauri asset://）
 * 重要：direct 模式的 photo.src 可能是 asset:// 跨域 URL，画到 Canvas 会污染画布导致 toDataURL 失败。
 *      必须通过 readFileAsBlobUrl 转换为同源 blob URL。
 */
async function resolvePhotoSrcForCanvas(photo: Photo): Promise<string | null> {
  // 优先使用 thumbBlobId（256px），降低解码与内存开销
  const thumbId = photo.thumbBlobId || photo.previewBlobId || photo.blobId || photo.originalBlobId;
  if (thumbId) {
    const dbUrl = await readPhotoFromDB(thumbId);
    if (dbUrl) return dbUrl;
  }
  // 回退到 photo.src（需判断是否为同源可绘制 URL）
  if (photo.src?.startsWith('blob:') || photo.src?.startsWith('data:')) {
    return photo.src;
  }
  // direct 模式 / Tauri asset://：转为同源 blob URL 避免 canvas 污染
  if (photo.storageMode === 'direct') {
    const directUrl = await makeDirectPhotoUrl(photo);
    if (directUrl) {
      // Tauri asset:// 仍需转 blob URL
      if (directUrl.startsWith('blob:') || directUrl.startsWith('data:')) return directUrl;
      if (photo.relativePath && isTauri()) {
        const blobUrl = await readFileAsBlobUrl(photo.relativePath);
        if (blobUrl) return blobUrl;
      }
      return directUrl;
    }
  }
  return photo.src || null;
}

/** 用 Canvas 生成照片缩略图 dataURL，降低解码与内存开销 */
async function generateThumbnail(photo: Photo, maxSize = THUMB_MAX_SIZE): Promise<string | null> {
  if (photo.width <= 0 || photo.height <= 0) return null;
  // 解析安全的图片源（处理 import/direct 模式 + Tauri asset:// 跨域）
  const resolvedSrc = await resolvePhotoSrcForCanvas(photo);
  if (!resolvedSrc) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        // canvas 被污染（跨域）时 toDataURL 抛异常，返回 null 让占位色块兜底
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = resolvedSrc;
  });
}

function photoColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
  hash = Math.abs(hash);
  const hue = hash % 360;
  const sat = 45 + (hash % 20);
  const light = 72 + (hash % 12);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * P2-1 集成：照片内容信息缓存（含人脸检测焦点）
 * 在智能编排进入时一次性预计算所有照片的 contentInfo，避免重复推理。
 * 缓存键：photoId；缓存值：PhotoContentInfo（focusX/focusY 已是人脸中心或 0.5 居中）。
 */
const contentInfoCache = new Map<string, PhotoContentInfo>();

/** 清空 contentInfo 缓存（切换相册或离开智能编排时调用） */
function clearContentInfoCache() {
  contentInfoCache.clear();
}

/**
 * 为一批照片预计算 contentInfo（并发限流 6 路，避免 300+ 张全并行卡死主线程）。
 * 失败的照片回退到默认 DEFAULT_CONTENT_INFO（居中、无人脸）。
 */
async function precomputeContentInfoBatch(photos: Photo[]): Promise<void> {
  const CONCURRENCY = 6;
  let nextIndex = 0;
  let running = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (running < CONCURRENCY && nextIndex < photos.length) {
        const idx = nextIndex++;
        running++;
        const photo = photos[idx];
        // 已缓存则跳过
        if (contentInfoCache.has(photo.id)) {
          running--;
          if (running === 0 && nextIndex >= photos.length) resolve();
          pump();
          return;
        }
        analyzePhotoWithFaces(photo)
          .then((info) => {
            contentInfoCache.set(photo.id, info);
            // P1-fix: 同步写入全局 photoContentCache，让编辑器/导出/缩略图共享分析结果
            // 之前只写本地 cache，退出 SmartLayoutView 后全局缓存为空，编辑器需重新分析
            ensurePhotoAnalyzed(photo);
          })
          .catch(() => { /* 失败时使用默认值，渲染时回退居中 */ })
          .finally(() => {
            running--;
            if (running === 0 && nextIndex >= photos.length) resolve();
            pump();
          });
      }
    };
    pump();
  });
}

/**
 * 从 contentInfo 计算照片在槽位内的 CSS object-position（百分比字符串）。
 * 与 computeSmartObjectPosition 算法对齐：把焦点对齐槽位中心，并 clamp 不露白。
 *
 * CSS object-position 百分比公式（与 background-position 一致）：
 *   0% 表示照片左/上对齐槽位左/上；
 *   50% 表示照片中心对齐槽位中心；
 *   100% 表示照片右/下对齐槽位右/下。
 * 当照片被 cover-fit 放大后超出槽位时，可见范围 [0%, 100%] 对应：
 *   focusPercent = (focusX_inPhoto * imgW - slotW/2) / (imgW - slotW) * 100
 * 当 imgW == slotW（无放大）时退化为 50%。
 */
function computeCssObjectPosition(
  photoW: number,
  photoH: number,
  slotW: number,
  slotH: number,
  contentInfo: PhotoContentInfo | undefined,
): string {
  // cover-fit 缩放
  const scale = Math.max(slotW / photoW, slotH / photoH);
  const imgW = photoW * scale;
  const imgH = photoH * scale;
  // X 轴
  let focusPercentX = 50;
  if (imgW > slotW + 0.5) {
    // 焦点在照片坐标系中的像素位置（相对照片左上）
    const focusPx = (contentInfo?.focusX ?? 0.5) * imgW;
    // 让焦点对齐槽位中心：可见偏移 = slotW/2 - focusPx
    // 百分比映射：0% 表示偏移 0（照片左对齐），100% 表示偏移 (slotW - imgW)（照片右对齐）
    const offsetX = slotW / 2 - focusPx;
    const range = slotW - imgW; // 负值
    focusPercentX = range !== 0 ? (offsetX / range) * 100 : 50;
    focusPercentX = Math.max(0, Math.min(100, focusPercentX));
  }
  // Y 轴
  let focusPercentY = 50;
  if (imgH > slotH + 0.5) {
    const focusPy = (contentInfo?.focusY ?? 0.5) * imgH;
    const offsetY = slotH / 2 - focusPy;
    const range = slotH - imgH;
    focusPercentY = range !== 0 ? (offsetY / range) * 100 : 50;
    focusPercentY = Math.max(0, Math.min(100, focusPercentY));
  }
  return `${focusPercentX.toFixed(2)}% ${focusPercentY.toFixed(2)}%`;
}

function applyPhotoPositionShuffle(
  photos: Array<{ photoId: string; x: number; y: number; width: number; height: number }>,
  seed: number | undefined,
): Array<{ photoId: string; x: number; y: number; width: number; height: number }> {
  if (seed == null || photos.length <= 1) return photos;
  const ids = photos.map((p) => p.photoId);
  const shuffled = shuffleWithSeed(ids, seed);
  if (shuffled.length !== ids.length || new Set(shuffled).size !== ids.length) return photos;
  return photos.map((pr, i) => ({ ...pr, photoId: shuffled[i] }));
}

function mapToRecord<T>(map: Map<number, T>): Record<number, T> {
  const record: Record<number, T> = {};
  map.forEach((value, key) => { record[key] = value; });
  return record;
}

function recordToMap<T>(record: Record<number, T>, map: Map<number, T>) {
  Object.entries(record).forEach(([key, value]) => {
    map.set(Number(key), value);
  });
}

/* ── 单页缩略卡（React.memo：仅 photo 坐标变时才重渲染）── */
function arePhotosEqual(
  a: Array<{ photoId: string; x: number; y: number; width: number; height: number }>,
  b: Array<{ photoId: string; x: number; y: number; width: number; height: number }>,
) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].photoId !== b[i].photoId || a[i].x !== b[i].x || a[i].y !== b[i].y ||
        a[i].width !== b[i].width || a[i].height !== b[i].height) return false;
  }
  return true;
}

const PageThumbCard = memo(function PageThumbCard({
  idx, photos, photoMap, thumbCache, contentInfoCache, pageW, pageH, pageRatio, rowCount, hasSpan, isSelected, previewMode, cardHeight, slotCornerRadius, onSelect,
}: {
  idx: number; photos: Array<{ photoId: string; x: number; y: number; width: number; height: number }>;
  photoMap: Map<string, Photo>; thumbCache: Map<string, string>; contentInfoCache: Map<string, PhotoContentInfo>;
  pageW: number; pageH: number; pageRatio: number;
  rowCount: number; hasSpan: boolean; isSelected: boolean; previewMode: 'photo' | 'layout'; cardHeight: number;
  slotCornerRadius: number; onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`rounded-xl p-2 cursor-pointer border-2 ${
        isSelected
          ? 'bg-[var(--color-brand-bg)] border-[var(--color-brand)]'
          : 'bg-white border-[var(--color-border)] hover:border-[var(--color-gray-400)]'
      }`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: `${Math.ceil(cardHeight)}px` }}
    >
      <div className="relative bg-[var(--color-gray-50)] rounded-lg mb-2 overflow-hidden border border-[var(--color-gray-100)]" style={{ aspectRatio: pageRatio }}>
        <div className="absolute inset-0">
          {previewMode === 'photo' ? (
            <div className="absolute inset-0">
              {photos.slice(0, 12).map((pr) => {
                const photo = photoMap.get(pr.photoId);
                if (!photo) return null;
                const thumbSrc = thumbCache.get(pr.photoId);
                if (!thumbSrc) {
                  // 缩略图未就绪时显示构图色块占位，避免空白
                  return (
                    <div
                      key={pr.photoId}
                      className="absolute"
                      style={{
                        left: `${(pr.x / pageW) * 100}%`,
                        top: `${(pr.y / pageH) * 100}%`,
                        width: `${(pr.width / pageW) * 100}%`,
                        height: `${(pr.height / pageH) * 100}%`,
                        backgroundColor: photoColor(pr.photoId),
                        borderRadius: slotCornerRadius,
                      }}
                    />
                  );
                }
                // P2-1 集成：根据人脸检测结果计算智能 object-position，避免裁切到人脸
                const contentInfo = contentInfoCache.get(pr.photoId);
                const objectPosition = computeCssObjectPosition(
                  photo.width, photo.height,
                  pr.width, pr.height,
                  contentInfo,
                );
                return (
                  <img
                    key={pr.photoId}
                    src={thumbSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute"
                    style={{
                      left: `${(pr.x / pageW) * 100}%`,
                      top: `${(pr.y / pageH) * 100}%`,
                      width: `${(pr.width / pageW) * 100}%`,
                      height: `${(pr.height / pageH) * 100}%`,
                      objectFit: 'cover',
                      objectPosition,
                      borderRadius: slotCornerRadius,
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="absolute inset-0">
              {photos.slice(0, 12).map((pr, i) => (
                <div
                  key={pr.photoId}
                  className="absolute shadow-[0_1px_3px_rgba(108,99,255,0.08)]"
                  style={{
                    left: `${(pr.x / pageW) * 100}%`,
                    top: `${(pr.y / pageH) * 100}%`,
                    width: `${(pr.width / pageW) * 100}%`,
                    height: `${(pr.height / pageH) * 100}%`,
                    backgroundImage: SLOT_PALETTE[i % SLOT_PALETTE.length],
                    border: `1px solid ${SLOT_BORDER_COLORS[i % SLOT_BORDER_COLORS.length]}`,
                    borderRadius: slotCornerRadius,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5 gap-1">
        <span className="text-[11px] font-[500] text-[var(--color-gray-600)] shrink-0">{t('editor.smartLayout.pageN', { n: idx + 1 })}</span>
        <span className="text-[10px] text-[var(--color-gray-400)] truncate whitespace-nowrap">{t('editor.smartLayout.pageInfo', { count: photos.length, rows: rowCount, hasSpan: hasSpan ? 'true' : 'false' })}</span>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.idx === next.idx && prev.isSelected === next.isSelected &&
  prev.rowCount === next.rowCount && prev.hasSpan === next.hasSpan &&
  prev.pageW === next.pageW && prev.pageH === next.pageH &&
  prev.previewMode === next.previewMode &&
  prev.thumbCache === next.thumbCache &&
  prev.contentInfoCache === next.contentInfoCache &&
  prev.cardHeight === next.cardHeight &&
  prev.slotCornerRadius === next.slotCornerRadius &&
  arePhotosEqual(prev.photos, next.photos),
);

/* ── 密度选项 ── */
const DENSITY_OPTS: { id: GooglePhotosDensity; labelKey: string; descKey: string }[] = [
  { id: 'auto', labelKey: 'editor.smartLayout.density.auto.label', descKey: 'editor.smartLayout.density.auto.desc' },
  { id: 'large', labelKey: 'editor.smartLayout.density.large.label', descKey: 'editor.smartLayout.density.large.desc' },
  { id: 'sparse', labelKey: 'editor.smartLayout.density.sparse.label', descKey: 'editor.smartLayout.density.sparse.desc' },
  { id: 'balanced', labelKey: 'editor.smartLayout.density.balanced.label', descKey: 'editor.smartLayout.density.balanced.desc' },
  { id: 'compact', labelKey: 'editor.smartLayout.density.compact.label', descKey: 'editor.smartLayout.density.compact.desc' },
];

const DATE_OPTS: { id: GooglePhotosDateGrouping; labelKey: string; descKey: string }[] = [
  { id: 'strict', labelKey: 'editor.smartLayout.date.strict.label', descKey: 'editor.smartLayout.date.strict.desc' },
  { id: 'moderate', labelKey: 'editor.smartLayout.date.moderate.label', descKey: 'editor.smartLayout.date.moderate.desc' },
  { id: 'continuous', labelKey: 'editor.smartLayout.date.continuous.label', descKey: 'editor.smartLayout.date.continuous.desc' },
];

/* ── 滑杆映射：5 档吸附位置 -100 / -50 / 0 / 50 / 100，0 为智能（auto） ──
 * step=50 使滑杆只能停在这 5 个位置，与高级选项一一对应：
 *   -100 → compact / uniform
 *   -50  → balanced / subtle
 *    0   → auto / auto（智能）
 *    50  → sparse / moderate
 *   100  → large / rich
 */
const SLIDER_MIN = -100;
const SLIDER_MAX = 100;
const SLIDER_STEP = 50;

function sliderToDensity(v: number): GooglePhotosDensity {
  if (v <= -75) return 'compact';
  if (v <= -25) return 'balanced';
  if (v < 25) return 'auto';
  if (v < 75) return 'sparse';
  return 'large';
}

function densityToSlider(d: GooglePhotosDensity): number {
  switch (d) {
    case 'compact': return -100;
    case 'balanced': return -50;
    case 'auto': return 0;
    case 'sparse': return 50;
    case 'large': return 100;
    default: return 0;
  }
}

function sliderToRhythm(v: number): GooglePhotosLayoutRhythm {
  if (v <= -75) return 'uniform';
  if (v <= -25) return 'subtle';
  if (v < 25) return 'auto';
  if (v < 75) return 'moderate';
  return 'rich';
}

function rhythmToSlider(r: GooglePhotosLayoutRhythm): number {
  switch (r) {
    case 'uniform': return -100;
    case 'subtle': return -50;
    case 'auto': return 0;
    case 'moderate': return 50;
    case 'rich': return 100;
    default: return 0;
  }
}

interface SmartLayoutViewProps {
  onBack: () => void;
}

export function SmartLayoutView({ onBack }: SmartLayoutViewProps) {
  const { t } = useTranslation();
  const editorPages = useEditorStore((s) => s.pages);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const albumSize = useEditorStore((s) => s.albumSize);
  const pageMargin = useEditorStore((s) => s.pageMargin);
  const slotGap = useEditorStore((s) => s.slotGap);
  const appendPages = useEditorStore((s) => s.appendPages);
  const addToast = useUIStore((s) => s.addToast);
  const smartLayoutSelectedIds = useUIStore((s) => s.smartLayoutSelectedIds);
  const setSmartLayoutSelectedIds = useUIStore((s) => s.setSmartLayoutSelectedIds);
  const smartLayoutSettings = useUIStore((s) => s.smartLayoutSettings);
  const setSmartLayoutSettings = useUIStore((s) => s.setSmartLayoutSettings);
  const setSmartLayoutPerPageOverrides = useUIStore((s) => s.setSmartLayoutPerPageOverrides);
  const clearSmartLayoutState = useUIStore((s) => s.clearSmartLayoutState);
  const photos = usePhotoStore((s) => s.photos);

  const selectedPhotos = useMemo(() => {
    const idSet = new Set(smartLayoutSelectedIds);
    return photos.filter((p) => idSet.has(p.id));
  }, [photos, smartLayoutSelectedIds]);

  const [densitySlider, setDensitySlider] = useState(0);
  const [rhythmSlider, setRhythmSlider] = useState(0);
  const density = useMemo(() => sliderToDensity(densitySlider), [densitySlider]);
  const layoutRhythm = useMemo(() => sliderToRhythm(rhythmSlider), [rhythmSlider]);

  const [dateGrouping, setDateGrouping] = useState<GooglePhotosDateGrouping>('strict');
  const [insertMode, setInsertMode] = useState<'end' | 'after'>('end');
  const [insertAfter, setInsertAfter] = useState('');
  const [thumbZoom, setThumbZoom] = useState(180); // 卡片最小宽度 px（120~320）
  const [previewMode, setPreviewMode] = useState<'photo' | 'layout'>('layout');
  const [thumbCache, setThumbCache] = useState<Map<string, string>>(new Map());
  const [executing, setExecuting] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(1); // 默认选中 B 方案
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 页面级选择 + 双轴偏压（rhythm/bias 通过 ref 传递，选择/取消选择永不触发 layoutResult 重算）
  const [selectedPageIdx, setSelectedPageIdx] = useState<number | null>(null);
  const [biasX, setBiasX] = useState(0);  // -10~+10
  const [biasY, setBiasY] = useState(0);  // -10~+10
  const biasRef = useRef({ biasX: 0, biasY: 0 });
  biasRef.current = { biasX, biasY };
  // 强制重算 key：切页/偏压变化时自增，确保 layoutResult 使用正确的 ref 值
  const [layoutRecalcKey, setLayoutRecalcKey] = useState(0);

  // 跨页偏压记忆 + 单页 rhythm/seed/tierPattern 隔离：统一为 pageOverrides，rotation/photoPosition 单独维护
  const pageOverridesRef = useRef<Map<number, PageOverride>>(new Map());
  const perPageRotationMapRef = useRef<Map<number, 0 | 90 | 180 | 270>>(new Map());
  const perPagePhotoPositionSeedMapRef = useRef<Map<number, number>>(new Map());

  // 当前生效的密度/节奏（考虑单页覆盖）
  const effectiveDensity = useMemo(() => {
    if (selectedPageIdx != null) {
      const pageOv = pageOverridesRef.current.get(selectedPageIdx);
      if (pageOv?.density != null) return pageOv.density;
    }
    return density;
  }, [selectedPageIdx, density, layoutRecalcKey]);

  const effectiveRhythm = useMemo(() => {
    if (selectedPageIdx != null) {
      const pageOv = pageOverridesRef.current.get(selectedPageIdx);
      if (pageOv?.rhythm != null) return pageOv.rhythm;
    }
    return layoutRhythm;
  }, [selectedPageIdx, layoutRhythm, layoutRecalcKey]);

  // ── 从 UIStore 恢复智能编排设置（组件挂载时一次性恢复）──
  useEffect(() => {
    const settings = smartLayoutSettings;
    if (!settings) return;
    setDensitySlider(densityToSlider(settings.density));
    setRhythmSlider(rhythmToSlider(settings.layoutRhythm));
    setDateGrouping(settings.dateGrouping);
    setInsertMode(settings.insertMode);
    setInsertAfter(settings.insertAfter);
    setThumbZoom(settings.thumbZoom);
    setPreviewMode(settings.previewMode);
    setSelectedPreviewIndex(settings.selectedPreviewIndex ?? 1);
    setLayoutRecalcKey(k => k + 1);
  }, []);

  // 切换选中页面时，滑杆回显该页的密度/节奏覆盖值（或全局值）
  useEffect(() => {
    if (selectedPageIdx == null) {
      setDensitySlider(densityToSlider(density));
      setRhythmSlider(rhythmToSlider(layoutRhythm));
      return;
    }
    const pageOv = pageOverridesRef.current.get(selectedPageIdx);
    setDensitySlider(pageOv?.density != null ? densityToSlider(pageOv.density) : densityToSlider(density));
    setRhythmSlider(pageOv?.rhythm != null ? rhythmToSlider(pageOv.rhythm) : rhythmToSlider(layoutRhythm));
  }, [selectedPageIdx]);

  useEffect(() => {
    const overrides = useUIStore.getState().smartLayoutPerPageOverrides;
    const map = new Map<number, PageOverride>();
    Object.entries(overrides.bias).forEach(([k, v]) => {
      const existing = map.get(Number(k)) ?? {};
      map.set(Number(k), { ...existing, biasX: v.biasX, biasY: v.biasY });
    });
    Object.entries(overrides.rhythm).forEach(([k, v]) => {
      const existing = map.get(Number(k)) ?? {};
      map.set(Number(k), { ...existing, rhythm: v });
    });
    Object.entries(overrides.seed).forEach(([k, v]) => {
      const existing = map.get(Number(k)) ?? {};
      map.set(Number(k), { ...existing, seed: v });
    });
    Object.entries(overrides.tierPattern).forEach(([k, v]) => {
      const existing = map.get(Number(k)) ?? {};
      map.set(Number(k), { ...existing, tierPattern: v });
    });
    pageOverridesRef.current = map;
    recordToMap(overrides.rotation, perPageRotationMapRef.current);
    recordToMap(overrides.photoPositionSeed, perPagePhotoPositionSeedMapRef.current);
    setLayoutRecalcKey(k => k + 1);
  }, []);

  // ── XY 盘拖拽：ref 提升到组件级避免渲染重建 ──
  const padRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const updateBiasFromClient = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let bx = Math.round(((clientX - r.left) / r.width - 0.5) * 200) / 10;
    let by = Math.round((0.5 - (clientY - r.top) / r.height) * 200) / 10;
    bx = Math.max(-10, Math.min(10, bx));
    by = Math.max(-10, Math.min(10, by));
    if (bx === biasX && by === biasY) return;
    setBiasX(bx);
    setBiasY(by);
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, biasX: bx, biasY: by });
    }
    setLayoutRecalcKey(k => k + 1);
  }, [biasX, biasY, selectedPageIdx]);
  const onPadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    updateBiasFromClient(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => { ev.preventDefault(); updateBiasFromClient(ev.clientX, ev.clientY); };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [updateBiasFromClient]);

  const handleSelectPage = (idx: number | null) => {
    // 保存当前页偏压（用 ref 避免 memo 闭包过期）
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, ...biasRef.current });
    }
    // 加载新页偏压
    let nextBX = 0, nextBY = 0;
    if (idx != null) {
      const saved = pageOverridesRef.current.get(idx);
      nextBX = saved?.biasX ?? 0;
      nextBY = saved?.biasY ?? 0;
    }
    setBiasX(nextBX);
    setBiasY(nextBY);
    setSelectedPageIdx(idx);
    setLayoutRecalcKey(k => k + 1);
  };
  const clearAllRhythmOverrides = () => {
    for (const [key, ov] of pageOverridesRef.current) {
      // 节奏变化时同步清除已锁定的 tierPattern，否则版式不会重新选择
      const { rhythm: _, tierPattern: __, ...rest } = ov;
      pageOverridesRef.current.set(key, rest);
    }
  };
  const handleBiasChange = (axis: 'X' | 'Y', val: number) => {
    if (axis === 'X') setBiasX(val);
    else setBiasY(val);
    const newBX = axis === 'X' ? val : biasX;
    const newBY = axis === 'Y' ? val : biasY;
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, biasX: newBX, biasY: newBY });
    }
    setLayoutRecalcKey(k => k + 1);
  };
  const handleDensityChange = (d: GooglePhotosDensity) => {
    setDensitySlider(densityToSlider(d));
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, density: d });
    }
    setLayoutRecalcKey(k => k + 1);
  };
  const handleDensitySliderChange = (val: number) => {
    setDensitySlider(val);
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, density: sliderToDensity(val) });
      setLayoutRecalcKey(k => k + 1);
    }
  };
  const handleRhythmChange = (rhythm: GooglePhotosLayoutRhythm) => {
    setRhythmSlider(rhythmToSlider(rhythm));
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      // 节奏变化后，必须移除锁定的 tierPattern，否则版式不会重新选择
      const { tierPattern: _, ...rest } = existing;
      pageOverridesRef.current.set(selectedPageIdx, { ...rest, rhythm });
    } else {
      clearAllRhythmOverrides();
    }
    setLayoutRecalcKey(k => k + 1);
  };
  const handleRhythmSliderChange = (val: number) => {
    setRhythmSlider(val);
    if (selectedPageIdx != null) {
      const rhythm = sliderToRhythm(val);
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      const { tierPattern: _, ...rest } = existing;
      pageOverridesRef.current.set(selectedPageIdx, { ...rest, rhythm });
      setLayoutRecalcKey(k => k + 1);
    } else {
      // 全局节奏变化时清除所有单页节奏覆盖，确保新节奏对所有页面生效
      clearAllRhythmOverrides();
      setLayoutRecalcKey(k => k + 1);
    }
  };
  const handleShufflePhotoPositions = (pageIdx: number) => {
    const pagePhotos = layoutResult.pages[pageIdx]?.photos;
    if (!pagePhotos || pagePhotos.length <= 1) {
      addToast({ message: t('editor.smartLayout.toast.shuffleInsufficient'), type: 'info' });
      return;
    }
    perPagePhotoPositionSeedMapRef.current.set(pageIdx, Math.floor(Math.random() * 10000));
    setLayoutRecalcKey(k => k + 1);
  };
  const handleShufflePhotoPositionsClick = () => {
    if (selectedPageIdx == null) {
      addToast({ message: t('editor.smartLayout.toast.selectPageForShuffle'), type: 'info' });
      return;
    }
    handleShufflePhotoPositions(selectedPageIdx);
  };

  const handleRotatePageClick = () => {
    if (selectedPageIdx == null) {
      addToast({ message: t('editor.smartLayout.toast.selectPageForRotate'), type: 'info' });
      return;
    }
    const current = perPageRotationMapRef.current.get(selectedPageIdx) ?? 0;
    const next = ((current + 90) % 360) as 0 | 90 | 180 | 270;
    perPageRotationMapRef.current.set(selectedPageIdx, next);
    setLayoutRecalcKey(k => k + 1);
  };

  if (!albumSize) {
    return (
      <div className="h-full w-full flex flex-col bg-[var(--color-surface-panel)] overflow-hidden items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-sm text-gray-500">{t('editor.smartLayout.createAlbumFirst')}</p>
          <div className="flex justify-center mt-4">
            <button className="px-5 py-2 text-sm text-white bg-[var(--color-brand)] rounded-lg cursor-pointer" onClick={onBack}>{t('common.back')}</button>
          </div>
        </div>
      </div>
    );
  }

  // P2-1 集成：contentInfo 缓存引用（含人脸检测焦点 + 清晰度）。
  // 用 useRef 持有模块级 contentInfoCache，组件卸载时清空避免泄漏。
  // 缓存键为 photoId，跨重渲染共享，避免重复推理。
  // 注意：声明在 baseConfig 之前，因 baseConfig 依赖 contentInfoVersion 触发重算。
  const contentInfoCacheRef = useRef(contentInfoCache);
  // 切换相册（selectedPhotos 变化）时增量补充未缓存的照片分析
  const [contentInfoVersion, setContentInfoVersion] = useState(0);
  useEffect(() => {
    if (selectedPhotos.length === 0) return;
    let cancelled = false;
    // 找出尚未分析的照片，增量补充
    const uncached = selectedPhotos.filter((p) => !contentInfoCache.has(p.id));
    if (uncached.length === 0) return;
    precomputeContentInfoBatch(uncached)
      .then(() => {
        if (!cancelled) setContentInfoVersion((v) => v + 1);
      })
      .catch((err) => {
        logger.warn('[SmartLayoutView] contentInfo 预计算失败:', err);
      });
    return () => { cancelled = true; };
  }, [selectedPhotos]);
  // 引用 contentInfoVersion 触发 PageThumbCard 重渲染（contentInfoCache 引用不变，靠 version 触发）
  useEffect(() => {
    // 仅作为依赖，无副作用
  }, [contentInfoVersion]);
  // 组件卸载时清空 contentInfo 缓存，避免下次进入时使用过期数据
  useEffect(() => {
    return () => { clearContentInfoCache(); };
  }, []);

  const baseConfig = useMemo(() => {
    return {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density,
      layoutRhythm,
      dateGrouping,
      pageOverrides: new Map(pageOverridesRef.current),
      // P0-1/P0-2/P0-4 集成：传入 contentInfoCache 启用人脸评分 + 色彩冲突检测 + 多版本择优
      // contentInfoVersion 触发重算（contentInfoCache 引用不变，靠 version 驱动 useMemo）
      contentInfoCache: contentInfoCacheRef.current,
    };
  }, [albumSize, pageMargin, slotGap, density, layoutRhythm, dateGrouping, layoutRecalcKey, selectedPhotos.length, contentInfoVersion]);

  // ── P2-2 集成：用 generateMultipleLayouts 生成 5 个版本 + 美学评分择优，取 Top-3 ──
  // 替代旧的 PREVIEW_SEEDS = [101, 202, 303] 固定 seed 方案，让评分函数真正发挥作用。
  // 用户看到的 A/B/C 三方案是评分 Top-3，而非随机 3 个，质量更稳定。
  // P0-4：contentInfoVersion 作为依赖，contentInfo 预计算完成后重跑择优
  const previewResults = useMemo(
    () => generateMultipleLayouts(selectedPhotos, baseConfig, 5, 3).map((v) => v.result),
    [selectedPhotos, baseConfig, layoutRecalcKey, contentInfoVersion],
  );

  // P0-fix: 防御性 clamp index，避免 previewResults 长度不足时越界崩溃
  const safePreviewIndex = Math.min(selectedPreviewIndex, Math.max(previewResults.length - 1, 0));
  const layoutResult = previewResults[safePreviewIndex];

  // 保存每页实际使用的 tierPattern，单页重排时锁定其他页避免受影响
  useEffect(() => {
    if (!layoutResult) return;
    layoutResult.tierPatterns.forEach((pattern, i) => {
      const existing = pageOverridesRef.current.get(i) ?? {};
      pageOverridesRef.current.set(i, { ...existing, tierPattern: pattern });
    });
  }, [layoutResult?.tierPatterns]);

  // 所有缩略卡共享同一份 photoMap，避免每张卡片重复构建
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    selectedPhotos.forEach((p) => map.set(p.id, p));
    return map;
  }, [selectedPhotos]);

  /** 为单页生成旋转后的实际坐标（用于确认生成） */
  const buildRotatedPageData = useCallback((pageIdx: number): {
    photos: Array<{ photoId: string; x: number; y: number; width: number; height: number }>;
    layoutRows: any;
    internalRows: any;
    tierPattern: TierPattern;
  } | null => {
    const rotation = perPageRotationMapRef.current.get(pageIdx) ?? 0;
    if (rotation === 0) {
      return {
        photos: layoutResult.pages[pageIdx].photos,
        layoutRows: layoutResult.layoutRows[pageIdx],
        internalRows: layoutResult.internalRows[pageIdx],
        tierPattern: layoutResult.tierPatterns[pageIdx],
      };
    }

    const gpPage = layoutResult.pages[pageIdx];
    const pagePhotos = gpPage.photos.map((pr) => photoMap.get(pr.photoId)).filter((p): p is Photo => p != null);
    if (pagePhotos.length === 0) return null;

    const isSideways = rotation === 90 || rotation === 270;
    const basePageW = isSideways ? albumSize.height : albumSize.width;
    const basePageH = isSideways ? albumSize.width : albumSize.height;
    const baseContentW = basePageW - pageMargin.left - pageMargin.right;
    const baseContentH = basePageH - pageMargin.top - pageMargin.bottom;
    if (baseContentW <= 0 || baseContentH <= 0) return null;

    const pageOverride = pageOverridesRef.current.get(pageIdx);
    const pageRhythm = pageOverride?.rhythm ?? layoutRhythm;
    const seed = pageOverride?.seed;
    const baseResult = layoutSinglePage(pagePhotos, {
      pageWidth: basePageW,
      pageHeight: basePageH,
      margin: pageMargin,
      gap: slotGap,
      density: 'auto',
      layoutRhythm: pageRhythm,
      dateGrouping: 'continuous',
      // P0-2 集成：单页重排也启用人脸评分维度，与多页预览保持一致
      contentInfoCache: contentInfoCacheRef.current,
    }, seed);

    if (baseResult.pages.length === 0) return null;

    const bx = pageOverride?.biasX ?? 0;
    const by = pageOverride?.biasY ?? 0;
    const pattern = (baseResult.tierPatterns[0] as TierPattern | undefined) ?? 'hero-first';
    const rotated = refitPageWithRotation(
      baseResult.layoutRows[0] as any,
      photoMap,
      baseContentW, baseContentH,
      pageMargin.left, pageMargin.top,
      slotGap,
      bx, by,
      rotation,
      basePageW, basePageH,
      albumSize.width, albumSize.height,
      pageMargin,
      pattern,
    );

    return {
      photos: rotated.photos,
      layoutRows: baseResult.layoutRows[0],
      internalRows: baseResult.internalRows[0],
      tierPattern: pattern,
    };
  }, [layoutResult, albumSize, pageMargin, slotGap, layoutRhythm, photoMap]);

  // 带旋转的预览数据：rotation 不为 0 时重新计算实际坐标，确保预览与最终生成一致
  const previewPages = useMemo(() => {
    return layoutResult.pages.map((gpPage, i) => {
      const rotation = perPageRotationMapRef.current.get(i) ?? 0;
      if (rotation === 0) return gpPage;
      const rotated = buildRotatedPageData(i);
      return rotated ? { ...gpPage, photos: rotated.photos } : gpPage;
    });
  }, [layoutResult, buildRotatedPageData, layoutRecalcKey]);

  // 应用照片位置重排（保持槽几何不变，仅交换 photoId）
  const displayPages = useMemo(() => {
    return previewPages.map((gpPage, i) => {
      const seed = perPagePhotoPositionSeedMapRef.current.get(i);
      const shuffled = applyPhotoPositionShuffle(gpPage.photos, seed);
      if (shuffled === gpPage.photos) return gpPage;
      return { ...gpPage, photos: shuffled };
    });
  }, [previewPages, layoutRecalcKey]);

  // ── 照片模式缩略图异步生成：用 Canvas 把原图压缩到 400px 以内，避免同时解码大量高清图 ──
  useEffect(() => {
    if (previewMode !== 'photo' || layoutResult.pages.length === 0) return;

    // 收集当前布局中真正需要渲染的照片 ID
    const neededIds = new Set<string>();
    layoutResult.pages.forEach((p) => p.photos.forEach((pr) => neededIds.add(pr.photoId)));

    const photoList = selectedPhotos.filter((p) => neededIds.has(p.id) && !thumbCache.has(p.id));
    if (photoList.length === 0) return;

    let cancelled = false;
    let index = 0;
    const batchSize = 3; // 每帧生成 3 张，避免阻塞 UI

    const processBatch = () => {
      if (cancelled || index >= photoList.length) return;
      const batch = photoList.slice(index, index + batchSize);
      index += batchSize;

      Promise.all(
        batch.map(async (photo) => {
          const thumb = await generateThumbnail(photo, THUMB_MAX_SIZE);
          return { photo, thumb };
        }),
      ).then((results) => {
        if (cancelled) return;
        setThumbCache((prev) => {
          const next = new Map(prev);
          results.forEach(({ photo, thumb }) => {
            if (thumb) next.set(photo.id, thumb);
          });
          return next;
        });
        requestAnimationFrame(processBatch);
      });
    };

    requestAnimationFrame(processBatch);
    return () => { cancelled = true; };
  }, [previewMode, layoutResult.pages, selectedPhotos, thumbCache]);

  const insertIndex = insertMode === 'end'
    ? editorPages.length
    : Math.max(0, Math.min(parseInt(insertAfter) || 0, editorPages.length));


  const handleExecute = useCallback(() => {
    if (executing || layoutResult.pages.length === 0) return;
    setExecuting(true);
    try {
      const now = Date.now();
      const newPages: AlbumPage[] = layoutResult.pages.map((gpPage, pageIdx) => {
        const rotated = buildRotatedPageData(pageIdx);
        const baseSource = rotated ?? {
          photos: gpPage.photos,
          layoutRows: layoutResult.layoutRows[pageIdx],
          internalRows: layoutResult.internalRows[pageIdx],
          tierPattern: layoutResult.tierPatterns[pageIdx],
        };
        // 应用照片位置重排（保持槽几何不变）
        const positionSeed = perPagePhotoPositionSeedMapRef.current.get(pageIdx);
        const finalPhotos = applyPhotoPositionShuffle(baseSource.photos, positionSeed);
        const source = { ...baseSource, photos: finalPhotos };
        const placements: PhotoPlacement[] = [];
        const slotOverrides: Record<string, SlotOverride> = {};
        const mmLayout: Array<{ photoId: string; x: number; y: number; width: number; height: number }> = [];
        source.photos.forEach((pr, pi) => {
          const slotId = `gp-${pi}`;
          placements.push({ slotId, photoId: pr.photoId });
          slotOverrides[slotId] = { x: pr.x * MM_TO_PX, y: pr.y * MM_TO_PX, width: pr.width * MM_TO_PX, height: pr.height * MM_TO_PX };
          mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
        });
        const ov = pageOverridesRef.current.get(pageIdx);
        const rotation = perPageRotationMapRef.current.get(pageIdx) ?? 0;
        return {
          id: `page-gp-${now}-${pageIdx}`,
          templateId: GOOGLE_PHOTOS_TEMPLATE_ID,
          placements,
          background: '#FFFFFF',
          slotOverrides,
          googlePhotosMmLayout: mmLayout,
          googlePhotosBaseMmLayout: rotated ? layoutResult.pages[pageIdx].photos : mmLayout,
          googlePhotosMmConfig: { margin: baseConfig.margin, gap: baseConfig.gap },
          googlePhotosInternalRows: source.internalRows,
          googlePhotosLayoutRows: source.layoutRows as any,
          googlePhotosBaseLayoutRows: source.layoutRows as any,
          googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
          perPageRhythm: ov?.rhythm,
          perPageTierPattern: source.tierPattern,
          layoutSeed: ov?.seed,
          perPageBiasX: ov?.biasX ?? 0,
          perPageBiasY: ov?.biasY ?? 0,
          perPageRotation: rotation,
        };
      });
      appendPages(insertIndex, newPages);

      addToast({ message: t('editor.smartLayout.layoutSuccess', { photos: selectedPhotos.length, pages: newPages.length }), type: 'success' });
      setSmartLayoutSelectedIds([]);
      // P0: 返回编辑器前清理位图缓存（不清 blob URL）。
      // EditorView 因条件渲染被卸载又重新挂载，imageCache 中的旧 ImageBitmap
      // 与新 Konva Stage 状态不一致会导致画布空白。只清位图/缩略图缓存，
      // 保留 blobUrlCache/directUrlCache 让 photo.src 继续有效。
      photoService.clearRuntimeBitmapCache();
      onBack();
    } catch (err) {
      addToast({ message: t('editor.smartLayout.layoutFailed', { message: (err as Error)?.message ?? '' }), type: 'error' });
    } finally {
      setExecuting(false);
    }
  }, [executing, layoutResult.pages, insertIndex, selectedPhotos.length, baseConfig.gap, baseConfig.margin, addToast, onBack, appendPages, buildRotatedPageData, setSmartLayoutSelectedIds, albumSize.width, albumSize.height, t]);

  const saveSmartLayoutState = useCallback(() => {
    const settings: SmartLayoutSettings = {
      density,
      layoutRhythm,
      dateGrouping,
      insertMode,
      insertAfter,
      thumbZoom,
      previewMode,
      selectedPhotoIds: smartLayoutSelectedIds,
      selectedPreviewIndex,
    };
    setSmartLayoutSettings(settings);
    const biasRecord: Record<number, { biasX: number; biasY: number }> = {};
    const rhythmRecord: Record<number, GooglePhotosLayoutRhythm> = {};
    const seedRecord: Record<number, number> = {};
    const tierPatternRecord: Record<number, TierPattern> = {};
    pageOverridesRef.current.forEach((ov, idx) => {
      if (ov.biasX != null && ov.biasY != null) biasRecord[idx] = { biasX: ov.biasX, biasY: ov.biasY };
      if (ov.rhythm != null) rhythmRecord[idx] = ov.rhythm;
      if (ov.seed != null) seedRecord[idx] = ov.seed;
      if (ov.tierPattern != null) tierPatternRecord[idx] = ov.tierPattern;
    });
    setSmartLayoutPerPageOverrides({
      bias: biasRecord,
      rhythm: rhythmRecord,
      seed: seedRecord,
      rotation: mapToRecord(perPageRotationMapRef.current),
      tierPattern: tierPatternRecord,
      photoPositionSeed: mapToRecord(perPagePhotoPositionSeedMapRef.current),
    });
  }, [density, layoutRhythm, dateGrouping, insertMode, insertAfter, thumbZoom, previewMode, smartLayoutSelectedIds, setSmartLayoutSettings, setSmartLayoutPerPageOverrides]);

  const handleContinueAdd = useCallback(() => {
    // 保存当前智能编排设置，继续添加照片后可恢复
    saveSmartLayoutState();
    onBack();
  }, [onBack, saveSmartLayoutState]);

  const handleCancel = useCallback(() => {
    setSmartLayoutSelectedIds([]);
    clearSmartLayoutState();
    onBack();
  }, [onBack, setSmartLayoutSelectedIds, clearSmartLayoutState]);

  if (layoutResult.pages.length === 0) {
    return (
      <div className="h-full w-full flex flex-col bg-[var(--color-surface-panel)] overflow-hidden items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-sm text-gray-500">{t('editor.smartLayout.pageTooSmall')}</p>
          <div className="flex justify-center mt-4">
            <button className="px-5 py-2 text-sm text-white bg-[var(--color-brand)] rounded-lg cursor-pointer" onClick={onBack}>{t('common.back')}</button>
          </div>
        </div>
      </div>
    );
  }

  const pageW = albumSize.width;
  const pageH = albumSize.height;
  const pageRatio = pageW / pageH;
  const slotCornerRadius = editorPages[currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
  const scaledCornerRadius = Math.max(0, slotCornerRadius * (thumbZoom / (pageW * MM_TO_PX)));

  return (
    <div className="h-full w-full flex flex-col bg-[var(--color-surface-panel)] overflow-hidden">
      {/* ═══════ 顶部导航栏（品牌渐变标题区） ═══════ */}
      <AppHeader>
        <div className="flex-1" />
        <div className="text-center min-w-0 px-2" data-no-drag>
          <div className="flex items-center justify-center gap-2">
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-[var(--color-brand)]" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" fill="currentColor" fillOpacity="0.2" />
              <path d="M8 1l1.8 4.2L14 6l-3.2 2.8L11.8 13 8 10.8 4.2 13l1-4.2L2 6l4.2-.8L8 1z" />
            </svg>
            <h1 className="text-[var(--text-h3)] font-[700] bg-gradient-to-r from-[var(--color-brand)] to-[#8B7FFF] bg-clip-text text-transparent">{t('editor.smartLayout.title')}</h1>
          </div>
          <p className="text-[var(--text-caption)] text-[var(--color-gray-500)] mt-0.5">
            {t('editor.smartLayout.spec', { w: pageW, h: pageH, gap: baseConfig.gap, margin: pageMargin.top })} · {t('editor.smartLayout.summary', { photos: selectedPhotos.length, pages: layoutResult.totalPages })}
          </p>
        </div>
        <div className="flex-1" />
      </AppHeader>

      <div className="flex flex-1 overflow-hidden">
        {/* ═══════ 左侧设置面板（磨砂质感） ═══════ */}
        <div className="w-[260px] shrink-0 flex flex-col bg-[var(--color-gray-50)] border-r border-[var(--color-border)]">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
            {/* 照片密度滑杆 */}
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">
                  {t('editor.smartLayout.densityLabel')}{selectedPageIdx != null ? t('editor.smartLayout.pageSuffix', { n: selectedPageIdx + 1 }) : ''}
                </span>
                <span className="text-[11px] font-[500] text-[var(--color-brand)]">
                  {t(DENSITY_OPTS.find((d) => d.id === effectiveDensity)?.labelKey ?? '')}
                </span>
              </div>
              <div className="relative h-6 flex items-center">
                <input
                  type="range"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={SLIDER_STEP}
                  value={densitySlider}
                  onChange={(e) => handleDensitySliderChange(parseInt(e.target.value))}
                  className="w-full h-1.5 accent-[var(--color-brand)] cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-[10px] text-[var(--color-gray-400)] mt-1">
                <span>{t('editor.smartLayout.compact')}</span>
                <span>{t('editor.smartLayout.density.auto.label')}</span>
                <span>{t('editor.smartLayout.loose')}</span>
              </div>
            </div>

            {/* 排版节奏滑杆 */}
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">
                  {t('editor.smartLayout.rhythmLabel')}{selectedPageIdx != null ? t('editor.smartLayout.pageSuffix', { n: selectedPageIdx + 1 }) : ''}
                </span>
                <span className="text-[11px] font-[500] text-[var(--color-brand)]">
                  {t(RHYTHM_OPTS.find((r) => r.id === effectiveRhythm)?.labelKey ?? '')}
                </span>
              </div>
              <div className="relative h-6 flex items-center">
                <input
                  type="range"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={SLIDER_STEP}
                  value={rhythmSlider}
                  onChange={(e) => handleRhythmSliderChange(parseInt(e.target.value))}
                  className="w-full h-1.5 accent-[var(--color-brand)] cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-[10px] text-[var(--color-gray-400)] mt-1">
                <span>{t('editor.smartLayout.uniform')}</span>
                <span>{t('editor.smartLayout.rhythm.auto.label')}</span>
                <span>{t('editor.smartLayout.varied')}</span>
              </div>
              {selectedPageIdx != null && layoutResult.tierPatterns[selectedPageIdx] && (
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="text-[10px] text-[var(--color-gray-400)]">{t('editor.smartLayout.currentPattern')}</span>
                  <span className="text-[10px] font-[500] text-[var(--color-brand)]">
                    {t(TIER_PATTERN_LABEL_KEYS[layoutResult.tierPatterns[selectedPageIdx]])}
                  </span>
                </div>
              )}
            </div>

            {/* 排版方案 */}
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">{t('editor.smartLayout.layoutSchemes')}</span>
                <span className="text-[10px] text-[var(--color-gray-400)]">{t('editor.smartLayout.clickToSwitch')}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {previewResults.map((result, i) => {
                  const pattern = result.tierPatterns[0];
                  const schemeLabels = ['editor.smartLayout.schemeA', 'editor.smartLayout.schemeB', 'editor.smartLayout.schemeC'];
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedPreviewIndex(i)}
                      className={`flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg border transition-all cursor-pointer ${
                        selectedPreviewIndex === i
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                          : 'border-[var(--color-border)] bg-white hover:border-[var(--color-gray-400)]'
                      }`}
                    >
                      <span className={`text-[11px] font-[600] ${selectedPreviewIndex === i ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-700)]'}`}>{t(schemeLabels[i])}</span>
                      {pattern ? (
                        <span className="text-[9px] text-[var(--color-gray-400)] leading-tight">{t(TIER_PATTERN_LABEL_KEYS[pattern])}</span>
                      ) : (
                        <span className="text-[9px] text-[var(--color-gray-400)] leading-tight">{t('editor.smartLayout.auto')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 高级设置（折叠） */}
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white hover:bg-[var(--color-gray-50)] transition-colors cursor-pointer"
              >
                <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">{t('editor.smartLayout.advancedSettings')}</span>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-3.5 h-3.5 text-[var(--color-gray-500)] transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
              {advancedOpen && (
                <div className="px-3 pb-3 space-y-4 bg-[var(--color-gray-50)]">
                  {/* 精确密度 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-[600] text-[var(--color-gray-600)]">{t('editor.smartLayout.preciseDensity')}</span>
                      {selectedPageIdx != null && (
                        <button
                          onClick={() => {
                            const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
                            const { density: _, ...rest } = existing;
                            pageOverridesRef.current.set(selectedPageIdx, rest);
                            setDensitySlider(densityToSlider(density));
                            setLayoutRecalcKey(k => k + 1);
                          }}
                          className="text-[9px] text-[var(--color-gray-500)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5 hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors cursor-pointer"
                        >
                          {t('editor.smartLayout.resetGlobal')}
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {DENSITY_OPTS.map(({ id, labelKey, descKey }) => (
                        <button
                          key={id}
                          onClick={() => handleDensityChange(id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                            effectiveDensity === id
                              ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                              : 'border-transparent bg-white hover:border-[var(--color-border)]'
                          }`}
                        >
                          <span className={`text-[11px] font-[500] ${effectiveDensity === id ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-700)]'}`}>{t(labelKey)}</span>
                          <span className="block text-[9px] text-[var(--color-gray-400)]">{t(descKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 精确节奏 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-[600] text-[var(--color-gray-600)]">{t('editor.smartLayout.preciseRhythm')}</span>
                      {selectedPageIdx != null && (
                        <button
                          onClick={() => {
                            const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
                            const { rhythm: _, tierPattern: __, ...rest } = existing;
                            pageOverridesRef.current.set(selectedPageIdx, rest);
                            setRhythmSlider(rhythmToSlider(layoutRhythm));
                            setLayoutRecalcKey(k => k + 1);
                          }}
                          className="text-[9px] text-[var(--color-gray-500)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5 hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors cursor-pointer"
                        >
                          {t('editor.smartLayout.resetGlobal')}
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {RHYTHM_OPTS.map(({ id, labelKey, descKey }) => {
                        const isActive = effectiveRhythm === id;
                        return (
                          <button
                            key={id}
                            onClick={() => handleRhythmChange(id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                              isActive
                                ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]'
                                : 'border-transparent bg-white hover:border-[var(--color-border)]'
                            }`}
                          >
                            <span className={`text-[11px] font-[500] ${isActive ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-700)]'}`}>{t(labelKey)}</span>
                            <span className="block text-[9px] text-[var(--color-gray-400)]">{t(descKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 排版变化 */}
                  <div className={selectedPageIdx == null ? 'opacity-40 pointer-events-none' : ''}>
              {(() => {
                const padW = padRef.current?.clientWidth ?? 220;
                const dotX = ((biasX + 10) / 20) * padW;
                const dotY = ((10 - biasY) / 20) * padW;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">
                        {t('editor.smartLayout.layoutVariation')}{selectedPageIdx != null ? t('editor.smartLayout.pageSuffix', { n: selectedPageIdx + 1 }) : ''}
                      </span>
                      <button onClick={() => { handleBiasChange('X', 0); handleBiasChange('Y', 0); }} className="text-[10px] text-[var(--color-gray-500)] border border-[var(--color-border)] rounded-full px-2 py-0.5 hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors cursor-pointer">{t('editor.smartLayout.centerReset')}</button>
                    </div>
                    <div
                      ref={padRef}
                      onMouseDown={onPadMouseDown}
                      onDoubleClick={() => { handleBiasChange('X', 0); handleBiasChange('Y', 0); }}
                      className="relative bg-[var(--color-gray-50)] rounded-xl border border-[var(--color-gray-200)] cursor-crosshair select-none w-full aspect-square"
                      style={{ touchAction: 'none' }}
                    >
                      <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-[var(--color-gray-300)]" style={{ marginTop: -0.5 }} />
                      <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-[var(--color-gray-300)]" style={{ marginLeft: -0.5 }} />
                      <span className="absolute top-0 left-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.smartLayout.biasTop')}</span>
                      <span className="absolute top-0 right-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.smartLayout.biasRight')}</span>
                      <span className="absolute bottom-0 left-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.smartLayout.biasLeft')}</span>
                      <span className="absolute bottom-0 right-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.smartLayout.biasBottom')}</span>
                      <div
                        ref={dotRef}
                        className="absolute w-4 h-4 rounded-full bg-[var(--color-brand)] border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] cursor-grab active:cursor-grabbing"
                        style={{ left: dotX - 8, top: dotY - 8, transition: 'none' }}
                      />
                    </div>
                    <div className="text-[10px] text-[var(--color-gray-400)]">
                      {t('editor.smartLayout.biasDisplay', {
                        x: biasX > 0 ? t('editor.smartLayout.biasRightVal', { v: biasX.toFixed(1) }) : biasX < 0 ? t('editor.smartLayout.biasLeftVal', { v: biasX.toFixed(1) }) : t('editor.smartLayout.biasCenter'),
                        y: biasY > 0 ? t('editor.smartLayout.biasTopVal', { v: biasY.toFixed(1) }) : biasY < 0 ? t('editor.smartLayout.biasBottomVal', { v: biasY.toFixed(1) }) : t('editor.smartLayout.biasCenter'),
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
                </div>
            )}
            </div>


            {/* 日期分组 */}
            <div>
              <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">{t('editor.smartLayout.dateGrouping')}</div>
              <div className="space-y-1">
                {DATE_OPTS.map(({ id, labelKey, descKey }) => (
                  <button
                    key={id}
                    onClick={() => setDateGrouping(id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                      dateGrouping === id
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)] ring-1 ring-[var(--color-brand)]/20'
                        : 'border-transparent bg-white hover:border-[var(--color-border)] hover:bg-white'
                    }`}
                  >
                    <span className={`text-[12px] font-[500] ${dateGrouping === id ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-700)]'}`}>{t(labelKey)}</span>
                    <span className="block text-[10px] text-[var(--color-gray-400)] mt-0.5">{t(descKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 插入位置 */}
            <div>
              <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">{t('editor.smartLayout.insertPosition')}</div>
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all mb-1 ${
                insertMode === 'end' ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]' : 'border-transparent bg-white hover:border-[var(--color-border)]'
              }`}>
                <input type="radio" name="insert" checked={insertMode === 'end'} onChange={() => setInsertMode('end')} className="w-3.5 h-3.5 accent-[var(--color-brand)]" />
                <span className="text-[12px] text-[var(--color-gray-700)]">{t('editor.smartLayout.appendEnd')}</span>
              </label>
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                insertMode === 'after' ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]' : 'border-transparent bg-white hover:border-[var(--color-border)]'
              }`}>
                <input type="radio" name="insert" checked={insertMode === 'after'} onChange={() => setInsertMode('after')} className="w-3.5 h-3.5 accent-[var(--color-brand)]" />
                <span className="text-[12px] text-[var(--color-gray-700)]">{t('editor.smartLayout.insertAfter')}</span>
                <input
                  type="number" min={0} max={editorPages.length}
                  value={insertMode === 'after' ? insertAfter : editorPages.length}
                  onChange={(e) => { setInsertMode('after'); setInsertAfter(e.target.value); }}
                  onFocus={() => setInsertMode('after')}
                  className="w-12 px-1.5 py-0.5 text-[12px] border border-[var(--color-border)] rounded-md text-center focus:outline-none focus:border-[var(--color-brand)]"
                />
                <span className="text-[12px] text-[var(--color-gray-700)]">{t('editor.smartLayout.pageAfter')}</span>
              </label>
            </div>
          </div>
          {/* 底部操作区 */}
          <div className="px-5 py-3 border-t border-[var(--color-border)] bg-white shrink-0 space-y-2">
            <button
              className="group relative w-full px-4 py-2.5 text-[13px] text-white font-[600]
                         bg-gradient-to-r from-[var(--color-brand)] via-[#7B6FFF] to-[#8B7FFF]
                         rounded-lg shadow-[0_2px_12px_rgba(108,99,255,0.3)]
                         hover:shadow-[0_6px_24px_rgba(108,99,255,0.5)]
                         hover:scale-[1.02] active:scale-[0.98]
                         transition-all duration-300 ease-out cursor-pointer
                         overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              onClick={handleExecute} disabled={executing}
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent
                               translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-700 ease-out" />
              <span className="relative z-10">{executing ? t('editor.smartLayout.executing') : t('editor.smartLayout.confirmGenerate', { pages: layoutResult.totalPages })}</span>
            </button>
            <div className="flex gap-2">
              <button
                className="flex-1 px-4 py-2 text-[13px] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-gray-400)] transition-colors cursor-pointer"
                onClick={handleContinueAdd}
              >{t('editor.smartLayout.continueAdd')}</button>
              <button
                className="flex-1 px-4 py-2 text-[13px] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-gray-400)] transition-colors cursor-pointer"
                onClick={handleCancel}
              >{t('editor.smartLayout.cancel')}</button>
            </div>
          </div>
        </div>

        {/* ═══════ 右侧预览区 ═══════ */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-surface-panel)]">
          {/* 头部工具栏 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-white">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[var(--color-gray-400)]">{t('editor.smartLayout.previewAll')}</span>
              <span className="font-[600] text-[var(--color-brand)]">{t('editor.smartLayout.pagesCount', { count: layoutResult.totalPages })}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleShufflePhotoPositionsClick}
                disabled={executing}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-[500] border rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                  selectedPageIdx == null
                    ? 'text-[var(--color-gray-400)] bg-[var(--color-gray-50)] border-[var(--color-border)]'
                    : 'text-[var(--color-gray-600)] bg-white border-[var(--color-border)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'
                }`}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <rect x="2.5" y="2.5" width="4" height="4" rx="1"/>
                  <rect x="9.5" y="2.5" width="4" height="4" rx="1"/>
                  <rect x="2.5" y="9.5" width="4" height="4" rx="1"/>
                  <rect x="9.5" y="9.5" width="4" height="4" rx="1"/>
                  <path d="M6.5 4.5h3M4.5 6.5v3M11.5 6.5v3M6.5 11.5h3"/>
                </svg>
                {t('editor.smartLayout.shufflePhotos')}
              </button>
              <button
                onClick={handleRotatePageClick}
                disabled={executing}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-[500] border rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                  selectedPageIdx == null
                    ? 'text-[var(--color-gray-400)] bg-[var(--color-gray-50)] border-[var(--color-border)]'
                    : 'text-[var(--color-gray-600)] bg-white border-[var(--color-border)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]'
                }`}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                  <path d="M3.5 8a4.5 4.5 0 014.5-4.5h0M12.5 8a4.5 4.5 0 01-4.5 4.5h0"/>
                  <path d="M10.5 5.5L13 3l-2.5-2.5"/>
                  <path d="M5.5 10.5L3 13l2.5 2.5"/>
                </svg>
                {t('editor.smartLayout.rotate90')}
              </button>
              <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg p-0.5 border border-[var(--color-border)]">
                <button
                  onClick={() => setPreviewMode('photo')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-[500] transition-colors cursor-pointer border-none ${
                    previewMode === 'photo' ? 'bg-white text-[var(--color-brand)] shadow-sm' : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'
                  }`}
                >{t('editor.smartLayout.photoMode')}</button>
                <button
                  onClick={() => setPreviewMode('layout')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-[500] transition-colors cursor-pointer border-none ${
                    previewMode === 'layout' ? 'bg-white text-[var(--color-brand)] shadow-sm' : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'
                  }`}
                >{t('editor.smartLayout.compositionMode')}</button>
              </div>
              <div className="flex items-center gap-2 bg-[var(--color-gray-50)] rounded-lg px-3 py-1.5 border border-[var(--color-border)]">
                <span className="text-[11px] text-[var(--color-gray-500)]">{t('editor.smartLayout.thumbnail')}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-[var(--color-gray-400)]">
                  <rect x="2" y="2" width="4" height="4" rx="1"/><rect x="10" y="2" width="4" height="4" rx="1"/>
                  <rect x="2" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/>
                </svg>
                <input
                  type="range"
                  min={160}
                  max={320}
                  step={10}
                  value={thumbZoom}
                  onChange={(e) => setThumbZoom(parseInt(e.target.value))}
                  className="w-24 h-1 accent-[var(--color-brand)] cursor-pointer"
                />
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-[var(--color-gray-400)]">
                  <rect x="1.5" y="1.5" width="6" height="6" rx="1"/><rect x="8.5" y="1.5" width="6" height="6" rx="1"/>
                  <rect x="1.5" y="8.5" width="6" height="6" rx="1"/><rect x="8.5" y="8.5" width="6" height="6" rx="1"/>
                </svg>
                <span className="text-[11px] font-[500] text-[var(--color-gray-600)] w-9 text-right">{Math.round(thumbZoom / 2)}%</span>
              </div>
            </div>
          </div>

          {/* 滚动预览 */}
          <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar" onClick={() => handleSelectPage(null)}>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbZoom}px, 1fr))` }}>
              {displayPages.map((gpPage, i) => {
                const ri = layoutResult.internalRows[i];
                const rowCount = ri?.length || 0;
                const hasSpan = ri?.some((r) => r.photoIds.length === 1) || false;
                const isSelected = selectedPageIdx === i;
                const cardHeight = thumbZoom / pageRatio + 40;
                return (
                  <PageThumbCard
                    key={i}
                    idx={i}
                    photos={gpPage.photos}
                    photoMap={photoMap}
                    thumbCache={thumbCache}
                    contentInfoCache={contentInfoCacheRef.current}
                    pageW={pageW}
                    pageH={pageH}
                    pageRatio={pageRatio}
                    rowCount={rowCount}
                    hasSpan={hasSpan}
                    isSelected={isSelected}
                    previewMode={previewMode}
                    cardHeight={cardHeight}
                    slotCornerRadius={scaledCornerRadius}
                    onSelect={() => handleSelectPage(isSelected ? null : i)}
                  />
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
