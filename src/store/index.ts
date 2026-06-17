import { create } from 'zustand';
import type {
  ViewMode, PanelTab, EditTab, BottomNavState,
  AlbumPage, Photo, Toast, HistoryEntry, StorageMode, PhotoAdjustments, AlbumSize,
} from '../types';
import { TEMPLATES, STORAGE_MODE_KEY } from '../types';

/* ── UI Store (视图切换、面板、toast、缩放、存储模式) ── */
interface UIState {
  viewMode: ViewMode;
  activePanel: PanelTab;
  editFlyoutOpen: boolean;
  editFlyoutTab: EditTab;
  bottomNav: BottomNavState;
  bottomNavHeight: number;   // 底部导航栏高度 (90-280px)
  canvasZoom: number;        // 0.3 ~ 3.0, 默认 1.0
  storageMode: StorageMode | null;  // null = 尚未选择
  toasts: Toast[];

  /* Actions */
  setViewMode: (mode: ViewMode) => void;
  setActivePanel: (panel: PanelTab) => void;
  setEditFlyoutOpen: (open: boolean) => void;
  setEditFlyoutTab: (tab: EditTab) => void;
  toggleBottomNav: () => void;
  setBottomNavHeight: (h: number) => void;
  setCanvasZoom: (zoom: number) => void;
  setStorageMode: (mode: StorageMode) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

/* 从 localStorage 恢复存储偏好 */
function loadStorageMode(): StorageMode | null {
  try {
    const saved = localStorage.getItem(STORAGE_MODE_KEY);
    if (saved === 'direct' || saved === 'import') return saved;
  } catch { /* ignore */ }
  return null;
}

export const useUIStore = create<UIState>((set) => ({
  viewMode: 'single',
  activePanel: 'photos',
  editFlyoutOpen: false,
  editFlyoutTab: 'crop',
  bottomNav: 'expanded',
  bottomNavHeight: 150,
  canvasZoom: 1.0,
  storageMode: loadStorageMode(),
  toasts: [],

  setViewMode: (mode) => set({ viewMode: mode }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setEditFlyoutOpen: (open) => set({ editFlyoutOpen: open }),
  setEditFlyoutTab: (tab) => set({ editFlyoutTab: tab }),
  toggleBottomNav: () =>
    set((s) => ({ bottomNav: s.bottomNav === 'expanded' ? 'collapsed' : 'expanded' })),
  setBottomNavHeight: (h) => set({ bottomNavHeight: h }),
  setCanvasZoom: (zoom) => set({ canvasZoom: Math.max(0.3, Math.min(3, zoom)) }),
  setStorageMode: (mode) => {
    try { localStorage.setItem(STORAGE_MODE_KEY, mode); } catch { /* ignore */ }
    set({ storageMode: mode });
  },
  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: `toast-${Date.now()}` }] })),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/* ── Editor Store (当前编辑状态) ── */
interface EditorState {
  currentPageIndex: number;
  selectedSlotId: string | null;
  selectedPhotoId: string | null;
  pages: AlbumPage[];
  albumSize: AlbumSize | null;

  /* Actions */
  setCurrentPage: (index: number) => void;
  setSelectedSlot: (slotId: string | null) => void;
  setSelectedPhoto: (photoId: string | null) => void;
  addPage: (templateId?: string) => void;
  insertPage: (index: number, templateId?: string) => void;
  copyPage: (index: number) => void;
  removePage: (index: number) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  setPages: (pages: AlbumPage[]) => void;
  setAlbumSize: (size: AlbumSize) => void;
  updatePageBackground: (index: number, color: string) => void;
  setPageTemplate: (pageIndex: number, templateId: string, preservePhotoIds?: string[]) => void;
  placePhoto: (pageIndex: number, slotId: string, photoId: string) => void;
  removePhotoFromSlot: (pageIndex: number, slotId: string) => void;
  /* 照片编辑 */
  updatePlacementRotation: (pageIndex: number, slotId: string, rotation: number) => void;
  updatePlacementAdjustments: (pageIndex: number, slotId: string, adjustments: PhotoAdjustments) => void;
  updatePlacementFilter: (pageIndex: number, slotId: string, filter: string | null) => void;
  resetPlacementEdits: (pageIndex: number, slotId: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /* ════════════════════════════════════════
     辅助：操作前自动记录历史快照
     ════════════════════════════════════════ */
  function pushSnapshot() {
    const { pages, selectedSlotId } = get();
    // 只在有页面时才推快照（避免初始空状态也被记录）
    if (pages.length > 0) {
      useHistoryStore.getState().pushSnapshot(pages, selectedSlotId);
    }
  }

  return {
  currentPageIndex: 0,
  selectedSlotId: null,
  selectedPhotoId: null,
  pages: [],
  albumSize: null,

  setCurrentPage: (index) => set({ currentPageIndex: index }),
  setSelectedSlot: (slotId) => set({ selectedSlotId: slotId }),
  setSelectedPhoto: (photoId) => set({ selectedPhotoId: photoId }),
  addPage: (templateId) => {
    pushSnapshot();
    set((s) => ({
      pages: [
        ...s.pages,
        {
          id: `page-${Date.now()}`,
          templateId: templateId || 'full',
          placements: [],
          background: '#FFFFFF',
        },
      ],
    }));
  },
  insertPage: (index, templateId) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      newPages.splice(index, 0, {
        id: `page-${Date.now()}`,
        templateId: templateId || 'full',
        placements: [],
        background: '#FFFFFF',
      });
      return { pages: newPages };
    });
  },
  copyPage: (index) => {
    pushSnapshot();
    set((s) => {
      if (!s.pages[index]) return s;
      const source = s.pages[index];
      const newPage: AlbumPage = {
        ...JSON.parse(JSON.stringify(source)),
        id: `page-${Date.now()}`,
      };
      const newPages = [...s.pages];
      newPages.splice(index + 1, 0, newPage);
      return { pages: newPages };
    });
  },
  removePage: (index) => {
    pushSnapshot();
    set((s) => ({
      pages: s.pages.filter((_, i) => i !== index),
      currentPageIndex:
        s.currentPageIndex >= s.pages.length - 1
          ? Math.max(0, s.pages.length - 2)
          : s.currentPageIndex,
    }));
  },
  reorderPages: (from, to) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      const [moved] = newPages.splice(from, 1);
      newPages.splice(to, 0, moved);
      return { pages: newPages };
    });
  },
  setPages: (pages) => set({ pages }),
  setAlbumSize: (size) => set({ albumSize: size }),
  updatePageBackground: (index, color) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      if (newPages[index]) {
        newPages[index] = { ...newPages[index], background: color };
      }
      return { pages: newPages };
    });
  },
  setPageTemplate: (pageIndex, templateId, preservePhotoIds) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      const template = TEMPLATES.find((t) => t.id === templateId);
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

      newPages[pageIndex] = {
        ...currentPage,
        templateId,
        placements: newPlacements,
      };
      return { pages: newPages };
    });
  },
  placePhoto: (pageIndex, slotId, photoId) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, photoId } : p
        ),
      };
      return { pages: newPages };
    });
  },
  removePhotoFromSlot: (pageIndex, slotId) => {
    pushSnapshot();
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
  },
  /* 照片编辑操作 */
  updatePlacementRotation: (pageIndex, slotId, rotation) => {
    pushSnapshot();
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
  },
  updatePlacementFilter: (pageIndex, slotId, filter) => {
    pushSnapshot();
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
  },
  resetPlacementEdits: (pageIndex, slotId) => {
    pushSnapshot();
    set((s) => {
      const newPages = [...s.pages];
      if (!newPages[pageIndex]) return s;
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId ? { ...p, adjustments: undefined, filter: undefined, rotation: undefined } : p
        ),
      };
      return { pages: newPages };
    });
  },
  };
});

/* ── Photo Store (照片库) ── */
interface PhotoState {
  photos: Photo[];
  addPhotos: (photos: Photo[]) => void;
  removePhoto: (id: string) => void;
  setPhotos: (photos: Photo[]) => void;
}

export const usePhotoStore = create<PhotoState>((set) => ({
  photos: [],
  addPhotos: (photos) => set((s) => ({ photos: [...s.photos, ...photos] })),
  removePhoto: (id) => set((s) => ({ photos: s.photos.filter((p) => p.id !== id) })),
  setPhotos: (photos) => set({ photos }),
}));

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

const MAX_HISTORY = 50;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  stack: [],
  pointer: -1,

  pushSnapshot: (pages, selectedSlotId) =>
    set((s) => {
      const entry: HistoryEntry = {
        timestamp: Date.now(),
        pages: JSON.parse(JSON.stringify(pages)),
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
    if (pointer < 0) return null;
    const newPtr = pointer - 1;
    set({ pointer: newPtr });
    return newPtr >= 0 ? stack[newPtr] : null;
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
