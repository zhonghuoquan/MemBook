import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { GOOGLE_PHOTOS_TEMPLATE_ID } from '../../types';
import type { Photo, AlbumPage, PhotoPlacement, SlotOverride } from '../../types';
import {
  googlePhotosLayout,
  layoutSinglePage,
  type GooglePhotosDensity, type GooglePhotosLayoutRhythm, type GooglePhotosDateGrouping, type TierPattern, type PageOverride,
} from '../../engine/google-photos-layout';

/** 模式 i18n key（供预览展示） */
const TIER_PATTERN_LABELS: Record<TierPattern, string> = {
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
import { ModalGuard } from '../../utils/modal-guard';

interface GooglePhotosLayoutDialogProps {
  selectedPhotos: Photo[];
  onClose: () => void;
  onComplete: () => void;
}

const MM_TO_PX = 2;
const THUMB_MAX_SIZE = 400; // 缩略图最大边长，足够 200px 卡片显示

/** 用 Canvas 生成照片缩略图 dataURL，降低解码与内存开销 */
async function generateThumbnail(photo: Photo, maxSize = THUMB_MAX_SIZE): Promise<string | null> {
  if (!photo.src || photo.width <= 0 || photo.height <= 0) return null;
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
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = photo.src;
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
  idx, photos, photoMap, thumbCache, pageW, pageH, pageRatio, rowCount, hasSpan, isSelected, previewMode, cardHeight, onSelect,
}: {
  idx: number; photos: Array<{ photoId: string; x: number; y: number; width: number; height: number }>;
  photoMap: Map<string, Photo>; thumbCache: Map<string, string>; pageW: number; pageH: number; pageRatio: number;
  rowCount: number; hasSpan: boolean; isSelected: boolean; previewMode: 'photo' | 'layout'; cardHeight: number; onSelect: () => void;
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
                    }}
                  />
                );
              }
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
                    objectPosition: 'center',
                  }}
                />
              );
            })}
          </div>
        ) : (
          <svg viewBox={`0 0 ${pageW} ${pageH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
            {photos.slice(0, 12).map((pr) => (
              <rect key={pr.photoId} x={pr.x} y={pr.y} width={pr.width} height={pr.height} fill={photoColor(pr.photoId)} rx={2} />
            ))}
          </svg>
        )}
      </div>
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-[500] text-[var(--color-gray-600)]">{t('editor.smartLayout.pageN', { n: idx + 1 })}</span>
        <span className="text-[10px] text-[var(--color-gray-400)]">{t('editor.smartLayout.pageInfo', { count: photos.length, rows: rowCount, hasSpan })}</span>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.idx === next.idx && prev.isSelected === next.isSelected &&
  prev.rowCount === next.rowCount && prev.hasSpan === next.hasSpan &&
  prev.pageW === next.pageW && prev.pageH === next.pageH &&
  prev.previewMode === next.previewMode &&
  prev.thumbCache === next.thumbCache &&
  prev.cardHeight === next.cardHeight &&
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

/* ── 快速预设：一键应用「密度 + 节奏 + 日期分组」组合，普通用户无需理解单项参数 ── */
interface LayoutPreset {
  id: string;
  labelKey: string;
  density: GooglePhotosDensity;
  layoutRhythm: GooglePhotosLayoutRhythm;
  dateGrouping: GooglePhotosDateGrouping;
}
const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'simple', labelKey: 'editor.smartLayout.preset.simple', density: 'large', layoutRhythm: 'uniform', dateGrouping: 'strict' },
  { id: 'balanced', labelKey: 'editor.smartLayout.preset.balanced', density: 'balanced', layoutRhythm: 'moderate', dateGrouping: 'moderate' },
  { id: 'rich', labelKey: 'editor.smartLayout.preset.rich', density: 'compact', layoutRhythm: 'rich', dateGrouping: 'continuous' },
];

/** 预设预览卡：用同一批照片实时计算第一页排版，以布局色块展示效果差异 */
const PresetPreviewCard = memo(function PresetPreviewCard({
  preset, photos, baseConfig, pageW, pageH, active, onSelect,
}: {
  preset: LayoutPreset;
  photos: Photo[];
  baseConfig: { pageWidth: number; pageHeight: number; margin: { top: number; bottom: number; left: number; right: number }; gap: number };
  pageW: number;
  pageH: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const previewPhotos = useMemo(() => {
    try {
      const result = layoutSinglePage(photos, { ...baseConfig, density: preset.density, layoutRhythm: preset.layoutRhythm, dateGrouping: preset.dateGrouping });
      return result.pages[0]?.photos ?? [];
    } catch {
      return [];
    }
  }, [photos, baseConfig, preset]);

  return (
    <button
      onClick={onSelect}
      className={`flex-1 rounded-lg p-1.5 border-2 cursor-pointer transition-all ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-bg)]'
          : 'border-transparent bg-white hover:border-[var(--color-border)]'
      }`}
    >
      <div className="relative bg-[var(--color-gray-50)] rounded-md overflow-hidden border border-[var(--color-gray-100)] mb-1" style={{ aspectRatio: pageW / pageH }}>
        <svg viewBox={`0 0 ${pageW} ${pageH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
          {previewPhotos.slice(0, 10).map((pr) => (
            <rect key={pr.photoId} x={pr.x} y={pr.y} width={pr.width} height={pr.height} fill={photoColor(pr.photoId)} rx={1} />
          ))}
        </svg>
      </div>
      <span className={`block text-center text-[11px] font-[500] ${active ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-600)]'}`}>
        {t(preset.labelKey)}
      </span>
    </button>
  );
}, (prev, next) =>
  prev.preset === next.preset && prev.active === next.active &&
  prev.photos === next.photos && prev.baseConfig === next.baseConfig &&
  prev.pageW === next.pageW && prev.pageH === next.pageH,
);

export function GooglePhotosLayoutDialog({ selectedPhotos, onClose, onComplete }: GooglePhotosLayoutDialogProps) {
  const { t } = useTranslation();
  const editorPages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);
  const pageMargin = useEditorStore((s) => s.pageMargin);
  const slotGap = useEditorStore((s) => s.slotGap);
  const appendPages = useEditorStore((s) => s.appendPages);
  const addToast = useUIStore((s) => s.addToast);

  const [density, setDensity] = useState<GooglePhotosDensity>('auto');
  const [layoutRhythm, setLayoutRhythm] = useState<GooglePhotosLayoutRhythm>('auto');
  const [dateGrouping, setDateGrouping] = useState<GooglePhotosDateGrouping>('strict');
  const [insertMode, setInsertMode] = useState<'end' | 'after'>('end');
  const [insertAfter, setInsertAfter] = useState('');
  const [thumbZoom, setThumbZoom] = useState(180); // 卡片最小宽度 px（120~320）
  const [previewMode, setPreviewMode] = useState<'photo' | 'layout'>('layout');
  const [thumbCache, setThumbCache] = useState<Map<string, string>>(new Map());
  const [executing, setExecuting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false); // 高级参数（日期分组/偏压/插入位置）折叠状态
  // 窗口拖拽
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const [dialogTranslate, setDialogTranslate] = useState({ x: 0, y: 0 });
  // 页面级选择 + 双轴偏压（rhythm/bias 通过 ref 传递，选择/取消选择永不触发 layoutResult 重算）
  const [selectedPageIdx, setSelectedPageIdx] = useState<number | null>(null);
  const [biasX, setBiasX] = useState(0);  // -10~+10
  const [biasY, setBiasY] = useState(0);  // -10~+10
  const biasRef = useRef({ biasX: 0, biasY: 0 });
  biasRef.current = { biasX, biasY };
  // 强制重算 key：切页/偏压变化时自增，确保 layoutResult 使用正确的 ref 值
  const [layoutRecalcKey, setLayoutRecalcKey] = useState(0);
  // 跨页偏压记忆 + 单页 rhythm/seed 隔离：统一为 pageOverrides，切页时保存/恢复，避免全局 pollution
  const pageOverridesRef = useRef<Map<number, PageOverride>>(new Map());

  // ── XY 盘拖拽：ref 提升到组件级避免渲染重建 ──
  const padRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const updateBiasFromClient = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let bx = Math.round(((clientX - r.left) / r.width - 0.5) * 200) / 10;
    let by = Math.round((0.5 - (clientY - r.top) / r.height) * 200) / 10;
    // 限制在 [-10, +10] 范围内，防止控制点超出控制区
    bx = Math.max(-10, Math.min(10, bx));
    by = Math.max(-10, Math.min(10, by));
    if (bx === biasX && by === biasY) return;
    // XY 合并为一次提交，避免双轴拖拽时触发两次重算
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
  const handleBiasChange = (axis: 'X' | 'Y', val: number) => {
    if (axis === 'X') setBiasX(val);
    else setBiasY(val);
    // 同步写入 pageOverrides，确保引擎读取最新值
    const newBX = axis === 'X' ? val : biasX;
    const newBY = axis === 'Y' ? val : biasY;
    if (selectedPageIdx != null) {
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, biasX: newBX, biasY: newBY });
    }
    setLayoutRecalcKey(k => k + 1);  // 滑条拖动也强制重算
  };
  const clearAllRhythmOverrides = () => {
    for (const [key, ov] of pageOverridesRef.current) {
      if (ov.rhythm != null) {
        const { rhythm: _, ...rest } = ov;
        pageOverridesRef.current.set(key, rest);
      }
    }
  };
  const handleRhythmChange = (rhythm: GooglePhotosLayoutRhythm) => {
    if (selectedPageIdx != null) {
      // 单页覆盖：仅影响当前选中的页
      const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
      pageOverridesRef.current.set(selectedPageIdx, { ...existing, rhythm });
    } else {
      // 全局：清空所有单页 rhythm 覆盖，统一使用新节奏
      clearAllRhythmOverrides();
      setLayoutRhythm(rhythm);
    }
    setLayoutRecalcKey(k => k + 1);
  };
  const handleShufflePage = (pageIdx: number) => {
    // 生成新 seed，让同一节奏池换另一种 pattern
    const existing = pageOverridesRef.current.get(pageIdx) ?? {};
    pageOverridesRef.current.set(pageIdx, { ...existing, seed: Math.floor(Math.random() * 10000) });
    setLayoutRecalcKey(k => k + 1);
  };
  const handleShuffleAll = () => {
    const count = layoutResult.pages.length;
    for (let i = 0; i < count; i++) {
      const existing = pageOverridesRef.current.get(i) ?? {};
      pageOverridesRef.current.set(i, { ...existing, seed: Math.floor(Math.random() * 10000) });
    }
    setLayoutRecalcKey(k => k + 1);
  };
  const handleShufflePageClick = () => {
    if (selectedPageIdx == null) {
      addToast({ message: t('editor.smartLayout.selectPageFirst'), type: 'info' });
      return;
    }
    handleShufflePage(selectedPageIdx);
  };

  // 窗口拖拽逻辑
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - dialogTranslate.x,
      y: e.clientY - dialogTranslate.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setDialogTranslate({
        x: ev.clientX - dragOffsetRef.current.x,
        y: ev.clientY - dragOffsetRef.current.y,
      });
    };
    const onUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dialogTranslate.x, dialogTranslate.y]);

  useEffect(() => { ModalGuard.open(); return () => ModalGuard.close(); }, []);

  if (!albumSize) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" style={{ pointerEvents: 'auto' }} onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-8 pointer-events-auto">
            <p className="text-sm text-gray-500">{t('editor.smartLayout.createAlbumFirst')}</p>
            <div className="flex justify-center mt-4">
              <button className="px-5 py-2 text-sm text-white bg-[var(--color-brand)] rounded-lg cursor-pointer" onClick={onClose}>{t('editor.smartLayout.ok')}</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const config = useMemo(() => {
    return {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density,
      layoutRhythm,
      dateGrouping,
      // 单页 rhythm/seed/偏压统一从 pageOverrides 读取
      pageOverrides: new Map(pageOverridesRef.current),
    };
  }, [albumSize, pageMargin, slotGap, density, layoutRhythm, dateGrouping, layoutRecalcKey, selectedPhotos.length]);

  const layoutResult = useMemo(
    () => googlePhotosLayout(selectedPhotos, config),
    [selectedPhotos, config, layoutRecalcKey],
  );

  // 预设预览的基础配置（仅页面几何，三个预设各自覆盖密度/节奏/日期分组）
  const presetBaseConfig = useMemo(() => ({
    pageWidth: albumSize.width,
    pageHeight: albumSize.height,
    margin: pageMargin,
    gap: slotGap,
  }), [albumSize, pageMargin, slotGap]);

  // 所有缩略卡共享同一份 photoMap，避免每张卡片重复构建
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    selectedPhotos.forEach((p) => map.set(p.id, p));
    return map;
  }, [selectedPhotos]);

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
        const placements: PhotoPlacement[] = [];
        const slotOverrides: Record<string, SlotOverride> = {};
        const mmLayout: Array<{ photoId: string; x: number; y: number; width: number; height: number }> = [];
        gpPage.photos.forEach((pr, pi) => {
          const slotId = `gp-${pi}`;
          placements.push({ slotId, photoId: pr.photoId });
          slotOverrides[slotId] = { x: pr.x * MM_TO_PX, y: pr.y * MM_TO_PX, width: pr.width * MM_TO_PX, height: pr.height * MM_TO_PX };
          mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
        });
        const ov = pageOverridesRef.current.get(pageIdx);
        return {
          id: `page-gp-${now}-${pageIdx}`,
          templateId: GOOGLE_PHOTOS_TEMPLATE_ID,
          placements,
          background: '#FFFFFF',
          slotOverrides,
          googlePhotosMmLayout: mmLayout,
          googlePhotosBaseMmLayout: mmLayout,
          googlePhotosMmConfig: { margin: config.margin, gap: config.gap },
          googlePhotosInternalRows: layoutResult.internalRows[pageIdx],
          googlePhotosLayoutRows: layoutResult.layoutRows[pageIdx] as any,
          googlePhotosBaseLayoutRows: layoutResult.layoutRows[pageIdx] as any,
          googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
          perPageRhythm: ov?.rhythm,
          perPageTierPattern: layoutResult.tierPatterns[pageIdx],
          layoutSeed: ov?.seed,
          perPageBiasX: ov?.biasX ?? 0,
          perPageBiasY: ov?.biasY ?? 0,
        };
      });
      appendPages(insertIndex, newPages);

      addToast({ message: t('editor.smartLayout.layoutSuccess', { photos: selectedPhotos.length, pages: newPages.length }), type: 'success' });
      onComplete();
      onClose();
    } catch (err) {
      addToast({ message: t('editor.smartLayout.layoutFailed', { message: (err as Error)?.message }), type: 'error' });
    } finally {
      setExecuting(false);
    }
  }, [executing, layoutResult.pages, insertIndex, selectedPhotos.length, config.gap, config.margin, addToast, onComplete, onClose, appendPages, t]);

  if (layoutResult.pages.length === 0) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" style={{ pointerEvents: 'auto' }} onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-8 pointer-events-auto">
            <p className="text-sm text-gray-500">{t('editor.smartLayout.pageTooSmall')}</p>
            <div className="flex justify-center mt-4">
              <button className="px-5 py-2 text-sm text-white bg-[var(--color-brand)] rounded-lg cursor-pointer" onClick={onClose}>{t('editor.smartLayout.ok')}</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const pageW = albumSize.width;
  const pageH = albumSize.height;
  const pageRatio = pageW / pageH;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" style={{ pointerEvents: 'auto' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          ref={dialogRef}
          className="bg-white rounded-2xl shadow-2xl flex flex-row pointer-events-auto overflow-hidden"
          style={{
            width: '1040px', maxWidth: '96vw', height: '85vh', maxHeight: '800px',
            transform: `translate(${dialogTranslate.x}px, ${dialogTranslate.y}px)`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ═══════ 左侧设置面板 ═══════ */}
          <div className="w-[260px] shrink-0 flex flex-col bg-[var(--color-gray-50)] border-r border-[var(--color-border)]">
            <div className="px-5 py-4 border-b border-[var(--color-border)] bg-white cursor-move" onMouseDown={startDrag}>
              <h2 className="text-[14px] font-[600] text-[var(--color-gray-800)]">{t('editor.smartLayout.title')}</h2>
              <p className="text-[11px] text-[var(--color-gray-400)] mt-0.5">{t('editor.smartLayout.summary', { photos: selectedPhotos.length, pages: layoutResult.totalPages })}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
              {/* 快速预设：三选一效果卡，实时预览第一页排版 */}
              <div>
                <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">{t('editor.smartLayout.quickPresets')}</div>
                <div className="flex gap-1.5">
                  {LAYOUT_PRESETS.map((preset) => {
                    const isActive = density === preset.density && layoutRhythm === preset.layoutRhythm && dateGrouping === preset.dateGrouping;
                    return (
                      <PresetPreviewCard
                        key={preset.id}
                        preset={preset}
                        photos={selectedPhotos}
                        baseConfig={presetBaseConfig}
                        pageW={pageW}
                        pageH={pageH}
                        active={isActive}
                        onSelect={() => {
                          setDensity(preset.density);
                          // 与全局节奏切换一致：清空所有单页 rhythm 覆盖
                          clearAllRhythmOverrides();
                          setLayoutRhythm(preset.layoutRhythm);
                          setDateGrouping(preset.dateGrouping);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* 照片密度：滑杆（宽松 ↔ 紧凑） */}
              <div>
                {(() => {
                  const densityIdx = Math.max(0, DENSITY_OPTS.findIndex((o) => o.id === density));
                  const cur = DENSITY_OPTS[densityIdx];
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">{t('editor.smartLayout.density')}</span>
                        <span className="text-[11px] font-[500] text-[var(--color-brand)]">{t(cur.labelKey)}</span>
                      </div>
                      <input
                        type="range" min={0} max={DENSITY_OPTS.length - 1} step={1}
                        value={densityIdx}
                        onChange={(e) => setDensity(DENSITY_OPTS[Number(e.target.value)].id)}
                        className="w-full accent-[var(--color-brand)] cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-[var(--color-gray-400)] mt-0.5">
                        <span>{t('editor.smartLayout.loose')}</span><span>{t('editor.smartLayout.compact')}</span>
                      </div>
                      <div className="text-[10px] text-[var(--color-gray-400)] mt-1">{t(cur.descKey)}</div>
                    </>
                  );
                })()}
              </div>

              {/* 排版节奏：滑杆（统一 ↔ 多变） */}
              <div>
                {(() => {
                  const activeRhythm = selectedPageIdx != null
                    ? (pageOverridesRef.current.get(selectedPageIdx)?.rhythm ?? layoutRhythm)
                    : layoutRhythm;
                  const rhythmIdx = Math.max(0, RHYTHM_OPTS.findIndex((o) => o.id === activeRhythm));
                  const cur = RHYTHM_OPTS[rhythmIdx];
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-[600] text-[var(--color-gray-700)]">
                          {t('editor.smartLayout.rhythm')}{selectedPageIdx != null ? t('editor.smartLayout.pageSuffix', { n: selectedPageIdx + 1 }) : ''}
                        </span>
                        <span className="text-[11px] font-[500] text-[var(--color-brand)]">{t(cur.labelKey)}</span>
                      </div>
                      <input
                        type="range" min={0} max={RHYTHM_OPTS.length - 1} step={1}
                        value={rhythmIdx}
                        onChange={(e) => handleRhythmChange(RHYTHM_OPTS[Number(e.target.value)].id)}
                        className="w-full accent-[var(--color-brand)] cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-[var(--color-gray-400)] mt-0.5">
                        <span>{t('editor.smartLayout.uniform')}</span><span>{t('editor.smartLayout.varied')}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-[var(--color-gray-400)]">{t(cur.descKey)}</span>
                        {selectedPageIdx != null && (
                          <button
                            onClick={() => {
                              const existing = pageOverridesRef.current.get(selectedPageIdx) ?? {};
                              const { rhythm: _, ...rest } = existing;
                              pageOverridesRef.current.set(selectedPageIdx, rest);
                              setLayoutRecalcKey(k => k + 1);
                            }}
                            className="text-[10px] text-[var(--color-gray-500)] border border-[var(--color-border)] rounded-full px-2 py-0.5 hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors cursor-pointer shrink-0"
                          >
                            {t('editor.smartLayout.resetGlobal')}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
                {selectedPageIdx != null && layoutResult.tierPatterns[selectedPageIdx] && (
                  <div className="mt-2 flex items-center justify-between px-1">
                    <span className="text-[10px] text-[var(--color-gray-400)]">{t('editor.smartLayout.currentPattern')}</span>
                    <span className="text-[10px] font-[500] text-[var(--color-brand)]">
                      {t(TIER_PATTERN_LABELS[layoutResult.tierPatterns[selectedPageIdx]])}
                    </span>
                  </div>
                )}
              </div>

              {/* 高级选项：日期分组 / 排版变化 / 插入位置（折叠） */}
              <div>
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center justify-between w-full px-1 py-1 text-[12px] font-[600] text-[var(--color-gray-700)] bg-transparent border-none cursor-pointer hover:text-[var(--color-brand)] transition-colors"
                >
                  <span>{t('editor.smartLayout.advancedOptions')}</span>
                  <span className="text-[10px] text-[var(--color-gray-400)]">{showAdvanced ? t('editor.smartLayout.collapse') : t('editor.smartLayout.expand')}</span>
                </button>
              </div>
            {showAdvanced && (<div className="space-y-5">

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
                          x: biasX > 0
                            ? t('editor.smartLayout.biasRightVal', { v: biasX.toFixed(1) })
                            : biasX < 0
                              ? t('editor.smartLayout.biasLeftVal', { v: biasX.toFixed(1) })
                              : t('editor.smartLayout.biasCenter'),
                          y: biasY > 0
                            ? t('editor.smartLayout.biasTopVal', { v: biasY.toFixed(1) })
                            : biasY < 0
                              ? t('editor.smartLayout.biasBottomVal', { v: biasY.toFixed(1) })
                              : t('editor.smartLayout.biasCenter'),
                        })}
                      </div>
                    </div>
                  );
                })()}
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
            </div>)}
            </div>
            {/* 底部规格 */}
            <div className="px-5 py-3 border-t border-[var(--color-border)] bg-white">
              <div className="text-[11px] text-[var(--color-gray-400)]">
                {t('editor.smartLayout.spec', { w: pageW, h: pageH, gap: config.gap, margin: pageMargin.top })}
              </div>
            </div>
          </div>

          {/* ═══════ 右侧预览区 ═══════ */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* 头部工具栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] cursor-move" onMouseDown={startDrag}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-[var(--color-gray-400)]">{t('editor.smartLayout.previewAll')}</span>
                <span className="font-[600] text-[var(--color-gray-700)]">{t('editor.smartLayout.pagesCount', { count: layoutResult.totalPages })}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleShuffleAll}
                  disabled={executing}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-[500] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-lg hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M13.5 10h-9l-2 2.5M13.5 6h-9l-2-2.5"/>
                  </svg>
                  {t('editor.smartLayout.shuffleAll')}
                </button>
                <button
                  onClick={handleShufflePageClick}
                  disabled={executing}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-[500] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-lg hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M13 10H4l-2 2.5M13 6H4l-2-2.5"/>
                  </svg>
                  {t('editor.smartLayout.shuffleOne')}
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
                <span className="text-[11px] text-[var(--color-gray-400)]">{t('editor.smartLayout.thumbnail')}</span>
                <div className="flex items-center gap-2 bg-[var(--color-gray-50)] rounded-lg px-3 py-1.5 border border-[var(--color-border)]">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-[var(--color-gray-400)]">
                    <rect x="2" y="2" width="4" height="4" rx="1"/><rect x="10" y="2" width="4" height="4" rx="1"/>
                    <rect x="2" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/>
                  </svg>
                  <input
                    type="range"
                    min={120}
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
                </div>
                <button
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer border-none ml-2"
                  onClick={onClose}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4 text-[var(--color-gray-500)]">
                    <path d="M11 3L3 11"/><path d="M3 3l8 8"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 滚动预览 */}
            <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar" onClick={() => handleSelectPage(null)}>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbZoom}px, 1fr))` }}>
                {layoutResult.pages.map((gpPage, i) => {
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
                      pageW={pageW}
                      pageH={pageH}
                      pageRatio={pageRatio}
                      rowCount={rowCount}
                      hasSpan={hasSpan}
                      isSelected={isSelected}
                      previewMode={previewMode}
                      cardHeight={cardHeight}
                      onSelect={() => handleSelectPage(isSelected ? null : i)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-3 border-t border-[var(--color-border)] bg-white shrink-0">
              <button
                className="px-5 py-2 text-[13px] text-[var(--color-gray-600)] bg-white border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                onClick={onClose}
              >{t('editor.smartLayout.cancel')}</button>
              <button
                className="px-6 py-2 text-[13px] text-white bg-[var(--color-brand)] rounded-lg hover:opacity-90 transition-opacity cursor-pointer font-[500] shadow-sm"
                onClick={handleExecute} disabled={executing}
              >{executing ? t('editor.smartLayout.executing') : t('editor.smartLayout.confirm', { pages: layoutResult.totalPages })}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
