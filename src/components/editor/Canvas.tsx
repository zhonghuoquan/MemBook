import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { TEMPLATES } from '../../types';
import type { Template, SlotLayout } from '../../types';

/**
 * Canvas 区域 — 集成 Konva.js 渲染相册页面
 * 支持：模板插槽显示、照片放置、选中变换、背景色
 */
const CANVAS_W = 420;
const CANVAS_H = 560;

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const photos = usePhotoStore((s) => s.photos);
  const [scale, setScale] = useState(1);

  const currentPage = pages[currentPageIndex];
  const template: Template | undefined = currentPage
    ? TEMPLATES.find((t) => t.id === currentPage.templateId)
    : undefined;

  // Attach transformer to selected node
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

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(s + 0.2, 2)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(s - 0.2, 0.3)), []);
  const handleFit = useCallback(() => setScale(1), []);

  /* Keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '=') { e.preventDefault(); handleZoomIn(); }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); handleZoomOut(); }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); handleFit(); }
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
  }, [handleZoomIn, handleZoomOut, handleFit, selectedSlotId, currentPageIndex, setSelectedSlot]);

  if (!currentPage || !template) {
    return <CanvasEmptyState onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} scale={Math.round(scale * 100)} />;
  }

  const slotWidth = (s: SlotLayout) => (s.width / 100) * CANVAS_W;
  const slotHeight = (s: SlotLayout) => (s.height / 100) * CANVAS_H;
  const slotX = (s: SlotLayout) => (s.x / 100) * CANVAS_W;
  const slotY = (s: SlotLayout) => (s.y / 100) * CANVAS_H;

  return (
    <div className="flex-1 flex flex-col bg-[var(--color-gray-100)] overflow-hidden relative">
      {/* Zoom Toolbar */}
      <div className="flex items-center justify-center gap-2 py-1.5 bg-[var(--color-gray-50)] border-b border-[var(--color-border-light)] shrink-0">
        <ZoomButton onClick={handleZoomOut} title="缩小 (Ctrl+-)">
          <line x1="2" y1="6" x2="10" y2="6" />
        </ZoomButton>
        <span className="text-[var(--text-caption)] text-[var(--color-gray-600)] min-w-[3em] text-center select-none">
          {Math.round(scale * 100)}%
        </span>
        <ZoomButton onClick={handleZoomIn} title="放大 (Ctrl+=)">
          <line x1="6" y1="2" x2="6" y2="10" /><line x1="2" y1="6" x2="10" y2="6" />
        </ZoomButton>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <button
          className="text-[var(--text-caption)] text-[var(--color-gray-500)] px-2 py-0.5 border border-[var(--color-border)]
                     rounded-[var(--radius-xs)] bg-white cursor-pointer hover:bg-[var(--color-surface-hover)]"
          onClick={handleFit}
        >
          适应
        </button>
      </div>

      {/* Scrollable Canvas Area */}
      <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-6">
        <Stage
          ref={stageRef}
          width={CANVAS_W}
          height={CANVAS_H}
          scaleX={scale}
          scaleY={scale}
          style={{
            background: currentPage.background,
            borderRadius: '2px',
            boxShadow: '0 2px 12px rgba(33,37,41,0.1)',
          }}
          onMouseDown={(e) => {
            // Deselect if clicking on empty stage
            if (e.target === e.target.getStage()) {
              setSelectedSlot(null);
            }
          }}
        >
          <Layer>
            {/* Background */}
            <Rect
              x={0}
              y={0}
              width={CANVAS_W}
              height={CANVAS_H}
              fill={currentPage.background}
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
                  {/* Slot background */}
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

                  {/* Photo image */}
                  {photo && (
                    <KonvaImage
                      image={loadImage(photo.src)}
                      width={sw}
                      height={sh}
                      cornerRadius={2}
                    />
                  )}

                  {/* Empty slot hint */}
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

            {/* Transformer for selected slot */}
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

      {/* Page info */}
      <div className="absolute bottom-2 right-3 text-[var(--text-nano)] text-[var(--color-gray-400)] select-none">
        Ctrl+滚轮缩放 · 第{currentPageIndex + 1}页
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

/* ── Sub-components ── */

function ZoomButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      className="w-6 h-6 flex items-center justify-center border-none rounded-[var(--radius-xs)]
                 bg-transparent text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)]"
      onClick={onClick}
      title={title}
    >
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
        {children}
      </svg>
    </button>
  );
}

function CanvasEmptyState({
  onZoomIn: handleZoomIn,
  onZoomOut: handleZoomOut,
  onFit: handleFit,
  scale,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  scale: number;
}) {
  const addToast = useUIStore((s) => s.addToast);
  const addPage = useEditorStore((s) => s.addPage);

  const handleCreatePage = () => {
    addPage();
    addToast({ type: 'success', message: '已添加新页面' });
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--color-gray-100)] overflow-hidden relative">
      {/* Zoom Toolbar */}
      <div className="flex items-center justify-center gap-2 py-1.5 bg-[var(--color-gray-50)] border-b border-[var(--color-border-light)] shrink-0">
        <ZoomButton onClick={handleZoomOut} title="缩小 (Ctrl+-)">
          <line x1="2" y1="6" x2="10" y2="6" />
        </ZoomButton>
        <span className="text-[var(--text-caption)] text-[var(--color-gray-600)] min-w-[3em] text-center select-none">{scale}%</span>
        <ZoomButton onClick={handleZoomIn} title="放大 (Ctrl+=)">
          <line x1="6" y1="2" x2="6" y2="10" /><line x1="2" y1="6" x2="10" y2="6" />
        </ZoomButton>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <button className="text-[var(--text-caption)] text-[var(--color-gray-500)] px-2 py-0.5 border border-[var(--color-border)] rounded-[var(--radius-xs)] bg-white cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={handleFit}>适应</button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-12 h-12 text-[var(--color-gray-300)] mx-auto mb-3">
            <rect x="6" y="6" width="36" height="36" rx="4" strokeDasharray="4 2" />
          </svg>
          <p className="text-[var(--text-body-sm)] text-[var(--color-text-tertiary)]">
            从左侧拖拽照片到此处
          </p>
          <button
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary-600)] text-white
                       border-none rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500] cursor-pointer
                       hover:bg-[var(--color-primary-700)] transition-colors"
            onClick={handleCreatePage}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            创建页面
          </button>
        </div>
      </div>
    </div>
  );
}
