import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, usePhotoStore, useUIStore, useHistoryStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { Template, SlotLayout, PhotoPlacement, Photo } from '../../types';

const DEFAULT_W = 420;
const DEFAULT_H = 560;
// mm → px 缩放因子
const MM_TO_PX = 2;

/* ── 缺失的工具函数 ── */
function calcCoverFit(iw: number, ih: number, cw: number, ch: number) {
  const scale = Math.max(cw / iw, ch / ih);
  return { x: 0, y: 0, width: iw * scale, height: ih * scale };
}
function loadImage(src: string, onLoad: () => void): HTMLImageElement {
  const img = new window.Image();
  img.onload = onLoad;
  img.src = src;
  return img;
}
function CanvasEmptyState() {
  return <div className="flex items-center justify-center h-full text-[var(--color-text-tertiary)]">暂无内容</div>;
}

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageNodeRef = useRef<Konva.Image>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const placePhoto = useEditorStore((s) => s.placePhoto);
  const albumSize = useEditorStore((s) => s.albumSize);
  const photos = usePhotoStore((s) => s.photos);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const editFlyoutOpen = useUIStore((s) => s.editFlyoutOpen);
  const setEditFlyoutOpen = useUIStore((s) => s.setEditFlyoutOpen);
  const setEditFlyoutTab = useUIStore((s) => s.setEditFlyoutTab);
  const addToast = useUIStore((s) => s.addToast);

  // 画布尺寸：根据用户选择的相册尺寸（mm）换算为像素
  const CANVAS_W = albumSize ? albumSize.width * MM_TO_PX : DEFAULT_W;
  const CANVAS_H = albumSize ? albumSize.height * MM_TO_PX : DEFAULT_H;

  const currentPage = pages[currentPageIndex];
  const template: Template | undefined = currentPage
    ? TEMPLATES.find((t) => t.id === currentPage.templateId)
    : undefined;

  const isEditing = !!(editFlyoutOpen && selectedSlotId);

  const getSlotBounds = useCallback((slot: SlotLayout) => ({
    x: (slot.x / 100) * CANVAS_W,
    y: (slot.y / 100) * CANVAS_H,
    w: (slot.width / 100) * CANVAS_W,
    h: (slot.height / 100) * CANVAS_H,
  }), [CANVAS_W, CANVAS_H]);

  const clientToStage = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const stageBox = stage.container().getBoundingClientRect();
    return {
      x: (clientX - stageBox.left) / canvasZoom,
      y: (clientY - stageBox.top) / canvasZoom,
    };
  }, [canvasZoom]);

  const hitTestSlots = useCallback((stageX: number, stageY: number): string | null => {
    if (!template) return null;
    for (const slot of template.slots) {
      const b = getSlotBounds(slot);
      if (stageX >= b.x && stageX <= b.x + b.w && stageY >= b.y && stageY <= b.y + b.h) {
        return slot.id;
      }
    }
    return null;
  }, [template, getSlotBounds]);

  // ── Observe container resize ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Attach transformer: slot Group (normal) OR image node (editing) ──
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;
    const stage = stageRef.current;
    if (isEditing && imageNodeRef.current) {
      // During editing, attach transformer to the movable image
      transformerRef.current.nodes([imageNodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    } else if (selectedSlotId) {
      const node = stage.findOne(`#slot-${selectedSlotId}`);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer()?.batchDraw();
        return;
      }
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedSlotId, currentPageIndex, currentPage?.placements, isEditing]);

  // ── Wheel: Ctrl+wheel = zoom, plain wheel = page navigation ──
  // 使用 React onWheel prop 而非 addEventListener，确保页面刷新/HMR 后正常工作
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Ctrl+wheel → 缩放
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const current = useUIStore.getState().canvasZoom;
      setCanvasZoom(Math.max(0.3, Math.min(3, current + delta)));
      return;
    }
    // 普通滚轮 → 切换页面
    e.preventDefault();
    e.stopPropagation();
    const st = useEditorStore.getState();
    const { pages, currentPageIndex, setCurrentPage } = st;
    if (e.deltaY > 0) {
      if (currentPageIndex < pages.length - 1) setCurrentPage(currentPageIndex + 1);
    } else {
      if (currentPageIndex > 0) setCurrentPage(currentPageIndex - 1);
    }
  }, [setCanvasZoom]);

  // ── 全局拦截浏览器 Ctrl+wheel 缩放（必须 passive:false + window 级）──
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handler, { capture: true });
  }, []);

  // ── Space+鼠标拖拽移动画布（类似 PS）──
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const scrollStart = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false); // 给原生事件用的同步 ref

  // 跟踪空格键状态
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 用原生事件在 capture 阶段拦截 mousedown（在 event 到达 Konva Stage 前）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (spaceHeldRef.current && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        panStart.current = { x: e.clientX, y: e.clientY };
        scrollStart.current = { x: el.scrollLeft, y: el.scrollTop };
        setIsPanning(true);
      }
    };
    el.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => el.removeEventListener('mousedown', onMouseDown, { capture: true });
  }, []);

  // 平移中：window 级 mousemove/mouseup
  useEffect(() => {
    if (!isPanning || !spaceHeldRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - panStart.current.x;
      const dy = ev.clientY - panStart.current.y;
      el.scrollLeft = scrollStart.current.x - dx;
      el.scrollTop = scrollStart.current.y - dy;
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  // 光标样式：space→grab, space+drag→grabbing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isPanning) {
      el.style.cursor = 'grabbing';
    } else if (spaceHeld) {
      el.style.cursor = 'grab';
    } else {
      el.style.cursor = '';
    }
  }, [spaceHeld, isPanning]);

  // ── Keyboard ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        const pages = useEditorStore.getState().pages;
        const photos = usePhotoStore.getState().photos;
        const projectId = localStorage.getItem('membook_current_project_id');
        if (projectId && pages.length > 0) {
          import('../../db').then(({ loadProject, saveProject, savePhotos }) => {
            loadProject(projectId).then((existing) => {
              if (existing) {
                saveProject({ ...existing, pages, updatedAt: new Date().toISOString() });
                savePhotos(photos);
                addToast({ type: 'success', message: '💾 已保存' });
              }
            });
          });
        }
        return;
      }
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const entry = useHistoryStore.getState().undo();
        if (entry) {
          useEditorStore.getState().setPages(entry.pages);
          if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
          addToast({ type: 'info', message: '已撤销' });
        }
        return;
      }
      if ((e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey)))) {
        e.preventDefault();
        const entry = useHistoryStore.getState().redo();
        if (entry) {
          useEditorStore.getState().setPages(entry.pages);
          if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
          addToast({ type: 'info', message: '已重做' });
        }
        return;
      }
      if (e.ctrlKey && e.key === '=') { e.preventDefault(); setCanvasZoom(canvasZoom + 0.1); }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); setCanvasZoom(canvasZoom - 0.1); }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); setCanvasZoom(1); }
      if (e.key === 'Escape') { setSelectedSlot(null); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSlotId && document.activeElement?.tagName !== 'INPUT' && !editFlyoutOpen) {
          useEditorStore.getState().removePhotoFromSlot(currentPageIndex, selectedSlotId);
          setSelectedSlot(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canvasZoom, selectedSlotId, currentPageIndex, setSelectedSlot, setCanvasZoom, addToast, editFlyoutOpen]);

  // ── Drop handler ──
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    setDragOverSlotId(null);
    const photoId = e.dataTransfer.getData('text/plain');
    if (!photoId) return;
    const pt = clientToStage(e.clientX, e.clientY);
    if (!pt) return;
    const hitSlotId = hitTestSlots(pt.x, pt.y);
    if (hitSlotId) {
      placePhoto(currentPageIndex, hitSlotId, photoId);
      setSelectedSlot(hitSlotId);
      addToast({ type: 'success', message: '照片已放入页内' });
    }
  }, [clientToStage, hitTestSlots, currentPageIndex, placePhoto, setSelectedSlot, addToast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingFile) setIsDraggingFile(true);
    const pt = clientToStage(e.clientX, e.clientY);
    if (pt) setDragOverSlotId(hitTestSlots(pt.x, pt.y));
  }, [clientToStage, hitTestSlots, isDraggingFile]);

  const handleDragLeave = useCallback(() => {
    setIsDraggingFile(false);
    setDragOverSlotId(null);
  }, []);

  // ── Double-click to edit ──
  const handleSlotDblClick = useCallback((slotId: string) => {
    if (!slotId) return;
    const page = pages[currentPageIndex];
    if (!page) return;
    const placement = page.placements.find((p) => p.slotId === slotId);
    if (placement?.photoId) {
      setSelectedSlot(slotId);
      setEditFlyoutOpen(true);
      setEditFlyoutTab('adjust');
    }
  }, [currentPageIndex, pages, setSelectedSlot, setEditFlyoutOpen, setEditFlyoutTab]);

  if (!currentPage || !template) {
    return <CanvasEmptyState />;
  }

  const padding = 48;
  // 缩放后的实际可视尺寸（用于溢出滚动条计算）
  const scaledW = CANVAS_W * canvasZoom + padding * 2;
  const scaledH = CANVAS_H * canvasZoom + padding * 2;

  const slotWidth = (s: SlotLayout) => (s.width / 100) * CANVAS_W;
  const slotHeight = (s: SlotLayout) => (s.height / 100) * CANVAS_H;
  const slotX = (s: SlotLayout) => (s.x / 100) * CANVAS_W;
  const slotY = (s: SlotLayout) => (s.y / 100) * CANVAS_H;

  return (
      <div
        className="w-full h-full overflow-auto relative bg-[var(--color-gray-100)] transition-colors duration-150"
        ref={containerRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onWheel={handleWheel}
      >
      {isDraggingFile && (
        <div className="absolute inset-0 z-[var(--z-overlay)] pointer-events-none flex items-center justify-center">
          <div className="px-6 py-3 bg-[var(--color-primary-600)]/90 text-white rounded-[var(--radius-lg)] shadow-lg text-[var(--text-body-sm)] font-[500]">
            {dragOverSlotId ? '📷 放入此槽位' : '拖到照片槽位中放置'}
          </div>
        </div>
      )}

      <div style={{
        width: Math.max(containerSize.w, scaledW),
        height: Math.max(containerSize.h, scaledH),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding
      }}>
        <div style={{ transform: `scale(${canvasZoom})`, transformOrigin: 'center center', width: CANVAS_W, height: CANVAS_H, flexShrink: 0, overflow: 'visible' }}>
          <Stage
            ref={stageRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ background: currentPage.background, borderRadius: '2px', boxShadow: '0 2px 12px rgba(33,37,41,0.1)' }}
            onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelectedSlot(null); }}
          >
            <Layer>
              <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={currentPage.background} listening={false} />
              <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} stroke={currentPage.background === '#FFFFFF' ? '#E9ECEF' : 'rgba(0,0,0,0.06)'} strokeWidth={1} listening={false} />

              {/* ── Slot renderer ── */}
              {template.slots.map((slot) => {
                const placement = currentPage.placements.find((p) => p.slotId === slot.id);
                const photo = placement?.photoId ? photos.find((p) => p.id === placement.photoId) : undefined;
                const isSelected = selectedSlotId === slot.id;
                const isDragTarget = dragOverSlotId === slot.id;
                const slotIsEditing = isEditing && selectedSlotId === slot.id;
                const sx = slotX(slot);
                const sy = slotY(slot);
                const sw = slotWidth(slot);
                const sh = slotHeight(slot);

                return (
                  <Group
                    key={slot.id}
                    id={`slot-${slot.id}`}
                    x={sx}
                    y={sy}
                    width={sw}
                    height={sh}
                    clipX={slotIsEditing ? -9999 : 0}
                    clipY={slotIsEditing ? -9999 : 0}
                    clipWidth={slotIsEditing ? 99999 : sw}
                    clipHeight={slotIsEditing ? 99999 : sh}
                    onClick={() => { if (!slotIsEditing) setSelectedSlot(slot.id); }}
                    onTap={() => { if (!slotIsEditing) setSelectedSlot(slot.id); }}
                    onDblClick={() => handleSlotDblClick(slot.id)}
                    onDblTap={() => handleSlotDblClick(slot.id)}
                  >
                    {/* Slot background */}
                    <Rect
                      x={0} y={0}
                      width={sw} height={sh}
                      fill={
                        slotIsEditing
                          ? 'rgba(108,99,255,0.04)'
                          : isDragTarget
                            ? 'rgba(108,99,255,0.12)'
                            : photo
                              ? undefined
                              : (currentPage.background === '#FFFFFF' ? '#F8F9FA' : 'rgba(255,255,255,0.08)')
                      }
                      stroke={
                        slotIsEditing
                          ? '#6C63FF'
                          : isDragTarget
                            ? '#6C63FF'
                            : isSelected
                              ? '#6C63FF'
                              : (photo ? 'transparent' : '#DEE2E6')
                      }
                      strokeWidth={slotIsEditing ? 2.5 : (isDragTarget ? 2.5 : (isSelected ? 2 : 1))}
                      strokeScaleEnabled={false}
                      cornerRadius={photo ? 2 : 4}
                      dash={slotIsEditing ? [6, 3] : (isDragTarget ? undefined : (photo ? undefined : [4, 4]))}
                    />

                    {/* Photo render */}
                    {photo && (
                      slotIsEditing ? (
                        // Edit mode: full image without clip, draggable
                        <CanvasPhotoRenderer
                          imageRef={imageNodeRef}
                          placement={placement}
                          photo={photo}
                          slotW={sw}
                          slotH={sh}
                          isEditing
                        />
                      ) : (
                        <CanvasPhotoRenderer
                          placement={placement}
                          photo={photo}
                          slotW={sw}
                          slotH={sh}
                          isEditing={false}
                        />
                      )
                    )}

                    {/* Slot boundary overlay in edit mode */}
                    {slotIsEditing && (
                      <Rect
                        x={0} y={0}
                        width={sw} height={sh}
                        fill="rgba(108,99,255,0.08)"
                        stroke="#6C63FF"
                        strokeWidth={2}
                        strokeScaleEnabled={false}
                        cornerRadius={2}
                        dash={[6, 4]}
                        listening={false}
                      />
                    )}

                    {/* Empty slot placeholder */}
                    {!photo && (
                      <Text
                        text={isDragTarget ? '释放放置' : '拖入照片'}
                        x={0} y={0} width={sw} height={sh}
                        align="center" verticalAlign="middle"
                        fontSize={11}
                        fill={isDragTarget ? '#6C63FF' : '#ADB5BD'}
                        fontStyle={isDragTarget ? 'bold' : 'normal'}
                      />
                    )}
                  </Group>
                );
              })}

              {/* Transformer */}
              <Transformer
                ref={transformerRef}
                borderStroke="#6C63FF"
                borderStrokeWidth={1.5}
                anchorStroke="#6C63FF"
                anchorFill="#fff"
                anchorSize={8}
                rotateEnabled={isEditing}
                enabledAnchors={isEditing
                  ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                  : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                }
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                boundBoxFunc={(oldBox, newBox) => {
                  // Constrain minimum size during edit
                  if (newBox.width < 20 || newBox.height < 20) return oldBox;
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      <div className="absolute bottom-2 right-3 text-[var(--text-nano)] text-[var(--color-gray-500)] select-none pointer-events-none bg-[var(--color-gray-100)]/80 px-1.5 py-0.5 rounded-[var(--radius-xs)]">
        {Math.round(canvasZoom * 100)}%
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   照片渲染组件（滤镜/旋转/编辑模式）
   ═══════════════════════════════════ */

function CanvasPhotoRenderer({
  placement,
  photo,
  slotW,
  slotH,
  isEditing,
  imageRef,
}: {
  placement?: PhotoPlacement;
  photo: Photo;
  slotW: number;
  slotH: number;
  isEditing?: boolean;
  imageRef?: React.MutableRefObject<Konva.Image | null>;
}) {
  const internalRef = useRef<Konva.Image>(null);
  const [loaded, setLoaded] = useState(false);
  const adj = placement?.adjustments;
  const filterName = placement?.filter;
  const rotation = placement?.rotation || 0;

  const cover = calcCoverFit(photo.width, photo.height, slotW, slotH);

  const handleImageLoad = useCallback(() => setLoaded(true), []);

  useEffect(() => {
    const node = internalRef.current;
    if (!node || !loaded) return;
    const filters: any[] = [];
    if (adj) {
      const b = adj.brightness / 100;
      if (Math.abs(b) > 0.01) { node.brightness(b); filters.push(Konva.Filters.Brighten); }
      const c = adj.contrast / 100;
      if (Math.abs(c) > 0.01) { node.enhance(c); filters.push(Konva.Filters.Enhance); }
    }
    if (filterName === '黑白') filters.push(Konva.Filters.Grayscale);
    if (filters.length > 0) { node.cache(); node.filters(filters); node.getLayer()?.batchDraw(); }
    else if (node.isCached()) { node.clearCache(); node.filters([]); node.getLayer()?.batchDraw(); }
  }, [loaded, adj, filterName]);

  return (
    <KonvaImage
      ref={(node) => {
        internalRef.current = node;
        if (imageRef) imageRef.current = node;
      }}
      image={loadImage(photo.src, handleImageLoad)}
      x={cover.x}
      y={cover.y}
      width={cover.width}
      height={cover.height}
      cornerRadius={2}
      rotation={rotation}
      offsetX={rotation ? cover.width / 2 : 0}
      offsetY={rotation ? cover.height / 2 : 0}
      draggable={isEditing}
      name="editableImage"
    />
  );
}
