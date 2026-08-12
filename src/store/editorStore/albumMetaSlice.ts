import type { AlbumSize, PageMarginSettings } from '../../types';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT, DEFAULT_SLOT_CORNER_RADIUS, isGooglePhotosPage } from '../../types';
import { pageMarginService } from '../../services/pageMarginService';
import { dirtyMarginPageIds, pushSnapshot } from './helpers';
import type { EditorSlice, AlbumMetaSlice } from './types';

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

  setProjectName: (name) => set({ projectName: name }),
  setAlbumType: (albumType) => set({ albumType }),
  setAlbumSize: (size: AlbumSize) => {
    set((s) => {
      // 切换相册尺寸时，模板页面清除旧 slotOverrides（走等比缩放 fallback），
      // 并标记为 dirty 让 pageMarginService 在翻页时按新尺寸重算
      const newPages = s.pages.map((p) => {
        if (isGooglePhotosPage(p)) {
          return { ...p, googlePhotosBasePageSize: { width: size.width, height: size.height } };
        }
        // 模板页面：清除 slotOverrides，触发等比缩放 fallback + dirty 重算
        if (p.slotOverrides) {
          return { ...p, slotOverrides: undefined };
        }
        return p;
      });
      // 标记所有页面为 dirty，翻页时按新尺寸重算 margin overrides
      for (let i = 0; i < newPages.length; i++) {
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
      // 全局应用：立即重算所有页（含圆角），并重新约束照片位置防止露白
      set((s) => {
        const np = [...s.pages];
        for (let i = 0; i < np.length; i++) {
          const result = pageMarginService.calcMarginForPage(i, s.pages);
          np[i] = result
            ? { ...result.newPage, slotCornerRadius: cornerRadius }
            : { ...np[i], slotCornerRadius: cornerRadius };
        }
        return { pages: np };
      });
    } else {
      // 仅当前页：即时重算并重新约束照片位置
      const result = pageMarginService.calcMarginForPage(currentPageIndex, get().pages);
      if (result || cornerRadius !== undefined) {
        set((s) => {
          const np = [...s.pages];
          const cp = np[currentPageIndex];
          if (cp) {
            np[currentPageIndex] = result
              ? { ...result.newPage, slotCornerRadius: cornerRadius }
              : { ...cp, slotCornerRadius: cornerRadius };
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
  },
  setDefaultSlotCornerRadius: (r) => set({ defaultSlotCornerRadius: r }),
  /** 设置当前页的槽位圆角（按页独立，开启"应用到全部页面"时同步所有页） */
  setPageSlotCornerRadius: (pageIndex, r) => {
    const { applyMarginToAll } = get();
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      if (applyMarginToAll) {
        for (let i = 0; i < newPages.length; i++) {
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
});
