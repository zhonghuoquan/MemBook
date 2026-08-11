import { create } from 'zustand';
import type {
  ViewMode, PanelTab, EditTab, BottomNavState,
  Toast, StorageMode,
} from '../types';
import { STORAGE_MODE_KEY } from '../types';
import type { TierPattern, GooglePhotosDensity, GooglePhotosLayoutRhythm, GooglePhotosDateGrouping } from '../engine/google-photos-layout';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, STORAGE_KEYS } from '../config/appConfig';
// editorStore 在 setActivePanel 中按需引用，避免顶部循环依赖
import { useEditorStore } from './editorStore';

/* ── 智能编排持久化设置 ── */
export interface SmartLayoutSettings {
  density: GooglePhotosDensity;
  layoutRhythm: GooglePhotosLayoutRhythm;
  dateGrouping: GooglePhotosDateGrouping;
  insertMode: 'end' | 'after';
  insertAfter: string;
  thumbZoom: number;
  previewMode: 'photo' | 'layout';
  selectedPhotoIds: string[];
  selectedPreviewIndex: number;
}

export interface SmartLayoutPerPageOverrides {
  bias: Record<number, { biasX: number; biasY: number }>;
  rhythm: Record<number, GooglePhotosLayoutRhythm>;
  seed: Record<number, number>;
  rotation: Record<number, 0 | 90 | 180 | 270>;
  tierPattern: Record<number, TierPattern>;
  photoPositionSeed: Record<number, number>;
}

/* ── UI Store (视图切换、面板、toast、缩放、存储模式、多选) ── */
interface UIState {
  viewMode: ViewMode;
  activePanel: PanelTab;
  editFlyoutOpen: boolean;
  editFlyoutTab: EditTab;
  editFlyoutCollapsed: boolean; // 照片编辑面板折叠状态，持久化
  isComparingOriginal: boolean; // 按住查看原图
  bottomNav: BottomNavState;
  bottomNavHeight: number;   // 底部导航栏高度 (90-280px)
  canvasZoom: number;        // 0.1 ~ 5.0, 默认 1.0
  storageMode: StorageMode | null;  // null = 尚未选择
  toasts: Toast[];
  isDraggingLayout: boolean; // 底部导航/左侧面板拖拽调整尺寸中

  /* 多选模式 */
  multiSelectMode: boolean;
  selectedProjectIds: string[];

  /* 网格视图 */
  gridZoom: number;           // 网格视图缩放 0.5 ~ 3.0，默认 1.0
  gridSelectedPages: string[];// 网格视图中多选的页面 ID 列表
  hiddenGridPageIds: string[];// 网格视图中被隐藏的页面 ID 列表

  /* 智能编排跨页状态 */
  smartLayoutSelectedIds: string[]; // 从编辑器带入/带回的照片 ID 列表
  smartLayoutSettings: SmartLayoutSettings | null;
  smartLayoutPerPageOverrides: SmartLayoutPerPageOverrides;

  /* 浮动窗口层级 */
  activeFloatingPanel: 'layoutAdjust' | 'layoutSwitch' | 'photoReorder' | null;

  /* 浮动窗口打开状态（持久化，避免切回编辑器后窗口被关闭） */
  layoutAdjustOpen: boolean;
  layoutSwitchOpen: boolean;
  photoReorderOpen: boolean;

  /* 左侧面板宽度（持久化，避免返回主页后丢失用户调整） */
  panelWidth: number;

  /* 数据持久化警告（自动保存连续失败时展示横幅，保存恢复后自动清除） */
  persistWarning: string | null;

  /* 页面显示模式：'full' = 全显（显示页面外内容），'page' = 页面模式（裁剪到页面边界） */
  pageDisplayMode: 'full' | 'page';

  /* 存储模式选择提示（首次导入或重置后让用户选择 import/direct） */
  isStorageModePromptOpen: boolean;
  pendingImportFiles: File[] | null;
  pendingImportOptions: { fallbackTimes?: Map<string, number>; originalPaths?: Map<string, string> } | null;
  /* Tauri 模式下：文件对话框返回的原始路径数组，用户选择存储模式后才读取文件内容 */
  pendingImportPaths: string[] | null;

  /* Actions */
  setViewMode: (mode: ViewMode) => void;
  setActivePanel: (panel: PanelTab) => void;
  setEditFlyoutOpen: (open: boolean) => void;
  setEditFlyoutTab: (tab: EditTab) => void;
  setEditFlyoutCollapsed: (collapsed: boolean) => void;
  setIsComparingOriginal: (v: boolean) => void;
  toggleBottomNav: () => void;
  setBottomNavHeight: (h: number) => void;
  setCanvasZoom: (zoom: number) => void;
  setStorageMode: (mode: StorageMode | null) => void;
  setDraggingLayout: (dragging: boolean) => void;
  requestStorageModeForImport: (files: File[], options?: { fallbackTimes?: Map<string, number>; originalPaths?: Map<string, string> }, paths?: string[]) => void;
  resolveStorageModePrompt: (mode: StorageMode) => void;
  cancelStorageModePrompt: () => void;
  clearPendingImport: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  /* 多选 actions */
  enterMultiSelect: (initialId?: string) => void;
  exitMultiSelect: () => void;
  toggleProjectSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: () => void;
  /* 网格视图 actions */
  setGridZoom: (zoom: number) => void;
  toggleGridPageSelect: (pageId: string) => void;
  setGridSelectedPages: (ids: string[]) => void;
  clearGridSelection: () => void;
  toggleHiddenGridPage: (pageId: string) => void;
  setHiddenGridPageIds: (ids: string[]) => void;
  clearHiddenGridPages: () => void;
  /* 智能编排 actions */
  setSmartLayoutSelectedIds: (ids: string[]) => void;
  setSmartLayoutSettings: (settings: SmartLayoutSettings | null) => void;
  setSmartLayoutPerPageOverrides: (overrides: SmartLayoutPerPageOverrides) => void;
  clearSmartLayoutState: () => void;
  setActiveFloatingPanel: (panel: 'layoutAdjust' | 'layoutSwitch' | 'photoReorder' | null) => void;
  setLayoutAdjustOpen: (open: boolean) => void;
  setLayoutSwitchOpen: (open: boolean) => void;
  setPhotoReorderOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  setPersistWarning: (msg: string | null) => void;
  setPageDisplayMode: (mode: 'full' | 'page') => void;
}

/* 从 localStorage 恢复存储偏好 */
export function loadStorageMode(): StorageMode | null {
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
  editFlyoutTab: 'adjust',
  editFlyoutCollapsed: (() => { try { return localStorage.getItem('membook_flyout_collapsed') === 'true'; } catch { return false; } })(),
  isComparingOriginal: false,
  bottomNav: 'expanded',
  bottomNavHeight: 150,
  canvasZoom: 1.0,
  storageMode: loadStorageMode(),
  toasts: [],
  isDraggingLayout: false,
  multiSelectMode: false,
  selectedProjectIds: [],
  gridZoom: 1.0,
  gridSelectedPages: [],
  hiddenGridPageIds: [],
  smartLayoutSelectedIds: [],
  smartLayoutSettings: null,
  smartLayoutPerPageOverrides: {
    bias: {},
    rhythm: {},
    seed: {},
    rotation: {},
    tierPattern: {},
    photoPositionSeed: {},
  },
  activeFloatingPanel: null,
  layoutAdjustOpen: false,
  layoutSwitchOpen: false,
  photoReorderOpen: false,
  panelWidth: (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PANEL_WIDTH);
      if (saved) {
        const w = parseInt(saved, 10);
        if (!isNaN(w) && w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH) return w;
      }
    } catch { /* ignore */ }
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--layout-panel-width')) || 440;
  })(),
  persistWarning: null,
  pageDisplayMode: 'full',
  isStorageModePromptOpen: false,
  pendingImportFiles: null,
  pendingImportOptions: null,
  pendingImportPaths: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setActivePanel: (panel) => {
    set({ activePanel: panel });
    // 切换离开「工具」面板时自动取消画笔/橡皮擦，避免干扰其他面板操作
    if (panel !== 'tools') {
      const { activeTool, setActiveTool } = useEditorStore.getState();
      if (activeTool === 'brush' || activeTool === 'eraser') {
        setActiveTool('none');
      }
    }
  },
  setEditFlyoutOpen: (open) => set({ editFlyoutOpen: open }),
  setEditFlyoutTab: (tab) => set({ editFlyoutTab: tab }),
  setEditFlyoutCollapsed: (collapsed) => {
    set({ editFlyoutCollapsed: collapsed });
    try { localStorage.setItem('membook_flyout_collapsed', String(collapsed)); } catch { /* ignore */ }
  },
  setIsComparingOriginal: (v) => set({ isComparingOriginal: v }),
  toggleBottomNav: () =>
    set((s) => ({ bottomNav: s.bottomNav === 'expanded' ? 'collapsed' : 'expanded' })),
  setBottomNavHeight: (h) => set({ bottomNavHeight: h }),
  setCanvasZoom: (zoom) => set({ canvasZoom: Math.max(0.1, Math.min(5, zoom)) }),
  setDraggingLayout: (dragging) => set({ isDraggingLayout: dragging }),
  setStorageMode: (mode) => {
    try {
      if (mode) {
        localStorage.setItem(STORAGE_MODE_KEY, mode);
      } else {
        localStorage.removeItem(STORAGE_MODE_KEY);
      }
    } catch { /* ignore */ }
    set({ storageMode: mode });
  },
  requestStorageModeForImport: (files, options, paths) => set({
    pendingImportFiles: files,
    pendingImportOptions: options ?? null,
    pendingImportPaths: paths ?? null,
    isStorageModePromptOpen: true,
  }),
  resolveStorageModePrompt: (mode) => {
    // 只设置 mode 并关闭弹窗，pending 文件/路径由 usePhotoImport 的 effect 消费
    set({
      storageMode: mode,
      isStorageModePromptOpen: false,
    });
  },
  cancelStorageModePrompt: () => set({
    pendingImportFiles: null,
    pendingImportOptions: null,
    pendingImportPaths: null,
    isStorageModePromptOpen: false,
  }),
  clearPendingImport: () => set({
    pendingImportFiles: null,
    pendingImportOptions: null,
    pendingImportPaths: null,
  }),
  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: `toast-${Date.now()}` }] })),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  /* 多选模式 actions */
  enterMultiSelect: (initialId) =>
    set({ multiSelectMode: true, selectedProjectIds: initialId ? [initialId] : [] }),
  exitMultiSelect: () =>
    set({ multiSelectMode: false, selectedProjectIds: [] }),
  toggleProjectSelect: (id) =>
    set((s) => ({
      selectedProjectIds: s.selectedProjectIds.includes(id)
        ? s.selectedProjectIds.filter((pid) => pid !== id)
        : [...s.selectedProjectIds, id],
    })),
  selectAll: (ids) => set({ selectedProjectIds: ids }),
  deselectAll: () => set({ selectedProjectIds: [] }),
  /* 网格视图 actions */
  setGridZoom: (zoom) => set({ gridZoom: Math.max(0.5, Math.min(3.0, zoom)) }),
  toggleGridPageSelect: (pageId) =>
    set((s) => ({
      gridSelectedPages: s.gridSelectedPages.includes(pageId)
        ? s.gridSelectedPages.filter((id) => id !== pageId)
        : [...s.gridSelectedPages, pageId],
    })),
  setGridSelectedPages: (ids) => set({ gridSelectedPages: ids }),
  clearGridSelection: () => set({ gridSelectedPages: [] }),
  toggleHiddenGridPage: (pageId) =>
    set((s) => ({
      hiddenGridPageIds: s.hiddenGridPageIds.includes(pageId)
        ? s.hiddenGridPageIds.filter((id) => id !== pageId)
        : [...s.hiddenGridPageIds, pageId],
    })),
  setHiddenGridPageIds: (ids) => set({ hiddenGridPageIds: ids }),
  clearHiddenGridPages: () => set({ hiddenGridPageIds: [] }),
  /* 智能编排 actions */
  setSmartLayoutSelectedIds: (ids) => set({ smartLayoutSelectedIds: ids }),
  setSmartLayoutSettings: (settings) => set({ smartLayoutSettings: settings }),
  setSmartLayoutPerPageOverrides: (overrides) => set({ smartLayoutPerPageOverrides: overrides }),
  clearSmartLayoutState: () => set({
    smartLayoutSelectedIds: [],
    smartLayoutSettings: null,
    smartLayoutPerPageOverrides: {
      bias: {},
      rhythm: {},
      seed: {},
      rotation: {},
      tierPattern: {},
      photoPositionSeed: {},
    },
  }),
  setActiveFloatingPanel: (panel) => set({ activeFloatingPanel: panel }),
  setLayoutAdjustOpen: (open) => set({ layoutAdjustOpen: open }),
  setLayoutSwitchOpen: (open) => set({ layoutSwitchOpen: open }),
  setPhotoReorderOpen: (open) => set({ photoReorderOpen: open }),
  setPanelWidth: (width) => {
    const clamped = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
    set({ panelWidth: clamped });
    try { localStorage.setItem(STORAGE_KEYS.PANEL_WIDTH, String(clamped)); } catch { /* ignore */ }
  },
  setPersistWarning: (msg) => set({ persistWarning: msg }),
  setPageDisplayMode: (mode) => set({ pageDisplayMode: mode }),
}));
