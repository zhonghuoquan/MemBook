/**
 * 画布滚轮处理 Hook
 * 从 Canvas.tsx 提取，处理 Ctrl+滚轮缩放、编辑模式照片缩放、普通滚轮翻页
 */
import { useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import { useEditorStore, useUIStore } from '../../../store';
import { useWheel } from '../../../hooks/useWheel';
import { computeZoomedScroll } from '../../../utils/sharedRender';
import { calcCoverFitWithRotation, computeZoomedPan } from '../../../utils/photoGeometry';
import type { Template, SlotLayout, PhotoPlacement, Photo } from '../../../types';

interface UseCanvasWheelOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  CANVAS_W: number;
  CANVAS_H: number;
  STAGE_W: number;
  STAGE_H: number;
  canvasZoom: number;
  setCanvasZoom: (zoom: number) => void;
  isEditing: boolean;
  isEditingRef: React.MutableRefObject<boolean>;
  selectedSlotId: string | null;
  template: Template | undefined;
  placementMap: Map<string, PhotoPlacement>;
  photoMap: Map<string, Photo>;
  currentPageIndex: number;
  groupOX: number;
  groupOY: number;
  slotX: (s: SlotLayout) => number;
  slotY: (s: SlotLayout) => number;
  slotWidth: (s: SlotLayout) => number;
  slotHeight: (s: SlotLayout) => number;
  wheelHideGridTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setShowGrid: (v: boolean) => void;
}

export function useCanvasWheel({
  containerRef, CANVAS_W, CANVAS_H, STAGE_W, STAGE_H, canvasZoom, setCanvasZoom,
  isEditing, isEditingRef, selectedSlotId, template, placementMap, photoMap,
  currentPageIndex, groupOX, groupOY,
  slotX, slotY, slotWidth, slotHeight,
  wheelHideGridTimer, setShowGrid,
}: UseCanvasWheelOptions) {
  // ── Wheel: Ctrl+wheel = 页面缩放，编辑模式下普通滚轮 = 照片缩放 ───
  const handleWheel = useCallback((e: WheelEvent) => {
    // Ctrl+滚轮缩放：编辑模式下也支持
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const containerW = container.clientWidth;
      const containerH = container.clientHeight;

      const oldZoom = useUIStore.getState().canvasZoom;
      const direction = e.deltaY > 0 ? -1 : 1;
      // 根据滚动速度动态调整缩放步长：慢滚精细（~3%），快滚加速（~13%）
      const absDelta = Math.abs(e.deltaY);
      const speed = Math.min(absDelta / 120, 1);
      const exponent = 0.03 + speed * 0.10;
      const newZoom = Math.max(0.1, Math.min(5, oldZoom * Math.exp(direction * exponent)));
      if (Math.abs(newZoom - oldZoom) < 0.001) return;

      // 页面小于可视窗口时以工作区中心为锚点，避免缩放后页面偏移；
      // 页面大于可视窗口时以鼠标光标为锚点，便于局部缩放。
      const pageFits = CANVAS_W * newZoom <= containerW && CANVAS_H * newZoom <= containerH;
      const anchor = pageFits
        ? { x: containerW / 2, y: containerH / 2 }
        : { x: e.clientX - rect.left, y: e.clientY - rect.top };

      setCanvasZoom(newZoom);

      // 下一帧根据页面 Group 偏移重新计算滚动位置，确保锚点下方逻辑点不变
      requestAnimationFrame(() => {
        const c = containerRef.current;
        if (!c) return;
        const { scrollLeft, scrollTop } = computeZoomedScroll(
          c,
          CANVAS_W,
          CANVAS_H,
          oldZoom,
          newZoom,
          anchor,
        );
        c.scrollLeft = scrollLeft;
        c.scrollTop = scrollTop;
      });

      return;
    }

    // 编辑模式下普通滚轮 = 照片缩放（光标位置为锚点，类似 Canva 裁剪缩放）
    if (isEditing && selectedSlotId && template) {
      e.preventDefault();
      e.stopPropagation();

      const slot = template.slots.find((s) => s.id === selectedSlotId);
      if (!slot) return;
      const sx = slotX(slot);
      const sy = slotY(slot);
      const sw = slotWidth(slot);
      const sh = slotHeight(slot);

      const placement = placementMap.get(selectedSlotId);
      const photo = placement?.photoId ? photoMap.get(placement.photoId) : undefined;
      if (!placement || !photo || photo.width <= 0 || photo.height <= 0) return;

      // 光标在 Stage 内容空间中的位置
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scrollX = containerRef.current?.scrollLeft || 0;
      const scrollY = containerRef.current?.scrollTop || 0;
      const stageX = e.clientX - rect.left + scrollX;
      const stageY = e.clientY - rect.top + scrollY;

      // 转换为槽位内部坐标作为缩放锚点
      const anchorCX = (stageX - groupOX) / canvasZoom - sx;
      const anchorCY = (stageY - groupOY) / canvasZoom - sy;

      const oldPanScale = Math.max(placement.panScale || 1, 1);
      const direction = e.deltaY > 0 ? -1 : 1;
      // 照片缩放同样按滚动速度调整步长
      const absDelta = Math.abs(e.deltaY);
      const speed = Math.min(absDelta / 120, 1);
      const exponent = 0.03 + speed * 0.10;
      const newPanScale = Math.max(1, oldPanScale * Math.exp(direction * exponent));

      const totalRot = placement.panRotation ?? (placement.rotation || 0);
      const oldCF = calcCoverFitWithRotation(photo.width, photo.height, sw, sh, totalRot);
      const oldBW = oldCF.boundingW * oldPanScale;
      const oldBH = oldCF.boundingH * oldPanScale;
      const oldDefaultPx = Math.round((sw - oldBW) / 2);
      const oldDefaultPy = Math.round((sh - oldBH) / 2);

      const { panX, panY } = computeZoomedPan(
        photo.width, photo.height, sw, sh, totalRot,
        oldPanScale, newPanScale,
        placement.panX ?? oldDefaultPx,
        placement.panY ?? oldDefaultPy,
        anchorCX, anchorCY
      );

      useEditorStore.getState().updatePlacementPan(currentPageIndex, selectedSlotId, panX, panY, newPanScale);
      setShowGrid(true);
      // 停止缩放一小会后隐藏网格
      if (wheelHideGridTimer.current) clearTimeout(wheelHideGridTimer.current);
      wheelHideGridTimer.current = setTimeout(() => setShowGrid(false), 600);
      return;
    }

    // 普通滚轮 → 切换页面（底部缩略图区域内的滚轮不切换）
    if ((e.target as HTMLElement).closest('nav[data-onboarding="bottom-nav"]')) return;
    e.preventDefault();
    e.stopPropagation();
    const st = useEditorStore.getState();
    const { pages, currentPageIndex: idx, setCurrentPage } = st;
    if (e.deltaY > 0) {
      if (idx < pages.length - 1) setCurrentPage(idx + 1);
    } else {
      if (idx > 0) setCurrentPage(idx - 1);
    }
  }, [setCanvasZoom, isEditing, selectedSlotId, template, placementMap, photoMap, currentPageIndex, canvasZoom, groupOX, groupOY, STAGE_W, STAGE_H]);

  // React 19 将 onWheel 设为 passive，preventDefault 会报警告；改用原生非 passive 监听
  useWheel(containerRef, handleWheel);

  // ── 全局拦截浏览器 Ctrl+wheel 缩放（必须 passive:false + window 级）──
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handler as EventListener, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handler as EventListener, { capture: true });
  }, []);

  // ── 容器级拦截：Ctrl+wheel（缩放）和普通滚轮（翻页）阻止默认滚动 ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || !isEditingRef.current) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', handler as EventListener, { passive: false } as EventListenerOptions);
    return () => el.removeEventListener('wheel', handler as EventListener, { passive: false } as EventListenerOptions);
  }, [containerRef, isEditingRef]);
}
