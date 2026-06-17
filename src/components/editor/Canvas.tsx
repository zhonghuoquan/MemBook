import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, usePhotoStore, useUIStore, useHistoryStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { Template, SlotLayout, PhotoPlacement, Photo } from '../../types';

const CANVAS_W = 420;
const CANVAS_H = 560;

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const placePhoto = useEditorStore((s) => s.placePhoto);
  const photos = usePhotoStore((s) => s.photos);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const setEditFlyoutOpen = useUIStore((s) => s.setEditFlyoutOpen);
  const setEditFlyoutTab = useUIStore((s) => s.setEditFlyoutTab);
  const addToast = useUIStore((s) => s.addToast);

  const currentPage = pages[currentPageIndex];
  const template: Template | undefined = currentPage
    ? TEMPLATES.find((t) => t.id === currentPage.templateId)
    : undefined;

  const getSlotBounds = useCallback((slot: SlotLayout) => ({
    x: (slot.x / 100) * CANVAS_W,
    y: (slot.y / 100) * CANVAS_H,
    w: (slot.width / 100) * CANVAS_W,
    h: (slot.height / 100) * CANVAS_H,
  }), []);

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

  // ── Attach transformer ──
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;
    const stage = stageRef.current;
    if (selectedSlotId) {
      const node = stage.findOne(`#slot-${selectedSlotId}`);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer()?.batchDraw();
        return;
      }
    }
    transformerRef.current.nodes([]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedSlotId, currentPageIndex, currentPage?.placements]);

  // ── Ctrl + wheel zoom (on entire canvas container) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setCanvasZoom(useUIStore.getState().canvasZoom + delta);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setCanvasZoom]);

  // ── Keyboard ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+S save
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
        if (selectedSlotId && document.activeElement?.tagName !== 'INPUT') {
          useEditorStore.getState().removePhotoFromSlot(currentPageIndex, selectedSlotId);
          setSelectedSlot(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canvasZoom, selectedSlotId, currentPageIndex, setSelectedSlot, setCanvasZoom, addToast]);

  // ── Drop handler ──
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    setDragOverSlotId(null);
    const photoId = e.dataTransfer.getData('text/plain');
    if (!photoId) { /* file drop handled by PhotoPanel */ return; }
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
    // 检查槽位是否有照片
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

  const scaledW = CANVAS_W * canvasZoom;
  const scaledH = CANVAS_H * canvasZoom;
  const padding = 48;
  const scrollW = Math.max(containerSize.w, scaledW + padding);
  const scrollH = Math.max(containerSize.h, scaledH + padding);

  const slotWidth = (s: SlotLayout) => (s.width / 100) * CANVAS_W;
  const slotHeight = (s: SlotLayout) => (s.height / 100) * CANVAS_H;
  const slotX = (s: SlotLayout) => (s.x / 100) * CANVAS_W;
  const slotY = (s: SlotLayout) => (s.y / 100) * CANVAS_H;

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-auto bg-[var(--color-gray-100)] relative transition-colors duration-150 ${isDraggingFile ? 'bg-[var(--color-primary-50)]' : ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 z-[var(--z-overlay)] pointer-events-none flex items-center justify-center">
          <div className="px-6 py-3 bg-[var(--color-primary-600)]/90 text-white rounded-[var(--radius-lg)] shadow-lg text-[var(--text-body-sm)] font-[500]">
            {dragOverSlotId ? '📷 放入此槽位' : '拖到照片槽位中放置'}
          </div>
        </div>
      )}

      <div className="flex items-center justify-center" style={{ width: scrollW, height: scrollH, padding }}>
        <div style={{ transform: `scale(${canvasZoom})`, transformOrigin: 'center center', width: CANVAS_W, height: CANVAS_H, flexShrink: 0 }}>
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

              {template.slots.map((slot) => {
                const placement = currentPage.placements.find((p) => p.slotId === slot.id);
                const photo = placement?.photoId ? photos.find((p) => p.id === placement.photoId) : undefined;
                const isSelected = selectedSlotId === slot.id;
                const isDragTarget = dragOverSlotId === slot.id;
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
                    clipX={0}
                    clipY={0}
                    clipWidth={sw}
                    clipHeight={sh}
                    rotation={0}
                    offsetX={0}
                    offsetY={0}
                    onClick={() => setSelectedSlot(slot.id)}
                    onTap={() => setSelectedSlot(slot.id)}
                    onDblClick={() => handleSlotDblClick(slot.id)}
                    onDblTap={() => handleSlotDblClick(slot.id)}
                  >
                    {/* Slot background / placeholder */}
                    <Rect
                      x={0}
                      y={0}
                      width={sw}
                      height={sh}
                      fill={isDragTarget ? 'rgba(108,99,255,0.12)' : photo ? undefined : (currentPage.background === '#FFFFFF' ? '#F8F9FA' : 'rgba(255,255,255,0.08)')}
                      stroke={isDragTarget ? '#6C63FF' : isSelected ? '#6C63FF' : (photo ? 'transparent' : '#DEE2E6')}
                      strokeWidth={isDragTarget ? 2.5 : (isSelected ? 2 : 1)}
                      strokeScaleEnabled={false}
                      cornerRadius={photo ? 2 : 4}
                      dash={isDragTarget ? undefined : (photo ? undefined : [4, 4])}
                    />
                    {photo && <CanvasPhotoRenderer placement={placement} photo={photo} slotW={sw} slotH={sh} />}
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

              <Transformer
                ref={transformerRef}
                borderStroke="#6C63FF"
                borderStrokeWidth={1.5}
                anchorStroke="#6C63FF"
                anchorFill="#fff"
                anchorSize={8}
                rotateEnabled={false}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      <div className="absolute bottom-2 right-3 text-[var(--text-nano)] text-[var(--color-gray-500)] select-none pointer-events-none bg-[var(--color-gray-100)]/80 px-1.5 py-0.5 rounded-[var(--radius-xs)]">
        {Math.round(canvasZoom * 100)}% · 第{currentPageIndex + 1}页
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   单独的照片渲染组件（处理滤镜/调整）
   ═══════════════════════════════════ */

function CanvasPhotoRenderer({
  placement,
  photo,
  slotW,
  slotH,
}: {
  placement?: PhotoPlacement;
  photo: Photo;
  slotW: number;
  slotH: number;
}) {
  const imageRef = useRef<Konva.Image>(null);
  const [loaded, setLoaded] = useState(false);
  const adj = placement?.adjustments;
  const filterName = placement?.filter;
  const rotation = placement?.rotation || 0;

  const cover = calcCoverFit(photo.width, photo.height, slotW, slotH);

  // On image load: cache and apply filters
  const handleImageLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    const node = imageRef.current;
    if (!node || !loaded) return;

    const filters: any[] = [];

    // Map adjustments to Konva filters
    if (adj) {
      // Brightness: Konva range 0-1 where 0=normal, 1=max
      // Map from -100~100 to -1~1
      const b = adj.brightness / 100;
      if (Math.abs(b) > 0.01) {
        node.brightness(b);
        filters.push(Konva.Filters.Brighten);
      }

      // Contrast: use Enhance filter (enhance property: -1 to 1)
      const c = adj.contrast / 100;
      if (Math.abs(c) > 0.01) {
        node.enhance(c);
        filters.push(Konva.Filters.Enhance);
      }

      // Saturation not directly supported → simulate via Enhance (combines contrast)
      // Will use Enhance for both contrast and saturation combined
    }

    // Preset filters
    if (filterName === '黑白') {
      filters.push(Konva.Filters.Grayscale);
    }

    if (filters.length > 0) {
      node.cache();
      node.filters(filters);
      node.getLayer()?.batchDraw();
    } else if (node.isCached()) {
      // Clear cache if no filters needed
      node.clearCache();
      node.filters([]);
      node.getLayer()?.batchDraw();
    }
  }, [loaded, adj, filterName]);

  return (
    <Group
      x={slotW / 2}
      y={slotH / 2}
      rotation={rotation}
      offsetX={slotW / 2}
      offsetY={slotH / 2}
    >
      <KonvaImage
        ref={imageRef}
        image={loadImage(photo.src, handleImageLoad)}
        x={cover.x - slotW / 2}
        y={cover.y - slotH / 2}
        width={cover.width}
        height={cover.height}
        cornerRadius={2}
      />
    </Group>
  );
}

/* ── Cover-fit 裁剪计算 ── */
function calcCoverFit(photoW: number, photoH: number, slotW: number, slotH: number) {
  const slotAspect = slotW / slotH;
  const photoAspect = photoW / photoH;
  if (photoAspect > slotAspect) {
    const h = slotH;
    const w = slotH * photoAspect;
    return { x: (slotW - w) / 2, y: 0, width: w, height: h };
  } else {
    const w = slotW;
    const h = slotW / photoAspect;
    return { x: 0, y: (slotH - h) / 2, width: w, height: h };
  }
}

/* ── Image cache with load callback ── */
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string, onLoad?: () => void): HTMLImageElement {
  if (imageCache.has(src)) return imageCache.get(src)!;
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imageCache.set(src, img);
    onLoad?.();
  };
  img.src = src;
  imageCache.set(src, img);
  return img;
}

function CanvasEmptyState() {
  const addToast = useUIStore((s) => s.addToast);
  const addPage = useEditorStore((s) => s.addPage);

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--color-gray-100)]">
      <div className="text-center">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-12 h-12 text-[var(--color-gray-300)] mx-auto mb-3">
          <rect x="6" y="6" width="36" height="36" rx="4" strokeDasharray="4 2" />
        </svg>
        <p className="text-[var(--text-body-sm)] text-[var(--color-text-tertiary)] mb-3">
          从左侧拖拽照片到此处
        </p>
        <button
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary-600)] text-white border-none rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500] cursor-pointer hover:bg-[var(--color-primary-700)] transition-colors"
          onClick={() => { addPage(); addToast({ type: 'success', message: '已添加新页面' }); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
          </svg>
          创建页面
        </button>
      </div>
    </div>
  );
}
