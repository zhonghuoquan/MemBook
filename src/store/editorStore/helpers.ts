import type {
  AlbumPage, Photo, PhotoPlacement, AlbumSize, SlotOverride, SlotLayout,
  BrushStroke, StickyNote, PageTextElement, StickerElement, ShapeElement,
} from '../../types';
import { resolveTemplate, isGooglePhotosPage } from '../../types';
import { refitPage, refitPageWithRotation } from '../../engine/google-photos-layout';
import type { TierPattern } from '../../engine/google-photos-layout';
import { calcCoverFitWithRotation, computePanForResizedSlot, clampPhotoToSlotBounds } from '../../utils/photoGeometry';
import { useHistoryStore } from '../historyStore';
import type { EditorState } from './types';

const DEFAULT_MM_W = 210;
const DEFAULT_MM_H = 280;
const MM_TO_PX = 2;

/* ── 全局 zIndex 工具（跨 slice 共享，原位于 decorationsSlice） ── */
type LayeredPage = {
  brushStrokes?: BrushStroke[];
  stickyNotes?: StickyNote[];
  textElements?: PageTextElement[];
  stickerElements?: StickerElement[];
  shapeElements?: ShapeElement[];
  slotZIndices?: Record<string, number>;
};

/** 收集页面内所有参与层级排序的装饰元素（画笔/便利贴/文字/贴纸/形状） */
function collectAllElements(page: LayeredPage) {
  return [
    ...(page.brushStrokes || []),
    ...(page.stickyNotes || []),
    ...(page.textElements || []),
    ...(page.stickerElements || []),
    ...(page.shapeElements || []),
  ];
}

/** 计算页面内全局最大 zIndex（装饰元素 + 槽位，槽位 zIndex 存于 slotZIndices） */
export function getGlobalMaxZ(page: LayeredPage): number {
  const decoMax = collectAllElements(page).reduce((m, el) => Math.max(m, el.zIndex || 0), 0);
  const slotMax = page.slotZIndices ? Object.values(page.slotZIndices).reduce((m, z) => Math.max(m, z), 0) : 0;
  return Math.max(decoMax, slotMax);
}

/** 计算页面内全局最小 zIndex（装饰元素 + 槽位） */
export function getGlobalMinZ(page: LayeredPage): number {
  const decoMin = collectAllElements(page).reduce((m, el) => Math.min(m, el.zIndex || 0), 0);
  const slotMin = page.slotZIndices ? Object.values(page.slotZIndices).reduce((m, z) => Math.min(m, z), 0) : 0;
  return Math.min(decoMin, slotMin);
}

/** 计算槽位像素尺寸（支持 slotOverride 与模板百分比） */
export function calcSlotPixelSize(slot: SlotLayout, slotOverrides: Record<string, SlotOverride> | undefined, canvasW: number, canvasH: number) {
  const ov = slotOverrides?.[slot.id];
  return ov
    ? { width: ov.width, height: ov.height }
    : { width: (slot.width / 100) * canvasW, height: (slot.height / 100) * canvasH };
}

/** 重新约束页面内所有照片的 panX/panY，防止布局/模板变化后露白 */
export function reclampPagePlacements(
  page: AlbumPage,
  albumSize: AlbumSize | null,
  photos: Photo[],
): PhotoPlacement[] {
  const canvasW = (albumSize?.width ?? DEFAULT_MM_W) * MM_TO_PX;
  const canvasH = (albumSize?.height ?? DEFAULT_MM_H) * MM_TO_PX;
  const template = resolveTemplate(page);
  if (!template) return page.placements;
  const photoMap = new Map(photos.map((p) => [p.id, p]));

  return page.placements.map((pl) => {
    if (!pl.photoId) return pl;
    const photo = photoMap.get(pl.photoId);
    if (!photo || photo.width <= 0 || photo.height <= 0) return pl;
    const slot = template.slots.find((s) => s.id === pl.slotId);
    if (!slot) return pl;

    const { width: slotW, height: slotH } = calcSlotPixelSize(slot, page.slotOverrides, canvasW, canvasH);
    const totalRot = pl.panRotation ?? (pl.rotation || 0);
    const ps = Math.max(pl.panScale || 1, 1);
    const cf = calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, totalRot);
    const oldPanX = pl.panX ?? (slotW - cf.boundingW * ps) / 2;
    const oldPanY = pl.panY ?? (slotH - cf.boundingH * ps) / 2;
    const clamped = clampPhotoToSlotBounds(photo.width, photo.height, slotW, slotH, totalRot, ps, oldPanX, oldPanY);
    return { ...pl, panX: clamped.panX, panY: clamped.panY };
  });
}

/* ── 编辑状态迁移：GP 页面重排/模板切换后，按 photoId 匹配旧 placement，保留编辑属性 ──
 * 保留 panScale，并使用 computePanForResizedSlot 按新旧槽位尺寸映射 panX/panY，最后通过多边形约束防止露白。
 * 返回一个工厂函数：传入 (photoId, newSlotId, newOv) → 新 placement */
export function makePlacementMigrator(
  oldPlacements: PhotoPlacement[],
  oldOverrides: Record<string, SlotOverride>,
  photoMap: Map<string, Photo>,
): (photoId: string, newSlotId: string, newOv: SlotOverride) => PhotoPlacement {
  return (photoId, newSlotId, newOv) => {
    const old = oldPlacements.find((p) => p.photoId === photoId);
    const base: PhotoPlacement = { slotId: newSlotId, photoId };
    if (!old) return base; // 新加入的照片，无历史编辑
    // 直接迁移非 pan 编辑属性
    base.crop = old.crop;
    base.rotation = old.rotation;
    base.flipH = old.flipH;
    base.flipV = old.flipV;
    base.adjustments = old.adjustments;
    base.filter = old.filter;
    base.filterIntensity = old.filterIntensity;
    base.panRotation = old.panRotation;
    base.panScale = old.panScale;

    // 无 pan 编辑时直接居中
    if (old.panX == null && old.panY == null && old.panScale == null) {
      base.panScale = undefined;
      return base;
    }

    const photo = photoMap.get(photoId);
    const oldOv = oldOverrides[old.slotId];
    if (!photo || !oldOv || photo.width <= 0 || photo.height <= 0) {
      base.panScale = undefined;
      return base;
    }

    const totalRot = old.panRotation ?? (old.rotation || 0);
    const ps = Math.max(old.panScale || 1, 1);
    const oldCF = calcCoverFitWithRotation(photo.width, photo.height, oldOv.width, oldOv.height, totalRot);
    const oldPanX = old.panX ?? (oldOv.width - oldCF.boundingW * ps) / 2;
    const oldPanY = old.panY ?? (oldOv.height - oldCF.boundingH * ps) / 2;

    const newPan = computePanForResizedSlot(
      photo.width, photo.height, oldOv.width, oldOv.height, newOv.width, newOv.height,
      totalRot, ps, oldPanX, oldPanY
    );
    base.panX = newPan.panX;
    base.panY = newPan.panY;
    return base;
  };
}

/* GP 页面用 googlePhotosLayout 重排后，统一构建新页数据（placements+overrides+mmLayout），按 photoId 迁移编辑状态 */
export function buildRegenPageData(
  gpPagePhotos: Array<{ photoId: string; x: number; y: number; width: number; height: number }>,
  migrator: (photoId: string, newSlotId: string, newOv: SlotOverride) => PhotoPlacement,
): { placements: PhotoPlacement[]; slotOverrides: Record<string, SlotOverride>; mmLayout: AlbumPage['googlePhotosMmLayout']; } {
  const MM = 2;
  const placements: PhotoPlacement[] = [];
  const slotOverrides: Record<string, SlotOverride> = {};
  const mmLayout: AlbumPage['googlePhotosMmLayout'] = [];
  gpPagePhotos.forEach((pr, pi) => {
    const newSlotId = `gp-${pi}`;
    const newOv: SlotOverride = {
      x: Math.round(pr.x * MM), y: Math.round(pr.y * MM),
      width: Math.round(pr.width * MM), height: Math.round(pr.height * MM),
    };
    placements.push(migrator(pr.photoId, newSlotId, newOv));
    slotOverrides[newSlotId] = newOv;
    mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
  });
  return { placements, slotOverrides, mmLayout };
}

/** 页面边距/间距变更后标记脏页，翻页时懒计算避免全量重算 */
export const dirtyMarginPageIds = new Set<number>();

/* ════════════════════════════════════════
   辅助：操作后自动记录历史快照
   ─────────────────────────────────────
   快照存储的是「改之后的状态」，这样撤销/重做栈的状态可以直接恢复。
   ════════════════════════════════════════ */
/** 连续型操作的快照合并窗口（ms）：同键且间隔小于该值时不再新增历史条目 */
const SNAPSHOT_MERGE_MS = 300;
let lastSnapshotKey: string | null = null;
let lastSnapshotAt = 0;

/**
 * 记录撤销快照。
 * @param mergeKey 连续型操作（如滑杆调色）传入稳定键：
 *   同键且间隔 < 300ms 时合并到首帧，撤销一步即可回到拖动前的状态，
 *   避免一次拖动产生几十条历史记录挤占 MAX_HISTORY。
 */
export function pushSnapshot(get: () => EditorState, mergeKey?: string) {
  const { pages, selectedSlotId } = get();
  if (pages.length === 0) return;
  const now = Date.now();
  if (mergeKey && mergeKey === lastSnapshotKey && now - lastSnapshotAt < SNAPSHOT_MERGE_MS) {
    lastSnapshotAt = now;
    return;
  }
  lastSnapshotKey = mergeKey ?? null;
  lastSnapshotAt = now;
  useHistoryStore.getState().pushSnapshot(pages, selectedSlotId);
}

/** 对单个页面的所有照片重新执行多边形约束，防止布局/模板/边距变化后露白 */
export function reclampPage(page: AlbumPage, get: () => EditorState, photos: Photo[]): AlbumPage {
  const { albumSize } = get();
  return { ...page, placements: reclampPagePlacements(page, albumSize, photos) };
}

/**
 * 检测模板槽位之间是否有真实重叠（面积 > 1% 容差，排除浮点误差/边线接触）。
 * 用于判断是否跳过 slotGap 调整：有重叠的模板（如 overlay 叠加留白）必须保留原始间距，
 * 无重叠的平铺模板（如 L型/杂志英雄，即使带 stagger/magazine 标签）应应用用户间距。
 */
function slotsHaveOverlap(slots: { x: number; y: number; width: number; height: number }[]): boolean {
  const TOL = 1; // 1% 容差：重叠区域宽高均 > 1% 才算真实重叠
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > TOL && overlapY > TOL) return true;
    }
  }
  return false;
}

/* 根据 pageMargin + slotGap 计算槽位在安全区内的 slotOverrides（像素值） */
export function calcMarginOverrides(pageIndex: number, get: () => EditorState, photos: Photo[]): Record<string, SlotOverride> | null {
  const { pages, albumSize, pageMargin: pm, slotGap } = get();
  const page = pages[pageIndex];
  if (!page || !albumSize) return null;

  // ── Google Photos 页面：用 refitPage 重排（边距/间距变更时正确反映到所有行间间距）──
  if (isGooglePhotosPage(page)) {
    if (!page.googlePhotosLayoutRows || !page.googlePhotosMmConfig) return null;
    const MM = 2;
    const pw = albumSize.width;
    const ph = albumSize.height;
    const newCW = pw - pm.left - pm.right;
    const newCH = ph - pm.top - pm.bottom;
    if (newCW <= 0 || newCH <= 0) return null;

    // 构建 photoId → Photo 映射
    const photoMap = new Map<string, Photo>();
    for (const p of photos) photoMap.set(p.id, p);

    const bx = page.perPageBiasX ?? 0;
    const by = page.perPageBiasY ?? 0;
    const rotation = page.perPageRotation ?? 0;
    const basePageSize = page.googlePhotosBasePageSize ?? { width: pw, height: ph };
    const baseCW = basePageSize.width - pm.left - pm.right;
    const baseCH = basePageSize.height - pm.top - pm.bottom;

    const pattern = (page.perPageTierPattern as TierPattern | undefined) ?? 'hero-first';
    const result = rotation !== 0
      ? refitPageWithRotation(
          page.googlePhotosLayoutRows,
          photoMap,
          baseCW, baseCH,
          pm.left, pm.top,
          slotGap,
          bx, by,
          rotation as 0 | 90 | 180 | 270,
          basePageSize.width, basePageSize.height,
          pw, ph,
          pm,
          pattern,
        )
      : refitPage(
          page.googlePhotosLayoutRows,
          photoMap,
          newCW, newCH,
          pm.left, pm.top,
          slotGap,
          bx, by,
          pattern,
        );

    // 重建 slotOverrides + mmLayout
    const overrides: Record<string, SlotOverride> = {};
    const mmLayout: Array<{ photoId: string; x: number; y: number; width: number; height: number }> = [];
    page.placements.forEach((pl, i) => {
      const pr = result.photos[i];
      if (!pr) return;
      overrides[pl.slotId] = {
        x: Math.round(pr.x * MM),
        y: Math.round(pr.y * MM),
        width: Math.round(pr.width * MM),
        height: Math.round(pr.height * MM),
      };
      mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
    });

    // 同步更新页面的 mmConfig + mmLayout，确保排版变化读取最新值
    page.googlePhotosMmConfig = { margin: { ...pm }, gap: slotGap };
    page.googlePhotosMmLayout = mmLayout;
    // 迁移照片编辑状态：用旋转感知的 cover-fit 计算包围盒，保持 panScale，
    // 通过 computePanForResizedSlot 把旧槽位的 panX/panY 映射到新槽位，最后多边形约束防露白。
    const oldOverrides = page.slotOverrides ?? {};
    const pMap = new Map<string, Photo>();
    for (const p of photos) pMap.set(p.id, p);
    page.placements = page.placements.map((pl) => {
      const photo = pMap.get(pl.photoId ?? '');
      const oldOv = oldOverrides[pl.slotId];
      const newOv = overrides[pl.slotId];
      if (!photo || !oldOv || !newOv || photo.width <= 0 || photo.height <= 0) return pl;

      // 无编辑记录：保持默认居中
      if (pl.panX == null && pl.panY == null && pl.panScale == null && pl.panRotation == null) return pl;

      const totalRot = pl.panRotation ?? (pl.rotation || 0);
      const ps = Math.max(pl.panScale || 1, 1);
      const oldCF = calcCoverFitWithRotation(photo.width, photo.height, oldOv.width, oldOv.height, totalRot);
      const oldPanX = pl.panX ?? (oldOv.width - oldCF.boundingW * ps) / 2;
      const oldPanY = pl.panY ?? (oldOv.height - oldCF.boundingH * ps) / 2;

      const newPan = computePanForResizedSlot(
        photo.width, photo.height, oldOv.width, oldOv.height, newOv.width, newOv.height,
        totalRot, ps, oldPanX, oldPanY
      );

      return {
        ...pl,
        panX: newPan.panX,
        panY: newPan.panY,
        panScale: ps,
      };
    });

    return overrides;
  }

  // ── 模板页面：原有逻辑 ──
  const template = resolveTemplate(page);
  if (!template) return null;

  const pw = albumSize.width;   // mm
  const ph = albumSize.height;  // mm
  const MM = 2;
  const CW = pw * MM;
  const CH = ph * MM;
  const sl = (pm.left / pw) * 100;
  const st = (pm.top / ph) * 100;
  const sw = 100 - sl - (pm.right / pw) * 100;
  const sh = 100 - st - (pm.bottom / ph) * 100;
  if (sw <= 0 || sh <= 0) return null;

  // 包围盒：模板槽位整体外边缘
  let minX = 100, minY = 100, maxX = 0, maxY = 0;
  for (const slot of template.slots) {
    if (slot.x < minX) minX = slot.x;
    if (slot.y < minY) minY = slot.y;
    if (slot.x + slot.width > maxX) maxX = slot.x + slot.width;
    if (slot.y + slot.height > maxY) maxY = slot.y + slot.height;
  }
  let bboxW = maxX - minX || 100;
  let bboxH = maxY - minY || 100;

  // 原始 bbox（slotGap 调整前）用于判断缩放策略和贴边检测
  // 避免slotGap 调整后 bbox 变小导致从独立轴缩放降级为等比缩放，照片位无法填满安全区
  const origBboxW = bboxW;
  const origBboxH = bboxH;
  const origMinX = minX, origMinY = minY, origMaxX = maxX, origMaxY = maxY;

  // slotGap → 检测所有槽位间边界，用统一间隙值替换模板中不一致的内建间距
  // 跳过条件改为基于实际重叠检测：只有照片位真实重叠的模板（如 overlay 叠加留白）才跳过，
  // 平铺无重叠的模板（如 L型/杂志英雄，即使带 stagger/magazine 标签）应应用用户间距。
  // 旧逻辑基于标签跳过导致 L型六图/杂志英雄六图等平铺模板间距不随用户设置变化。
  const isStagger = slotsHaveOverlap(template.slots);
  // 平铺模板（纯 grid 且无留白/胶片标签）：所有间距严格按用户设置调整，无阈值限制
  // 非平铺模板：仅调整小间距(<8%)，保留设计留白（如中心焦点的左右列间距24%）
  const isTiled = template.tags?.includes('grid')
    && !template.tags?.includes('white-space')
    && !template.tags?.includes('filmstrip');
  const gapThreshold = isTiled ? Infinity : 8;
  const slotGapX: number[] = [];
  const slotGapY: number[] = [];
  const colHAdj: number[] = new Array(template.slots.length).fill(0);
  const rowWAdj: number[] = new Array(template.slots.length).fill(0);
  if (template.slots.length > 1 && !isStagger) {
    const gapPctW = (slotGap / pw) * 100;
    const gapPctH = (slotGap / ph) * 100;

    // ── 水平方向：带 y-范围的边界 + 模板间距 ──
    interface GapInfo { pos: number; spacing: number; yLo: number; yHi: number; }
    const hGaps: GapInfo[] = [];
    const gapSetX = new Set<number>();
    for (const sa of template.slots) {
      for (const sb of template.slots) {
        if (sa === sb) continue;
        const aRight = Math.round((sa.x + sa.width) * 10) / 10;
        const bLeft  = Math.round(sb.x * 10) / 10;
        if (aRight <= bLeft) gapSetX.add(aRight);
      }
    }
    for (const gx of [...gapSetX].sort((a, b) => a - b)) {
      // 该 x-边界归属的槽位（右边缘 = gx），收集其 y-范围
      let yLo = 100, yHi = 0;
      for (const s of template.slots) {
        if (Math.round((s.x + s.width) * 10) / 10 === gx) {
          if (s.y < yLo) yLo = s.y;
          if (s.y + s.height > yHi) yHi = s.y + s.height;
        }
      }
      // 模板在此边界的现有间距
      let minDist = Infinity;
      for (const s of template.slots) {
        const sl = Math.round(s.x * 10) / 10;
        if (sl > gx) minDist = Math.min(minDist, sl - gx);
      }
      hGaps.push({ pos: gx, spacing: minDist === Infinity ? 0 : minDist, yLo, yHi });
    }

    // ── 垂直方向：带 x-范围的边界 + 模板间距 ──
    const vGaps: GapInfo[] = [];
    const gapSetY = new Set<number>();
    for (const sa of template.slots) {
      for (const sb of template.slots) {
        if (sa === sb) continue;
        const aBottom = Math.round((sa.y + sa.height) * 10) / 10;
        const bTop    = Math.round(sb.y * 10) / 10;
        if (aBottom <= bTop) gapSetY.add(aBottom);
      }
    }
    for (const gy of [...gapSetY].sort((a, b) => a - b)) {
      // 该 y-边界归属的槽位（底边缘 = gy），收集其 x-范围
      let xLo = 100, xHi = 0;
      for (const s of template.slots) {
        if (Math.round((s.y + s.height) * 10) / 10 === gy) {
          if (s.x < xLo) xLo = s.x;
          if (s.x + s.width > xHi) xHi = s.x + s.width;
        }
      }
      let minDist = Infinity;
      for (const s of template.slots) {
        const st = Math.round(s.y * 10) / 10;
        if (st > gy) minDist = Math.min(minDist, st - gy);
      }
      vGaps.push({ pos: gy, spacing: minDist === Infinity ? 0 : minDist, yLo: xLo, yHi: xHi });
    }

    // 每个槽位的偏移 = 用用户间隙替换模板间隙
    // 规则1：间隙在槽位中心的方向侧 → 偏移（中心判定）
    // 规则2：间隙位于槽位内部（跨度覆盖间隙）→ 不偏移
    // 规则3：正交范围必须重叠 → 才偏移
    for (const s of template.slots) {
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      let xShift = 0, yShift = 0;
      for (const g of hGaps) {
        // 平铺模板：所有间距都调整；非平铺模板：仅调整小间距(<8%)，大间距是设计留白不调整
        if (g.pos < cx && !(g.pos > s.x && g.pos < s.x + s.width) && g.spacing < gapThreshold) {
          const sTop = s.y, sBot = s.y + s.height;
          if (sTop < g.yHi && sBot > g.yLo) xShift += gapPctW - g.spacing;
        }
      }
      for (const g of vGaps) {
        if (g.pos < cy && !(g.pos > s.y && g.pos < s.y + s.height) && g.spacing < gapThreshold) {
          const sLef = s.x, sRig = s.x + s.width;
          if (sLef < g.yHi && sRig > g.yLo) yShift += gapPctH - g.spacing;
        }
      }
      slotGapX.push(xShift);
      slotGapY.push(yShift);
    }
    // 列底部对齐 + 行右边界对齐（仅对贴边的列/行补足）
    // 瀑布流/砖石模板跳过对齐，保留原始错落比例
    if (!template.tags?.includes('masonry') && !template.tags?.includes('waterfall')) {
      // 列分组（按 x 坐标）
      const xCols = new Map<number, number[]>();
      for (let i = 0; i < template.slots.length; i++) {
        const k = Math.round(template.slots[i].x * 10) / 10;
        if (!xCols.has(k)) xCols.set(k, []);
        xCols.get(k)!.push(i);
      }
      let globalMaxBottom = 0;
      for (const indices of xCols.values()) {
        for (const i of indices) {
          const b = template.slots[i].y + slotGapY[i] + template.slots[i].height;
          if (b > globalMaxBottom) globalMaxBottom = b;
        }
      }
      const vThresh = globalMaxBottom - 5; // 仅对齐距底边≤5%的槽位，避免拉伸有留白的槽位
      for (const indices of xCols.values()) {
        let lastIdx = indices[0];
        let lastB = template.slots[lastIdx].y + slotGapY[lastIdx] + template.slots[lastIdx].height;
        for (const i of indices) {
          const b = template.slots[i].y + slotGapY[i] + template.slots[i].height;
          if (b > lastB) { lastB = b; lastIdx = i; }
        }
        if (lastB < globalMaxBottom && lastB >= vThresh) colHAdj[lastIdx] = globalMaxBottom - lastB;
      }
      // 行分组（按 y 坐标）→ 全局最右边界对齐
      const yRows = new Map<number, number[]>();
      for (let i = 0; i < template.slots.length; i++) {
        const k = Math.round(template.slots[i].y * 10) / 10;
        if (!yRows.has(k)) yRows.set(k, []);
        yRows.get(k)!.push(i);
      }
      let globalMaxRight = 0;
      for (const indices of yRows.values()) {
        for (const i of indices) {
          const r = template.slots[i].x + slotGapX[i] + template.slots[i].width;
          if (r > globalMaxRight) globalMaxRight = r;
        }
      }
      const hThresh = globalMaxRight - 5; // 仅对齐距右边≤5%的槽位，避免拉伸有留白的槽位
      for (const indices of yRows.values()) {
        let lastIdx = indices[0];
        let lastR = template.slots[lastIdx].x + slotGapX[lastIdx] + template.slots[lastIdx].width;
        for (const i of indices) {
          const r = template.slots[i].x + slotGapX[i] + template.slots[i].width;
          if (r > lastR) { lastR = r; lastIdx = i; }
        }
        if (lastR < globalMaxRight && lastR >= hThresh) rowWAdj[lastIdx] = globalMaxRight - lastR;
      }
    }
    // 用偏移后位置重新计算包围盒（含列高/行宽补足）
    bboxW = 0; bboxH = 0;
    minX = 100; minY = 100; maxX = 0; maxY = 0;
    for (let i = 0; i < template.slots.length; i++) {
      const s = template.slots[i];
      const ax = s.x + slotGapX[i];
      const ay = s.y + slotGapY[i];
      const aw = s.width + rowWAdj[i];
      const ah = s.height + colHAdj[i];
      if (ax < minX) minX = ax;
      if (ay < minY) minY = ay;
      if (ax + aw > maxX) maxX = ax + aw;
      if (ay + ah > maxY) maxY = ay + ah;
    }
    bboxW = maxX - minX || 100;
    bboxH = maxY - minY || 100;

    // 注意：不归一化 bbox。归一化会按比例缩小所有槽位尺寸（包括跨行大图），
    // 导致大图高度不足。改为在最终输出时对贴边槽位强制贴边+尺寸填满。
  } else {
    for (let i = 0; i < template.slots.length; i++) { slotGapX.push(0); slotGapY.push(0); }
  }

  // 缩放策略：
  // - 页面铺开型（原始 bbox 宽高均 ≥85% 且无重叠）：独立轴缩放填满安全区，避免非方形页面上下出现未使用空白
  // - 留白型/特殊比例型/有重叠型：等比缩放（取 sx/sy 较小者）保持模板原始比例，居中对齐
  // 使用原始 bbox（slotGap 调整前）判断，避免调整后 bbox 变小降级为等比缩放导致照片位无法填满安全区
  const sx = sw / bboxW;
  const sy = sh / bboxH;
  const isPageSpread = origBboxW >= 85 && origBboxH >= 85 && !isStagger;
  const scaleX = isPageSpread ? sx : Math.min(sx, sy);
  const scaleY = isPageSpread ? sy : Math.min(sx, sy);

  // 等比缩放后包围盒可能小于安全区，居中对齐避免偏靠一侧（页面铺开型无偏移）
  const ox = (sw - bboxW * scaleX) / 2;
  const oy = (sh - bboxH * scaleY) / 2;

  // 输出像素坐标（页面铺开型使用独立轴缩放，其他使用等比缩放）
  const overrides: Record<string, SlotOverride> = {};
  for (let i = 0; i < template.slots.length; i++) {
    const slot = template.slots[i];
    const gx = slotGapX[i];
    const gy = slotGapY[i];
    const nx = sl + ox + (slot.x + gx - minX) * scaleX;
    const ny = st + oy + (slot.y + gy - minY) * scaleY;
    const nw = (slot.width + rowWAdj[i]) * scaleX;
    const nh = (slot.height + colHAdj[i]) * scaleY;
    overrides[slot.id] = {
      x: Math.round((nx / 100) * CW),
      y: Math.round((ny / 100) * CH),
      width: Math.round((nw / 100) * CW),
      height: Math.round((nh / 100) * CH),
    };
  }

  // 后处理：贴边槽位强制贴安全区边界 + 尺寸填满
  // 解决 slotGap 调整后 bbox 膨胀导致缩放因子变小、贴边槽位被压缩不贴边的问题。
  // 判断依据：槽位在原始模板中是否贴住 bbox 边缘（1.5% 容差）。
  // 贴两对边（如跨行大图贴上+贴下）→ 尺寸填满安全区，彻底解决压缩问题。
  // 贴单边 → 仅平移贴边，尺寸不变。
  // isPageSpread 用强制贴边（无容差限制），非 isPageSpread 用 8px 小容差 snap。
  const EDGE_TOL = 1.5; // 1.5% 容差判断原始贴边
  const leftEdgePx = Math.round((pm.left / pw) * CW);
  const rightEdgePx = CW - Math.round((pm.right / pw) * CW);
  const topEdgePx = Math.round((pm.top / ph) * CH);
  const bottomEdgePx = CH - Math.round((pm.bottom / ph) * CH);
  for (const slot of template.slots) {
    const o = overrides[slot.id];
    if (!o) continue;
    if (isPageSpread) {
      // 原始贴边判断（基于原始 bbox 边缘，非 0/100 边界）
      const stickLeft = Math.abs(slot.x - origMinX) < EDGE_TOL;
      const stickRight = Math.abs(slot.x + slot.width - origMaxX) < EDGE_TOL;
      const stickTop = Math.abs(slot.y - origMinY) < EDGE_TOL;
      const stickBottom = Math.abs(slot.y + slot.height - origMaxY) < EDGE_TOL;
      // 水平：贴左+贴右 → 宽度填满；只贴一边 → 仅平移
      if (stickLeft && stickRight) {
        o.x = leftEdgePx;
        o.width = rightEdgePx - leftEdgePx;
      } else if (stickLeft) {
        o.x = leftEdgePx;
      } else if (stickRight) {
        o.x = rightEdgePx - o.width;
      }
      // 垂直：贴上+贴下 → 高度填满；只贴一边 → 仅平移
      if (stickTop && stickBottom) {
        o.y = topEdgePx;
        o.height = bottomEdgePx - topEdgePx;
      } else if (stickTop) {
        o.y = topEdgePx;
      } else if (stickBottom) {
        o.y = bottomEdgePx - o.height;
      }
    } else {
      // 非铺开型：8px 容差 snap，避免误吸附留白型模板的设计留白
      const snapPx = 8;
      if (o.x >= leftEdgePx - snapPx && o.x <= leftEdgePx + snapPx) o.x = leftEdgePx;
      const oRight = o.x + o.width;
      if (oRight >= rightEdgePx - snapPx && oRight <= rightEdgePx + snapPx) o.x = rightEdgePx - o.width;
      if (o.y >= topEdgePx - snapPx && o.y <= topEdgePx + snapPx) o.y = topEdgePx;
      const oBottom = o.y + o.height;
      if (oBottom >= bottomEdgePx - snapPx && oBottom <= bottomEdgePx + snapPx) o.y = bottomEdgePx - o.height;
    }
  }

  return overrides;
}

export { DEFAULT_MM_W, DEFAULT_MM_H, MM_TO_PX };
