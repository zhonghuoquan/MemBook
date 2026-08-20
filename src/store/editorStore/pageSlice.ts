import type { AlbumPage, SlotLayout, PresetTextElement, PresetShapeElement, PageTextElement, ShapeElement, BackgroundApply } from '../../types';
import { DEFAULT_SLOT_CORNER_RADIUS, isGooglePhotosPage, findTemplateById, isCoverPage, isBackCoverPage, isCoverOrBackCoverPage } from '../../types';
import { pageLayoutService } from '../../services/pageLayoutService';
import { pageMarginService, calcCoverOverrides } from '../../services/pageMarginService';
import { dirtyMarginPageIds, pushSnapshot, getGlobalMaxZ, makePlacementMigrator } from './helpers';
import { findCoverTemplateById } from '../../types/cover-templates';
import { DEFAULT_SPINE_WIDTH_MM } from '../../components/editor/canvas/constants';
import { fitTextSize } from '../../components/editor/canvas/TextDomNode';
import { coverElementSize, coverAnchorPosition, isMaskShape } from '../../utils/coverScale';
import { createDefaultCoverPhotos } from '../../utils/coverPresetPhoto';
import { SPINE_DATE_BOTTOM_MM } from '../../utils/sharedRender';
import { usePhotoStore } from '../photoStore';
import type { EditorSlice, PageSlice } from './types';

/** 封面模板文字字体基准尺寸（mm）：模板 fontSize 按默认竖版相册 210×280 设计。
 * 适配其他尺寸（方形/横版/迷你/冲印）时，综合宽高比取最小值缩放（clamp [0.5,1.6]），
 * 保证文字在任一维度都不溢出、比例协调——仅按宽度缩放会在横版/方形页面上字幕过大。 */
const REFERENCE_COVER_WIDTH_MM = 210;
const REFERENCE_COVER_HEIGHT_MM = 280;

/** 封面/封底元素适配字号缩放：取宽高比较小者，避免某一维度溢出；clamp 防止过小不可读/过大溢出 */
function coverFontScale(pageMm: { width: number; height: number }): number {
  const s = Math.min(pageMm.width / REFERENCE_COVER_WIDTH_MM, pageMm.height / REFERENCE_COVER_HEIGHT_MM);
  return Math.max(0.5, Math.min(1.6, s));
}

/** 封面/封底模板图层 zIndex 层级（统一语义，避免魔法数字导致图层错乱）：
 * 装饰形状(30) < 槽位照片(60) < 渐变蒙版(70) < 书脊元素(100) < 模板文字(100) < 用户后加元素(动态 getGlobalMaxZ)
 * - 装饰形状（圆点/叶片/太阳/彩球等）置于照片之下，避免遮挡照片主视觉；
 * - 槽位照片置顶于装饰形状之上，保证照片完整显示不被形状遮挡；
 * - 渐变蒙版(mask)仍置于照片之上做压暗，保证其上文字清晰可读；
 * - 书脊与封面文字分处不同区域、同层不重叠。 */
const COVER_Z = {
  decoration: 30,
  photo: 60,
  mask: 70,
  spine: 100,
  text: 100,
} as const;

/**
 * 将模板的预设文字元素（百分比坐标）转换为页面的 textElements（mm 坐标）。
 * 占位符 {albumName}/{date} 在此处替换为实际值，用户可在画布上继续编辑。
 */
function presetTextToPageElements(
  presets: PresetTextElement[] | undefined,
  pageMm: { width: number; height: number },
  albumName: string,
  dateRange: string | undefined,
  spineOffsetX = 0,
): PageTextElement[] {
  if (!presets || presets.length === 0) return [];
  // 封面/封底页：书脊为页面左侧物理扩展，正文元素整体右移 spineOffsetX（mm）
  // 位置 x 含书脊偏移；尺寸 width/height 不含偏移（否则会放大并导致居中元素偏移）
  const posX = (v: number) => spineOffsetX + (v / 100) * pageMm.width;
  const scale = (v: number) => (v / 100) * pageMm.width;
  const scaleY = (v: number) => (v / 100) * pageMm.height;
  // 文字随封面尺寸等比缩放：综合宽高比取小值 + clamp，保证不同尺寸（竖版/横版/方形/迷你）比例协调且不溢出
  const fontScale = coverFontScale(pageMm);
  return presets.map((p) => {
    let text = p.text;
    if (p.placeholder === 'albumName') text = albumName || text;
    else if (p.placeholder === 'date') text = dateRange || text;
    const fontSize = p.fontSize * fontScale;
    const base: PageTextElement = {
      id: `cover-text-${p.id}-${Date.now().toString(36)}`,
      x: posX(p.x), y: scaleY(p.y),
      width: scale(p.width), height: scaleY(p.height),
      text,
      fontSize,
      fontFamily: p.fontFamily,
      color: p.color,
      align: p.align,
      // 封面文字垂直对齐：模板可指定，缺省居中（与普通文字工具一致，编辑浮层按 verticalAlign 对齐）
      verticalAlign: p.verticalAlign ?? 'center',
      // 封面模板字间距/行间距：透传模板预设值，缺省用默认（0 / 1.2），与渲染层保持所见即所得
      letterSpacing: p.letterSpacing,
      lineHeight: p.lineHeight,
      bold: p.bold,
      italic: p.italic,
      rotation: p.rotation,
      gradient: p.gradient,
      gradientAngle: p.gradientAngle,
      zIndex: COVER_Z.text,
    };
    // 文本框按文字自适应：模板预设 height 是偏小占位值，实际渲染文字更高会被 overflow:hidden 裁剪。
    // 应用时用 fitTextSize（与渲染层同源公式）把尺寸撑到完整容纳文字——
    // 横排宽度固定、高度按换行增长；竖排宽度按列数增长。仅文字非空时计算，空文字保持占位尺寸。
    if (text) {
      const fitted = fitTextSize({
        text, fontSize, fontFamily: p.fontFamily,
        bold: p.bold, italic: p.italic, isVertical: false,
        width: base.width, height: base.height,
        lineHeight: p.lineHeight, letterSpacing: p.letterSpacing,
      });
      base.width = fitted.width;
      base.height = fitted.height;
    }
    return base;
  });
}

/**
 * 将模板的预设形状元素（百分比坐标）转换为页面的 shapeElements（mm 坐标）。
 * 坐标基于元素中心点（与现有 ShapeElement 一致）。
 */
function presetShapeToPageElements(
  presets: PresetShapeElement[] | undefined,
  pageMm: { width: number; height: number },
  spineOffsetX = 0,
): ShapeElement[] {
  if (!presets || presets.length === 0) return [];
  // 封面/封底页：书脊为页面左侧物理扩展，正文元素整体右移 spineOffsetX（mm）
  // 位置 x 含书脊偏移；尺寸 width/height 不含偏移（否则会放大并导致居中元素偏移）
  // 形状尺寸统一走 coverElementSize：蒙版(mask)按轴拉伸覆盖区域，装饰形状等比保持宽高比
  const kx = pageMm.width / 100;
  const ky = pageMm.height / 100;
  return presets.map((p) => {
    const { width: w, height: h } = coverElementSize(isMaskShape(p.id), p.width, p.height, kx, ky);
    // 锚点感知定位：贴边/居中形状在异宽高比页面上保持视觉关系一致（避免居中偏移、靠边离边）
    const { x, y } = coverAnchorPosition(p, pageMm.width, pageMm.height, w, h);
    return {
      id: `cover-shape-${p.id}-${Date.now().toString(36)}`,
      x: spineOffsetX + x + w / 2,  // 中心点（x 已为 mm 页面坐标，叠加书脊偏移）
      y: y + h / 2,
      width: w,
      height: h,
      type: p.type,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      opacity: p.opacity,
      rotation: p.rotation,
      gradient: p.gradient,
      gradientAngle: p.gradientAngle,
      strokeGradient: p.strokeGradient,
      strokeGradientAngle: p.strokeGradientAngle,
      cornerRadius: p.cornerRadius,
      cornerCut: p.cornerCut,
      // 蒙版（id 含 mask）在照片之上做压暗保证文字可读；装饰形状在照片之下避免遮挡照片
      zIndex: isMaskShape(p.id) ? COVER_Z.mask : COVER_Z.decoration,
    };
  });
}

/** 从相册照片中提取日期年份区间（如 2023-2024）；照片无日期时以当前年份为默认（2026） */
function deriveDateRange(photos: { date?: string }[]): string | undefined {
  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => !Number.isNaN(y));
  if (years.length === 0) return String(new Date().getFullYear());
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

/**
 * 生成书脊默认内容元素（竖排文本，逐字正立自上而下）：MemBook 水印 + 相册名 + 日期。
 * 书脊背面区域为封面页左侧 0..spineWidth(mm)，元素水平居中于书脊。
 * 均为独立可编辑文本元素，用户可在画布上继续编辑。
 */
function buildSpineElements(
  albumName: string,
  dateRange: string | undefined,
  spineWidth: number,
  pageHeight: number,
): PageTextElement[] {
  const centerX = spineWidth / 2;
  // 竖排文本：盒宽与普通竖排文字一致（单列宽度 = 字号+6，与 fitTextSize 一致），贴合文字列；
  // 高度按内容（每字 字号+2 + 上下内边距）自适应。保证控制器(选框)与编辑输入框尺寸一致、不超出书脊。
  const mk = (
    id: string, centerY: number, text: string, fontSize: number, h: number,
    align: 'left' | 'center' | 'right' = 'center',
    verticalAlign?: 'top' | 'center' | 'bottom',
  ): PageTextElement => {
    const boxW = Math.min(fontSize + 6, spineWidth);
    return {
      id: `spine-text-${id}-${Date.now().toString(36)}`,
      x: centerX - boxW / 2,
      y: centerY - h / 2,
      width: boxW,
      height: h,
      text,
      fontSize,
      // 书脊文字默认字体 = 应用默认字体 思源黑体（与新建文字元素一致）
      fontFamily: '思源黑体',
      color: 'rgba(60,60,70,0.9)',
      align,
      verticalAlign,
      bold: false,
      italic: false,
      // 书脊文字：isVertical 已逐字正立竖排（自上而下），不另旋转；若再加 -90 会把正立字旋转成横躺导致角度错误
      rotation: 0,
      isVertical: true,
      zIndex: COVER_Z.spine,
    };
  };

  const els: PageTextElement[] = [];
  // 相册名：放在画册纵向中线上（页高 50%），高度按内容增长，至少容纳 50mm
  const nameFs = 9;
  const nameH = Math.max(50, albumName.length * (nameFs + 2) + 8);
  els.push(mk('name', pageHeight * 0.5, albumName, nameFs, nameH));
  // 日期：放到底部书脊，底边距固定 15mm（与顶部 logo 顶边距 SPINE_LOGO_TOP_MM=15 镜像对称）；
  // 水平居中 + 垂直底部对齐（基于文本框，竖排语义：align=水平、verticalAlign=垂直）
  if (dateRange) {
    const dateFs = 8;
    const dateH = Math.max(20, dateRange.length * (dateFs + 2) + 8);
    const dateCenterY = pageHeight - SPINE_DATE_BOTTOM_MM - dateH / 2;
    els.push(mk('date', dateCenterY, dateRange, dateFs, dateH, 'center', 'bottom'));
  }
  return els;
}

/**
 * 确保相册照片足够填满模板所有照片位：不足时用封面预设照片补齐并加入 photoStore。
 * 返回足以覆盖槽位的照片数组（相册照片优先，预设照片补足）。
 */
async function ensureCoverSlotPhotos(slotCount: number): Promise<import('../../types').Photo[]> {
  const photoStore = usePhotoStore.getState();
  const photos = photoStore.photos;
  if (photos.length >= slotCount) return photos;
  const defaults = await createDefaultCoverPhotos(slotCount - photos.length);
  if (defaults.length) photoStore.addPhotos(defaults);
  return [...photos, ...defaults];
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
  /** 背景应用描述：可同时设置底色（纯色/渐变/纹理）与背景图片 */
  updatePageBackground: (index, apply: BackgroundApply) => {
    set((s) => {
      const newPages = [...s.pages];
      if (newPages[index]) {
        newPages[index] = { ...newPages[index], ...apply };
      }
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  applyBackgroundByScope: (scope, apply: BackgroundApply) => {
    const currentIndex = get().currentPageIndex;
    const matches = (p: AlbumPage, i: number): boolean => {
      switch (scope) {
        case 'current': return i === currentIndex;
        case 'normal': return !isCoverOrBackCoverPage(p);
        case 'cover': return isCoverPage(p);
        case 'back': return isBackCoverPage(p);
        case 'all': return true;
        default: return false;
      }
    };
    set((s) => {
      const newPages = s.pages.map((p, i) => (matches(p, i) ? { ...p, ...apply } : p));
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
  applyCoverTemplate: async (templateId) => {
    const template = findCoverTemplateById(templateId);
    if (!template) return;
    const size = get().albumSize;
    const pageMm = { width: size?.width ?? 210, height: size?.height ?? 280 };
    const albumName = get().projectName || '我的相册';
    // 确保照片槽位全部有图：相册照片不足时用预设照片补齐
    const photos = await ensureCoverSlotPhotos(template.slots.length);
    const dateRange = deriveDateRange(photos);

    // 书脊为封面页左侧物理扩展。切换模板时按场景1规则处理（2026-08-19）：
    // 书脊宽度/锚点沿用旧封面（用户调整过的不重置）；但书脊底色/logo 色重置为新模板默认——
    // 底色=template.spineColor，logo 色=空（undefined 按底色深浅自动黑/白），不沿用旧封面
    const oldCoverInfo = get().pages.find((p) => p.pageKind === 'cover');
    const spineWidth = oldCoverInfo?.spineWidth ?? DEFAULT_SPINE_WIDTH_MM;
    const spineColor = template.spineColor;
    const spineLogoColor: string | undefined = undefined;
    // 封面正面内容整体右移书脊宽度（印刷一体：书脊背面与封面正面连续，无视觉间隙），书脊背面在左侧
    const contentOffset = spineWidth;
    // 书脊偏移锚点 = 内容烘焙的偏移量（折线位置）。书脊宽度后续调整时内容不再移动，渲染按 (书脊宽-锚点) 偏移
    const spineAnchorMm = oldCoverInfo?.spineAnchorMm ?? oldCoverInfo?.spineWidth ?? contentOffset;

    // 预设元素落位（百分比→mm，正文整体右移 contentOffset）
    const textElements = presetTextToPageElements(template.presetTextElements, pageMm, albumName, dateRange, contentOffset);
    const shapeElements = presetShapeToPageElements(template.presetShapeElements, pageMm, contentOffset);

    // 书脊默认内容：MemBook 水印 + 相册名 + 日期（竖排，位于书脊背面 0..spineWidth 区域）
    const spineElements = buildSpineElements(albumName, dateRange, spineWidth, pageMm.height);

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
      spineWidth,
      spineAnchorMm,
      spineColor,
      spineLogoColor,
      slotCornerRadius: template.slotCornerRadius ?? 4,
      // 照片槽位置顶于装饰形状之上（COVER_Z.photo > decoration），避免被形状遮挡
      slotZIndices: Object.fromEntries(template.slots.map((s) => [s.id, COVER_Z.photo])),
      textElements: [...spineElements, ...textElements],
      shapeElements,
    };

    set((s) => {
      const hasCover = s.pages.some((p) => p.pageKind === 'cover');
      const newPages = [...s.pages];
      let coverIdx: number;
      if (hasCover) {
        // 切换封面模板：完整保留用户内容——照片（含编辑属性按 photoId 迁移）+ 用户文字/形状 + 贴纸/便利贴 + 书脊设置
        const oldCover = newPages.find((p) => p.pageKind === 'cover')!;
        const oldPhotoIds = oldCover.placements
          .filter((pl) => pl.photoId)
          .map((pl) => pl.photoId!) as string[];
        // 切换模板：优先保留旧封面照片，不足的槽位用 photos（ensureCoverSlotPhotos 已确保含预设照片）补齐，
        // 保证只要模板有照片位，所有槽位都有图（如单图→多图拼排不会出现空槽位）
        const usedIds = new Set(oldPhotoIds);
        const extraPhotoIds = photos.filter((p) => !usedIds.has(p.id)).map((p) => p.id);
        const newPhotoIds = [...oldPhotoIds, ...extraPhotoIds];
        // 照片编辑属性迁移：按 photoId 用 makePlacementMigrator 保留 pan/缩放/裁剪/旋转/滤镜/明暗/阴影，
        // 并按新旧槽位尺寸重映射 pan（避免切换模板后照片调整归零，2026-08-19）
        const photoMap = new Map(photos.map((p) => [p.id, p]));
        const migratePlacement = makePlacementMigrator(oldCover.placements, oldCover.slotOverrides ?? {}, photoMap);
        const newCoverOverrides = size ? calcCoverOverrides(newPage, size)?.overrides ?? {} : {};
        const oldPlByPhoto = new Map(oldCover.placements.filter((pl) => pl.photoId).map((pl) => [pl.photoId!, pl]));
        newPage.placements = template.slots.map((slot, i) => {
          const photoId = newPhotoIds[i] ?? null;
          if (!photoId) return { slotId: slot.id, photoId: null };
          const migrated = migratePlacement(photoId, slot.id, newCoverOverrides[slot.id] ?? { x: 0, y: 0, width: 0, height: 0 });
          if (oldPlByPhoto.get(photoId)?.shadow) migrated.shadow = true;
          return migrated;
        });
        // 书脊文字：保留旧封面版本（用户可能改过相册名/日期，且已按保留的书脊宽居中）；
        // 旧封面无书脊文字时回退用新模板生成的书脊文字（书脊宽沿用旧值，居中一致）
        const oldSpineTexts = (oldCover.textElements || []).filter((el) => el.id.startsWith('spine-text-'));
        const keepSpineTexts = oldSpineTexts.length > 0 ? oldSpineTexts : spineElements;
        // 保留旧封面用户编辑的文字（排除书脊自动生成元素 + 模板预设文字）
        const oldUserTexts = (oldCover.textElements || []).filter(
          (el) => !el.id.startsWith('spine-text-') && !el.id.startsWith('cover-text-'),
        );
        // 保留旧封面用户添加的形状（排除模板预设形状）
        const oldShapeElements = (oldCover.shapeElements || []).filter(
          (el) => !el.id.startsWith('cover-shape-'),
        );
        // 合并：旧书脊文字 + 用户文字 + 新模板预设文字 + 用户形状 + 新模板预设形状
        newPage.textElements = [...keepSpineTexts, ...oldUserTexts, ...textElements];
        newPage.shapeElements = [...oldShapeElements, ...shapeElements];
        // 贴纸/便利贴随切换保留
        newPage.stickerElements = [...(oldCover.stickerElements || [])];
        newPage.stickyNotes = [...(oldCover.stickyNotes || [])];
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

    // 整体成套设计：应用封面时自动同步应用配套封底（template.backCover），不拆分开。
    // 每套封面都内置风格统一的封底（同背景/字体/配色），保证封面与封底具有整体性。
    // 封面 + 封底合并为一次快照：这里不压快照，封底联动调用传 recordHistory=false 跳过自身快照，
    // 统一在 if 之后 pushSnapshot 一次 → 一次 Ctrl+Z 撤销整套封面/封底设置（2026-08-19）
    if (template.backCover) {
      await get().applyBackCoverTemplate(template.backCover.id, false);
    }
    pushSnapshot(get);
  },

  /**
   * 应用封底模板：插入封底页或切换已有封底的模板。
   * 逻辑同 applyCoverTemplate，pageKind='backCover'，插入到尾部。
   * recordHistory=false（被 applyCoverTemplate 成套联动调用）时不压快照，由调用方统一提交。
   */
  applyBackCoverTemplate: async (templateId, recordHistory = true) => {
    const template = findCoverTemplateById(templateId);
    if (!template) return;
    const size = get().albumSize;
    const pageMm = { width: size?.width ?? 210, height: size?.height ?? 280 };
    const albumName = get().projectName || '我的相册';
    // 确保照片槽位全部有图：相册照片不足时用预设照片补齐
    const photos = await ensureCoverSlotPhotos(template.slots.length);
    const dateRange = deriveDateRange(photos);

    // 封底无书脊，元素不偏移
    const textElements = presetTextToPageElements(template.presetTextElements, pageMm, albumName, dateRange, 0);
    const shapeElements = presetShapeToPageElements(template.presetShapeElements, pageMm, 0);

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
      spineWidth: 0,
      spineColor: template.spineColor,
      slotCornerRadius: template.slotCornerRadius ?? 4,
      // 照片槽位置顶于装饰形状之上（COVER_Z.photo > decoration），避免被形状遮挡
      slotZIndices: Object.fromEntries(template.slots.map((s) => [s.id, COVER_Z.photo])),
      textElements,
      shapeElements,
    };

    set((s) => {
      const hasBack = s.pages.some((p) => p.pageKind === 'backCover');
      const newPages = [...s.pages];
      if (hasBack) {
        // 切换封底模板：完整保留用户内容——照片（含编辑属性按 photoId 迁移）+ 用户文字/形状 + 贴纸/便利贴
        const oldBack = newPages.find((p) => p.pageKind === 'backCover')!;
        const oldPhotoIds = oldBack.placements
          .filter((pl) => pl.photoId)
          .map((pl) => pl.photoId!) as string[];
        // 切换模板：优先保留旧封底照片，不足的槽位用 photos（ensureCoverSlotPhotos 已确保含预设照片）补齐
        const usedIds = new Set(oldPhotoIds);
        const extraPhotoIds = photos.filter((p) => !usedIds.has(p.id)).map((p) => p.id);
        const newPhotoIds = [...oldPhotoIds, ...extraPhotoIds];
        // 照片编辑属性迁移：按 photoId 保留 pan/缩放/裁剪/旋转/滤镜/明暗/阴影，并按新旧槽位尺寸重映射 pan
        const photoMap = new Map(photos.map((p) => [p.id, p]));
        const migratePlacement = makePlacementMigrator(oldBack.placements, oldBack.slotOverrides ?? {}, photoMap);
        const newBackOverrides = size ? calcCoverOverrides(newPage, size)?.overrides ?? {} : {};
        const oldPlByPhoto = new Map(oldBack.placements.filter((pl) => pl.photoId).map((pl) => [pl.photoId!, pl]));
        newPage.placements = template.slots.map((slot, i) => {
          const photoId = newPhotoIds[i] ?? null;
          if (!photoId) return { slotId: slot.id, photoId: null };
          const migrated = migratePlacement(photoId, slot.id, newBackOverrides[slot.id] ?? { x: 0, y: 0, width: 0, height: 0 });
          if (oldPlByPhoto.get(photoId)?.shadow) migrated.shadow = true;
          return migrated;
        });
        const oldTextElements = (oldBack.textElements || []).filter(
          (el) => !el.id.startsWith('cover-text-'),
        );
        const oldShapeElements = (oldBack.shapeElements || []).filter(
          (el) => !el.id.startsWith('cover-shape-'),
        );
        newPage.textElements = [...textElements, ...oldTextElements];
        newPage.shapeElements = [...shapeElements, ...oldShapeElements];
        // 贴纸/便利贴随切换保留
        newPage.stickerElements = [...(oldBack.stickerElements || [])];
        newPage.stickyNotes = [...(oldBack.stickyNotes || [])];
        const idx = newPages.findIndex((p) => p.pageKind === 'backCover');
        newPages[idx] = newPage;
      } else {
        newPages.push(newPage);
      }
      return { pages: newPages };
    });
    if (recordHistory !== false) pushSnapshot(get);
  },
});
