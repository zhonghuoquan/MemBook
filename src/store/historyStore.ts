import { create } from 'zustand';
import type { HistoryEntry, AlbumPage } from '../types';

/* ── History Store (撤销/重做) ── */
interface HistoryState {
  stack: HistoryEntry[];
  pointer: number;
  pushSnapshot: (pages: AlbumPage[], selectedSlotId: string | null) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

const MAX_HISTORY = 30;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  stack: [],
  pointer: -1,

  pushSnapshot: (pages, selectedSlotId) =>
    set((s) => {
      // 浅拷贝 pages 数组和每个 page 对象，结构化共享未变更的嵌套数据，减少深拷贝开销
      const entry: HistoryEntry = {
        timestamp: Date.now(),
        pages: pages.map((p) => ({ ...p })),
        selectedSlotId,
      };
      const truncated = s.stack.slice(0, s.pointer + 1);
      truncated.push(entry);
      if (truncated.length > MAX_HISTORY) truncated.shift();
      return {
        stack: truncated,
        pointer: truncated.length - 1,
      };
    }),

  undo: () => {
    const { stack, pointer } = get();
    if (pointer <= 0) return null;
    const newPtr = pointer - 1;
    set({ pointer: newPtr });
    return stack[newPtr];
  },

  redo: () => {
    const { stack, pointer } = get();
    if (pointer >= stack.length - 1) return null;
    const newPtr = pointer + 1;
    set({ pointer: newPtr });
    return stack[newPtr];
  },

  canUndo: () => get().pointer > 0,
  canRedo: () => get().pointer < get().stack.length - 1,
  clear: () => set({ stack: [], pointer: -1 }),
}));
