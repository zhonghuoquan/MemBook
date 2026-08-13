import type { AlbumPage, SlotLayout, PresetTextElement, PresetShapeElement, PageTextElement, ShapeElement } from '../../types';
import { DEFAULT_SLOT_CORNER_RADIUS, isGooglePhotosPage, findTemplateById } from '../../types';
import { pageLayoutService } from '../../services/pageLayoutService';
import { pageMarginService } from '../../services/pageMarginService';
import { dirtyMarginPageIds, pushSnapshot, getGlobalMaxZ } from './helpers';
import { findCoverTemplateById } from '../../types/cover-templates';
import { usePhotoStore } from '../photoStore';
import type { EditorSlice, PageSlice } from './types';

/**
 * 将模板的预设文字元素（百分比坐标）转换为页面的 textElements（mm 坐标）。
 * 占位符 {albumName}/{date} 在此处替换为实际值，用户可在画布上继续编辑。
 */
function presetTextToPageElements(
  presets: PresetTextElement[] | undefined,
  pageMm: { width: number; height: number },
  albumName: string,
  dateRange: string | undefined,
): PageTextElement[] {
  if (!presets || presets.length === 0) return [];
  const scaleX = (v: number) => (v / 100) * pageMm.width;
  const scaleY = (v: number) => (v / 100) * pageMm.height;
  return presets.map((p) => {
    let text = p.text;
    if (p.placeholder === 'albumName') text = albumName || text;
    else if (p.placeholder === 'date') text = dateRange || text;
    return {
      id: `cover-text-${p.id}-${Date.now().toString(36)}`,
      x: scaleX(p.x), y: scaleY(p.y),
      width: scaleX(p.width), height: scaleY(p.height),
      text,
      fontSize: p.fontSize,
      fontFamily: p.fontFamily,
      color: p.color,
      align: p.align,
      bold: p.bold,
      italic: p.italic,
      rotation: p.rotation,
      zIndex: 100,
    };
  });
}

/**
 * 将模板的预设形状元素（百分比坐标）转换为页面的 shapeElements（mm 坐标）。
 * 坐标基于元素中心点（与现有 ShapeElement 一致）。
 */
function presetShapeToPageElements(
  presets: PresetShapeElement[] | undefined,
  pageMm: { width: number; height: number },
): ShapeElement[] {
  if (!presets || presets.length === 0) return [];
  const scaleX = (v: number) => (v / 100) * pageMm.width;
  const scaleY = (v: number) => (v / 100) * pageMm.height;
  return presets.map((p) => ({
    id: `cover-shape-${p.id}-${Date.now().toString(36)}`,
    x: scaleX(p.x) + scaleX(p.width) / 2,  // 中心点
    y: scaleY(p.y) + scaleY(p.height) / 2,
    width: scaleX(p.width),
    height: scaleY(p.height),
    type: p.type,
    fill: p.fill,
    stroke: p.stroke,
    strokeWidth: p.strokeWidth,
    opacity: p.opacity,
    rotation: p.rotation,
    zIndex: 50,
  }));
}

/** 从相册照片中提取日期年份区间（如 2023-2024） */
function deriveDateRange(photos: { date?: string }[]): string | undefined {
  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => !Number.isNaN(y));
  if (years.length === 0) return undefined;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

/* ── 页面增删改查 slice ── */
export const createPageSlice: EditorSlice<PageSlice> = (set, get) => ({
  pages: [],
  currentPageIndex: 0,

  setCurrentPage: (index) => {
    // 懒计算：目标页被标记脏 → 翻页时重算 margin 并重新约束照片位置
    if (dirtyMarginPageIds.has(index)) {
      dirtyMarginPageIds.delete(index);
      const result = pageMarginService.calcMarginForPage(index, get().pages);
      if (result) {
        set((s) => {
          const np = [...s.pages];
          if (np[index]) {
            np[index] = result.newPage;
          }
          return { currentPageIndex: index, pages: np };
        });
        // 懒计算修改了 pages 数据，需记录历史快照
        pushSnapshot(get);
        return;
      }
    }
    set({ currentPageIndex: index });
  },
  addPage: (templateId) => {
    set((s) => {
      const tplId = templateId || 'pin-shape';
      const template = findTemplateById(tplId);
      const placements = template ? template.slots.map((slot) => ({ slotId: slot.id, photoId: null })) : [];
      // 新页面继承当前页的圆角设置；若当前无页面（新相册空状态）则使用创建时保存的默认圆角
      const srcPage = s.pages[s.currentPageIndex];
      const cr = srcPage?.slotCornerRadius ?? s.defaultSlotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
      return {
        pages: [
          ...s.pages,
          { id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, templateId: tplId, placements, background: '#FFFFFF', slotCornerRadius: cr },
        ],
      };
    });
    // 对新页面应用边距
    const newIdx = get().pages.length - 1;
    const marginResult = pageMarginService.calcMarginForPage(newIdx, get().pages);
    if (marginResult) {
      set((s) => {
        const np = [...s.pages];
        if (np[newIdx]) np[newIdx] = marginResult.newPage;
        return { pages: np };
      });
    }
    pushSnapshot(get);
  },
  insertPage: (index, templateId) => {
    set((s) => {
      const tplId = templateId || 'pin-shape';
      const template = findTemplateById(tplId);
      const placements = template ? template.slots.map((slot) => ({ slotId: slot.id, photoId: null })) : [];
      // 新页面继承当前页的圆角设置
      const srcPage = s.pages[s.currentPageIndex];
      const cr = srcPage?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
      const newPages = [...s.pages];
      newPages.splice(index, 0, {
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, templateId: tplId, placements, background: '#FFFFFF', slotCornerRadius: cr,
      });
      return { pages: newPages };
    });
    // 对新页面应用边距
    const marginResult = pageMarginService.calcMarginForPage(index, get().pages);
    if (marginResult) {
      set((s) => {
        const np = [...s.pages];
        if (np[index]) np[index] = marginResult.newPage;
        return { pages: np };
      });
    }
    pushSnapshot(get);
  },
  copyPage: (index) => {
    set((s) => {
      if (!s.pages[index]) return s;
      const source = s.pages[index];
      const newPage: AlbumPage = {
        ...JSON.parse(JSON.stringify(source)),
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const newPages = [...s.pages];
      newPages.splice(index + 1, 0, newPage);
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  removePage: (index) => {
    set((s) => ({
      pages: s.pages.filter((_, i) => i !== index),
      currentPageIndex:
        s.currentPageIndex >= s.pages.length - 1
          ? Math.max(0, s.pages.length - 2)
          : s.currentPageIndex,
    }));
    pushSnapshot(get);
  },
  reorderPages: (from, to) => {
    set((s) => {
      const newPages = [...s.pages];
      const [moved] = newPages.splice(from, 1);
      newPages.splice(to, 0, moved);
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  setPages: (pages) => set({ pages }),
  appendPages: (afterIndex, newPages) => {
    const { pages } = get();
    const before = pages.slice(0, afterIndex);
    const after = pages.slice(afterIndex);
    set({ pages: [...before, ...newPages, ...after], currentPageIndex: afterIndex });
    pushSnapshot(get);
  },
  setPageTemplate: (pageIndex, templateId, preservePhotoIds) => {
    const sourcePage = get().pages[pageIndex];
    const isTargetGP = isGooglePhotosPage({ templateId });
    const isSourceGP = sourcePage ? isGooglePhotosPage(sourcePage) : false;

    // ── 普通 → GP：复用 convertPageToGooglePhotos 的生成逻辑（智能排版字段 + 迁移编辑数据）──
    // 该函数内部已处理 toast 和 pushSnapshot（已通过 service 下沉跨域依赖）
    if (isTargetGP && !isSourceGP) {
      pageLayoutService.convertPageToGooglePhotos(pageIndex);
      return;
    }

    // ── GP → GP：原逻辑（理论上不应触发，但保留兜底）──
    // ── GP → 普通 / 普通 → 普通：原逻辑 + GP 字段清理 ──
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const template = findTemplateById(templateId);
      if (!template) return s;

      const currentPage = newPages[pageIndex];

      // 获取已有照片的有序 ID 列表（已填充的非空槽位）
      const currentFilled = currentPage.placements
        .filter((p) => p.photoId !== null)
        .map((p) => p.photoId as string);

      // 当调用方指定了保留照片列表时使用它，否则使用当前已填充的照片
      const photoIds = preservePhotoIds ?? currentFilled;

      // 构建 photoId → oldPlacement 查找表（保留编辑数据）
      const oldPlacementMap = new Map(
        currentPage.placements
          .filter((p) => p.photoId !== null)
          .map((p) => [p.photoId as string, p])
      );

      // 智能迁移：按序填充新模板的槽位
      const newPlacements = template.slots.map((slot, i) => {
        const photoId = i < photoIds.length ? photoIds[i] : null;
        const old = photoId ? oldPlacementMap.get(photoId) : undefined;
        return {
          slotId: slot.id,
          photoId: photoId ?? null,
          ...(old
            ? {
                crop: old.crop,
                rotation: old.rotation,
                flipH: old.flipH,
                flipV: old.flipV,
                adjustments: old.adjustments,
                filter: old.filter,
              }
            : {}),
        };
      });

      // ── GP → 普通：清理 GP 特有字段，避免切回 GP 时用过期的 layout 数据 ──
      const gpCleanup = isSourceGP && !isTargetGP ? {
        googlePhotosMmLayout: undefined,
        googlePhotosBaseMmLayout: undefined,
        googlePhotosMmConfig: undefined,
        googlePhotosInternalRows: undefined,
        googlePhotosLayoutRows: undefined,
        googlePhotosBaseLayoutRows: undefined,
        googlePhotosBasePageSize: undefined,
        perPageBiasX: 0,
        perPageBiasY: 0,
        perPageRotation: 0 as 0 | 90 | 180 | 270,
        perPageRhythm: undefined,
      } : null;

      newPages[pageIndex] = {
        ...currentPage,
        templateId,
        placements: newPlacements,
        slotOverrides: undefined,
        ...(gpCleanup || {}),
      };
      return { pages: newPages };
    });
    // 应用当前边距到新模板，并重新约束照片位置防止露白
    const marginResult = pageMarginService.calcMarginForPage(pageIndex, get().pages);
    if (marginResult) {
      set((s) => {
        const np = [...s.pages];
        if (np[pageIndex]) {
          np[pageIndex] = marginResult.newPage;
        }
        return { pages: np };
      });
    }
    pushSnapshot(get);
  },
  updatePageBackground: (index, color) => {
    set((s) => {
      const newPages = [...s.pages];
      if (newPages[index]) {
        newPages[index] = { ...newPages[index], background: color };
      }
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  applyBackgroundToAllPages: (color) => {
    set((s) => {
      const newPages = s.pages.map((p) => ({ ...p, background: color }));
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  /** 重置当前页所有照片位到当前边距的布局 */
  resetPageLayout: (pageIndex) => {
    const marginResult = pageMarginService.calcMarginForPage(pageIndex, get().pages);
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = marginResult?.newPage ?? newPages[pageIndex];
      return { pages: newPages, selectedSlotId: null };
    });
    pushSnapshot(get);
  },
  /** 在当前页添加一个照片槽位（默认居中，30%×30%，百分比坐标） */
  addPhotoSlot: () => {
    set((s) => {
      const page = s.pages[s.currentPageIndex];
      if (!page) return s;
      // 使用时间戳 + 随机后缀生成唯一 slotId，避免快速连点时 Date.now() 碰撞
      // （resolveTemplate 用 slotId 去重，碰撞会导致第二个槽位被过滤掉）
      const slotId = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 默认位置：页面中央，大小 30%×30%（百分比坐标，与模板槽位一致）
      const newSlot: SlotLayout = { id: slotId, x: 35, y: 35, width: 30, height: 30 };
      const extraSlots = [...(page.extraSlots ?? []), newSlot];
      const placements = [...page.placements, { slotId, photoId: null as string | null }];
      // 将新槽位追加到渲染顺序末尾（后渲染 = 显示在上层）
      const slotOrder = [...(page.slotOrder ?? []), slotId];
      // 显式设置 zIndex 为全局最大值 +1，确保新槽位在所有装饰元素（贴纸/便利贴/文字/笔触）之上
      // 否则 slotZIndices[id] 为 undefined，fallback 默认值 0，可能被装饰元素遮挡
      const maxZ = getGlobalMaxZ(page);
      const slotZIndices = { ...(page.slotZIndices || {}), [slotId]: maxZ + 1 };
      const newPages = [...s.pages];
      newPages[s.currentPageIndex] = { ...page, extraSlots, placements, slotOrder, slotZIndices };
      return { pages: newPages, selectedSlotId: slotId, multiSelectedSlots: [] };
    });
    pushSnapshot(get);
  },

  /**
   * 应用封面模板：插入封面页或切换已有封面的模板。
   * - 当前无封面：创建新封面页插入首部，照片从相册池按序填入槽位
   * - 当前已有封面：切换模板，保留已填照片（按序迁移到新槽位），重新落位预设文字/形状
   */
  applyCoverTemplate: (templateId) => {
    const template = findCoverTemplateById(templateId);
    if (!template) return;
    const size = get().albumSize;
    const pageMm = { width: size?.width ?? 210, height: size?.height ?? 280 };
    const albumName = get().projectName || '我的相册';
    const photos = usePhotoStore.getState().photos;
    const dateRange = deriveDateRange(photos);

    // 预设元素落位（百分比→mm）
    const textElements = presetTextToPageElements(template.presetTextElements, pageMm, albumName, dateRange);
    const shapeElements = presetShapeToPageElements(template.presetShapeElements, pageMm);

    // 照片槽位 placements：从相册照片按序填入
    const photoIds = photos.slice(0, template.slots.length).map((p) => p.id);
    const placements = template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
    }));

    const newPage: AlbumPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      templateId,
      pageKind: 'cover',
      placements,
      background: template.presetBackground ?? '#FFFFFF',
      slotCornerRadius: 4,
      textElements,
      shapeElements,
    };

    set((s) => {
      const hasCover = s.pages.some((p) => p.pageKind === 'cover');
      const newPages = [...s.pages];
      let coverIdx: number;
      if (hasCover) {
        // 切换封面模板：保留当前已填照片（按序迁移到新槽位）
        const oldCover = newPages.find((p) => p.pageKind === 'cover')!;
        const oldPhotoIds = oldCover.placements
          .filter((pl) => pl.photoId)
          .map((pl) => pl.photoId!) as string[];
        // 用旧照片填新槽位（不足则留空）
        newPage.placements = template.slots.map((slot, i) => ({
          slotId: slot.id,
          photoId: oldPhotoIds[i] ?? null,
        }));
        coverIdx = newPages.findIndex((p) => p.pageKind === 'cover');
        newPages[coverIdx] = newPage;
      } else {
        newPages.unshift(newPage);
        coverIdx = 0;
      }
      return { pages: newPages, currentPageIndex: coverIdx };
    });

    // 应用边距约束
    const idx = get().pages.findIndex((p) => p.pageKind === 'cover');
    const marginResult = pageMarginService.calcMarginForPage(idx, get().pages);
    if (marginResult) {
      set((s) => {
        const np = [...s.pages];
        if (np[idx]) np[idx] = marginResult.newPage;
        return { pages: np };
      });
    }
    pushSnapshot(get);
  },

  /**
   * 应用封底模板：插入封底页或切换已有封底的模板。
   * 逻辑同 applyCoverTemplate，pageKind='backCover'，插入到尾部。
   */
  applyBackCoverTemplate: (templateId) => {
    const template = findCoverTemplateById(templateId);
    if (!template) return;
    const size = get().albumSize;
    const pageMm = { width: size?.width ?? 210, height: size?.height ?? 280 };
    const albumName = get().projectName || '我的相册';
    const photos = usePhotoStore.getState().photos;
    const dateRange = deriveDateRange(photos);

    const textElements = presetTextToPageElements(template.presetTextElements, pageMm, albumName, dateRange);
    const shapeElements = presetShapeToPageElements(template.presetShapeElements, pageMm);

    // 封底通常无照片槽位或单小图
    const photoIds = photos.slice(0, template.slots.length).map((p) => p.id);
    const placements = template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
    }));

    const newPage: AlbumPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      templateId,
      pageKind: 'backCover',
      placements,
      background: template.presetBackground ?? '#FFFFFF',
      slotCornerRadius: 4,
      textElements,
      shapeElements,
    };

    set((s) => {
      const hasBack = s.pages.some((p) => p.pageKind === 'backCover');
      const newPages = [...s.pages];
      if (hasBack) {
        // 切换封底模板
        const oldBack = newPages.find((p) => p.pageKind === 'backCover')!;
        const oldPhotoIds = oldBack.placements
          .filter((pl) => pl.photoId)
          .map((pl) => pl.photoId!) as string[];
        newPage.placements = template.slots.map((slot, i) => ({
          slotId: slot.id,
          photoId: oldPhotoIds[i] ?? null,
        }));
        const idx = newPages.findIndex((p) => p.pageKind === 'backCover');
        newPages[idx] = newPage;
      } else {
        newPages.push(newPage);
      }
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
});
