import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { Template, SlotLayout } from '../../types';

const CANVAS_W = 420;
const CANVAS_H = 560;

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const photos = usePhotoStore((s) => s.photos);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);

  const currentPage = pages[currentPageIndex];
  const template: Template | undefined = currentPage
    ? TEMPLATES.find((t) => t.id === currentPage.templateId)
    : undefined;

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

  // ── Attach transformer to selected node ──
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

  // ── Ctrl + wheel zoom — whole page scaling ──
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    if (e.evt.ctrlKey || e.evt.metaKey) {
      e.evt.preventDefault();
      const delta = e.evt.deltaY > 0 ? -0.1 : 0.1;
      setCanvasZoom(useUIStore.getState().canvasZoom + delta);
    }
  }, [setCanvasZoom]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  }, [canvasZoom, selectedSlotId, currentPageIndex, setSelectedSlot, setCanvasZoom]);

  if (!currentPage || !template) {
    return <CanvasEmptyState />;
  }

  // Scaled dimensions for scroll spacer
  const scaledW = CANVAS_W * canvasZoom;
  const scaledH = CANVAS_H * canvasZoom;
  const padding = 48; // 24px each side
  const scrollW = Math.max(containerSize.w, scaledW + padding);
  const scrollH = Math.max(containerSize.h, scaledH + padding);

  const slotWidth = (s: SlotLayout) => (s.width / 100) * CANVAS_W;
  const slotHeight = (s: SlotLayout) => (s.height / 100) * CANVAS_H;
  const slotX = (s: SlotLayout) => (s.x / 100) * CANVAS_W;
  const slotY = (s: SlotLayout) => (s.y / 100) * CANVAS_H;

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--color-gray-100)] relative">
      {/* Scroll spacer ensures the container has room when zoomed in */}
      <div
        className="flex items-center justify-center"
        style={{ width: scrollW, height: scrollH, padding }}
      >
        {/* CSS transform: scales the entire Stage uniformly (page + slots + photos) */}
        <div
          style={{
            transform: `scale(${canvasZoom})`,
            transformOrigin: 'center center',
            width: CANVAS_W,
            height: CANVAS_H,
            flexShrink: 0,
          }}
        >
          <Stage
            ref={stageRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{
              background: currentPage.background,
              borderRadius: '2px',
              boxShadow: '0 2px 12px rgba(33,37,41,0.1)',
            }}
            onWheel={handleWheel}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) {
                setSelectedSlot(null);
              }
            }}
          >
            <Layer>
              {/* Page background — fills the entire stage */}
              <Rect
                x={0} y={0}
                width={CANVAS_W} height={CANVAS_H}
                fill={currentPage.background}
                listening={false}
              />

              {/* Subtle page edge */}
              <Rect
                x={0} y={0}
                width={CANVAS_W} height={CANVAS_H}
                stroke={currentPage.background === '#FFFFFF' ? '#E9ECEF' : 'rgba(0,0,0,0.06)'}
                strokeWidth={1}
                listening={false}
              />

              {/* Slot placeholders + Photo render */}
              {template.slots.map((slot) => {
                const placement = currentPage.placements.find((p) => p.slotId === slot.id);
                const photo = placement?.photoId
                  ? photos.find((p) => p.id === placement.photoId)
                  : undefined;
                const isSelected = selectedSlotId === slot.id;
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
                    onClick={() => setSelectedSlot(slot.id)}
                    onTap={() => setSelectedSlot(slot.id)}
                  >
                    <Rect
                      width={sw}
                      height={sh}
                      fill={photo ? undefined : (currentPage.background === '#FFFFFF' ? '#F8F9FA' : 'rgba(255,255,255,0.08)')}
                      stroke={isSelected ? '#6C63FF' : (photo ? 'transparent' : '#DEE2E6')}
                      strokeWidth={isSelected ? 2 : 1}
                      strokeScaleEnabled={false}
                      cornerRadius={photo ? 2 : 4}
                      dash={photo ? undefined : [4, 4]}
                    />
                    {photo && (
                      <KonvaImage
                        image={loadImage(photo.src)}
                        width={sw}
                        height={sh}
                        cornerRadius={2}
                      />
                    )}
                    {!photo && (
                      <Text
                        text="拖入照片"
                        x={0}
                        y={0}
                        width={sw}
                        height={sh}
                        align="center"
                        verticalAlign="middle"
                        fontSize={11}
                        fill="#ADB5BD"
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

      {/* Zoom indicator */}
      <div className="absolute bottom-2 right-3 text-[var(--text-nano)] text-[var(--color-gray-500)] select-none pointer-events-none bg-[var(--color-gray-100)]/80 px-1.5 py-0.5 rounded-[var(--radius-xs)]">
        {Math.round(canvasZoom * 100)}% · 第{currentPageIndex + 1}页
      </div>
    </div>
  );
}

/* Image cache for Konva */
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): HTMLImageElement {
  if (imageCache.has(src)) return imageCache.get(src)!;
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
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
