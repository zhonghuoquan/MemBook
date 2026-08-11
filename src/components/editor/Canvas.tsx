import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Circle, Transformer, Group, Text, Line } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, usePhotoStore, useUIStore, useHistoryStore } from '../../store';
import { resolveTemplate, DEFAULT_SLOT_CORNER_RADIUS, getSlotZIndex, BRUSH_STYLE_MAP } from '../../types';
import { SLOT_CANVAS_PALETTE, SLOT_BORDER_COLORS } from '../../constants/templatePalette';
import { useTheme } from '../../contexts/ThemeContext';
import type { Template, SlotLayout, PhotoPlacement, Photo, PageTextElement, StickyNote, StickerElement } from '../../types';
import type { GuideLine, GuideType, AlignBounds } from '../../engine/alignment-engine';
import { findSnap } from '../../engine/alignment-engine';
import { dragState } from '../../engine/drag-manager';
import { onStickerDragStateChange, type StickerDragState } from '../../engine/sticker-drag';
import { setKonvaStage } from '../../engine/stage-handle';
import { useMarqueeGroupSelect } from './canvas/useMarqueeGroupSelect';
import { useMultiElementGroupSelect } from './canvas/useMultiElementGroupSelect';
import { shouldShowWatermark, getWatermarkText, calcWatermarkFontSize, calcWatermarkPosition, calcPageSafeArea, WATERMARK_FONT_STACK } from '../../utils/watermarkRenderer';
import { DEFAULT_WATERMARK_SETTINGS } from '../../types';
import { calcCoverFitWithRotation, computePhotoBounds, computePanForResizedSlot, clampPhotoToSlotBounds } from '../../utils/photoGeometry';
import { CANVAS_WORKSPACE_EXTRA } from '../../utils/sharedRender';
import { isActivated } from '../../license/licenseService';
import { DEFAULT_W, DEFAULT_H, MM_TO_PX, MIN_SLOT_SIZE, applySlotResizeConstraints, isDarkBackground, getTextureBaseColor } from './canvas/constants';
import { usePanZoom } from './canvas/usePanZoom';
import { PageBackgroundRect } from './canvas/PageBackground';
import { CanvasEmptyState } from './canvas/CanvasEmptyState';
import { EraserCursor, BrushCursor } from './canvas/ToolCursors';
import { RotationIcon } from './canvas/RotationIcon';
import { StickyNoteNode } from './canvas/StickyNoteNode';
import { TextElementNode } from './canvas/TextElementNode';
import { StickerNode } from './canvas/StickerNode';
import { CanvasPhotoRenderer, DragPreviewPhoto } from './canvas/CanvasPhotoRenderer';
import { useCanvasCentering } from './canvas/useCanvasCentering';
import { useCanvasWheel } from './canvas/useCanvasWheel';
import { useCanvasKeyboard } from './canvas/useCanvasKeyboard';
import { useDragDrop } from './canvas/useDragDrop';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { pageLayoutService } from '../../services/pageLayoutService';
import { slotEditService } from '../../services/slotEditService';
import { useTranslation } from 'react-i18next';

export function Canvas() {
  const { resolved } = useTheme();
  const { t } = useTranslation();
  const workspaceBg = resolved === 'dark' ? '#252525' : '#F1F3F5';

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageNodeRef = useRef<Konva.Image>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const guidesLayerRef = useRef<Konva.Layer>(null);
  const coverFitRef = useRef({ w: 0, h: 0 });     // 存储原始覆盖尺寸
  const guideNodePoolRef = useRef<Map<string, Konva.Line>>(new Map()); // 引导线节点池（轻量化：单个 Line）
  const altKeyRef = useRef(false); // Alt 键状态：按住时禁用吸附
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [, setGuides] = useState<GuideLine[]>([]);

  // 工作区滚动条悬浮显隐：合并到 containerRef，页面放大超过视口时可见
  const canvasScroll = useScrollbarVisibility<HTMLDivElement>({ externalRef: containerRef, hideDelay: 1500 });

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  // 只订阅当前页，避免其他页面改动触发整片 Canvas 重渲染
  const currentPage = useEditorStore((s) => s.pages[s.currentPageIndex]);
  const pagesLength = useEditorStore((s) => s.pages.length);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  // 通用多选（跨类型）：Ctrl+click 切换 + 框选 统一使用 multiSelectedElements
  const multiSelectedElements = useEditorStore((s) => s.multiSelectedElements);
  const setMultiSelectedElements = useEditorStore((s) => s.setMultiSelectedElements);
  const toggleMultiSelect = useEditorStore((s) => s.toggleMultiSelect);
  const clearMultiSelect = useEditorStore((s) => s.clearMultiSelect);

  // ── 单槽位拖拽缩放实时预览尺寸 ──
  const [, setResizePreview] = useState<{ slotId: string | null; x: number; y: number; w: number; h: number }>({ slotId: null, x: 0, y: 0, w: 0, h: 0 });

  // 编辑模式下拖拽/缩放触发 Tick（驱动控制点实时更新）
  const [, setEditPosTick] = useState(0);
  const bumpEditTick = useCallback(() => { setEditPosTick((t) => t + 1); setShowGrid(true); }, []);
  // 三分法网格线：移动/缩放时显示，静止时隐藏
  const [showGrid, setShowGrid] = useState(false);

  // 设置全局舞台引用（集中管理，替代 window.__KONVA_STAGE__）
  const stageCallbackRef = useCallback((node: Konva.Stage | null) => {
    (stageRef as React.MutableRefObject<Konva.Stage | null>).current = node;
    setKonvaStage(node);
  }, []);

  // P0-fix: 组件卸载时销毁 Konva Stage，释放 Layer/Group/Image 节点持有的位图引用。
  //   之前不销毁 → Stage 内部对象图（Layer → Group → Konva.Image → CanvasImageSource）
  //   在 EditorView 卸载后仍驻留内存，Konva.Image 节点持有的 ImageBitmap 不被 GC。
  //   stage.destroy() 会递归销毁所有子节点并解绑事件，是 Konva 官方推荐的释放方式。
  useEffect(() => {
    return () => {
      const stage = stageRef.current;
      if (stage) {
        try {
          stage.destroy();
        } catch { /* ignore */ }
        (stageRef as React.MutableRefObject<Konva.Stage | null>).current = null;
        setKonvaStage(null);
      }
    };
  }, []);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const albumSize = useEditorStore((s) => s.albumSize);
  const photos = usePhotoStore((s) => s.photos);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const pageDisplayMode = useUIStore((s) => s.pageDisplayMode);
  const canvasZoomRef = useRef(canvasZoom);
  canvasZoomRef.current = canvasZoom;
  // 自定义控制点 refs（角点圆形 + 边点长方块，叠加在透明 Transformer 锚点上）
  const customHandleRefs = useRef<{
    tl: Konva.Circle | null; tc: Konva.Rect | null; tr: Konva.Circle | null;
    ml: Konva.Rect | null; mr: Konva.Rect | null;
    bl: Konva.Circle | null; bc: Konva.Rect | null; br: Konva.Circle | null;
  }>({ tl: null, tc: null, tr: null, ml: null, mr: null, bl: null, bc: null, br: null });
  // 槽位缩放到最小时的边缘锁定（防止位置漂移）
  const slotLockRef = useRef({
    rightEdge: null as number | null, bottomEdge: null as number | null,
    prevX: 0, prevRawW: 0, prevY: 0, prevRawH: 0,
    lastX: 0, lastY: 0, lastW: 0, lastH: 0, // 最后一次拖拽的浮动值（松手时同步用）
  });
  // 槽位缩放开始时的状态（用于保持照片相对位置）
  const resizeStartRef = useRef<{
    slotId: string;
    x: number; y: number; w: number; h: number;
    panX?: number; panY?: number; panScale: number;
    photoW: number; photoH: number; rotation: number;
  } | null>(null);
  // 自由旋转辅助 ref（编辑模式下拖拽旋转图标使用）
  const freeRotateBaseRef = useRef(0);
  const freeCenterRef = useRef({ x: 0, y: 0 });
  const wheelHideGridTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shift 键状态（用于 Transformer boundBoxFunc 中切换宽高比锁定）
  const shiftKeyRef = useRef(false);
  /* ── 工具模式 ── */
  const activeTool = useEditorStore((s) => s.activeTool);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const addBrushStroke = useEditorStore((s) => s.addBrushStroke);
  const removeBrushStroke = useEditorStore((s) => s.removeBrushStroke);
  const updateStickyNote = useEditorStore((s) => s.updateStickyNote);
  // 画笔/橡皮擦工具模式下，所有页面内容元素禁用交互（listening=false），
  // 让点击事件穿透到 Stage，由 Stage 的 onMouseDown 统一处理绘制。
  // 笔迹在橡皮擦模式下单独保持 listening=true 以支持点击擦除。
  const isToolMode = activeTool === 'brush' || activeTool === 'eraser';
  const removeStickyNote = useEditorStore((s) => s.removeStickyNote);
  const updateTextElement = useEditorStore((s) => s.updateTextElement);
  const removeTextElement = useEditorStore((s) => s.removeTextElement);
  const addStickerElement = useEditorStore((s) => s.addStickerElement);
  const updateStickerElement = useEditorStore((s) => s.updateStickerElement);
  const removeStickerElement = useEditorStore((s) => s.removeStickerElement);
  const bringToFront = useEditorStore((s) => s.bringToFront);
  const sendToBack = useEditorStore((s) => s.sendToBack);
  const bringSlotToFront = useEditorStore((s) => s.bringSlotToFront);
  const sendSlotToBack = useEditorStore((s) => s.sendSlotToBack);
  const removePhotoFromSlot = useEditorStore((s) => s.removePhotoFromSlot);
  const toggleShadow = useEditorStore((s) => s.toggleShadow);
  const batchSetShadow = useEditorStore((s) => s.batchSetShadow);

  /* ── 画笔绘制状态 ── */
  const isDrawingRef = useRef(false);
  const brushPointsRef = useRef<number[]>([]);
  // 实时显示当前绘制的笔迹
  const [activeStrokePts, setActiveStrokePts] = useState<number[]>([]);
  // 用于便利贴和文字拖拽
  const [, setDraggingElementId] = useState<string | null>(null);

  /* ── 文字选中&编辑状态 ── */
  // selectedTextId / selectedStickyId 提升到 editorStore，便于 BottomNav 等全局快捷键访问
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const setSelectedTextId = useEditorStore((s) => s.setSelectedTextId);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── 自动编辑：ToolsPanel 添加文字后触发 ── */
  const pendingTextEditId = useEditorStore((s) => s.pendingTextEditId);
  const setPendingTextEditId = useEditorStore((s) => s.setPendingTextEditId);

  /* ── 便利贴浮动工具栏 ── */
  const selectedStickyId = useEditorStore((s) => s.selectedStickyId);
  const setSelectedStickyId = useEditorStore((s) => s.setSelectedStickyId);

  /* ── 贴纸选中状态 ── */
  const selectedStickerId = useEditorStore((s) => s.selectedStickerId);
  const setSelectedStickerId = useEditorStore((s) => s.setSelectedStickerId);

  /* ── 时间水印选中&编辑状态 ── */
  const [selectedWatermark, setSelectedWatermark] = useState(false);
  const [editingWatermark, setEditingWatermark] = useState(false);
  const watermarkNodeRef = useRef<Konva.Text>(null);
  const watermarkToolbarRef = useRef<HTMLDivElement>(null);
  const watermarkInputRef = useRef<HTMLSpanElement>(null);

  // 水印进入编辑状态时初始化文本、聚焦并全选
  useEffect(() => {
    if (editingWatermark && watermarkInputRef.current && currentPage && albumSize) {
      const el = watermarkInputRef.current;
      const pages = useEditorStore.getState().pages;
      const defaultText = getWatermarkText(currentPageIndex, pages, photos, watermarkSettings);
      const text = currentPage.watermarkTextOverride ?? defaultText;
      el.textContent = text;
      requestAnimationFrame(() => {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingWatermark]);

  const setPageWatermarkTextOverride = useEditorStore((s) => s.setPageWatermarkTextOverride);
  const resetPageWatermark = useEditorStore((s) => s.resetPageWatermark);
  const setPageWatermarkHidden = useEditorStore((s) => s.setPageWatermarkHidden);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const editFlyoutOpen = useUIStore((s) => s.editFlyoutOpen);
  const setEditFlyoutOpen = useUIStore((s) => s.setEditFlyoutOpen);
  const setEditFlyoutTab = useUIStore((s) => s.setEditFlyoutTab);
  const addToast = useUIStore((s) => s.addToast);
  const updateSlotOverride = useEditorStore((s) => s.updateSlotOverride);
  const pageMargin = useEditorStore((s) => s.pageMargin);
  const slotGap = useEditorStore((s) => s.slotGap);
  const defaultSlotCornerRadius = useEditorStore((s) => s.defaultSlotCornerRadius);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showMarginGuide = useEditorStore((s) => s.showMarginGuide);
  const rawWatermarkSettings = useEditorStore((s) => s.watermarkSettings ?? DEFAULT_WATERMARK_SETTINGS);
  const watermarkSettings = useMemo(
    () => (isActivated() ? rawWatermarkSettings : { ...rawWatermarkSettings, enabled: false }),
    [rawWatermarkSettings],
  );

  // 预加载水印字体，防止 Tauri/WebView2 首次绘制时字体未就绪导致空白
  useEffect(() => {
    if (!currentPage || !albumSize) return;
    const fontSize = calcWatermarkFontSize();
    document.fonts.load(`italic ${fontSize}px ${WATERMARK_FONT_STACK}`).then(() => {
      stageRef.current?.batchDraw();
    });
  }, [currentPageIndex, watermarkSettings, albumSize, currentPage]);

  // 画布尺寸：根据用户选择的相册尺寸（mm）换算为像素
  const CANVAS_W = albumSize ? albumSize.width * MM_TO_PX : DEFAULT_W;
  const CANVAS_H = albumSize ? albumSize.height * MM_TO_PX : DEFAULT_H;

  // Canva 模式：Stage 大于容器以保留平移/缩放锚点空间，页面在内容 Group 中保持逻辑坐标
  const STAGE_W = Math.max(containerSize.w + CANVAS_WORKSPACE_EXTRA * 2, (CANVAS_W + 200) * canvasZoom);
  const STAGE_H = Math.max(containerSize.h + CANVAS_WORKSPACE_EXTRA * 2, (CANVAS_H + 200) * canvasZoom);

  // 缩放后的内容 Group 定位（Stage 空间）
  // 公式：Group 中心 = Stage 中心 → groupOX + CANVAS_W * canvasZoom / 2 = STAGE_W / 2
  const groupOX = Math.round((STAGE_W - CANVAS_W * canvasZoom) / 2);
  const groupOY = Math.round((STAGE_H - CANVAS_H * canvasZoom) / 2);
  // 空格键拖拽平移画布（逻辑提取至 usePanZoom hook）
  usePanZoom({ containerRef, canvasW: CANVAS_W, canvasH: CANVAS_H, canvasZoom });

  /* ── 自动编辑：ToolsPanel 添加文字/便利贴后触发 ── */
  useEffect(() => {
    if (!pendingTextEditId || !currentPage) return;
    // 先在文字元素中查找
    const textEl = currentPage.textElements?.find((e) => e.id === pendingTextEditId);
    if (textEl) {
      setSelectedStickyId(null);
      setSelectedTextId(textEl.id);
      setEditingTextId(textEl.id);
      setPendingTextEditId(null);
      return;
    }
    // 再在便利贴中查找
    const stickyNote = currentPage.stickyNotes?.find((n) => n.id === pendingTextEditId);
    if (stickyNote) {
      setSelectedTextId(null);
      setSelectedStickyId(stickyNote.id);
      setEditingTextId(stickyNote.id);
      setPendingTextEditId(null);
    }
  }, [pendingTextEditId, currentPage, setPendingTextEditId, setSelectedTextId, setSelectedStickyId]);

  const slotCornerRadius = currentPage?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
  const template: Template | undefined = currentPage
    ? resolveTemplate(currentPage)
    : undefined;

  const isEditing = !!(editFlyoutOpen && selectedSlotId);

  /* ── 槽位排序（按 slotOrder） ── */
  const sortedSlots = useMemo(() => {
    if (!template) return [];
    const order = currentPage?.slotOrder || template.slots.map((s) => s.id);
    return [...template.slots].sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999);
    });
  }, [template, currentPage?.slotOrder]);

  /* ── 预构建查找表，消除渲染循环中的 O(n²) find ── */
  const placementMap = useMemo(() => {
    const map = new Map<string, PhotoPlacement>();
    if (!currentPage) return map;
    for (const p of currentPage.placements) map.set(p.slotId, p);
    return map;
  }, [currentPage?.placements]);

  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    for (const p of photos) map.set(p.id, p);
    return map;
  }, [photos]);

  const slotMap = useMemo(() => {
    const map = new Map<string, SlotLayout>();
    if (!template) return map;
    for (const s of template.slots) map.set(s.id, s);
    return map;
  }, [template]);

  /* 模板原始槽位索引 → 用于取配色（不受 slotOrder 排序影响） */
  const slotIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!template) return map;
    template.slots.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [template]);

  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  // 拖拽回调需要的 ref（避免 useEffect([]) 闭包陷阱）
  const dragOverSlotRef = useRef<string | null>(null);
  dragOverSlotRef.current = dragOverSlotId;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const [isOverPage, setIsOverPage] = useState(false);
  // 拖到页面空白区时暂存待添加照片（仅 GP 页面），等待用户确认后重排
  const [pendingAddPhoto, setPendingAddPhoto] = useState<{ photoIds: string[]; pageIndex: number } | null>(null);

  // ── 页面居中 / 初始适配（逻辑提取至 useCanvasCentering hook）──
  useCanvasCentering({
    containerRef, pagesLength, albumSizeId: albumSize?.id, currentPageId: currentPage?.id,
    CANVAS_W, CANVAS_H, STAGE_W, STAGE_H, canvasZoom, setCanvasZoom,
    containerSize, setContainerSize,
  });

  // ── Attach transformer: slot-box (normal) OR photo image node (editing) ──
  const slotRef = useRef(selectedSlotId);
  slotRef.current = selectedSlotId;
  const imagePollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;
    const stage = stageRef.current;
    if (isEditing) {
      // 编辑模式：Transformer 绑定到照片节点，只允许四个角点等比缩放；槽位框固定不可操作
      let cancelled = false;
      if (imagePollTimer.current) { clearInterval(imagePollTimer.current); imagePollTimer.current = null; }

      const attachImage = () => {
        if (cancelled) return;
        const sid = slotRef.current;
        const node = imageNodeRef.current || stage.findOne(`#slot-${sid} .editableImage`);
        if (!node) return;
        transformerRef.current?.keepRatio(true);
        transformerRef.current?.enabledAnchors(['top-left', 'top-right', 'bottom-right', 'bottom-left']);
        transformerRef.current?.rotateEnabled(false);
        transformerRef.current?.nodes([node]);
        transformerRef.current?.getLayer()?.batchDraw();
      };

      const tryAttach = (retry: number) => {
        if (cancelled) return;
        const node = imageNodeRef.current || stage.findOne(`#slot-${slotRef.current} .editableImage`);
        if (node) {
          attachImage();
        } else if (retry > 0) {
          setTimeout(() => tryAttach(retry - 1), 30);
        }
      };
      tryAttach(10);
      return () => { cancelled = true; };
    } else if (selectedSlotId) {
      // 普通选中：短重试确保首次渲染时 Konva 节点就绪
      let cancelled = false;
      const tryAttach = (retry: number) => {
        if (cancelled || slotRef.current !== selectedSlotId) return;
        const node = stage.findOne(`#slot-box-${selectedSlotId}`);
        if (node) {
          transformerRef.current?.keepRatio(false);
          transformerRef.current?.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
          transformerRef.current?.rotateEnabled(false);
          transformerRef.current?.nodes([node]);
          transformerRef.current?.getLayer()?.batchDraw();
        } else if (retry > 0) {
          setTimeout(() => tryAttach(retry - 1), 30);
        }
      };
      tryAttach(5); // 5 次 × 30ms = 150ms 足够
      return () => { cancelled = true; };
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedSlotId, currentPageIndex, currentPage?.placements, isEditing]);

  // ── Wheel 处理逻辑提取至 useCanvasWheel hook（在 slot 函数定义后调用）──

  // ── 框选（仅负责框选检测，产出 multiSelectedElements）──
  const marqueeGroup = useMarqueeGroupSelect({
    stageRef, template, currentPage,
    canvasZoom, groupOX, groupOY, CANVAS_W, CANVAS_H,
    clearSelection,
    setMultiSelectedElements,
    resetTransientUI: () => { setGuides([]); clearGuideLines(); },
  });

  // ── 跨类型多选包围盒（multiSelectedElements：slot/text/sticky/sticker，统一处理包围盒/缩放/移动）──
  const multiElementGroup = useMultiElementGroupSelect({
    stageRef, template, currentPage, currentPageIndex, multiSelectedElements,
    canvasZoom, groupOX, groupOY, CANVAS_W, CANVAS_H,
  });
  const { previewRectMap: multiPreviewRectMap } = multiElementGroup;

  // ── Keyboard 快捷键（逻辑提取至 useCanvasKeyboard hook）──
  useCanvasKeyboard({
    shiftKeyRef, altKeyRef, containerRef,
    canvasZoom, selectedSlotId, currentPageIndex, editFlyoutOpen,
    editingTextId, selectedTextId, selectedStickyId, selectedStickerId,
    multiSelectedElements, clearMultiSelect,
    CANVAS_W, CANVAS_H,
    setSelectedSlot, setCanvasZoom,
    setEditingTextId, setSelectedTextId, setSelectedStickyId, setSelectedStickerId,
    addToast, removeTextElement, removeStickyNote, removeStickerElement,
  });

  // ── 拖拽缩略图跟随鼠标（含点击偏移用于居中）──
  const [dragThumb, setDragThumb] = useState<{ x: number; y: number; ox: number; oy: number; photoIds: string[]; dismissing?: boolean } | null>(null);

  // ── 拖放逻辑（逻辑提取至 useDragDrop hook）──
  useDragDrop({
    stageRef, containerRef, groupOX, groupOY, canvasZoom, CANVAS_W, CANVAS_H,
    currentPageIndexRef, dragOverSlotRef,
    setIsDraggingFile, setIsOverPage, setDragOverSlotId, setPendingAddPhoto, setDragThumb,
  });

  // ── 选中态残留清理：元素被删除或切页后，若选中的便利贴/贴纸已不存在则清空选中态 ──
  // 修复 P0：原在 JSX 渲染回调中调用 setSelectedXxxId 触发 React 警告（渲染期间 setState），
  // 改为在 useEffect 中安全清理。
  useEffect(() => {
    if (selectedStickyId && currentPage && !currentPage.stickyNotes?.some((n) => n.id === selectedStickyId)) {
      setSelectedStickyId(null);
    }
  }, [selectedStickyId, currentPage, setSelectedStickyId]);

  useEffect(() => {
    if (selectedStickerId && currentPage && !currentPage.stickerElements?.some((s) => s.id === selectedStickerId)) {
      setSelectedStickerId(null);
    }
  }, [selectedStickerId, currentPage, setSelectedStickerId]);

  // ── 贴纸拖放：监听 sticker-drag 系统，鼠标释放时在画布上添加贴纸 ──
  // P0-fix 性能优化：原实现将 stickerDragPreview 作为 React state，每次 mousemove 都
  //   setStickerDragPreview → Canvas 重渲染（巨大组件）→ effect 拆销+重建订阅，每秒 60+ 次。
  //   对比照片拖拽（useDragDrop effect 依赖不含拖拽数据，订阅稳定），贴纸明显卡顿。
  //   优化：用 ref 存最新拖拽数据（callback 始终读 ref，无闭包陈旧），预览位置用 DOM 直操
  //   transform（不触发 React 重渲染），active 用 boolean state（仅开始/结束切换一次）。
  const [stickerDragActive, setStickerDragActive] = useState(false);
  const stickerDragStateRef = useRef<StickerDragState | null>(null);
  const stickerPreviewRef = useRef<HTMLDivElement>(null);
  // 用 ref 保存最新的布局参数（避免 effect 依赖变化导致重新订阅）
  const layoutParamsRef = useRef({ groupOX, groupOY, canvasZoom, CANVAS_W, CANVAS_H });
  layoutParamsRef.current = { groupOX, groupOY, canvasZoom, CANVAS_W, CANVAS_H };

  useEffect(() => {
    const unsub = onStickerDragStateChange((state) => {
      if (state.active) {
        // 拖拽中：更新 ref + DOM 直操预览位置（不触发 React 重渲染）
        stickerDragStateRef.current = { ...state };
        // 首次激活时切换 boolean（仅触发一次重渲染来挂载预览 DOM）
        setStickerDragActive((prev) => prev || true);
        // DOM 直操更新预览位置
        const el = stickerPreviewRef.current;
        if (el) {
          const thumbW = 64;
          const ratio = state.height > 0 && state.width > 0 ? state.width / state.height : 1;
          const thumbH = thumbW / ratio;
          el.style.transform = `translate(${state.clientX - thumbW / 2}px, ${state.clientY - thumbH / 2}px)`;
          el.style.width = `${thumbW}px`;
          el.style.height = `${thumbH}px`;
        }
      } else {
        // 拖拽结束：直接用 state 参数（endStickerDrag 的 notify 仍保留 stickerId/clientX 等字段，
        //   仅 active=false。不依赖 ref，避免 ref 未设置或已清除的边界问题）
        setStickerDragActive(false);
        stickerDragStateRef.current = null;
        if (state.stickerId && state.dataURL) {
          // 边界检测：用 containerRef（滚动容器 = 可见工作区）判断鼠标是否在中间工作区内。
          //   不能仅用 stageRef：Stage 可能比可见区域大（可滚动），getBoundingClientRect() 返回
          //   滚动后的位置（left 可能为负），导致拖拽到左侧面板的坐标也落在 Stage 逻辑范围内。
          const containerBox = containerRef.current?.getBoundingClientRect();
          const stageBox = stageRef.current?.container().getBoundingClientRect();
          if (containerBox && stageBox) {
            // 第一步：鼠标必须在可见工作区（containerRef）内，否则拒绝（如左侧面板、顶部工具栏）
            const inContainer =
              state.clientX >= containerBox.left &&
              state.clientX <= containerBox.right &&
              state.clientY >= containerBox.top &&
              state.clientY <= containerBox.bottom;
            if (!inContainer) return;
            // 第二步：用 stageRef 计算 Konva 坐标（groupOX/groupOY 相对于 Stage 坐标系）
            const sx = state.clientX - stageBox.left;
            const sy = state.clientY - stageBox.top;
            // 接受范围：整个 Stage 容器（包含页面 + 周围灰色区域）
            if (sx >= 0 && sx <= stageBox.width && sy >= 0 && sy <= stageBox.height) {
              const { groupOX: ox, groupOY: oy, canvasZoom: cz } = layoutParamsRef.current;
              // 不 clamp：贴纸落在鼠标松开位置（含页面外灰色区域）
              const lx = (sx - ox) / cz;
              const ly = (sy - oy) / cz;
              // 计算默认尺寸：宽度 60mm，保持图片宽高比
              const DEFAULT_STICKER_WIDTH_MM = 60;
              const ratio = state.height > 0 && state.width > 0
                ? state.height / state.width
                : 1;
              const defaultW = DEFAULT_STICKER_WIDTH_MM;
              const defaultH = DEFAULT_STICKER_WIDTH_MM * ratio;
              // 转换为 mm 坐标（中心点）
              const mmX = lx / MM_TO_PX;
              const mmY = ly / MM_TO_PX;
              const newStickerId = `sticker-el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              addStickerElement(currentPageIndexRef.current, {
                id: newStickerId,
                x: mmX,
                y: mmY,
                width: defaultW,
                height: defaultH,
                stickerId: state.stickerId,
                rotation: 0,
                flipH: false,
                flipV: false,
                zIndex: 0,
              });
              // 选中新添加的贴纸
              setSelectedStickerId(newStickerId);
            }
          }
        }
      }
    });
    return unsub;
  }, [addStickerElement, setSelectedStickerId, currentPageIndexRef]);

  // ── Double-click to edit ──
  const handleSlotDblClick = useCallback((slotId: string) => {
    if (!slotId || !currentPage) return;
    const placement = currentPage.placements.find((p) => p.slotId === slotId);
    if (placement?.photoId) {
      setSelectedSlot(slotId);
      setEditFlyoutOpen(true);
      setEditFlyoutTab('adjust');
    }
  }, [currentPage, setSelectedSlot, setEditFlyoutOpen, setEditFlyoutTab]);

  // ── Transformer 变换结束 → 提交照片位覆盖尺寸 ──
  const handleTransformEnd = useCallback(() => {
    if (!selectedSlotId || !stageRef.current) return;

    // 清除拖拽实时预览状态
    setResizePreview({ slotId: null, x: 0, y: 0, w: 0, h: 0 });

    // 非编辑模式：Transformer 绑定了 slot-box → 保存到 slotOverride
    if (!isEditingRef.current) {
      const lock = slotLockRef.current;
      // 保存拖拽时的浮动值（松手前最后一帧），消除取整跳变
      // 若 lastW=0 说明未经过 onTransform（如单击选区），退回到 rect 当前值
      let lx = lock.lastX, ly = lock.lastY, lw = lock.lastW, lh = lock.lastH;
      lock.rightEdge = null; lock.bottomEdge = null;
      lock.prevX = 0; lock.prevRawW = 0; lock.prevY = 0; lock.prevRawH = 0;
      const rect = stageRef.current.findOne(`#slot-box-${selectedSlotId}`) as Konva.Rect | null;
      if (!rect) return;
      if (lw < 1) {
        const scX = rect.scaleX(), scY = rect.scaleY();
        lx = rect.x(); ly = rect.y();
        lw = Math.max(MIN_SLOT_SIZE, rect.width() * scX);
        lh = Math.max(MIN_SLOT_SIZE, rect.height() * scY);
      }

      // 即时视觉用浮动值保持平滑，store 存取整值保证渲染稳定
      rect.scaleX(1); rect.scaleY(1);
      rect.width(lw); rect.height(lh);
      rect.x(lx); rect.y(ly);
      updateCustomHandlePositions(lx, ly, lw, lh);
      updateSlotOverride(currentPageIndex, selectedSlotId, {
        x: Math.round(lx), y: Math.round(ly),
        width: Math.round(lw), height: Math.round(lh),
      });

      // 计算新的照片位置：保持照片在槽位内的相对位置（Canva 风格）
      const pl = currentPage?.placements.find((p) => p.slotId === selectedSlotId);
      const pt = pl?.photoId ? photos.find((p) => p.id === pl.photoId) : undefined;
      let finalPanX: number | undefined;
      let finalPanY: number | undefined;
      let finalPanScale = pl?.panScale;
      const start = resizeStartRef.current;
      if (start && start.slotId === selectedSlotId && start.photoW > 0 && start.photoH > 0 && pt && pt.width > 0 && pt.height > 0) {
        const oldPanX = start.panX ?? (start.w - (calcCoverFitWithRotation(start.photoW, start.photoH, start.w, start.h, start.rotation).boundingW * start.panScale)) / 2;
        const oldPanY = start.panY ?? (start.h - (calcCoverFitWithRotation(start.photoW, start.photoH, start.w, start.h, start.rotation).boundingH * start.panScale)) / 2;
        const newPan = computePanForResizedSlot(
          start.photoW, start.photoH, start.w, start.h, lw, lh,
          start.rotation, start.panScale, oldPanX, oldPanY
        );
        finalPanX = newPan.panX;
        finalPanY = newPan.panY;
      }

      if (finalPanX !== undefined && finalPanY !== undefined) {
        useEditorStore.getState().updatePlacementPan(currentPageIndex, selectedSlotId, finalPanX, finalPanY, finalPanScale);
      } else {
        // 无历史照片位置时回退到居中
        useEditorStore.getState().resetPlacementPan(currentPageIndex, selectedSlotId);
      }

      // 同步修正照片位置（浮动值即时更新，避免拖拽松手跳变）
      const sg = stageRef.current.findOne(`#slot-${selectedSlotId}`) as Konva.Group | null;
      if (sg) {
        sg.x(lx);
        sg.y(ly);
        const es = useEditorStore.getState();
        const cr = es.pages[es.currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
        sg.clipFunc((ctx: any) => { ctx.beginPath(); ctx.roundRect(0, 0, lw, lh, cr); ctx.closePath(); });
        const imgNode = sg.findOne('.editableImage') as Konva.Image | null;
        if (imgNode && pt && pt.width > 0 && pt.height > 0) {
          const totalRot = pl?.panRotation ?? (pl?.rotation || 0);
          const ps = Math.max(pl?.panScale || 1, 1);
          const cv = calcCoverFitWithRotation(pt.width, pt.height, lw, lh, totalRot);
          const hasRot = Math.abs(totalRot) > 0.01;
          const iw = cv.imgW * ps;
          const ih = cv.imgH * ps;
          const bw = cv.boundingW * ps;
          const bh = cv.boundingH * ps;
          let px: number;
          let py: number;
          if (finalPanX !== undefined && finalPanY !== undefined) {
            px = finalPanX;
            py = finalPanY;
          } else {
            px = Math.round((lw - bw) / 2);
            py = Math.round((lh - bh) / 2);
          }
          if (hasRot) {
            imgNode.x(px + bw / 2);
            imgNode.y(py + bh / 2);
            imgNode.offsetX(iw / 2);
            imgNode.offsetY(ih / 2);
          } else {
            imgNode.x(px);
            imgNode.y(py);
            imgNode.offsetX(0);
            imgNode.offsetY(0);
          }
          imgNode.width(iw);
          imgNode.height(ih);
          imgNode.rotation(totalRot);
        }
        sg.getLayer()?.batchDraw();
      }

      clearGuideLines();
      setGuides([]);

      // 关键：React 重渲染会重写 slot-box 属性，Transformer 需在下帧重新校准位置
      requestAnimationFrame(() => {
        transformerRef.current?.forceUpdate();
        transformerRef.current?.getLayer()?.batchDraw();
      });
      return;
    }

    // 编辑模式：Transformer 绑定了照片节点 → 保存缩放比例和位置
    const img = imageNodeRef.current;
    if (!img) return;

    const pl = currentPage?.placements.find((p) => p.slotId === selectedSlotId);
    const pt = pl?.photoId ? photos.find((p) => p.id === pl.photoId) : undefined;
    if (!pl || !pt || pt.width <= 0 || pt.height <= 0) return;

    const slot = template?.slots.find((s) => s.id === selectedSlotId);
    if (!slot) return;
    const sw = slotWidth(slot);
    const sh = slotHeight(slot);
    const totalRot = pl.panRotation ?? (pl.rotation || 0);
    const hasRotation = Math.abs(totalRot) > 0.01;

    // 计算旋转后的 cover-fit 基线
    const coverFit = calcCoverFitWithRotation(pt.width, pt.height, sw, sh, totalRot);
    if (!Number.isFinite(coverFit.boundingW) || coverFit.boundingW <= 0 ||
        !Number.isFinite(coverFit.boundingH) || coverFit.boundingH <= 0) {
      return;
    }

    // 读取当前照片的可见包围盒（相对 slotGroup），兼容旋转/翻转
    const slotGroup = img.getParent() as Konva.Group | null;
    const absRect = img.getClientRect();
    const groupAbs = slotGroup?.getAbsolutePosition() ?? { x: 0, y: 0 };
    // getClientRect 返回 Stage 坐标，需除以 canvasZoom 转回 slotGroup 本地坐标
    const relX = (absRect.x - groupAbs.x) / canvasZoom;
    const relY = (absRect.y - groupAbs.y) / canvasZoom;
    const relW = absRect.width / canvasZoom;
    const relH = absRect.height / canvasZoom;

    if (!Number.isFinite(relW) || relW <= 0 || !Number.isFinite(relH) || relH <= 0) {
      return;
    }

    // 新的 panScale 不能小于 1（cover-fit 基准）
    // 用可见包围盒宽度计算，避免依赖可能为负/零的 scaleX
    let newPanScale = Math.max(1, relW / coverFit.boundingW);
    if (!Number.isFinite(newPanScale)) {
      newPanScale = Math.max(pl.panScale || 1, 1);
    }

    const newBoundingW = coverFit.boundingW * newPanScale;
    const newBoundingH = coverFit.boundingH * newPanScale;
    const newImgW = coverFit.imgW * newPanScale;
    const newImgH = coverFit.imgH * newPanScale;

    // 约束位置：投影到可行多边形，确保照片始终覆盖槽位不露白
    const clamped = clampPhotoToSlotBounds(pt.width, pt.height, sw, sh, totalRot, newPanScale, relX, relY);
    const newPx = clamped.panX;
    const newPy = clamped.panY;

    // 防止 NaN/Infinity 写入 store 导致照片渲染异常
    if (!Number.isFinite(newPanScale) || !Number.isFinite(newPx) || !Number.isFinite(newPy) ||
        !Number.isFinite(newImgW) || !Number.isFinite(newImgH)) {
      return;
    }

    // 重置变换，固化新尺寸和位置（保留翻转的 scale 值）
    img.width(newImgW);
    img.height(newImgH);
    img.scaleX(pl.flipH ? -1 : 1);
    img.scaleY(pl.flipV ? -1 : 1);
    if (hasRotation) {
      img.x(newPx + newBoundingW / 2);
      img.y(newPy + newBoundingH / 2);
      img.offsetX(newImgW / 2);
      img.offsetY(newImgH / 2);
    } else {
      img.x(pl.flipH ? newPx + newImgW / 2 : newPx);
      img.y(pl.flipV ? newPy + newImgH / 2 : newPy);
      img.offsetX(pl.flipH ? newImgW / 2 : 0);
      img.offsetY(pl.flipV ? newImgH / 2 : 0);
    }

    useEditorStore.getState().updatePlacementPan(
      currentPageIndex, selectedSlotId,
      newPx, newPy, newPanScale
    );
    setShowGrid(false);

    // 编辑模式松手后同步 slotGroup 视觉（clipFunc + bgRect）避免下一帧跳变
    const sg = stageRef.current.findOne(`#slot-${selectedSlotId}`) as Konva.Group | null;
    if (sg) {
      const cr = useEditorStore.getState().pages[currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
      sg.clipFunc((ctx: any) => { ctx.beginPath(); ctx.roundRect(0, 0, sw, sh, cr); ctx.closePath(); });
      const bgRect = sg.findOne('.slot-bg') as Konva.Rect | null;
      if (bgRect) { bgRect.width(sw); bgRect.height(sh); }
    }

    // 校准 Transformer 边界框
    requestAnimationFrame(() => {
      transformerRef.current?.forceUpdate();
      transformerRef.current?.getLayer()?.batchDraw();
    });
  }, [selectedSlotId, currentPageIndex, updateSlotOverride, currentPage, template, photos]);

  // ── 自定义控制点：命令式更新位置（角点圆形 + 边点长方块，叠加在透明 Transformer 锚点上）──
  const updateCustomHandlePositions = useCallback((x: number, y: number, w: number, h: number) => {
    const cz = canvasZoomRef.current;
    const hsz = 6 / cz;                          // 控制点基础尺寸，除以 zoom 抵消 Group 缩放
    const refs = customHandleRefs.current;
    // 角点（圆形）
    refs.tl?.position({ x, y });
    refs.tr?.position({ x: x + w, y });
    refs.bl?.position({ x, y: y + h });
    refs.br?.position({ x: x + w, y: y + h });
    // 边点（长方块）：需要同时更新位置和尺寸
    refs.tc?.x(x + w / 2 - hsz * 1.5).y(y - hsz / 2).width(hsz * 3).height(hsz);
    refs.bc?.x(x + w / 2 - hsz * 1.5).y(y + h - hsz / 2).width(hsz * 3).height(hsz);
    refs.ml?.x(x - hsz / 2).y(y + h / 2 - hsz * 1.5).width(hsz).height(hsz * 3);
    refs.mr?.x(x + w - hsz / 2).y(y + h / 2 - hsz * 1.5).width(hsz).height(hsz * 3);
  }, []);
  // ref 持有最新 handler，避免每次渲染更换 onTransform prop 干扰Transformer拖拽状态
  const handleTransformRef = useRef<() => void>(() => {});
  handleTransformRef.current = () => {
    const sid = useEditorStore.getState().selectedSlotId;
    if (!sid || !stageRef.current) return;
    if (isEditingRef.current) return;

    const rect = stageRef.current.findOne(`#slot-box-${sid}`) as Konva.Rect | null;
    if (!rect) return;

    // 直接从 rect 的属性计算逻辑坐标（与 handleTransformEnd 路径完全一致，无 getClientRect 浮点误差）
    // 视觉尺寸 = rect.width() * rect.scaleX()，位置 = rect.x()（Konva 已对齐对角点）
    // 注意：这里不取整，保持与 Transformer 浮点坐标精确一致，消除控制点框和槽位的视觉漂移
    const scaleX = rect.scaleX();
    const scaleY = rect.scaleY();
    let rlx = rect.x();
    let rly = rect.y();
    let rawW = rect.width() * scaleX;
    let rawH = rect.height() * scaleY;

    // 应用 8 控制点约束：角点自由、边点单轴、Shift 比例、最小尺寸保护
    const lock = slotLockRef.current;
    const anchor = transformerRef.current?.getActiveAnchor?.();
    const oldBox = { x: lock.prevX, y: lock.prevY, width: lock.prevRawW, height: lock.prevRawH };
    const newBox = { x: rlx, y: rly, width: rawW, height: rawH };
    const clamped = applySlotResizeConstraints(oldBox, newBox, anchor, shiftKeyRef.current);
    // 同步 rect 到约束后的值，消除 Konva boundBoxFunc 未生效或 anchor 检测失败时的行为漂移
    if (Math.abs(rlx - clamped.x) > 1e-6 || Math.abs(rly - clamped.y) > 1e-6 ||
        Math.abs(rawW - clamped.width) > 1e-6 || Math.abs(rawH - clamped.height) > 1e-6) {
      rect.x(clamped.x);
      rect.y(clamped.y);
      rect.width(clamped.width);
      rect.height(clamped.height);
      rect.scaleX(1);
      rect.scaleY(1);
      rlx = clamped.x;
      rly = clamped.y;
      rawW = clamped.width;
      rawH = clamped.height;
    }

    const rw = Math.max(MIN_SLOT_SIZE, rawW);
    const rh = Math.max(MIN_SLOT_SIZE, rawH);

    // ── 边缘锁定：缩放达到最小尺寸后锁死对边，防止槽位漂移 ──
    // 检测拖拽方向：比较左边(x)移动量 vs 右边(x+rawW)移动量
    const dx = Math.abs(rlx - lock.prevX);
    const dRight = Math.abs((rlx + rawW) - (lock.prevX + lock.prevRawW));
    const dy = Math.abs(rly - lock.prevY);
    const dBottom = Math.abs((rly + rawH) - (lock.prevY + lock.prevRawH));
    if (rawW < MIN_SLOT_SIZE && dx > dRight + 0.1 && rawW <= lock.prevRawW) {
      // 左边正被拖拽且仍在缩小 → 锁死左右边（x + scaleX 双锁）
      if (lock.rightEdge === null) lock.rightEdge = rlx + rawW;
      rect.x(lock.rightEdge - MIN_SLOT_SIZE);
      rect.scaleX(MIN_SLOT_SIZE / rect.width());
      rlx = lock.rightEdge - MIN_SLOT_SIZE;
      rawW = MIN_SLOT_SIZE;
    } else {
      lock.rightEdge = null;
    }
    if (rawH < MIN_SLOT_SIZE && dy > dBottom + 0.1 && rawH <= lock.prevRawH) {
      // 上边正被拖拽且仍在缩小 → 锁死上下边（y + scaleY 双锁）
      if (lock.bottomEdge === null) lock.bottomEdge = rly + rawH;
      rect.y(lock.bottomEdge - MIN_SLOT_SIZE);
      rect.scaleY(MIN_SLOT_SIZE / rect.height());
      rly = lock.bottomEdge - MIN_SLOT_SIZE;
      rawH = MIN_SLOT_SIZE;
    } else {
      lock.bottomEdge = null;
    }
    lock.prevX = rlx;
    lock.prevRawW = rawW;
    lock.prevY = rly;
    lock.prevRawH = rawH;
    // 记录最后一次浮动值，供 handleTransformEnd 同步，消除取整跳变
    lock.lastX = rlx;
    lock.lastY = rly;
    lock.lastW = rw;
    lock.lastH = rh;

    // 同步更新自定义控制点（角点圆形 + 边点长方块）位置到当前 slot-box 边界
    updateCustomHandlePositions(rlx, rly, rw, rh);

    // 只做命令式更新，不调用 setResizePreview —— 避免触发 React 重渲染覆盖命令式写的 imgNode 属性
    // 松手后 handleTransformEnd 提交 slotOverride → 自然重渲染 → 命令式残留被提交值同步覆盖

    // ── 对齐引导线（逻辑坐标）──
    const movingBounds: AlignBounds = { x: rlx, y: rly, width: rw, height: rh };
    const targets = buildAlignTargets(sid);
    const { guides } = findSnap(movingBounds, targets, CANVAS_W, CANVAS_H, {
      zoom: canvasZoom,
      disableSnap: altKeyRef.current,
      margin: {
        left: pageMargin.left * MM_TO_PX,
        right: pageMargin.right * MM_TO_PX,
        top: pageMargin.top * MM_TO_PX,
        bottom: pageMargin.bottom * MM_TO_PX,
      },
    });
    updateGuideLines(guides);

    // ── 实时更新照片位视觉内容（Group 内部坐标 = 逻辑坐标）──
    const slotGroup = stageRef.current.findOne(`#slot-${sid}`) as Konva.Group | null;
    if (!slotGroup) return;

    slotGroup.x(rlx);
    slotGroup.y(rly);

    // 关键：clipWidth/clipHeight 不是 Konva.Group 标准属性，必须用 clipFunc 实时更新裁剪区域
    const es = useEditorStore.getState();
    const cr = es.pages[es.currentPageIndex]?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS;
    slotGroup.clipFunc((ctx: any) => {
      ctx.beginPath();
      ctx.roundRect(0, 0, rw, rh, cr);
      ctx.closePath();
    });

    const bgRect = slotGroup.findOne('.slot-bg') as Konva.Rect | null;
    if (bgRect) {
      bgRect.width(rw);
      bgRect.height(rh);
    }

    // 更新照片 cover-fit：保持照片在槽位内的相对位置（Canva 风格），不重置居中
    const pages = useEditorStore.getState().pages;
    const cpIdx = useEditorStore.getState().currentPageIndex;
    const currentPage = pages[cpIdx];
    const placement = currentPage?.placements.find((p) => p.slotId === sid);
    const photos = usePhotoStore.getState().photos;
    const photo = placement?.photoId ? photos.find((p) => p.id === placement.photoId) : undefined;
    if (photo && photo.width > 0 && photo.height > 0) {
      const imgNode = slotGroup.findOne('.editableImage') as Konva.Image | null;
      if (imgNode) {
        const totalRot = placement?.panRotation ?? (placement?.rotation || 0);
        const ps = Math.max(placement?.panScale || 1, 1);
        const cv = calcCoverFitWithRotation(photo.width, photo.height, rw, rh, totalRot);
        const hasRot = Math.abs(totalRot) > 0.01;
        const iw = cv.imgW * ps;
        const ih = cv.imgH * ps;
        const bw = cv.boundingW * ps;
        const bh = cv.boundingH * ps;

        // 计算新的 pan：优先使用 resizeStartRef 保持相对位置，否则居中
        const start = resizeStartRef.current;
        let px: number, py: number;
        if (start && start.slotId === sid && start.photoW > 0 && start.photoH > 0) {
          const oldPanX = start.panX ?? (start.w - (calcCoverFitWithRotation(start.photoW, start.photoH, start.w, start.h, start.rotation).boundingW * start.panScale)) / 2;
          const oldPanY = start.panY ?? (start.h - (calcCoverFitWithRotation(start.photoW, start.photoH, start.w, start.h, start.rotation).boundingH * start.panScale)) / 2;
          const newPan = computePanForResizedSlot(
            start.photoW, start.photoH, start.w, start.h, rw, rh,
            start.rotation, start.panScale, oldPanX, oldPanY
          );
          px = newPan.panX;
          py = newPan.panY;
        } else {
          px = (rw - bw) / 2;
          py = (rh - bh) / 2;
        }

        if (hasRot) {
          imgNode.x(px + bw / 2);
          imgNode.y(py + bh / 2);
          imgNode.offsetX(iw / 2);
          imgNode.offsetY(ih / 2);
        } else {
          imgNode.x(px);
          imgNode.y(py);
          imgNode.offsetX(0);
          imgNode.offsetY(0);
        }
        imgNode.width(iw);
        imgNode.height(ih);
        imgNode.rotation(totalRot);
      }
    }

    // 更新占位文本
    const textNode = slotGroup.findOne('.slot-placeholder') as Konva.Text | null;
    if (textNode) {
      textNode.width(rw);
      textNode.height(rh);
    }
  };

  // 稳定回调：不随渲染改变 props，避免干扰 Transformer 拖拽
  const stableOnTransform = useCallback(() => {
    handleTransformRef.current();
    if (isEditingRef.current) {
      setEditPosTick((t) => t + 1);
      setShowGrid(true);
    }
  }, []);

  // Transformer 拖拽开始：记录槽位/照片初始状态，用于保持照片相对位置
  const handleTransformStart = useCallback(() => {
    if (isEditingRef.current) return;
    const sid = useEditorStore.getState().selectedSlotId;
    if (!sid || !currentPage || !template) return;
    const slot = template.slots.find((s) => s.id === sid);
    if (!slot) return;
    const pl = currentPage.placements.find((p) => p.slotId === sid);
    const photo = pl?.photoId ? photos.find((p) => p.id === pl.photoId) : undefined;

    const sx = slotX(slot);
    const sy = slotY(slot);
    const sw = slotWidth(slot);
    const sh = slotHeight(slot);

    resizeStartRef.current = {
      slotId: sid,
      x: sx, y: sy, w: sw, h: sh,
      panX: pl?.panX, panY: pl?.panY, panScale: Math.max(pl?.panScale || 1, 1),
      photoW: photo?.width || 0, photoH: photo?.height || 0,
      rotation: pl?.panRotation ?? (pl?.rotation || 0),
    };

    // 初始化 slotLockRef，避免首次缩放的漂移判断基于 0
    const lock = slotLockRef.current;
    lock.prevX = sx;
    lock.prevRawW = sw;
    lock.prevY = sy;
    lock.prevRawH = sh;
    lock.lastX = sx;
    lock.lastY = sy;
    lock.lastW = sw;
    lock.lastH = sh;
    lock.rightEdge = null;
    lock.bottomEdge = null;
  }, [currentPage, template, photos]);

  // 稳定 boundBoxFunc
  const stableBoundBoxFunc = useCallback((oldBox: any, newBox: any) => {
    if (isEditingRef.current) {
      // 编辑模式：仅限制照片不能缩到 cover-fit 以下。
      // 这里不处理坐标系转换 / 位置约束，避免坐标系误判导致照片飞走；
      // 最终的缩放下限与位置约束交给 handleTransformEnd 统一处理。
      if (!Number.isFinite(newBox.x) || !Number.isFinite(newBox.y) ||
          !Number.isFinite(newBox.width) || !Number.isFinite(newBox.height) ||
          !Number.isFinite(oldBox.width) || !Number.isFinite(oldBox.height) ||
          newBox.width <= 0 || newBox.height <= 0 ||
          oldBox.width <= 0 || oldBox.height <= 0) {
        return newBox;
      }

      const state = useEditorStore.getState();
      const sid = state.selectedSlotId;
      const page = state.pages[state.currentPageIndex];
      if (!sid || !page) return newBox;
      const pl = page.placements.find((p) => p.slotId === sid);
      if (!pl) return newBox;

      const currentPanScale = Math.max(pl.panScale || 1, 1);
      // oldBox 与 newBox 在同一坐标系中，直接按比例反推 cover-fit 时的最小宽高
      const minW = oldBox.width / currentPanScale;
      const minH = oldBox.height / currentPanScale;

      if (newBox.width >= minW && newBox.height >= minH) return newBox;

      // 缩到 cover-fit 以下时，按当前锚点固定对边，宽高等比放大回最小值
      const anchor = transformerRef.current?.getActiveAnchor?.();
      const w = Math.max(newBox.width, minW);
      const h = Math.max(newBox.height, minH);
      let x = newBox.x;
      let y = newBox.y;
      if (anchor?.includes('right')) {
        // 右侧锚点：固定左侧
        x = oldBox.x;
      } else if (anchor?.includes('left')) {
        // 左侧锚点：固定右侧
        x = oldBox.x + oldBox.width - w;
      }
      if (anchor?.includes('bottom')) {
        // 下侧锚点：固定上侧
        y = oldBox.y;
      } else if (anchor?.includes('top')) {
        // 上侧锚点：固定下侧
        y = oldBox.y + oldBox.height - h;
      }
      return { ...newBox, x, y, width: w, height: h };
    }
    // 非编辑模式：角点自由拉伸；边点只控制单方向；Shift 保持比例
    const anchor = transformerRef.current?.getActiveAnchor?.();
    return applySlotResizeConstraints(oldBox, newBox, anchor, shiftKeyRef.current);
  }, []);

  // ── 照片位边界计算 + slot 函数定义（必须在早返回之前，useCanvasWheel 依赖这些函数）──
  // 无 slotOverrides 时按用户边距计算安全区，并对页面铺开型模板（bbox≥85%）使用独立轴缩放填满安全区
  // 其他模板使用等比缩放（取 sx/sy 较小者）保持原始比例，居中对齐
  // P0-fix: template/currentPage 可能为 undefined（如 currentPageIndex 越界），需 null 守卫避免崩溃
  const _safeL = albumSize ? (pageMargin.left / albumSize.width) * CANVAS_W : 0;
  const _safeT = albumSize ? (pageMargin.top / albumSize.height) * CANVAS_H : 0;
  const _safeW = albumSize ? CANVAS_W - ((pageMargin.left + pageMargin.right) / albumSize.width) * CANVAS_W : CANVAS_W;
  const _safeH = albumSize ? CANVAS_H - ((pageMargin.top + pageMargin.bottom) / albumSize.height) * CANVAS_H : CANVAS_H;
  const _bbox = template?.slots.reduce((acc, s) => ({
    minX: Math.min(acc.minX, s.x), minY: Math.min(acc.minY, s.y),
    maxX: Math.max(acc.maxX, s.x + s.width), maxY: Math.max(acc.maxY, s.y + s.height),
  }), { minX: 100, minY: 100, maxX: 0, maxY: 0 }) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const _bboxW = _bbox.maxX - _bbox.minX || 100;
  const _bboxH = _bbox.maxY - _bbox.minY || 100;
  const _isSpread = _bboxW >= 85 && _bboxH >= 85;
  const _scaleX = _isSpread ? _safeW / _bboxW : Math.min(_safeW / _bboxW, _safeH / _bboxH);
  const _scaleY = _isSpread ? _safeH / _bboxH : Math.min(_safeW / _bboxW, _safeH / _bboxH);
  const _offsetX = _safeL + (_safeW - _bboxW * _scaleX) / 2 - _bbox.minX * _scaleX;
  const _offsetY = _safeT + (_safeH - _bboxH * _scaleY) / 2 - _bbox.minY * _scaleY;
  const slotWidth = (s: SlotLayout) => {
    const ov = currentPage?.slotOverrides?.[s.id];
    return ov ? ov.width : s.width * _scaleX;
  };
  const slotHeight = (s: SlotLayout) => {
    const ov = currentPage?.slotOverrides?.[s.id];
    return ov ? ov.height : s.height * _scaleY;
  };
  const slotX = (s: SlotLayout) => {
    const ov = currentPage?.slotOverrides?.[s.id];
    return ov ? ov.x : s.x * _scaleX + _offsetX;
  };
  const slotY = (s: SlotLayout) => {
    const ov = currentPage?.slotOverrides?.[s.id];
    return ov ? ov.y : s.y * _scaleY + _offsetY;
  };

  // ── Wheel 处理（P0-fix: 必须在早返回之前调用，保持 hook 调用顺序一致，避免 React #310）──
  useCanvasWheel({
    containerRef, CANVAS_W, CANVAS_H, STAGE_W, STAGE_H, canvasZoom, setCanvasZoom,
    isEditing, isEditingRef, selectedSlotId, template, placementMap, photoMap,
    currentPageIndex, groupOX, groupOY,
    slotX, slotY, slotWidth, slotHeight,
    wheelHideGridTimer, setShowGrid,
  });

  if (!currentPage || !template) {
    return (
      <div
        data-canvas-container
        className={`w-full h-full overflow-auto relative bg-[var(--color-gray-100)] transition-colors duration-150 ps-scroll ${canvasScroll.className}`}
        ref={canvasScroll.ref}
        {...canvasScroll.handlers}
      >
        <CanvasEmptyState
          albumSize={albumSize}
          pageMargin={pageMargin}
          slotGap={slotGap}
          defaultSlotCornerRadius={defaultSlotCornerRadius}
        />
      </div>
    );
  }

  // 缩放后的滚动条尺寸（即 Stage 实际渲染尺寸）
  const scaledW = STAGE_W;
  const scaledH = STAGE_H;

  // ── Figma/Canva 风格引导线渲染（节点池复用 + 颜色区分 + 锚点 + 标注）──

  /** 按 type 获取引导线颜色 */
  function guideColor(type: GuideType): string {
    switch (type) {
      case 'center':  return '#FF2D55';   // 红色 = 中心/居中对齐
      case 'margin':  return '#FF9500';   // 橙色 = 边距对齐
      case 'edge':
      default:        return '#6C63FF';   // 品牌紫 = 边对齐
    }
  }

  /** 辅助线虚线样式：不同类型用不同线型区分 */
  function guideDash(type: GuideType): number[] | undefined {
    switch (type) {
      case 'center':  return [6, 4];    // 长虚线
      case 'margin':  return [8, 3];    // 长短交替
      case 'edge':
      default:        return undefined;  // 实线
    }
  }

  function updateGuideLines(guideList: GuideLine[]) {
    const layer = guidesLayerRef.current;
    if (!layer) return;
    const pool = guideNodePoolRef.current;

    // 标记所有现有节点为「待移除」
    const toRemove = new Set(pool.keys());

    const zoom = canvasZoom;
    const LINE_W = 1 / zoom; // 保持屏幕上 1px 宽度

    for (const g of guideList) {
      toRemove.delete(g.id);

      let line = pool.get(g.id);
      const color = guideColor(g.type);
      const dash = guideDash(g.type);

      if (!line) {
        line = new Konva.Line({
          points: [0, 0, 0, 0],
          stroke: color,
          strokeWidth: LINE_W,
          dash,
          opacity: 0.8,
          listening: false,
          strokeScaleEnabled: false,
        });
        pool.set(g.id, line);
        layer.add(line);
      }

      // 更新颜色和线型（类型可能变化）
      line.stroke(color);
      line.dash(dash);
      line.strokeWidth(LINE_W);

      // 计算辅助线起止点（使用 rangeStart/rangeEnd 绘制短线段）
      if (g.orientation === 'vertical') {
        const x = g.position * zoom;
        const yStart = (g.rangeStart ?? 0) * zoom;
        const yEnd = (g.rangeEnd ?? CANVAS_H) * zoom;
        line.points([x, yStart, x, yEnd]);
      } else {
        const y = g.position * zoom;
        const xStart = (g.rangeStart ?? 0) * zoom;
        const xEnd = (g.rangeEnd ?? CANVAS_W) * zoom;
        line.points([xStart, y, xEnd, y]);
      }

      line.visible(true);
    }

    // 移除不再需要的节点
    for (const id of toRemove) {
      const g = pool.get(id);
      if (g) {
        g.remove();
        pool.delete(id);
      }
    }

    layer.batchDraw();
  }

  function clearGuideLines() {
    const pool = guideNodePoolRef.current;
    for (const [, g] of pool) g.remove();
    pool.clear();
    const layer = guidesLayerRef.current;
    layer?.batchDraw();
  }

  // ── 收集对齐目标（除当前拖拽照片位以外的所有照片位） ──
  function buildAlignTargets(excludeSlotId: string): { id: string; bounds: AlignBounds }[] {
    if (!template || !currentPage) return [];
    return template.slots
      .filter((s) => s.id !== excludeSlotId)
      .map((s) => ({
        id: s.id,
        bounds: {
          x: slotX(s),
          y: slotY(s),
          width: slotWidth(s),
          height: slotHeight(s),
        },
      }));
  }

  /** 渲染单个槽位（含 slot-box 与视觉层 Group），供 globalLayerElements 统一排序使用 */
  const renderSlotContent = (slot: SlotLayout): React.ReactNode => {
    const placement = placementMap.get(slot.id);
    const photo = placement?.photoId ? photoMap.get(placement.photoId) : undefined;
    const isMultiSelected = multiSelectedElements.some((m) => m.type === 'slot' && m.id === slot.id);
    const isSelected = selectedSlotId === slot.id || isMultiSelected;
    const isDragTarget = dragOverSlotId === slot.id;
    const previewPhoto = isDragTarget && isDraggingFile ? photoMap.get(dragState.photoIds[0] ?? '') : undefined;

    // 取整保证渲染稳定，handleTransformEnd 存取整值保持一致性
    const boxX = Math.round(slotX(slot));
    const boxY = Math.round(slotY(slot));
    const boxW = Math.round(slotWidth(slot));
    const boxH = Math.round(slotHeight(slot));

    // 视觉元素与 slot-box 使用完全相同的坐标和尺寸（强制一致，消除任何间隙）
    // 多选缩放/移动预览（统一从 multiElementGroup 读取）
    const mePreviewRect = multiPreviewRectMap.get(slot.id);
    let sx = boxX;
    let sy = boxY;
    let sw = boxW;
    let sh = boxH;
    if (mePreviewRect) {
      sx = mePreviewRect.x;
      sy = mePreviewRect.y;
      sw = mePreviewRect.width;
      sh = mePreviewRect.height;
    }

    return (
      <React.Fragment key={slot.id}>
        {/* 用户可配置阴影：仅 placement.shadow=true 时渲染，在 clipped Group 外
            填充白色会被上层 cover-fit 照片完全覆盖，仅阴影超出槽位边界可见
            拖动/编辑时也保持显示，实时跟随槽位坐标 */}
        {photo && placement?.shadow && (
          <Rect
            x={sx} y={sy}
            width={sw} height={sh}
            cornerRadius={slotCornerRadius}
            fill="#FFFFFF"
            shadowColor="rgba(0,0,0,0.28)"
            shadowBlur={Math.max(4, Math.min(sw, sh) * 0.04)}
            shadowOffsetX={0}
            shadowOffsetY={Math.max(2, Math.min(sw, sh) * 0.02)}
            shadowOpacity={0.55}
            shadowForStrokeEnabled={false}
            listening={false}
          />
        )}
        {/* slot-box：编辑模式下隐藏但保留 DOM 节点，作为 Transformer 的 fallback 绑定目标。
            多选缩放/移动时使用预览几何 sx/sy/sw/sh 实时跟随，避免线框与照片内容错位 */}
        <Rect
          id={`slot-box-${slot.id}`}
          x={sx} y={sy}
          width={sw} height={sh}
          cornerRadius={slotCornerRadius}
          fill="transparent"
          stroke={isSelected && !isEditing ? '#6C63FF' : 'transparent'}
          strokeWidth={isSelected && !isEditing ? (1.5 / canvasZoom) : 0}
          strokeScaleEnabled={false}
          visible={!(isEditing && isSelected)}
          listening={false}
        />
        {/* 视觉层 Group：拖拽时使用 resizePreview 实时更新 */}
        <Group
          id={`slot-${slot.id}`}
          x={sx}
          y={sy}
          width={sw}
          height={sh}
          opacity={isEditing ? 0.3 : 1}
          listening={!isEditing && !isToolMode}
          clipFunc={(ctx) => { ctx.beginPath(); ctx.roundRect(0, 0, sw, sh, slotCornerRadius); ctx.closePath(); }}
          draggable={!isEditing}
          onClick={(e) => {
            if (isEditing) return;
            // Ctrl/Cmd+click：切换多选
            if (e.evt.ctrlKey || e.evt.metaKey) {
              toggleMultiSelect({ type: 'slot', id: slot.id });
            } else {
              setSelectedSlot(slot.id);
            }
          }}
          onTap={(e) => {
            if (isEditing) return;
            if (e.evt.ctrlKey || e.evt.metaKey) {
              toggleMultiSelect({ type: 'slot', id: slot.id });
            } else {
              setSelectedSlot(slot.id);
            }
          }}
          onDblClick={() => handleSlotDblClick(slot.id)}
          onDblTap={() => handleSlotDblClick(slot.id)}
          onDragMove={(e) => {
            if (isEditing) return;
            const rawX = e.target.x();
            const rawY = e.target.y();
            const movingBounds: AlignBounds = { x: rawX, y: rawY, width: sw, height: sh };
            const targets = buildAlignTargets(slot.id);
            const { guides: foundGuides, offsetX, offsetY } = findSnap(
              movingBounds, targets, CANVAS_W, CANVAS_H,
              {
                zoom: canvasZoom,
                disableSnap: altKeyRef.current,
                margin: {
                  left: pageMargin.left * MM_TO_PX,
                  right: pageMargin.right * MM_TO_PX,
                  top: pageMargin.top * MM_TO_PX,
                  bottom: pageMargin.bottom * MM_TO_PX,
                },
              },
            );
            const snapX = rawX + offsetX;
            const snapY = rawY + offsetY;
            e.target.x(snapX);
            e.target.y(snapY);
            const bbox = stageRef.current?.findOne(`#slot-box-${slot.id}`);
            if (bbox) {
              bbox.x(snapX);
              bbox.y(snapY);
            }

            // 单选拖动时同步更新 Transformer 和自定义 8 控制点，避免视觉不同步
            if (selectedSlotId === slot.id && multiSelectedElements.length < 2) {
              transformerRef.current?.forceUpdate();
              updateCustomHandlePositions(snapX, snapY, sw, sh);
            }

            updateGuideLines(foundGuides);
          }}
          onDragEnd={(e) => {
            if (isEditing) return;
            const newSx = e.target.x();
            const newSy = e.target.y();
            updateSlotOverride(currentPageIndex, slot.id, {
              x: newSx, y: newSy, width: sw, height: sh,
            });
            clearGuideLines();
            setGuides([]);
          }}
        >
          {(() => {
            const slotIndex = slotIndexMap.get(slot.id) ?? 0;
            const [gradStart, gradEnd] = SLOT_CANVAS_PALETTE[slotIndex % SLOT_CANVAS_PALETTE.length];
            const borderColor = SLOT_BORDER_COLORS[slotIndex % SLOT_BORDER_COLORS.length];
            const showTemplateStyle = !photo && !isDragTarget && !isSelected;
            return (
              <Rect
                name="slot-bg"
                x={0} y={0}
                width={sw} height={sh}
                fill={
                  showTemplateStyle
                    ? undefined
                    : isDragTarget
                      ? 'rgba(108,99,255,0.12)'
                      : isSelected
                        ? 'rgba(108,99,255,0.06)' // 选中时紫色微高亮（不含描边，描边由 Transformer 渲染）
                        : photo
                          ? undefined
                          : (currentPage.background === '#FFFFFF' ? '#F8F9FA' : 'rgba(255,255,255,0.08)')
                }
                fillLinearGradientStartPoint={showTemplateStyle ? { x: 0, y: 0 } : undefined}
                fillLinearGradientEndPoint={showTemplateStyle ? { x: sw, y: sh } : undefined}
                fillLinearGradientColorStops={showTemplateStyle ? [0, gradStart, 1, gradEnd] : undefined}
                stroke={isDragTarget ? '#6C63FF' : (photo ? 'transparent' : borderColor)}
                strokeWidth={isDragTarget ? 10 : 1}
                strokeScaleEnabled={false}
                cornerRadius={slotCornerRadius}
                dash={isDragTarget || showTemplateStyle ? undefined : (photo ? undefined : [4, 4])}
              />
            );
          })()}

          {photo && (
            <CanvasPhotoRenderer
              placement={placement}
              photo={photo}
              slotW={sw}
              slotH={sh}
              isEditing={false}
              ignoreStoredPan={!!mePreviewRect}
              onUpdatePan={(slotId, panX, panY, panScale) =>
                useEditorStore.getState().updatePlacementPan(currentPageIndex, slotId, panX, panY, panScale)
              }
            />
          )}

          {/* 拖拽悬停预览：渲染在照片上层 */}
          {previewPhoto && (
            <DragPreviewPhoto photo={previewPhoto} slotW={sw} slotH={sh} />
          )}

          {!photo && !previewPhoto && (
            <Text
              name="slot-placeholder"
              text={t('editor.canvas.dropPhotoPlaceholder')}
              x={0} y={0} width={sw} height={sh}
              align="center" verticalAlign="middle"
              fontSize={11}
              fill={isDragTarget ? '#6C63FF' : '#ADB5BD'}
              fontStyle={isDragTarget ? 'bold' : 'normal'}
            />
          )}
        </Group>
      </React.Fragment>
    );
  };

  // ── 全局图层：画笔/文字/便利贴/贴纸的合并排序结果 ──
  // P0-fix: 改回 IIFE（非常量 useMemo），因为此处在早返回之后，
  // 若用 useMemo 会导致空相册→添加页面时 hook 数量变化触发 React #310。
  // IIFE 仅在 currentPage 存在时（早返回已跳过）执行，无 hook 调用顺序问题。
  // 注意：内联箭头函数仍是新引用，子组件的 React.memo 需配合 useCallback 才能完全生效。
  const globalLayerElements = (() => {
    if (!currentPage) return null;
    // typeOrder：z 相同时决定渲染先后，小的渲染在下方（槽位=0，装饰元素=1）
    type RenderItem = { z: number; typeOrder: number; render: React.ReactNode };
    const items: RenderItem[] = [];
    // 槽位：参与统一 zIndex 排序，使 bringSlotToFront/sendSlotToBack 能超越装饰元素
    sortedSlots.forEach((slot) => {
      items.push({
        z: getSlotZIndex(currentPage, slot.id),
        typeOrder: 0,
        render: renderSlotContent(slot),
      });
    });
    (currentPage.brushStrokes || []).forEach((s) => {
      const bs = BRUSH_STYLE_MAP[s.brushType] || BRUSH_STYLE_MAP.pencil;
      items.push({
        z: s.zIndex || 0,
        typeOrder: 1,
        render: <Line
          key={s.id}
          points={s.points.map((v) => v * MM_TO_PX)}
          stroke={s.color} strokeWidth={s.strokeWidth * bs.widthMultiplier} opacity={s.opacity * bs.opacityMultiplier}
          tension={bs.tension} lineCap={s.lineCap} lineJoin="round"
          globalCompositeOperation={bs.blendMode}
          listening={activeTool === 'eraser'}
          onClick={activeTool === 'eraser' ? () => removeBrushStroke(currentPageIndex, s.id) : undefined}
          hitStrokeWidth={activeTool === 'eraser' ? 20 : 0}
        />,
      });
    });
    (currentPage.textElements || []).forEach((el) => {
      const isMultiSelected = multiSelectedElements.some((m) => m.type === 'text' && m.id === el.id);
      // 多选包围盒拖拽/缩放预览：用 previewRect 覆盖几何
      const previewRect = multiPreviewRectMap.get(el.id);
      const elWithPreview: PageTextElement = previewRect
        ? { ...el, x: previewRect.x / MM_TO_PX, y: previewRect.y / MM_TO_PX, width: previewRect.width / MM_TO_PX, height: previewRect.height / MM_TO_PX }
        : el;
      items.push({
        z: el.zIndex || 0,
        typeOrder: 1,
        render: <TextElementNode
          key={el.id} el={elWithPreview} mmToPx={MM_TO_PX} canvasZoom={canvasZoom}
          isSelected={selectedTextId === el.id || isMultiSelected} isEditing={editingTextId === el.id}
          interactive={!isToolMode}
          onUpdate={(p: Partial<PageTextElement>, rh?: boolean) => updateTextElement(currentPageIndex, el.id, p, rh)}
          onRemove={() => { removeTextElement(currentPageIndex, el.id); setSelectedTextId(null); setEditingTextId(null); }}
          onClick={(e) => {
            if (e.evt.ctrlKey || e.evt.metaKey) {
              toggleMultiSelect({ type: 'text', id: el.id });
            } else {
              // 单击只选中，不进入编辑（双击才编辑）
              setSelectedTextId(el.id);
            }
          }}
          onDblClick={() => setEditingTextId(el.id)}
        />,
      });
    });
    (currentPage.stickyNotes || []).forEach((note) => {
      const isMultiSelected = multiSelectedElements.some((m) => m.type === 'sticky' && m.id === note.id);
      const previewRect = multiPreviewRectMap.get(note.id);
      const noteWithPreview: StickyNote = previewRect
        ? { ...note, x: previewRect.x / MM_TO_PX, y: previewRect.y / MM_TO_PX, width: previewRect.width / MM_TO_PX, height: previewRect.height / MM_TO_PX }
        : note;
      items.push({
        z: note.zIndex || 0,
        typeOrder: 1,
        render: <StickyNoteNode
          key={note.id} note={noteWithPreview} mmToPx={MM_TO_PX}
          canDrag={true}
          isSelected={selectedStickyId === note.id || isMultiSelected}
          interactive={!isToolMode}
          onUpdate={(p: Partial<StickyNote>, rh?: boolean) => updateStickyNote(currentPageIndex, note.id, p, rh)}
          onRemove={() => { removeStickyNote(currentPageIndex, note.id); setSelectedStickyId(null); }}
          onRequestEdit={(_t: string) => setEditingTextId(note.id)}
          onSelect={(e) => {
            if (e.evt.ctrlKey || e.evt.metaKey) {
              toggleMultiSelect({ type: 'sticky', id: note.id });
            } else {
              setSelectedStickyId(note.id);
            }
          }}
        />,
      });
    });
    (currentPage.stickerElements || []).forEach((st) => {
      const isMultiSelected = multiSelectedElements.some((m) => m.type === 'sticker' && m.id === st.id);
      const previewRect = multiPreviewRectMap.get(st.id);
      const stWithPreview: StickerElement = previewRect
        ? { ...st, x: previewRect.x / MM_TO_PX, y: previewRect.y / MM_TO_PX, width: previewRect.width / MM_TO_PX, height: previewRect.height / MM_TO_PX }
        : st;
      // 多选模式下隐藏单独控制手柄（resize/旋转），由组包围盒统一控制
      const inMultiSelectMode = multiSelectedElements.length >= 2;
      items.push({
        z: st.zIndex || 0,
        typeOrder: 1,
        render: <StickerNode
          key={st.id} sticker={stWithPreview} mmToPx={MM_TO_PX}
          isSelected={selectedStickerId === st.id || isMultiSelected}
          showHandles={!inMultiSelectMode}
          interactive={!isToolMode}
          onUpdate={(p: Partial<StickerElement>, rh?: boolean) => updateStickerElement(currentPageIndex, st.id, p, rh)}
          onRemove={() => { removeStickerElement(currentPageIndex, st.id); setSelectedStickerId(null); }}
          onSelect={(e) => {
            if (e.evt.ctrlKey || e.evt.metaKey) {
              toggleMultiSelect({ type: 'sticker', id: st.id });
            } else {
              setSelectedStickerId(st.id);
            }
          }}
        />,
      });
    });
    // 排序：先按 z 升序（z 小的渲染在下层），z 相同时 typeOrder 小的（槽位）排前（渲染在装饰下方）
    return items.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      return a.typeOrder - b.typeOrder;
    }).map((item) => item.render);
  })();

  return (
      <div
        data-canvas-container
        className={`w-full h-full overflow-auto relative bg-[var(--color-gray-100)] transition-colors duration-150 ps-scroll ${canvasScroll.className}`}
        ref={canvasScroll.ref}
        {...canvasScroll.handlers}
        style={{
          cursor: activeTool === 'brush' || activeTool === 'eraser'
            ? 'none'
            : undefined,
        }}
      >
      {/* 拖拽提示：仅在页面外时显示，顶部居中 */}
      {isDraggingFile && !isOverPage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[var(--z-overlay)] pointer-events-none">
          <div className="px-5 py-2 bg-[var(--color-primary-600)]/90 text-white rounded-[var(--radius-md)] shadow-lg text-[var(--text-body-sm)] font-[500]">
            {t('editor.canvas.dragToSlotHint')}
          </div>
        </div>
      )}

      {/* 拖到空白区：确认添加照片到当前页（仅 GP 页面） */}
      {pendingAddPhoto && (() => {
        const first = photos.find((ph) => ph.id === pendingAddPhoto.photoIds[0]);
        const count = pendingAddPhoto.photoIds.length;
        return createPortal(
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-surface-overlay)',
            }}
            onClick={() => setPendingAddPhoto(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                background: 'var(--color-card)',
                borderRadius: 12,
                boxShadow: 'var(--shadow-lg)',
                padding: 20,
                maxWidth: 340,
                width: '90%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                {first && (
                  <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
                    <img
                      src={first.src}
                      alt=""
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, pointerEvents: 'none' }}
                    />
                    {count > 1 && (
                      <span style={{
                        position: 'absolute', bottom: -4, right: -4,
                        minWidth: 18, height: 18, padding: '0 5px',
                        background: 'var(--color-brand)', color: 'var(--color-text-inverse)', borderRadius: 9,
                        fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: 'var(--shadow-sm)',
                      }}>
                        {count}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {t('editor.canvas.addPhotosConfirmTitle', { count })}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                {t('editor.canvas.addPhotosConfirmDesc')}{(() => {
                  const { pages } = useEditorStore.getState();
                  const movedSources = new Set<number>();
                  for (const photoId of pendingAddPhoto.photoIds) {
                    const srcIdx = pages.findIndex((pg, i) => i !== pendingAddPhoto.pageIndex && pg.placements.some((pl) => pl.photoId === photoId));
                    if (srcIdx >= 0) movedSources.add(srcIdx);
                  }
                  if (movedSources.size === 0) return '';
                  const pagesText = [...movedSources].sort((a, b) => a - b).map((i) => t('editor.canvas.pageNumber', { n: i + 1 })).join('、');
                  return t('editor.canvas.photosMovedFromPages', { pages: pagesText });
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setPendingAddPhoto(null)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    border: 'none', cursor: 'pointer',
                    background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    pageLayoutService.addPhotoToPage(pendingAddPhoto.pageIndex, pendingAddPhoto.photoIds);
                    setPendingAddPhoto(null);
                  }}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    border: 'none', cursor: 'pointer',
                    background: 'var(--color-brand)', color: 'var(--color-text-inverse)',
                  }}
                >
                  添加
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}



      {/* 拖拽缩略图跟随鼠标（以点击点为中心，70% 透明度） */}
      {dragThumb && (() => {
        const firstPhoto = photos.find((p) => p.id === dragThumb.photoIds[0]);
        if (!firstPhoto) return null;
        const thumbW = 64;
        const thumbH = firstPhoto.height > 0 ? (thumbW * firstPhoto.height / firstPhoto.width) : thumbW;
        const scale = thumbW / (firstPhoto.width > 0 ? firstPhoto.width : thumbW);
        const cx = dragThumb.ox * scale;
        const cy = dragThumb.oy * scale;
        const count = dragThumb.photoIds.length;
        const isDismissing = !!dragThumb.dismissing;
        return (
          <div
            className={`fixed z-[9999] pointer-events-none transition-all duration-200 ease-out ${isDismissing ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`}
            style={{
              left: dragThumb.x - cx,
              top: dragThumb.y - cy,
              width: thumbW,
              height: thumbH,
            }}
          >
            <img
              src={firstPhoto.src}
              alt=""
              className="w-full h-full object-cover rounded-lg shadow-2xl border-2 border-white/90"
              style={{ opacity: 0.85 }}
            />
            {count > 1 && (
              <div className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--color-brand)] text-white text-[10px] font-[600] shadow-md px-1">
                {count}
              </div>
            )}
          </div>
        );
      })()}

      {/* 贴纸拖拽预览：跟随鼠标的贴纸缩略图
          P0-fix: 预览位置用 DOM 直操 transform（ref），不触发 React 重渲染。
          active 状态仅在拖拽开始/结束切换一次，dataURL 从 ref 读取。
          flicker-fix: 挂载时即从 ref 计算初始 width/height/transform 写入 inline style，
          避免首次绘制时父级无尺寸导致 <img> 回退到原始大尺寸而瞬间放大闪烁。
          （ref 在 setStickerDragActive 前已同步设置，渲染时读取安全。） */}
      {stickerDragActive && stickerDragStateRef.current?.dataURL && (() => {
        const st = stickerDragStateRef.current!;
        const thumbW = 64;
        const ratio = st.height > 0 && st.width > 0 ? st.width / st.height : 1;
        const thumbH = thumbW / ratio;
        return (
          <div
            ref={stickerPreviewRef}
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: 0,
              top: 0,
              opacity: 0.85,
              willChange: 'transform',
              width: `${thumbW}px`,
              height: `${thumbH}px`,
              transform: `translate(${st.clientX - thumbW / 2}px, ${st.clientY - thumbH / 2}px)`,
            }}
          >
            <img
              src={st.dataURL}
              alt=""
              className="w-full h-full object-contain rounded-lg shadow-2xl border-2 border-white/90"
              draggable={false}
            />
          </div>
        );
      })()}

      {/* Stage 容器 */}
      <div style={{
        width: Math.max(containerSize.w, scaledW),
        height: Math.max(containerSize.h, scaledH),
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Stage
          key="stage-editor"
          ref={stageCallbackRef}
          pixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
          width={scaledW}
          height={scaledH}
          style={{ borderRadius: '2px' }}
          onMouseDown={(e) => {
            const stage = e.target.getStage()!;
            const isStageBg = e.target === stage;

            /* ── 画笔/橡皮擦工具 ── */
            // 画笔模式：无论点击是否在元素上，都开始绘制（元素已 listening=false，事件穿透到 Stage）
            if (activeTool === 'brush' && e.evt.button === 0) {
              isDrawingRef.current = true;
              const pos = stage.getPointerPosition()!;
              const lx = (pos.x - groupOX) / canvasZoom / MM_TO_PX;
              const ly = (pos.y - groupOY) / canvasZoom / MM_TO_PX;
              brushPointsRef.current = [lx, ly, lx, ly];
              setDraggingElementId(null);
              return;
            }
            if (activeTool === 'eraser') {
              // 橡皮擦由 Line onClick 处理，这里不做其他操作
              return;
            }

            // 每次按下鼠标时，清理旧的多选缩放预览状态，防止 Group 坐标与 slot-box 不一致
            if (!isEditing) {
              marqueeGroup.resetInteraction();
              multiElementGroup.resetInteraction();
            }
            if (e.evt.button !== 0) return;

            if (isStageBg && !isEditing) {
              // 清除文字选中和便利贴选中
              setSelectedTextId(null);
              setEditingTextId(null);
              setSelectedStickyId(null);
              setSelectedStickerId(null);
              setSelectedWatermark(false);
              setEditingWatermark(false);
              // 清除跨类型多选
              clearMultiSelect();
              // 空白区域按下 → 开始框选
              marqueeGroup.startMarquee();
            } else if (isStageBg && isEditing) {
              setSelectedSlot(null);
              setEditFlyoutOpen(false);
              setGuides([]);
              clearGuideLines();
            }
          }}
          onMouseMove={(e) => {
            const stage = e.target.getStage()!;

            /* ── 画笔绘制 ── */
            if (isDrawingRef.current && activeTool === 'brush') {
              const pos = stage.getPointerPosition()!;
              const lx = (pos.x - groupOX) / canvasZoom / MM_TO_PX;
              const ly = (pos.y - groupOY) / canvasZoom / MM_TO_PX;
              brushPointsRef.current = [...brushPointsRef.current, lx, ly];
              // 更新实时显示的笔迹点（逻辑 px 坐标）
              const pxPts = brushPointsRef.current.map((v) => v * MM_TO_PX);
              setActiveStrokePts(pxPts);
              return;
            }

            // 框选 / 组合缩放 / 组合移动预览（hook 内部消费事件）
            if (marqueeGroup.handleMove()) return;
            multiElementGroup.handleMove();
          }}
          onMouseUp={(_e) => {
            /* ── 画笔完成绘制 ── */
            if (isDrawingRef.current && activeTool === 'brush') {
              isDrawingRef.current = false;
              setActiveStrokePts([]);
              const pts = brushPointsRef.current;
              if (pts.length >= 4) {
                // 点数量足够才保存
                const stroke = {
                  id: `stroke-${Date.now()}`,
                  points: pts,
                  brushType: brushSettings.brushType,
                  color: brushSettings.color,
                  strokeWidth: brushSettings.strokeWidth,
                  opacity: brushSettings.opacity,
                  tension: brushSettings.brushType === 'pencil' ? 0.3 : brushSettings.brushType === 'marker' ? 0.5 : 0.5,
                  lineCap: 'round' as const,
                };
                addBrushStroke(currentPageIndex, { ...stroke, zIndex: 0 });
              }
              brushPointsRef.current = [];
              return;
            }

            // 框选完成 / 组合缩放与移动提交（hook 内部消费事件）
            if (marqueeGroup.handleUp()) return;
            multiElementGroup.handleUp();
          }}
        >
          {/* ── 背景 Layer ── */}
          <Layer listening={false}>
            {/* 灰色工作区背景（Stage 空间） */}
            <Rect x={0} y={0} width={scaledW} height={scaledH} fill={workspaceBg} listening={false} />

            {/* 编辑模式：整个画布半透明遮罩 */}
            {isEditing && (
              <Rect x={0} y={0} width={scaledW} height={scaledH} fill="rgba(0,0,0,0.4)" listening={false} />
            )}
          </Layer>

          {/* ── 内容 Layer：页面和槽位 ── */}
          <Layer>
            {/* ── 缩放后的内容 Group（逻辑坐标 × canvasZoom → Stage 空间） ── */}
            <Group x={groupOX} y={groupOY} scaleX={canvasZoom} scaleY={canvasZoom}>
              {/* 页面区域（逻辑坐标） */}
              <PageBackgroundRect bg={currentPage.background} w={CANVAS_W} h={CANVAS_H} />
              <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} stroke={(!currentPage.background || currentPage.background === '#FFFFFF') ? '#E9ECEF' : 'rgba(0,0,0,0.06)'} strokeWidth={1} strokeScaleEnabled={false} listening={false} />

              {/* 边距虚线 —— 安全区边界（strokeScaleEnabled=false 保持所有缩放级别下线条一致） */}
              {showMarginGuide && albumSize && (() => {
                const ml = (pageMargin.left / albumSize.width) * CANVAS_W;
                const mr = (pageMargin.right / albumSize.width) * CANVAS_W;
                const mt = (pageMargin.top / albumSize.height) * CANVAS_H;
                const mb = (pageMargin.bottom / albumSize.height) * CANVAS_H;
                const mw = CANVAS_W - ml - mr;
                const mh = CANVAS_H - mt - mb;
                if (mw <= 0 || mh <= 0) return null;
                return (
                  <Rect x={ml} y={mt} width={mw} height={mh}
                    stroke="#6C63FF" strokeWidth={1} dash={[6, 4]}
                    strokeScaleEnabled={false}
                    fill="transparent" listening={false}
                  />
                );
              })()}

              {/* G - 辅助线（中线+三分线，strokeScaleEnabled=false 保持所有缩放级别下线条一致） */}
              {showGuides && (
                <>
                  {[CANVAS_W / 3, CANVAS_W * 2 / 3].map((x) => (
                    <Line key={`gv${x}`} points={[x, 0, x, CANVAS_H]} stroke="#94a3b8" strokeWidth={0.5} dash={[4, 6]} strokeScaleEnabled={false} listening={false} />
                  ))}
                  {[CANVAS_H / 3, CANVAS_H * 2 / 3].map((y) => (
                    <Line key={`gh${y}`} points={[0, y, CANVAS_W, y]} stroke="#94a3b8" strokeWidth={0.5} dash={[4, 6]} strokeScaleEnabled={false} listening={false} />
                  ))}
                  <Line points={[CANVAS_W / 2, 0, CANVAS_W / 2, CANVAS_H]} stroke="#cbd5e1" strokeWidth={0.5} strokeScaleEnabled={false} listening={false} />
                  <Line points={[0, CANVAS_H / 2, CANVAS_W, CANVAS_H / 2]} stroke="#cbd5e1" strokeWidth={0.5} strokeScaleEnabled={false} listening={false} />
                </>
              )}

              {/* ── 全局图层：三种元素合并按 zIndex 排序渲染（在槽位之上） ── */}
              {/* useMemo 缓存：避免 Canvas 每次重渲染都重建元素数组+排序+map。
                  依赖项覆盖数据源和交互状态，未变化时直接复用上次的 ReactNode 数组。 */}
              {/* P0-fix: 恢复 page 模式裁剪（上轮误移除导致全显/页面模式按钮失效）。
                  page 模式裁剪贴纸/便利贴溢出页面的部分；full 模式不裁剪，贴纸可在灰色区域可见。
                  贴纸拖放时不限制落点坐标，用户在 full 模式下可看到灰色区域的贴纸，
                  切到 page 模式则裁剪到页面内——这是两个模式的语义分工。 */}
              {pageDisplayMode === 'page' ? (
                <Group clipFunc={(ctx: Konva.Context) => { ctx.beginPath(); ctx.rect(0, 0, CANVAS_W, CANVAS_H); ctx.clip(); }}>
                  {globalLayerElements}
                </Group>
              ) : (
                globalLayerElements
              )}

              {/* ── 时间水印 ── */}
              {(() => {
                if (!currentPage || !albumSize || currentPage.watermarkHidden || editingWatermark) return null;
                const pages = useEditorStore.getState().pages;
                if (!shouldShowWatermark(currentPageIndex, pages, photos, watermarkSettings)) return null;
                const defaultText = getWatermarkText(currentPageIndex, pages, photos, watermarkSettings);
                const text = currentPage.watermarkTextOverride ?? defaultText;
                if (!text) return null;
                const fontSize = calcWatermarkFontSize();
                // 根据全局边距计算安全区边界，水印位置固定，不随照片槽移动
                const safe = calcPageSafeArea(currentPage, albumSize.width, albumSize.height, CANVAS_W, CANVAS_H, pageMargin);
                const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
                // 根据页面背景色选择文字颜色（深底用白字，浅底用灰字）
                const bg = currentPage.background || '#FFFFFF';
                // 渐变/纹理取基础色判断深浅
                const bgForCheck = bg.startsWith('texture-') ? getTextureBaseColor(bg) : (bg.startsWith('#') ? bg : '#FFFFFF');
                const isDark = isDarkBackground(bgForCheck);
                return (
                  <Group>
                    <Text
                      ref={watermarkNodeRef}
                      text={text}
                      x={pos.x} y={pos.y}
                      fontSize={fontSize}
                      fontFamily={WATERMARK_FONT_STACK}
                      fontStyle="italic"
                      fill={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)'}
                      listening={!isToolMode}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        setSelectedWatermark(true);
                        setSelectedTextId(null);
                        setSelectedStickyId(null);
                        setSelectedStickerId(null);
                        setEditingTextId(null);
                      }}
                      onDblClick={(e) => {
                        e.cancelBubble = true;
                        setSelectedWatermark(false);
                        setEditingWatermark(true);
                        setSelectedTextId(null);
                        setSelectedStickyId(null);
                        setEditingTextId(null);
                      }}
                      onTap={(e) => {
                        e.cancelBubble = true;
                        setSelectedWatermark(true);
                      }}
                    />
                    {selectedWatermark && (
                      <Rect
                        x={pos.x - 4}
                        y={pos.y - 4}
                        width={(watermarkNodeRef.current?.width() ?? text.length * fontSize * 0.6) + 8}
                        height={(watermarkNodeRef.current?.height() ?? fontSize) + 8}
                        stroke="#6C63FF"
                        strokeWidth={1 / canvasZoom}
                        dash={[4 / canvasZoom, 4 / canvasZoom]}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })()}

              {/* ── 正在绘制的实时笔迹（始终在最顶层） ── */}
              {activeStrokePts.length >= 4 && (() => {
                const bs = BRUSH_STYLE_MAP[brushSettings.brushType] || BRUSH_STYLE_MAP.pencil;
                return (
                  <Line
                    points={activeStrokePts}
                    stroke={brushSettings.color} strokeWidth={brushSettings.strokeWidth * bs.widthMultiplier}
                    opacity={brushSettings.opacity * bs.opacityMultiplier} tension={bs.tension} lineCap="round" lineJoin="round"
                    globalCompositeOperation={bs.blendMode}
                    listening={false}
                  />
                );
              })()}

              {/* 编辑模式页面遮罩 */}
              {isEditing && selectedSlotId && template && (() => {
                const slot = slotMap.get(selectedSlotId);
                if (!slot) return null;
                const sx = slotX(slot);
                const sy = slotY(slot);
                const sw = slotWidth(slot);
                const sh = slotHeight(slot);
                return (
                  <>
                    <Rect x={0} y={0} width={CANVAS_W} height={sy} fill="rgba(0,0,0,0.4)" listening={false} />
                    <Rect x={0} y={sy + sh} width={CANVAS_W} height={CANVAS_H - sy - sh} fill="rgba(0,0,0,0.4)" listening={false} />
                    <Rect x={0} y={sy} width={sx} height={sh} fill="rgba(0,0,0,0.4)" listening={false} />
                    <Rect x={sx + sw} y={sy} width={CANVAS_W - sx - sw} height={sh} fill="rgba(0,0,0,0.4)" listening={false} />
                  </>
                );
              })()}

              {/* 最后渲染编辑中的槽位（确保显示在最上层） */}
              {isEditing && selectedSlotId && (() => {
                const slot = slotMap.get(selectedSlotId);
                if (!slot) return null;
                const placement = placementMap.get(slot.id);
                const photo = placement?.photoId ? photoMap.get(placement.photoId) : undefined;
                const sx = slotX(slot);
                const sy = slotY(slot);
                const sw = slotWidth(slot);
                const sh = slotHeight(slot);

                return (
                  <React.Fragment key={slot.id}>
                    <Rect
                      id={`slot-box-${slot.id}`}
                      x={sx} y={sy}
                      width={sw} height={sh}
                      fill="transparent"
                      stroke="transparent"
                      listening={false}
                    />

                    <Group
                      id={`slot-${slot.id}`}
                      x={sx}
                      y={sy}
                      width={sw}
                      height={sh}
                    >
                      <Rect
                        name="slot-bg"
                        x={0} y={0}
                        width={sw} height={sh}
                        fill="transparent"
                        stroke="transparent"
                      />

                      {photo && (
                        <CanvasPhotoRenderer
                          imageRef={imageNodeRef}
                          coverFitRef={coverFitRef}
                          placement={placement}
                          photo={photo}
                          slotW={sw}
                          slotH={sh}
                          isEditing
                          onUpdatePan={(slotId, panX, panY, panScale) =>
                            useEditorStore.getState().updatePlacementPan(currentPageIndex, slotId, panX, panY, panScale)
                          }
                          onRotate90={() =>
                            slotEditService.rotatePhoto(currentPageIndex, slot.id)
                          }
                          onFreeRotate={(angle) =>
                            slotEditService.updatePlacementPanRotation(currentPageIndex, slot.id, angle)
                          }
                          onDragUpdate={bumpEditTick}
                          onDragEndUpdate={() => setShowGrid(false)}
                        />
                      )}

                      {/* 虚线边框：标识槽位位置 */}
                      <Rect x={0} y={0} width={sw} height={sh}
                        fill="transparent" stroke="#9B94FF" strokeWidth={2}
                        dash={[4, 4]} cornerRadius={slotCornerRadius}
                        listening={false} strokeScaleEnabled={false}
                      />

                      {/* 槽外降暗遮罩：圆角抠洞，保持槽位圆角显示 */}
                      <Group
                        listening={false}
                        clipFunc={(ctx: any) => {
                          const PAD = 5000;
                          ctx.beginPath();
                          ctx.rect(-PAD, -PAD, sw + PAD * 2, sh + PAD * 2);
                          ctx.roundRect(0, 0, sw, sh, slotCornerRadius);
                          ctx.clip('evenodd');
                        }}
                      >
                        <Rect x={-5000} y={-5000} width={sw + 10000} height={sh + 10000}
                          fill="rgba(0,0,0,0.45)" listening={false} />
                      </Group>

                      {/* 三分法网格线：拖拽/缩放时显示 */}
                      {showGrid && (
                        <>
                          <Line points={[sw / 3, 0, sw / 3, sh]} stroke="rgba(255,255,255,0.3)" strokeWidth={1} listening={false} strokeScaleEnabled={false} />
                          <Line points={[sw * 2 / 3, 0, sw * 2 / 3, sh]} stroke="rgba(255,255,255,0.3)" strokeWidth={1} listening={false} strokeScaleEnabled={false} />
                          <Line points={[0, sh / 3, sw, sh / 3]} stroke="rgba(255,255,255,0.3)" strokeWidth={1} listening={false} strokeScaleEnabled={false} />
                          <Line points={[0, sh * 2 / 3, sw, sh * 2 / 3]} stroke="rgba(255,255,255,0.3)" strokeWidth={1} listening={false} strokeScaleEnabled={false} />
                        </>
                      )}

                    </Group>

                    {/* 旋转图标：在遮罩外部 + sx/sy 偏移到正确位置，避免被 evenodd 裁剪 */}
                    {photo && photo.width > 0 && photo.height > 0 && (() => {
                      const rot = placement?.panRotation ?? 0;
                      const cf = calcCoverFitWithRotation(photo.width, photo.height, sw, sh, rot);
                      const ps = Math.max(placement?.panScale || 1, 1);
                      const bw = cf.boundingW * ps;
                      const bh = cf.boundingH * ps;
                      const cpx = (placement?.panX ?? Math.round((sw - bw) / 2)) + bw / 2;
                      const cpy = (placement?.panY ?? Math.round((sh - bh) / 2)) + bh / 2;
                      const iH = cf.imgH * ps;
                      return (
                        <Group x={sx} y={sy} key="rotation-icon-group" opacity={showGrid ? 0 : 1}>
                          <RotationIcon
                            photoCenterX={cpx}
                            photoCenterY={cpy}
                            photoImgH={iH}
                            rotationDeg={rot}
                            canvasZoom={canvasZoom}
                            onRotate90={() => slotEditService.rotatePhoto(currentPageIndex, slot.id)}
                            onFreeRotateStart={() => {
                              freeRotateBaseRef.current = rot;
                              freeCenterRef.current = { x: cpx, y: cpy };
                            }}
                            onFreeRotateMove={(deltaAngle) => {
                              const newAngle = freeRotateBaseRef.current + deltaAngle;
                              const ps = Math.max(placement?.panScale || 1, 1);
                              // 保持原中心点，再用精确边界约束避免旋转后露白
                              const bounds = computePhotoBounds(photo.width, photo.height, sw, sh, newAngle, ps);
                              const cf = calcCoverFitWithRotation(photo.width, photo.height, sw, sh, newAngle);
                              const halfBW = cf.boundingW * ps / 2;
                              const halfBH = cf.boundingH * ps / 2;
                              const rawCX = freeCenterRef.current.x;
                              const rawCY = freeCenterRef.current.y;
                              const clampedCX = Math.max(bounds.minX + halfBW, Math.min(bounds.maxX + halfBW, rawCX));
                              const clampedCY = Math.max(bounds.minY + halfBH, Math.min(bounds.maxY + halfBH, rawCY));
                              const newPanX = clampedCX - halfBW;
                              const newPanY = clampedCY - halfBH;
                              const es = useEditorStore.getState();
                              es.updatePlacementPan(currentPageIndex, slot.id, newPanX, newPanY, ps);
                              slotEditService.updatePlacementPanRotation(currentPageIndex, slot.id, newAngle, undefined, false);
                            }}
                            onFreeRotateEnd={() => {
                              const es = useEditorStore.getState();
                              const { pages, selectedSlotId } = es;
                              if (pages.length > 0) {
                                useHistoryStore.getState().pushSnapshot(pages, selectedSlotId);
                              }
                            }}
                          />
                        </Group>
                      );
                    })()}
                  </React.Fragment>
                );
              })()}

              {/* 非编辑：边框由 slot-box 描边，锚点透明（视觉由自定义控制点叠加）；编辑：原生绘制 */}
              <Transformer
                ref={transformerRef}
                borderStroke={isEditing ? '#9B94FF' : 'transparent'}
                borderStrokeWidth={isEditing ? (1.5 / canvasZoom) : 0}
                anchorStroke={isEditing ? '#6C63FF' : 'transparent'}
                anchorFill={isEditing ? '#fff' : 'transparent'}
                anchorSize={8}
                anchorCornerRadius={4}
                padding={0}
                rotateEnabled={false}
                draggable={false}
                centeredScaling={false}
                keepRatio={isEditing}
                enabledAnchors={isEditing
                  ? ['top-left', 'top-right', 'bottom-right', 'bottom-left']
                  : ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']
                }
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                onTransformStart={handleTransformStart}
                onTransform={stableOnTransform}
                onTransformEnd={handleTransformEnd}
                boundBoxFunc={stableBoundBoxFunc}
              />

              {/* ── 框选矩形 ── */}
              {marqueeGroup.renderMarquee()}

              {/* ── 自定义控制点（单选槽位，非编辑模式）：角点圆形 + 边点长方块，透明交互由 Transformer 原生锚点处理 ── */}
              {selectedSlotId && !isEditing && multiSelectedElements.length < 2 && template && (() => {
                const slot = slotMap.get(selectedSlotId);
                if (!slot) return null;
                const hsz = 6 / canvasZoom;                       // / canvasZoom 抵消 Group 缩放，保持 6px 视觉
                const sw = 1.5 / canvasZoom;                      // 描边宽度
                const hx = Math.round(slotX(slot));
                const hy = Math.round(slotY(slot));
                const hw = Math.round(slotWidth(slot));
                const hh = Math.round(slotHeight(slot));
                return (
                  <>
                    {/* 角点（圆形） */}
                    <Circle x={hx}          y={hy}          radius={hsz} fill="white" stroke="#6C63FF" strokeWidth={sw} listening={false} ref={(r) => { customHandleRefs.current.tl = r; }} />
                    <Circle x={hx + hw}     y={hy}          radius={hsz} fill="white" stroke="#6C63FF" strokeWidth={sw} listening={false} ref={(r) => { customHandleRefs.current.tr = r; }} />
                    <Circle x={hx}          y={hy + hh}     radius={hsz} fill="white" stroke="#6C63FF" strokeWidth={sw} listening={false} ref={(r) => { customHandleRefs.current.bl = r; }} />
                    <Circle x={hx + hw}     y={hy + hh}     radius={hsz} fill="white" stroke="#6C63FF" strokeWidth={sw} listening={false} ref={(r) => { customHandleRefs.current.br = r; }} />
                    {/* 边点（长方块） */}
                    <Rect x={hx + hw / 2 - hsz * 1.5} y={hy - hsz / 2}          width={hsz * 3} height={hsz}     fill="white" stroke="#6C63FF" strokeWidth={sw} cornerRadius={1} listening={false} ref={(r) => { customHandleRefs.current.tc = r; }} />
                    <Rect x={hx + hw / 2 - hsz * 1.5} y={hy + hh - hsz / 2}     width={hsz * 3} height={hsz}     fill="white" stroke="#6C63FF" strokeWidth={sw} cornerRadius={1} listening={false} ref={(r) => { customHandleRefs.current.bc = r; }} />
                    <Rect x={hx - hsz / 2}          y={hy + hh / 2 - hsz * 1.5} width={hsz}     height={hsz * 3} fill="white" stroke="#6C63FF" strokeWidth={sw} cornerRadius={1} listening={false} ref={(r) => { customHandleRefs.current.ml = r; }} />
                    <Rect x={hx + hw - hsz / 2}     y={hy + hh / 2 - hsz * 1.5} width={hsz}     height={hsz * 3} fill="white" stroke="#6C63FF" strokeWidth={sw} cornerRadius={1} listening={false} ref={(r) => { customHandleRefs.current.mr = r; }} />
                  </>
                );
              })()}

              {/* ── 多选包围盒 + 8 控制点（统一由 multiElementGroup 渲染：框选/Ctrl多选 共用） ── */}
              {multiElementGroup.renderGroupBox()}

            </Group>
          </Layer>

          {/* ── 对齐引导线 Layer（Stage 空间，坐标 × canvasZoom） ── */}
          <Layer ref={guidesLayerRef} listening={false} />
        </Stage>

        {/* ── 文字浮动工具栏（动态定位在文字元素上方，旋转后用 AABB 包围盒顶部） ── */}
        {selectedTextId && (() => {
          const el = currentPage?.textElements?.find((e) => e.id === selectedTextId);
          if (!el) return null;
          // AABB 包围盒定位（与便利贴工具栏一致）：旋转后始终在视觉上方
          const elRot = el.rotation ?? 0;
          const elW = el.width;
          const elH = el.height ?? 20;
          const centerX = el.x + elW / 2;
          const centerY = el.y + elH / 2;
          const rad = elRot * Math.PI / 180;
          const bboxTopMm = centerY - (Math.abs(elW / 2 * Math.sin(rad)) + Math.abs(elH / 2 * Math.cos(rad)));
          const offsetMm = 48 / (MM_TO_PX * canvasZoom);
          const toolX = centerX * MM_TO_PX * canvasZoom + groupOX;
          const toolY = (bboxTopMm - offsetMm) * MM_TO_PX * canvasZoom + groupOY;
          return (
            <div className="absolute z-[var(--z-overlay)] flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1 whitespace-nowrap"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              {/* 编辑 */}
              <button onClick={() => setEditingTextId(el.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.editText')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M8 2l2 2-6 6H2V8l6-6z"/></svg>
                <span className="text-[10px]">{t('common.edit')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 置顶/置底 */}
              <button onClick={() => bringToFront(currentPageIndex, 'text', el.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.bringToFront')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="1.5" x2="6" y2="7"/><polyline points="3,4.5 6,1.5 9,4.5"/><line x1="2" y1="10.5" x2="10" y2="10.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.bringToFront')}</span>
              </button>
              <button onClick={() => sendToBack(currentPageIndex, 'text', el.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.sendToBack')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="10.5" x2="6" y2="5"/><polyline points="3,7.5 6,10.5 9,7.5"/><line x1="2" y1="1.5" x2="10" y2="1.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.sendToBack')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 删除 */}
              <button onClick={() => { removeTextElement(currentPageIndex, el.id); setSelectedTextId(null); }}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('common.delete')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3"/></svg>
                <span className="text-[10px]">{t('common.delete')}</span>
              </button>
              {/* 关闭 */}
              <button onClick={() => setSelectedTextId(null)}
                className="flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer text-[var(--color-gray-400)] hover:bg-[var(--color-surface-hover)] ml-0.5" title={t('common.close')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M3 3l6 6M9 3l-6 6"/></svg>
              </button>
            </div>
          );
        })()}

        {/* ── 直接编辑浮层（文字元素或便利贴） ── */}
        {editingTextId && (() => {
          const isSticky = !!currentPage?.stickyNotes?.find((n) => n.id === editingTextId);
          const el = isSticky
            ? currentPage?.stickyNotes?.find((n) => n.id === editingTextId)
            : currentPage?.textElements?.find((e) => e.id === editingTextId);
          if (!el) { setEditingTextId(null); return null; }
          // 尺寸阈值须与 Konva 渲染一致：便利贴 min 40，文字元素 min 50/20。
          const tw = Math.max(el.width * MM_TO_PX, isSticky ? 40 : 50) * canvasZoom;
          const textPad = (isSticky ? 6 : 4) * canvasZoom;
          const boxH = Math.max(('height' in el ? el.height : 80) * MM_TO_PX, isSticky ? 40 : 20) * canvasZoom;
          // 旋转角度：便利贴和文字元素都支持旋转。竖排模式(rotation===-90)不旋转 Group。
          const elRotation = 'rotation' in el ? (el.rotation ?? 0) : 0;
          const isVert = elRotation === -90;
          const editRotation = isVert ? 0 : elRotation;
          // 中心定位（与 Konva Group 一致）：中心 = (el.x + w/2, el.y + h/2)
          const centerX = el.x + el.width / 2;
          const centerY = el.y + ('height' in el ? el.height : 80) / 2;
          const tcx = centerX * MM_TO_PX * canvasZoom + groupOX;
          const tcy = centerY * MM_TO_PX * canvasZoom + groupOY;
          const saveText = () => {
            const val = editTextareaRef.current?.value || '';
            if (isSticky) updateStickyNote(currentPageIndex, editingTextId, { text: val }, true);
            else updateTextElement(currentPageIndex, editingTextId, { text: val }, true);
            setEditingTextId(null);
          };
          const fs = ('fontSize' in el ? el.fontSize : 14) * canvasZoom;
          return (
            <div className="absolute z-[var(--z-overlay)]"
              style={{
                left: tcx, top: tcy, width: tw, height: boxH,
                transform: `translate(-50%, -50%)${editRotation ? ` rotate(${editRotation}deg)` : ''}`,
                transformOrigin: 'center center',
              }}>
              {/* 选中边框提示 */}
              <div className="absolute inset-0 border-2 border-[#6C63FF] border-dashed rounded-[2px] pointer-events-none" style={{ borderWidth: 2 * canvasZoom }} />
              <textarea
                ref={editTextareaRef}
                value={el.text}
                autoFocus
                className="w-full h-full bg-transparent border-none resize-none outline-none overflow-hidden"
                style={{
                  writingMode: isVert ? 'vertical-rl' : undefined,
                  padding: `${textPad}px`,
                  fontSize: fs,
                  fontFamily: ('fontFamily' in el ? el.fontFamily : '思源黑体'),
                  color: 'transparent',
                  fontWeight: ('bold' in el && el.bold ? 600 : 400),
                  fontStyle: ('italic' in el && el.italic ? 'italic' : 'normal'),
                  textDecoration: ('underline' in el && el.underline ? 'underline' : undefined),
                  textAlign: ('align' in el ? el.align : 'left') as 'left' | 'center' | 'right',
                  lineHeight: 1.2,
                  caretColor: '#6C63FF',
                }}
                onChange={(e) => {
                  // 实时更新 Konva 文字，保持同步（不记录历史，避免每次按键都创建快照）
                  if (isSticky) updateStickyNote(currentPageIndex, editingTextId, { text: e.target.value }, false);
                  else updateTextElement(currentPageIndex, editingTextId, { text: e.target.value }, false);
                }}
                onBlur={saveText}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setEditingTextId(null); }
                  else if (e.key === 'Enter' && !e.shiftKey && !isVert) { e.preventDefault(); saveText(); }
                }}
              />
            </div>
          );
        })()}

        {/* ── 便利贴浮动工具栏（动态定位在便利贴上方，旋转后用 AABB 包围盒顶部） ── */}
        {selectedStickyId && (() => {
          const note = currentPage?.stickyNotes?.find((n) => n.id === selectedStickyId);
          if (!note) return null;
          // 工具栏位置：始终在旋转后包围盒顶部上方（屏幕视觉上方，不跟随旋转）
          // note.x/y 为左上角，中心 = (note.x + w/2, note.y + h/2)；旋转中心 = 便利贴中心
          const rad = (note.rotation ?? 0) * Math.PI / 180;
          const halfW = note.width / 2;
          const halfH = note.height / 2;
          const centerX = note.x + note.width / 2;
          const centerY = note.y + note.height / 2;
          // 包围盒顶部（mm）：旋转后便利贴最高点
          const bboxTopMm = centerY - (Math.abs(halfW * Math.sin(rad)) + Math.abs(halfH * Math.cos(rad)));
          // 48px 偏移转换为 mm（屏幕固定像素，不随缩放变化）
          const offsetMm = 48 / (MM_TO_PX * canvasZoom);
          // 工具栏 X = 便利贴中心 X（水平居中，旋转中心不变）
          const toolX = centerX * MM_TO_PX * canvasZoom + groupOX;
          // 工具栏 Y = 包围盒顶部 - 偏移（始终在便利贴视觉上方，不遮挡内容）
          const toolY = (bboxTopMm - offsetMm) * MM_TO_PX * canvasZoom + groupOY;
          return (
            <div className="absolute z-[var(--z-overlay)] flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1 whitespace-nowrap"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              {/* 编辑 */}
              <button onClick={() => setEditingTextId(note.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('common.edit')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M8 2l2 2-6 6H2V8l6-6z"/></svg>
                <span className="text-[10px]">{t('common.edit')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 置顶/置底 */}
              <button onClick={() => bringToFront(currentPageIndex, 'sticky', note.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.bringToFront')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="1.5" x2="6" y2="7"/><polyline points="3,4.5 6,1.5 9,4.5"/><line x1="2" y1="10.5" x2="10" y2="10.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.bringToFront')}</span>
              </button>
              <button onClick={() => sendToBack(currentPageIndex, 'sticky', note.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.sendToBack')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="10.5" x2="6" y2="5"/><polyline points="3,7.5 6,10.5 9,7.5"/><line x1="2" y1="1.5" x2="10" y2="1.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.sendToBack')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 删除 */}
              <button onClick={() => { removeStickyNote(currentPageIndex, note.id); setSelectedStickyId(null); }}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('common.delete')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3"/></svg>
                <span className="text-[10px]">{t('common.delete')}</span>
              </button>
              {/* 关闭 */}
              <button onClick={() => setSelectedStickyId(null)}
                className="flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer text-[var(--color-gray-400)] hover:bg-[var(--color-surface-hover)] ml-0.5" title={t('common.close')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M3 3l6 6M9 3l-6 6"/></svg>
              </button>
            </div>
          );
        })()}

        {/* ── 贴纸浮动工具栏（镜像、置顶/置底、删除） ── */}
        {selectedStickerId && (() => {
          const st = currentPage?.stickerElements?.find((s) => s.id === selectedStickerId);
          if (!st) return null;
          // 工具栏位置：始终在旋转后包围盒顶部上方（屏幕视觉上方，不跟随旋转）
          // st.x/st.y 已是中心点坐标；旋转中心 = 图片中心，旋转时中心不变
          // 旋转后 AABB 包围盒顶部 = cy - (|halfW*sinθ| + |halfH*cosθ|)
          const rad = (st.rotation ?? 0) * Math.PI / 180;
          const halfW = st.width / 2;
          const halfH = st.height / 2;
          // 包围盒顶部（mm）：旋转后贴纸最高点
          const bboxTopMm = st.y - (Math.abs(halfW * Math.sin(rad)) + Math.abs(halfH * Math.cos(rad)));
          // 48px 偏移转换为 mm（屏幕固定像素，不随缩放变化）
          const offsetMm = 48 / (MM_TO_PX * canvasZoom);
          // 工具栏 X = 贴纸中心 X（水平居中，旋转中心不变）
          const toolX = st.x * MM_TO_PX * canvasZoom + groupOX;
          // 工具栏 Y = 包围盒顶部 - 偏移（始终在贴纸视觉上方，不遮挡图案）
          const toolY = (bboxTopMm - offsetMm) * MM_TO_PX * canvasZoom + groupOY;
          return (
            <div className="absolute z-[var(--z-overlay)] flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1 whitespace-nowrap"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              {/* 水平镜像 */}
              <button onClick={() => updateStickerElement(currentPageIndex, st.id, { flipH: !st.flipH })}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.flipHorizontal')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0">
                  <path d="M6 1v10" strokeDasharray="2 1.5"/>
                  <path d="M3 4l-2 2 2 2M9 4l2 2-2 2"/>
                </svg>
                <span className="text-[10px]">{t('editor.toolbar.flipHorizontal')}</span>
              </button>
              {/* 垂直镜像 */}
              <button onClick={() => updateStickerElement(currentPageIndex, st.id, { flipV: !st.flipV })}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.flipVertical')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0">
                  <path d="M1 6h10" strokeDasharray="2 1.5"/>
                  <path d="M4 3l2-2 2 2M4 9l2 2 2-2"/>
                </svg>
                <span className="text-[10px]">{t('editor.toolbar.flipVertical')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 置顶/置底 */}
              <button onClick={() => bringToFront(currentPageIndex, 'sticker', st.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.bringToFront')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="1.5" x2="6" y2="7"/><polyline points="3,4.5 6,1.5 9,4.5"/><line x1="2" y1="10.5" x2="10" y2="10.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.bringToFront')}</span>
              </button>
              <button onClick={() => sendToBack(currentPageIndex, 'sticker', st.id)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.sendToBack')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="10.5" x2="6" y2="5"/><polyline points="3,7.5 6,10.5 9,7.5"/><line x1="2" y1="1.5" x2="10" y2="1.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.sendToBack')}</span>
              </button>
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              {/* 删除 */}
              <button onClick={() => { removeStickerElement(currentPageIndex, st.id); setSelectedStickerId(null); }}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('common.delete')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3"/></svg>
                <span className="text-[10px]">{t('common.delete')}</span>
              </button>
            </div>
          );
        })()}

        {/* ── 时间水印浮动工具栏 ── */}
        {selectedWatermark && !editingWatermark && (() => {
          if (!currentPage || !albumSize) return null;
          const pages = useEditorStore.getState().pages;
          const defaultText = getWatermarkText(currentPageIndex, pages, photos, watermarkSettings);
          const text = currentPage.watermarkTextOverride ?? defaultText;
          if (!text) return null;
          const fontSize = calcWatermarkFontSize();
          const safe = calcPageSafeArea(currentPage, albumSize.width, albumSize.height, CANVAS_W, CANVAS_H, pageMargin);
          const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
          const toolX = pos.x * canvasZoom + groupOX;
          const toolY = pos.y * canvasZoom + groupOY - 40;
          const hasOverride = currentPage.watermarkTextOverride != null;
          return (
            <div ref={watermarkToolbarRef}
              className="absolute z-[var(--z-overlay)] flex items-center gap-1 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1.5"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              <button onClick={() => { setSelectedWatermark(false); setEditingWatermark(true); }}
                className="w-7 h-7 flex items-center justify-center rounded border-none cursor-pointer text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] bg-transparent" title={t('editor.toolbar.editText')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><path d="M8 2l2 2-6 6H2V8l6-6z"/></svg>
              </button>
              <button onClick={() => { resetPageWatermark(currentPageIndex); setSelectedWatermark(false); }}
                disabled={!hasOverride}
                className="w-7 h-7 flex items-center justify-center rounded border-none cursor-pointer text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] bg-transparent disabled:opacity-30 disabled:cursor-not-allowed" title={t('editor.toolbar.resetDefault')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><path d="M2.5 6a3.5 3.5 0 1 0 1.5-2.9M3 3.5V6h2.5"/></svg>
              </button>
              <div className="w-px h-4 bg-[var(--color-border-light)]" />
              <button onClick={() => { setPageWatermarkHidden(currentPageIndex, true); setSelectedWatermark(false); }}
                className="w-7 h-7 flex items-center justify-center rounded border-none cursor-pointer text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] bg-transparent" title={t('editor.toolbar.hideWatermark')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><path d="M1.5 6c.8-2 2.7-3.5 4.5-3.5S9.7 4 10.5 6c-.8 2-2.7 3.5-4.5 3.5S2.3 8 1.5 6z"/><path d="M6 6.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/></svg>
              </button>
            </div>
          );
        })()}

        {/* ── 时间水印直接编辑浮层（所见即所得，覆盖在原水印位置） ── */}
        {editingWatermark && (() => {
          if (!currentPage || !albumSize) return null;
          const fontSize = calcWatermarkFontSize();
          const safe = calcPageSafeArea(currentPage, albumSize.width, albumSize.height, CANVAS_W, CANVAS_H, pageMargin);
          const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
          const screenX = pos.x * canvasZoom + groupOX;
          const screenY = pos.y * canvasZoom + groupOY;
          const bg = currentPage.background || '#FFFFFF';
          const bgForCheck = bg.startsWith('texture-') ? getTextureBaseColor(bg) : (bg.startsWith('#') ? bg : '#FFFFFF');
          const isDark = isDarkBackground(bgForCheck);
          const color = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)';
          const pxFontSize = fontSize * canvasZoom;
          const save = () => {
            const val = watermarkInputRef.current?.textContent || '';
            if (val.trim()) setPageWatermarkTextOverride(currentPageIndex, val);
            else setPageWatermarkTextOverride(currentPageIndex, '');
            setEditingWatermark(false);
            setSelectedWatermark(false);
          };
          const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { setEditingWatermark(false); setSelectedWatermark(true); }
          };
          const handlePaste = (e: React.ClipboardEvent<HTMLSpanElement>) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
            document.execCommand('insertText', false, pasted);
          };
          return (
            <span
              ref={watermarkInputRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={save}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className="absolute z-[calc(var(--z-overlay)+2)] outline-none whitespace-nowrap caret-[var(--color-brand)] min-w-[20px]"
              style={{
                left: screenX,
                top: screenY,
                fontSize: pxFontSize,
                fontFamily: 'serif',
                color,
                lineHeight: 1,
                display: 'inline-block',
              }}
            />
          );
        })()}

        {/* ── 水印隐藏后恢复占位按钮 ── */}
        {currentPage?.watermarkHidden && (() => {
          if (!currentPage || !albumSize) return null;
          const pages = useEditorStore.getState().pages;
          if (!shouldShowWatermark(currentPageIndex, pages, photos, watermarkSettings)) return null;
          const fontSize = calcWatermarkFontSize();
          const safe = calcPageSafeArea(currentPage, albumSize.width, albumSize.height, CANVAS_W, CANVAS_H, pageMargin);
          const pos = calcWatermarkPosition(safe.left, safe.bottom, fontSize);
          const screenX = pos.x * canvasZoom + groupOX;
          const screenY = pos.y * canvasZoom + groupOY;
          return (
            <button
              onClick={() => setPageWatermarkHidden(currentPageIndex, false)}
              className="absolute z-[var(--z-overlay)] flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-[var(--color-gray-300)] bg-white/70 text-[var(--color-gray-400)] text-[10px] opacity-40 hover:opacity-90 transition-opacity"
              style={{ left: screenX, top: screenY }}
              title={t('editor.toolbar.showWatermark')}
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M1.5 6c.8-2 2.7-3.5 4.5-3.5S9.7 4 10.5 6c-.8 2-2.7 3.5-4.5 3.5S2.3 8 1.5 6z"/><path d="M4 6l1.5 1.5L8 5"/></svg>
              {t('editor.toolbar.watermarkHidden')}
            </button>
          );
        })()}

        {/* ── 选中槽位浮动工具栏 ── */}
        {selectedSlotId && !isEditing && (() => {
          const slot = template?.slots.find((s) => s.id === selectedSlotId);
          if (!slot) return null;
          const ov = currentPage?.slotOverrides?.[selectedSlotId];
          const sx = ov ? ov.x : (slot.x / 100) * CANVAS_W;
          const sy = ov ? ov.y : (slot.y / 100) * CANVAS_H;
          const sw = ov ? ov.width : (slot.width / 100) * CANVAS_W;
          const toolX = (sx + sw / 2) * canvasZoom + groupOX;
          const toolY = sy * canvasZoom + groupOY - 36;
          return (
            <div className="absolute z-[var(--z-overlay)] flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1 whitespace-nowrap"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              <button onClick={() => bringSlotToFront(currentPageIndex, selectedSlotId)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.bringToFront')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="1.5" x2="6" y2="7"/><polyline points="3,4.5 6,1.5 9,4.5"/><line x1="2" y1="10.5" x2="10" y2="10.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.bringToFront')}</span>
              </button>
              <button onClick={() => sendSlotToBack(currentPageIndex, selectedSlotId)}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.sendToBack')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="10.5" x2="6" y2="5"/><polyline points="3,7.5 6,10.5 9,7.5"/><line x1="2" y1="1.5" x2="10" y2="1.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.sendToBack')}</span>
              </button>
              {(() => {
                const pl = currentPage?.placements.find((p) => p.slotId === selectedSlotId);
                const hasPhoto = !!pl?.photoId;
                const shadowOn = !!pl?.shadow;
                return (
                  <>
                    <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
                    <button
                      onClick={() => toggleShadow(currentPageIndex, selectedSlotId)}
                      disabled={!hasPhoto}
                      className={`flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer border-none bg-transparent disabled:opacity-30 disabled:cursor-not-allowed ${shadowOn ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-500)]'}`}
                      title={t('editor.toolbar.shadow')}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0"><rect x="2" y="2" width="8" height="8" rx="1"/><path d="M5 11.5h6a1 1 0 0 0 1-1V5.5" opacity="0.5"/></svg>
                      <span className="text-[10px]">{t('editor.toolbar.shadow')}</span>
                    </button>
                    <button
                      onClick={() => { removePhotoFromSlot(currentPageIndex, selectedSlotId); setSelectedSlot(null); }}
                      disabled={!hasPhoto}
                      className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
                      title={t('editor.toolbar.clearPhoto')}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0"><path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" /><path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" /></svg>
                      <span className="text-[10px]">{t('editor.toolbar.clear')}</span>
                    </button>
                    <button
                      onClick={() => { pageLayoutService.removeSlotFromPage(currentPageIndex, selectedSlotId); }}
                      className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent"
                      title={t('editor.toolbar.deleteSlot')}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0"><rect x="1.5" y="2.5" width="11" height="8" rx="1" /><path d="M4 2.5V1.5h6v1" /><line x1="1.5" y1="5.5" x2="12.5" y2="5.5" /><path d="M5 8l4 0" /></svg>
                      <span className="text-[10px]">{t('common.delete')}</span>
                    </button>
                  </>
                );
              })()}
            </div>
          );
        })()}

        {/* ── 多选浮动工具栏（仅同类型 ≥2 时显示，跨类型仅支持移动不显示工具栏）── */}
        {multiSelectedElements.length >= 2 && !isEditing && (() => {
          // 判断是否同类型
          const firstType = multiSelectedElements[0].type;
          const allSameType = multiSelectedElements.every((m) => m.type === firstType);
          if (!allSameType) return null; // 跨类型多选：不显示工具栏，仅支持移动

          // 计算选中元素的包围盒（canvas 像素坐标）
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const m of multiSelectedElements) {
            let x = 0, y = 0, w = 0, h = 0;
            if (m.type === 'slot') {
              const slot = template?.slots.find((s) => s.id === m.id);
              if (!slot) continue;
              x = slotX(slot); y = slotY(slot); w = slotWidth(slot); h = slotHeight(slot);
            } else if (m.type === 'text') {
              const el = currentPage?.textElements?.find((e) => e.id === m.id);
              if (!el) continue;
              x = el.x * MM_TO_PX; y = el.y * MM_TO_PX; w = el.width * MM_TO_PX; h = el.height * MM_TO_PX;
            } else if (m.type === 'sticky') {
              const note = currentPage?.stickyNotes?.find((n) => n.id === m.id);
              if (!note) continue;
              x = note.x * MM_TO_PX; y = note.y * MM_TO_PX; w = note.width * MM_TO_PX; h = note.height * MM_TO_PX;
            } else if (m.type === 'sticker') {
              const st = currentPage?.stickerElements?.find((s) => s.id === m.id);
              if (!st) continue;
              // StickerElement.x/y 是中心点，需转换为左上角
              x = (st.x - st.width / 2) * MM_TO_PX;
              y = (st.y - st.height / 2) * MM_TO_PX;
              w = st.width * MM_TO_PX;
              h = st.height * MM_TO_PX;
            }
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
          }
          if (minX === Infinity) return null;

          // 工具栏定位：包围盒顶部居中
          const toolX = ((minX + maxX) / 2) * canvasZoom + groupOX;
          const toolY = minY * canvasZoom + groupOY - 36;

          // 批量操作
          const handleBatchBringToFront = () => {
            for (const m of multiSelectedElements) {
              if (m.type === 'slot') bringSlotToFront(currentPageIndex, m.id);
              else bringToFront(currentPageIndex, m.type, m.id);
            }
            addToast({ type: 'success', message: t('editor.toolbar.broughtToFront') });
          };
          const handleBatchSendToBack = () => {
            for (const m of multiSelectedElements) {
              if (m.type === 'slot') sendSlotToBack(currentPageIndex, m.id);
              else sendToBack(currentPageIndex, m.type, m.id);
            }
            addToast({ type: 'success', message: t('editor.toolbar.sentToBack') });
          };
          const handleBatchDelete = () => {
            for (const m of multiSelectedElements) {
              if (m.type === 'slot') pageLayoutService.removeSlotFromPage(currentPageIndex, m.id);
              else if (m.type === 'text') removeTextElement(currentPageIndex, m.id);
              else if (m.type === 'sticky') removeStickyNote(currentPageIndex, m.id);
              else if (m.type === 'sticker') removeStickerElement(currentPageIndex, m.id);
            }
            clearMultiSelect();
            addToast({ type: 'success', message: t('editor.toolbar.batchDeleted', { count: multiSelectedElements.length }) });
          };

          return (
            <div className="absolute z-[var(--z-overlay)] flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-[var(--color-border)] px-2 py-1 whitespace-nowrap"
              style={{ left: toolX, top: toolY, transform: 'translateX(-50%)' }}>
              {/* 选中数量徽标 */}
              <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 mr-1 rounded-full bg-[var(--color-brand-bg)] text-[var(--color-brand)] text-[10px] font-[600]">
                {multiSelectedElements.length}
              </span>
              <button onClick={handleBatchBringToFront}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.bringToFront')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="1.5" x2="6" y2="7"/><polyline points="3,4.5 6,1.5 9,4.5"/><line x1="2" y1="10.5" x2="10" y2="10.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.bringToFront')}</span>
              </button>
              <button onClick={handleBatchSendToBack}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('editor.toolbar.sendToBack')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><line x1="6" y1="10.5" x2="6" y2="5"/><polyline points="3,7.5 6,10.5 9,7.5"/><line x1="2" y1="1.5" x2="10" y2="1.5"/></svg>
                <span className="text-[10px]">{t('editor.toolbar.sendToBack')}</span>
              </button>
              {/* 阴影切换：仅 slot 类型多选时显示 */}
              {firstType === 'slot' && (() => {
                const slotIds = multiSelectedElements.filter((m) => m.type === 'slot').map((m) => m.id);
                const slotPlacements = slotIds
                  .map((id) => currentPage?.placements.find((p) => p.slotId === id))
                  .filter((p): p is NonNullable<typeof p> => !!p);
                const allHavePhoto = slotPlacements.length > 0 && slotPlacements.every((p) => p.photoId);
                const allHaveShadow = slotPlacements.length > 0 && slotPlacements.every((p) => p.shadow);
                return (
                  <>
                    <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
                    <button
                      onClick={() => batchSetShadow(currentPageIndex, slotIds, !allHaveShadow)}
                      disabled={!allHavePhoto}
                      className={`flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer border-none bg-transparent disabled:opacity-30 disabled:cursor-not-allowed ${allHaveShadow ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-500)]'}`}
                      title={t('editor.toolbar.shadow')}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0"><rect x="2" y="2" width="8" height="8" rx="1"/><path d="M5 11.5h6a1 1 0 0 0 1-1V5.5" opacity="0.5"/></svg>
                      <span className="text-[10px]">{t('editor.toolbar.shadow')}</span>
                    </button>
                  </>
                );
              })()}
              <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
              <button onClick={handleBatchDelete}
                className="flex items-center gap-1 px-1.5 h-6 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] text-[var(--color-gray-500)] cursor-pointer border-none bg-transparent" title={t('common.delete')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0"><path d="M2 3h8M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M9 3v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3"/></svg>
                <span className="text-[10px]">{t('common.delete')}</span>
              </button>
              {/* 关闭多选 */}
              <button onClick={() => clearMultiSelect()}
                className="flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer text-[var(--color-gray-400)] hover:bg-[var(--color-surface-hover)] ml-0.5" title={t('common.close')}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M3 3l6 6M9 3l-6 6"/></svg>
              </button>
            </div>
          );
        })()}

        {/* ── 画笔/橡皮擦光标跟随圆（系统 cursor 已设为 none，完全由此替代） ── */}
        {activeTool === 'eraser' && <EraserCursor containerRef={containerRef} size={brushSettings.strokeWidth * 2} />}
        {activeTool === 'brush' && (() => {
          const bs = BRUSH_STYLE_MAP[brushSettings.brushType] || BRUSH_STYLE_MAP.pencil;
          return <BrushCursor containerRef={containerRef} size={brushSettings.strokeWidth * bs.widthMultiplier} color={brushSettings.color} opacity={brushSettings.opacity} />;
        })()}
      </div>

    </div>
  );
}
