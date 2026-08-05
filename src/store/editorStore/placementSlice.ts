import type { PhotoPlacement } from '../../types';
import { isGooglePhotosPage } from '../../types';
import { pushSnapshot, getGlobalMaxZ, getGlobalMinZ } from './helpers';
import type { EditorSlice, PlacementSlice } from './types';

/* ── 槽位/照片编辑 slice ──
 * 注意：涉及 photoStore / uiStore 的跨域编排已下沉到 services 层，
 * 本 slice 仅保留纯 editor 状态更新。
 */
export const createPlacementSlice: EditorSlice<PlacementSlice> = (set, get) => ({
  placePhoto: (pageIndex, slotId, photoId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const existingIdx = page.placements.findIndex((p) => p.slotId === slotId);
      let newPlacements: typeof page.placements;
      if (existingIdx >= 0) {
        // 替换照片：重置所有编辑属性（pan/缩放/旋转/滤镜/调整）
        newPlacements = page.placements.map((p, i) =>
          i === existingIdx ? { slotId, photoId } : p
        );
      } else {
        newPlacements = [...page.placements, { slotId, photoId }];
      }
      newPages[pageIndex] = { ...page, placements: newPlacements };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  toggleShadow: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const newPlacements = page.placements.map((p) =>
        p.slotId === slotId ? { ...p, shadow: !p.shadow } : p
      );
      newPages[pageIndex] = { ...page, placements: newPlacements };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  batchSetShadow: (pageIndex, slotIds, shadow) => {
    const idSet = new Set(slotIds);
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const newPlacements = page.placements.map((p) =>
        idSet.has(p.slotId) ? { ...p, shadow } : p
      );
      newPages[pageIndex] = { ...page, placements: newPlacements };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  removePhotoFromSlot: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, photoId: null } : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  /** 保持槽几何不变，交换两个照片位置（photoId 及编辑状态跟随照片走）。
   *  支持所有页面类型（Google Photos 智能排版 + 普通模板页面）。 */
  swapPagePhotoPlacements: (pageIndex, fromIndex, toIndex) => {
    const state = get();
    const page = state.pages[pageIndex];
    if (!page) return false;
    const placements = page.placements;
    if (fromIndex < 0 || fromIndex >= placements.length || toIndex < 0 || toIndex >= placements.length) return false;
    if (fromIndex === toIndex) return false;
    const newPlacements = [...placements];
    const fromSlotId = newPlacements[fromIndex].slotId;
    const toSlotId = newPlacements[toIndex].slotId;
    // 交换 photoId 及编辑状态，但保留 slotId（槽几何不变）
    const fromData = { ...newPlacements[fromIndex] };
    const toData = { ...newPlacements[toIndex] };
    newPlacements[fromIndex] = { ...toData, slotId: fromSlotId };
    newPlacements[toIndex] = { ...fromData, slotId: toSlotId };
    // 仅 Google Photos 页面需要同步交换 mmLayout（普通模板槽位几何由 template 定义，不受影响）
    const isGp = isGooglePhotosPage(page);
    const mmLayout = isGp && page.googlePhotosMmLayout ? [...page.googlePhotosMmLayout] : page.googlePhotosMmLayout;
    if (isGp && mmLayout && fromIndex < mmLayout.length && toIndex < mmLayout.length) {
      const tmp = mmLayout[fromIndex];
      mmLayout[fromIndex] = mmLayout[toIndex];
      mmLayout[toIndex] = tmp;
    }
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = { ...newPages[pageIndex], placements: newPlacements, ...(mmLayout !== page.googlePhotosMmLayout ? { googlePhotosMmLayout: mmLayout } : {}) };
      return { pages: newPages };
    });
    pushSnapshot(get);
    return true;
  },
  /* ── 照片编辑 ── */
  updatePlacementRotation: (pageIndex, slotId, rotation) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, rotation } : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updatePlacementAdjustments: (pageIndex, slotId, adjustments) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, adjustments } : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updatePlacementFilter: (pageIndex, slotId, filter) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, filter } : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updatePlacementPan: (pageIndex, slotId, panX, panY, panScale, recordHistory) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId
            ? { ...p, panX, panY, ...(panScale !== undefined ? { panScale } : {}) }
            : p
        ),
      };
      return { pages: newPages };
    });
    if (recordHistory !== false) pushSnapshot(get);
  },
  resetPlacementPan: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) => {
          if (p.slotId !== slotId) return p;
          const { panX: _px, panY: _py, panScale: _ps, ...rest } = p;
          return rest as PhotoPlacement;
        }),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updatePlacementFlip: (pageIndex, slotId, flipH, flipV) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId
            ? { ...p, ...(flipH !== undefined ? { flipH } : {}), ...(flipV !== undefined ? { flipV } : {}) }
            : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updatePlacementFilterIntensity: (pageIndex, slotId, intensity) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, filterIntensity: intensity } : p
        ),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  resetPlacementEdits: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) => {
          if (p.slotId !== slotId) return p;
          // 仅保留 slotId 和 photoId，清除所有编辑属性
          return { slotId, photoId: p.photoId };
        }),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  /* ── 照片位自由编辑 ── */
  updateSlotOverride: (pageIndex, slotId, override) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      newPages[pageIndex] = {
        ...page,
        slotOverrides: { ...(page.slotOverrides || {}), [slotId]: override },
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  batchUpdateSlotOverrides: (pageIndex, updates) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const newOverrides = { ...(page.slotOverrides || {}) };
      for (const u of updates) {
        newOverrides[u.slotId] = u.override;
      }
      newPages[pageIndex] = { ...page, slotOverrides: newOverrides };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  resetSlotOverride: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      if (!page.slotOverrides) return s;
      const newOverrides = { ...page.slotOverrides };
      delete newOverrides[slotId];
      newPages[pageIndex] = { ...page, slotOverrides: newOverrides };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  /* ── 槽位层级 ── */
  bringSlotToFront: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        slotZIndices: { ...(page.slotZIndices || {}), [slotId]: maxZ + 1 },
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  sendSlotToBack: (pageIndex, slotId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const minZ = getGlobalMinZ(page);
      newPages[pageIndex] = {
        ...page,
        slotZIndices: { ...(page.slotZIndices || {}), [slotId]: minZ - 1 },
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
});
