import type { AlbumSize, PageMarginSettings, AlbumPage, PageTextElement, AlbumGuideLine, SlotOverride } from '../../types';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT, DEFAULT_SLOT_CORNER_RADIUS, isGooglePhotosPage, isCoverOrBackCoverPage } from '../../types';
import { pageMarginService, calcCoverOverrides } from '../../services/pageMarginService';
import { dirtyMarginPageIds, pushSnapshot } from './helpers';
import { fitTextSize } from '../../components/editor/canvas/TextDomNode';
import { coverElementSize, coverAnchorPosition, isMaskShape } from '../../utils/coverScale';
import { SPINE_DATE_BOTTOM_MM } from '../../utils/sharedRender';
import type { EditorSlice, AlbumMetaSlice } from './types';

/**
 * 切换相册尺寸时，封面/封底页的文字/形状元素按新旧尺寸等比重映射，保证在不同尺寸页面上布局协调、文字不裁剪。
 * - 正文元素：x 先减去书脊偏移锚点(spX = spineAnchorMm)按 kx 缩放再加回（折线位置固定，不随页面缩放）；y/height 按 ky；fontSize 按 kx。
 * - 书脊元素（spine-text-*）：书脊宽度固定，水平保持书脊居中(数据 x 不变)；**字号/盒宽高不变**，
 *   仅按新页高重排垂直位置——相册名纵向居中于新页中线，日期底边距固定 SPINE_DATE_BOTTOM_MM(15mm)。
 * - 形状：中心 x 含/不含偏移按上方规则处理，width/height 缩放。
 * - 文字重映射后重新 fitTextSize 撑高，避免切换尺寸后超框裁剪。
 */
function rescaleCoverDecorations(
  page: AlbumPage,
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
): AlbumPage {
  const kx = newSize.width / oldSize.width;
  const ky = newSize.height / oldSize.height;
  const spX = page.spineAnchorMm ?? page.spineWidth ?? 0;
  const textElements = (page.textElements || []).map((el) => {
    const isSpine = el.id.startsWith('spine-text-');
    if (isSpine) {
      // 书脊宽固定：字号/盒宽高不变，仅按新页高重排垂直位置；水平保持书脊居中（x 不变）
      const isDate = el.id.includes('date');
      const h = el.height || 0;
      return {
        ...el,
        y: isDate ? newSize.height - SPINE_DATE_BOTTOM_MM - h : newSize.height / 2 - h / 2,
      };
    }
    const scaled: PageTextElement = {
      ...el,
      x: spX + (el.x - spX) * kx,
      y: el.y * ky,
      width: Math.max(el.width * kx, 0.5),
      height: el.height * ky,
      fontSize: el.fontSize * kx,
    };
    if (scaled.text) {
      const fitted = fitTextSize(scaled);
      scaled.width = fitted.width;
      scaled.height = fitted.height;
    }
    return scaled;
  });
  const shapeElements = (page.shapeElements || []).map((sh) => {
    // 形状尺寸统一走 coverElementSize：蒙版按轴拉伸覆盖区域，装饰形状等比保持宽高比
    const { width, height } = coverElementSize(isMaskShape(sh.id), sh.width, sh.height, kx, ky);
    // 用旧页相对几何（百分比）判定锚点，在新页尺寸上锚点感知重新定位（贴边/居中保持一致）
    const pctBox = {
      x: ((sh.x - spX) / oldSize.width) * 100,
      y: (sh.y / oldSize.height) * 100,
      width: (sh.width / oldSize.width) * 100,
      height: (sh.height / oldSize.height) * 100,
    };
    const { x, y } = coverAnchorPosition(pctBox, newSize.width, newSize.height, width, height);
    return {
      ...sh,
      x: spX + x,
      y,
      width: Math.max(width, 0.5),
      height: Math.max(height, 0.5),
    };
  });
  return { ...page, textElements, shapeElements };
}

/**
 * 封面/封底照片槽位自适应合并：对每个槽，若用户手动拖/改过（与模板坐标不一致），
 * 按 kx/ky 等比缩放保留手动位置，避免尺寸变更时用户微调被模板重建覆盖而跳变；
 * 否则采用模板坐标（与 calcCoverOverrides 输出一致）。
 * @param manual      用户当前 slotOverrides（未包含的槽用模板）
 * @param template    新尺寸下模板驱动的 slotOverrides
 * @param oldTemplate 旧尺寸下模板驱动的 slotOverrides（用于判定是否"手动改过"）
 * @param kx ky       缩放系数（尺寸未变传 1）
 */
function mergeManualSlotOverrides(config: {
  manual: Record<string, SlotOverride> | undefined;
  template: Record<string, SlotOverride>;
  oldTemplate: Record<string, SlotOverride>;
  kx: number;
  ky: number;
}): Record<string, SlotOverride> {
  const out: Record<string, SlotOverride> = {};
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
  for (const id of Object.keys(config.template)) {
    const t = config.template[id];
    const m = config.manual?.[id];
    const ot = config.oldTemplate[id];
    // 手动改过：与旧模板坐标四边任一明显不同
    const isManual = !!m && !!ot && (
      !near(m.x, ot.x) || !near(m.y, ot.y) ||
      !near(m.width, ot.width) || !near(m.height, ot.height)
    );
    out[id] = isManual && config.kx === 1 && config.ky === 1
      ? m
      : isManual
        ? { x: m.x * config.kx, y: m.y * config.ky, width: m.width * config.kx, height: m.height * config.ky }
        : t;
  }
  return out;
}

/* ── 相册元数据 slice ── */
export const createAlbumMetaSlice: EditorSlice<AlbumMetaSlice> = (set, get) => ({
  albumSize: null,
  projectName: '',
  albumType: undefined,
  pageMargin: { top: PAGE_MARGIN_DEFAULT, bottom: PAGE_MARGIN_DEFAULT, left: PAGE_MARGIN_DEFAULT, right: PAGE_MARGIN_DEFAULT },
  applyMarginToAll: false,
  showGuides: false,
  showMarginGuide: false,
  slotGap: PAGE_GAP_DEFAULT,
  defaultSlotCornerRadius: DEFAULT_SLOT_CORNER_RADIUS,
  /** 相册级参考线（编辑辅助，跨页共享，随项目持久化；不参与导出/缩略图/打印） */
  guideLines: [],

  setProjectName: (name) => set({ projectName: name }),
  setAlbumType: (albumType) => set({ albumType }),
  setAlbumSize: (size: AlbumSize) => {
    set((s) => {
      // 切换相册尺寸时，模板页面清除旧 slotOverrides（走等比缩放 fallback），
      // 并标记为 dirty 让 pageMarginService 在翻页时按新尺寸重算
      const oldSize = s.albumSize;
      const hasOld = !!oldSize && oldSize.width > 0 && oldSize.height > 0;
      const newPages = s.pages.map((p) => {
        if (isGooglePhotosPage(p)) {
          return { ...p, googlePhotosBasePageSize: { width: size.width, height: size.height } };
        }
        // 封面/封底页：文字/形状按新旧尺寸等比重映射（+ 文字撑高），书脊文字按新页高重排；
        // 照片槽位同步用新尺寸重算（保留用户手动微调），避免槽位停留在旧尺寸绝对像素而照片不随尺寸自适应。
        if (isCoverOrBackCoverPage(p) && hasOld) {
          const scaled = rescaleCoverDecorations(p, { width: oldSize.width, height: oldSize.height }, { width: size.width, height: size.height });
          const oldCov = calcCoverOverrides(p, { width: oldSize.width, height: oldSize.height });
          const newCov = calcCoverOverrides(p, size);
          if (newCov) {
            return {
              ...scaled,
              slotOverrides: mergeManualSlotOverrides({
                manual: p.slotOverrides,
                template: newCov.overrides,
                oldTemplate: oldCov?.overrides ?? {},
                kx: size.width / oldSize.width,
                ky: size.height / oldSize.height,
              }),
            };
          }
          return scaled;
        }
        // 模板页面：清除 slotOverrides，触发等比缩放 fallback + dirty 重算
        if (p.slotOverrides) {
          return { ...p, slotOverrides: undefined };
        }
        return p;
      });
      // 标记所有页面为 dirty，翻页时按新尺寸重算 margin overrides。
      // 封面/封底页已在上方用新尺寸同步重算（含手动微调保留），不再标记 dirty，
      // 避免翻页重算时把封面手动微调的照片槽位覆盖掉造成跳变。
      for (let i = 0; i < newPages.length; i++) {
        if (isCoverOrBackCoverPage(newPages[i])) continue;
        dirtyMarginPageIds.add(i);
      }
      return { albumSize: size, pages: newPages };
    });
    pushSnapshot(get);
  },
  /** 批量应用页面设置（边距+间距+圆角+开关），一次 Store 写入避免中间态跳变 */
  batchPageSettings: ({ margin, gap, cornerRadius, applyAll, showGuides, showMarginGuide }) => {
    const { currentPageIndex, pages: _pages, albumSize: _albumSize, slotGap: _oldGap } = get();
    // 一次性写入所有设置，再用最终值计算 margin overrides
    set({
      pageMargin: margin,
      slotGap: gap,
      applyMarginToAll: applyAll,
      showGuides,
      showMarginGuide,
    });

    if (applyAll) {
      // 全局应用：立即重算所有内容页（含圆角），并重新约束照片位置防止露白
      // 封面/封底页不受边距/间距/圆角影响，仅尺寸调整时自适应
      set((s) => {
        const np = [...s.pages];
        for (let i = 0; i < np.length; i++) {
          if (isCoverOrBackCoverPage(np[i])) continue;
          const result = pageMarginService.calcMarginForPage(i, s.pages);
          np[i] = result
            ? { ...result.newPage, slotCornerRadius: cornerRadius }
            : { ...np[i], slotCornerRadius: cornerRadius };
        }
        return { pages: np };
      });
    } else {
      // 仅当前页：即时重算并重新约束照片位置（封面/封底页不应用圆角）
      const cp = get().pages[currentPageIndex];
      const isCover = cp ? isCoverOrBackCoverPage(cp) : false;
      const result = pageMarginService.calcMarginForPage(currentPageIndex, get().pages);
      if (result || (cornerRadius !== undefined && !isCover)) {
        set((s) => {
          const np = [...s.pages];
          const cp = np[currentPageIndex];
          if (cp) {
            // 封面/封底页：保留用户手动拖改的照片槽位（尺寸未变，kx=ky=1 时原样保留），其余用模板坐标，
            // 避免重新计算 slotOverrides 时把用户微调照片位置覆盖掉导致跳变；且不写入圆角。
            const coverMerged = isCover && result
              ? { ...result.newPage, slotOverrides: mergeManualSlotOverrides({
                  manual: cp.slotOverrides,
                  template: result.overrides ?? {},
                  oldTemplate: result.overrides ?? {},
                  kx: 1,
                  ky: 1,
                }) }
              : result?.newPage;
            np[currentPageIndex] = coverMerged
              ? { ...coverMerged, ...(isCover ? {} : { slotCornerRadius: cornerRadius }) }
              : (isCover ? cp : { ...cp, slotCornerRadius: cornerRadius });
          }
          return { pages: np };
        });
      }
    }
    pushSnapshot(get);
  },
  setPageMargin: (margin: PageMarginSettings) => {
    const { applyMarginToAll, currentPageIndex, pages: pgs } = get();
    set({ pageMargin: margin });
    // 当前页即时重算并重新约束照片位置；其余页标记脏，翻页时懒计算
    const result = pageMarginService.calcMarginForPage(currentPageIndex, get().pages);
    if (result) {
      set((s) => {
        const np = [...s.pages];
        if (np[currentPageIndex]) {
          np[currentPageIndex] = result.newPage;
        }
        return { pages: np };
      });
      pushSnapshot(get);
    }
    if (applyMarginToAll) {
      for (let i = 0; i < pgs.length; i++) {
        if (i !== currentPageIndex) dirtyMarginPageIds.add(i);
      }
    }
  },
  setApplyMarginToAll: (v) => set({ applyMarginToAll: v }),
  setSlotGap: (gap) => {
    const { applyMarginToAll, currentPageIndex, pages: pgs } = get();
    set({ slotGap: gap });
    // 当前页即时重算并重新约束照片位置；其余标记脏，翻页时懒计算
    const result = pageMarginService.calcMarginForPage(currentPageIndex, get().pages);
    if (result) {
      set((s) => {
        const np = [...s.pages];
        if (np[currentPageIndex]) {
          np[currentPageIndex] = result.newPage;
        }
        return { pages: np };
      });
    }
    if (applyMarginToAll) {
      for (let i = 0; i < pgs.length; i++) {
        if (i !== currentPageIndex) dirtyMarginPageIds.add(i);
      }
    }
    // 间距调整需记历史，否则 Ctrl+Z 撤销不生效（2026-08-19）
    pushSnapshot(get);
  },
  setDefaultSlotCornerRadius: (r) => set({ defaultSlotCornerRadius: r }),
  /** 设置当前页的槽位圆角（按页独立，开启"应用到全部页面"时同步所有内容页，封面/封底不受影响） */
  setPageSlotCornerRadius: (pageIndex, r) => {
    const { applyMarginToAll } = get();
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      if (applyMarginToAll) {
        for (let i = 0; i < newPages.length; i++) {
          if (isCoverOrBackCoverPage(newPages[i])) continue;
          newPages[i] = { ...newPages[i], slotCornerRadius: r };
        }
      } else {
        newPages[pageIndex] = { ...newPages[pageIndex], slotCornerRadius: r };
      }
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  setShowGuides: (v) => set({ showGuides: v }),
  setShowMarginGuide: (v) => set({ showMarginGuide: v }),
  setGuideLines: (guides: AlbumGuideLine[]) => set({ guideLines: guides }),
});
