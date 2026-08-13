import type { StateCreator } from 'zustand';
import type {
  AlbumPage, PhotoAdjustments, AlbumSize, SlotOverride, PageMarginSettings, AlbumTypeId,
  EditorTool, BrushStroke, BrushSettings, StickyNote, PageTextElement, StickerElement, ShapeElement, ShapeType, WatermarkSettings,
} from '../../types';

/* ── Editor Store (当前编辑状态) ── */

/* ── 选区管理 ── */
/* 多选元素类型：支持跨类型多选（槽位/文字/便利贴/贴纸）
 * 当 multiSelectedElements 长度 >= 2 时为多选模式：
 *   - 全同类型：显示批量操作工具栏（删除/置顶/置底）
 *   - 跨类型：不显示工具栏，仅支持整体移动
 * 单选时 multiSelectedElements 为空，使用 selectedSlotId/selectedTextId 等单选字段
 */
export type SelectedElementType = 'slot' | 'text' | 'sticky' | 'sticker' | 'shape';
export type SelectedElement = { type: SelectedElementType; id: string };

export interface SelectionSlice {
  selectedSlotId: string | null;
  selectedPhotoId: string | null;
  multiSelectedSlots: string[];
  /* 文字元素 / 便利贴 / 贴纸选中态（提升到 store 以便全局访问，如 BottomNav 快捷键复制） */
  selectedTextId: string | null;
  selectedStickyId: string | null;
  selectedStickerId: string | null;
  selectedShapeId: string | null;
  /* 通用多选列表：支持同类型/跨类型多选，与 multiSelectedSlots 并存（后者仅用于槽位框选兼容） */
  multiSelectedElements: SelectedElement[];
  setSelectedSlot: (slotId: string | null) => void;
  setSelectedPhoto: (photoId: string | null) => void;
  setMultiSelectedSlots: (slots: string[]) => void;
  setSelectedTextId: (id: string | null) => void;
  setSelectedStickyId: (id: string | null) => void;
  setSelectedStickerId: (id: string | null) => void;
  setSelectedShapeId: (id: string | null) => void;
  /** Ctrl+click 切换元素多选状态：加入或移出 multiSelectedElements */
  toggleMultiSelect: (element: SelectedElement) => void;
  /** 直接设置多选列表（框选等场景） */
  setMultiSelectedElements: (elements: SelectedElement[]) => void;
  /** 清空多选列表（单选时调用） */
  clearMultiSelect: () => void;
  clearSelection: () => void;
}

/* ── 页面增删改查 ── */
export interface PageSlice {
  pages: AlbumPage[];
  currentPageIndex: number;
  setCurrentPage: (index: number) => void;
  addPage: (templateId?: string) => void;
  insertPage: (index: number, templateId?: string) => void;
  copyPage: (index: number) => void;
  removePage: (index: number) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  setPages: (pages: AlbumPage[]) => void;
  /** 批量操作：在指定位置插入页面并跳转（一次 setState 避免双重重渲染） */
  appendPages: (afterIndex: number, newPages: AlbumPage[]) => void;
  setPageTemplate: (pageIndex: number, templateId: string, preservePhotoIds?: string[]) => void;
  updatePageBackground: (index: number, color: string) => void;
  applyBackgroundToAllPages: (color: string) => void;
  /** 重置当前页所有照片位到当前边距的布局 */
  resetPageLayout: (pageIndex: number) => void;
  /** 在当前页添加一个照片槽位（默认居中，30%×30%，百分比坐标） */
  addPhotoSlot: () => void;
  /** 应用封面模板：插入封面页或切换已有封面的模板（保留已填照片） */
  applyCoverTemplate: (templateId: string) => void;
  /** 应用封底模板：插入封底页或切换已有封底的模板 */
  applyBackCoverTemplate: (templateId: string) => void;
}

/* ── 槽位/照片编辑 ──
 * 注意：removeSlotFromPage / addPhotoToPage / shufflePagePhotos / rotatePageLayout /
 * shufflePageLayout / convertPageToGooglePhotos / rotatePhoto / updatePlacementPanRotation
 * 等涉及 photoStore / uiStore 的跨域编排已下沉到 services 层。
 */
export interface PlacementSlice {
  placePhoto: (pageIndex: number, slotId: string, photoId: string) => void;
  /** 切换照片槽位阴影开关（per-placement） */
  toggleShadow: (pageIndex: number, slotId: string) => void;
  /** 批量设置多个槽位的阴影开关（统一 pushSnapshot 一次） */
  batchSetShadow: (pageIndex: number, slotIds: string[], shadow: boolean) => void;
  removePhotoFromSlot: (pageIndex: number, slotId: string) => void;
  /** 仅 Google Photos 页面：保持槽几何不变，交换两个照片位置（photoId 及编辑状态跟随照片走） */
  swapPagePhotoPlacements: (pageIndex: number, fromIndex: number, toIndex: number) => boolean;
  /* 照片编辑 */
  updatePlacementRotation: (pageIndex: number, slotId: string, rotation: number) => void;
  updatePlacementAdjustments: (pageIndex: number, slotId: string, adjustments: PhotoAdjustments) => void;
  updatePlacementFilter: (pageIndex: number, slotId: string, filter: string | null) => void;
  updatePlacementPan: (pageIndex: number, slotId: string, panX: number, panY: number, panScale?: number, recordHistory?: boolean) => void;
  resetPlacementPan: (pageIndex: number, slotId: string) => void; // 仅重置pan，保留调整/滤镜/翻转
  updatePlacementFlip: (pageIndex: number, slotId: string, flipH?: boolean, flipV?: boolean) => void;
  updatePlacementFilterIntensity: (pageIndex: number, slotId: string, intensity: number) => void;
  resetPlacementEdits: (pageIndex: number, slotId: string) => void;
  /* 照片位自由编辑 */
  updateSlotOverride: (pageIndex: number, slotId: string, override: SlotOverride) => void;
  batchUpdateSlotOverrides: (pageIndex: number, updates: { slotId: string; override: SlotOverride }[]) => void;
  resetSlotOverride: (pageIndex: number, slotId: string) => void;
  /* ── 槽位层级 ── */
  bringSlotToFront: (pageIndex: number, slotId: string) => void;
  sendSlotToBack: (pageIndex: number, slotId: string) => void;
}

/* ── 相册元数据 ── */
export interface AlbumMetaSlice {
  albumSize: AlbumSize | null;
  projectName: string;
  /** 相册类型（用于封面场景化引言与配色） */
  albumType: AlbumTypeId | undefined;
  pageMargin: PageMarginSettings;
  applyMarginToAll: boolean;
  slotGap: number;
  defaultSlotCornerRadius: number;
  showGuides: boolean;
  showMarginGuide: boolean;
  setProjectName: (name: string) => void;
  setAlbumSize: (size: AlbumSize) => void;
  /** 设置相册类型（封面场景化引言与配色） */
  setAlbumType: (albumType: AlbumTypeId | undefined) => void;
  /** 批量应用页面设置（边距+间距+圆角+开关），一次 Store 写入避免中间态跳变 */
  batchPageSettings: (params: {
    margin: PageMarginSettings; gap: number; cornerRadius: number;
    applyAll: boolean; showGuides: boolean; showMarginGuide: boolean;
  }) => void;
  setPageMargin: (margin: PageMarginSettings) => void;
  setApplyMarginToAll: (v: boolean) => void;
  setSlotGap: (gap: number) => void;
  setDefaultSlotCornerRadius: (r: number) => void;
  /** 设置当前页的槽位圆角（按页独立，开启"应用到全部页面"时同步所有页） */
  setPageSlotCornerRadius: (pageIndex: number, r: number) => void;
  setShowGuides: (v: boolean) => void;
  setShowMarginGuide: (v: boolean) => void;
}

/* ── 工具模式 ── */
export interface ToolsSlice {
  activeTool: EditorTool;
  brushSettings: BrushSettings;
  /* 自动编辑信号：ToolsPanel 添加文字后通知 Canvas 打开内联编辑器 */
  pendingTextEditId: string | null;
  /* 待绘制形状类型：选中形状图标后，进入 shape 工具模式，等待在工作区拖拽绘制 */
  pendingShapeType: ShapeType | null;
  setActiveTool: (tool: EditorTool) => void;
  setBrushSettings: (patch: Partial<BrushSettings>) => void;
  setPendingTextEditId: (id: string | null) => void;
  setPendingShapeType: (type: ShapeType | null) => void;
}

/* ── 画笔/便利贴/文字/贴纸/层级 ── */
export interface DecorationsSlice {
  /* ── 画笔 ── */
  addBrushStroke: (pageIndex: number, stroke: BrushStroke) => void;
  removeBrushStroke: (pageIndex: number, strokeId: string) => void;
  /* ── 便利贴 ── */
  addStickyNote: (pageIndex: number, note: StickyNote) => void;
  updateStickyNote: (pageIndex: number, noteId: string, patch: Partial<StickyNote>, recordHistory?: boolean) => void;
  removeStickyNote: (pageIndex: number, noteId: string) => void;
  /* ── 文字 ── */
  addTextElement: (pageIndex: number, el: PageTextElement) => void;
  updateTextElement: (pageIndex: number, elId: string, patch: Partial<PageTextElement>, recordHistory?: boolean) => void;
  removeTextElement: (pageIndex: number, elId: string) => void;
  /* ── 贴纸 ── */
  addStickerElement: (pageIndex: number, sticker: StickerElement) => void;
  updateStickerElement: (pageIndex: number, stickerId: string, patch: Partial<StickerElement>, recordHistory?: boolean) => void;
  removeStickerElement: (pageIndex: number, stickerId: string) => void;
  /* ── 形状 ── */
  addShapeElement: (pageIndex: number, shape: ShapeElement) => void;
  updateShapeElement: (pageIndex: number, shapeId: string, patch: Partial<ShapeElement>, recordHistory?: boolean) => void;
  removeShapeElement: (pageIndex: number, shapeId: string) => void;
  /* ── 层级 ── */
  bringToFront: (pageIndex: number, type: 'brush' | 'sticky' | 'text' | 'sticker' | 'shape', id: string) => void;
  sendToBack: (pageIndex: number, type: 'brush' | 'sticky' | 'text' | 'sticker' | 'shape', id: string) => void;
}

/* ── 水印 ── */
export interface WatermarkSlice {
  /* ── 水印设置 ── */
  watermarkSettings: WatermarkSettings;
  setWatermarkSettings: (settings: WatermarkSettings) => void;
  /* ── 单页水印覆盖 ── */
  setPageWatermarkTextOverride: (pageIndex: number, text: string | null) => void;
  resetPageWatermark: (pageIndex: number) => void;
  setPageWatermarkHidden: (pageIndex: number, hidden: boolean) => void;
}

export type EditorState =
  & SelectionSlice
  & PageSlice
  & PlacementSlice
  & AlbumMetaSlice
  & ToolsSlice
  & DecorationsSlice
  & WatermarkSlice;

export type EditorSlice<T> = StateCreator<EditorState, [], [], T>;
