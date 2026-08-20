import { pushSnapshot, getGlobalMaxZ, getGlobalMinZ } from './helpers';
import type { EditorSlice, DecorationsSlice } from './types';

// 向后兼容：重导出 getGlobalMaxZ/getGlobalMinZ（已迁移至 helpers.ts，避免 slice 间直接 import）
export { getGlobalMaxZ, getGlobalMinZ };

/* ── 画笔/便利贴/文字/贴纸/层级 slice ── */
export const createDecorationsSlice: EditorSlice<DecorationsSlice> = (set, get) => ({
  /* ── 画笔 ── */
  addBrushStroke: (pageIndex, stroke) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        brushStrokes: [...(page.brushStrokes || []), { ...stroke, zIndex: maxZ + 1 }],
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  removeBrushStroke: (pageIndex, strokeId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        brushStrokes: (newPages[pageIndex].brushStrokes || []).filter((b) => b.id !== strokeId),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },

  /* ── 便利贴 ── */
  addStickyNote: (pageIndex, note) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        stickyNotes: [...(page.stickyNotes || []), { ...note, zIndex: maxZ + 1 }],
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updateStickyNote: (pageIndex, noteId, patch, recordHistory?: boolean) => {
    let changed = false;
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const stickyNotes = (newPages[pageIndex].stickyNotes || []).map((n) => {
        if (n.id === noteId) { changed = true; return { ...n, ...patch }; }
        return n;
      });
      // 元素不存在（如切模板/撤销后已移除）：不修改也不压快照，避免「冗余快照」导致撤销错位
      if (!changed) return s;
      newPages[pageIndex] = { ...newPages[pageIndex], stickyNotes };
      return { pages: newPages };
    });
    if (changed && recordHistory !== false) pushSnapshot(get);
  },
  removeStickyNote: (pageIndex, noteId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        stickyNotes: (newPages[pageIndex].stickyNotes || []).filter((n) => n.id !== noteId),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },

  /* ── 文字 ── */
  addTextElement: (pageIndex, el) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        textElements: [...(page.textElements || []), { ...el, zIndex: maxZ + 1 }],
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updateTextElement: (pageIndex, elId, patch, recordHistory?: boolean) => {
    let changed = false;
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const textElements = (newPages[pageIndex].textElements || []).map((el) => {
        if (el.id === elId) { changed = true; return { ...el, ...patch }; }
        return el;
      });
      // 元素不存在（如切模板/撤销后已移除）：不修改也不压快照，避免「冗余快照」导致撤销错位
      if (!changed) return s;
      newPages[pageIndex] = { ...newPages[pageIndex], textElements };
      return { pages: newPages };
    });
    if (changed && recordHistory !== false) pushSnapshot(get);
  },
  removeTextElement: (pageIndex, elId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        textElements: (newPages[pageIndex].textElements || []).filter((el) => el.id !== elId),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },

  /* ── 贴纸 ── */
  addStickerElement: (pageIndex, sticker) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        stickerElements: [...(page.stickerElements || []), { ...sticker, zIndex: maxZ + 1 }],
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updateStickerElement: (pageIndex, stickerId, patch, recordHistory?: boolean) => {
    let changed = false;
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const stickerElements = (newPages[pageIndex].stickerElements || []).map((st) => {
        if (st.id === stickerId) { changed = true; return { ...st, ...patch }; }
        return st;
      });
      // 元素不存在（如切模板/撤销后已移除）：不修改也不压快照，避免「冗余快照」导致撤销错位
      if (!changed) return s;
      newPages[pageIndex] = { ...newPages[pageIndex], stickerElements };
      return { pages: newPages };
    });
    if (changed && recordHistory !== false) pushSnapshot(get);
  },
  removeStickerElement: (pageIndex, stickerId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        stickerElements: (newPages[pageIndex].stickerElements || []).filter((st) => st.id !== stickerId),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },

  /* ── 形状 ── */
  addShapeElement: (pageIndex, shape) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const page = newPages[pageIndex];
      const maxZ = getGlobalMaxZ(page);
      newPages[pageIndex] = {
        ...page,
        shapeElements: [...(page.shapeElements || []), { ...shape, zIndex: maxZ + 1 }],
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  updateShapeElement: (pageIndex, shapeId, patch, recordHistory?: boolean) => {
    let changed = false;
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const shapeElements = (newPages[pageIndex].shapeElements || []).map((sh) => {
        if (sh.id === shapeId) { changed = true; return { ...sh, ...patch }; }
        return sh;
      });
      // 元素不存在（如切模板/撤销后已移除）：不修改也不压快照，避免「冗余快照」导致撤销错位
      if (!changed) return s;
      newPages[pageIndex] = { ...newPages[pageIndex], shapeElements };
      return { pages: newPages };
    });
    if (changed && recordHistory !== false) pushSnapshot(get);
  },
  removeShapeElement: (pageIndex, shapeId) => {
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        shapeElements: (newPages[pageIndex].shapeElements || []).filter((sh) => sh.id !== shapeId),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },

  /* ── 层级操作 ── */
  bringToFront: (pageIndex, type, id) => {
    set((s) => {
      const newPages = [...s.pages];
      const page = newPages[pageIndex];
      if (!page) return s;
      // 跨所有类别计算全局最大 zIndex
      const maxZ = getGlobalMaxZ(page);
      const updateList = <T extends { id: string; zIndex: number }>(list: T[]) =>
        list.map((el) => el.id === id ? { ...el, zIndex: maxZ + 1 } : el);
      newPages[pageIndex] = {
        ...page,
        ...(type === 'brush' ? { brushStrokes: updateList(page.brushStrokes || []) } : {}),
        ...(type === 'sticky' ? { stickyNotes: updateList(page.stickyNotes || []) } : {}),
        ...(type === 'text' ? { textElements: updateList(page.textElements || []) } : {}),
        ...(type === 'sticker' ? { stickerElements: updateList(page.stickerElements || []) } : {}),
        ...(type === 'shape' ? { shapeElements: updateList(page.shapeElements || []) } : {}),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
  sendToBack: (pageIndex, type, id) => {
    set((s) => {
      const newPages = [...s.pages];
      const page = newPages[pageIndex];
      if (!page) return s;
      const minZ = getGlobalMinZ(page);
      const updateList = <T extends { id: string; zIndex: number }>(list: T[]) =>
        list.map((el) => el.id === id ? { ...el, zIndex: minZ - 1 } : el);
      newPages[pageIndex] = {
        ...page,
        ...(type === 'brush' ? { brushStrokes: updateList(page.brushStrokes || []) } : {}),
        ...(type === 'sticky' ? { stickyNotes: updateList(page.stickyNotes || []) } : {}),
        ...(type === 'text' ? { textElements: updateList(page.textElements || []) } : {}),
        ...(type === 'sticker' ? { stickerElements: updateList(page.stickerElements || []) } : {}),
        ...(type === 'shape' ? { shapeElements: updateList(page.shapeElements || []) } : {}),
      };
      return { pages: newPages };
    });
    pushSnapshot(get);
  },
});
