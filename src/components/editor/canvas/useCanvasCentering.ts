/**
 * 页面居中 / 初始适配 Hook
 * 从 Canvas.tsx 提取，管理容器尺寸测量和页面居中逻辑
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useUIStore } from '../../../store';
import { computeFitZoom } from './constants';

interface UseCanvasCenteringOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  pagesLength: number;
  albumSizeId: string | undefined;
  currentPageId: string | undefined;
  CANVAS_W: number;
  CANVAS_H: number;
  STAGE_W: number;
  STAGE_H: number;
  canvasZoom: number;
  setCanvasZoom: (zoom: number) => void;
  containerSize: { w: number; h: number };
  setContainerSize: (v: { w: number; h: number }) => void;
}

export function useCanvasCentering({
  containerRef, pagesLength, albumSizeId, currentPageId,
  CANVAS_W, CANVAS_H, STAGE_W, STAGE_H, canvasZoom, setCanvasZoom,
  containerSize, setContainerSize,
}: UseCanvasCenteringOptions) {

  // ── 页面居中 / 初始适配：在挂载、相册尺寸变化、容器尺寸变化或页面从 0 变为 1+ 时执行 ──
  const needsCenterRef = useRef(true);
  const shouldFitZoomRef = useRef(true);
  const hasMeasuredRef = useRef(false);
  const prevPagesLengthRef = useRef(0);

  useEffect(() => {
    const wasEmpty = prevPagesLengthRef.current === 0;
    prevPagesLengthRef.current = pagesLength;
    if (wasEmpty && pagesLength > 0) {
      needsCenterRef.current = true;
      shouldFitZoomRef.current = true;
      // 强制触发一次容器尺寸测量：首次创建页面时 ResizeObserver 可能尚未回调，
      // 若跳过测量，居中逻辑会因 hasMeasuredRef 为 false 直接 return。
      if (!hasMeasuredRef.current) {
        const el = containerRef.current;
        if (el) {
          // 与 ResizeObserver contentRect 语义保持一致：使用 content box 尺寸
          hasMeasuredRef.current = true;
          setContainerSize({ w: el.clientWidth, h: el.clientHeight });
        }
      }
    }
  }, [pagesLength]);

  useEffect(() => {
    // 相册尺寸变化时重新适配并居中
    needsCenterRef.current = true;
    shouldFitZoomRef.current = true;
  }, [albumSizeId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !needsCenterRef.current || !hasMeasuredRef.current) return;
    needsCenterRef.current = false;

    // 首次或相册变化时，根据容器大小自适应缩放（完整显示页面，最大 200%）
    if (currentPageId && shouldFitZoomRef.current) {
      shouldFitZoomRef.current = false;
      const fitZoom = computeFitZoom(el.clientWidth, el.clientHeight, CANVAS_W, CANVAS_H);
      if (Math.abs(fitZoom - canvasZoom) > 0.001) {
        setCanvasZoom(fitZoom);
        needsCenterRef.current = true; // 缩放变更后下一帧重新居中
        return;
      }
    }

    // 计算居中滚动位置：画布居中于容器（使用 containerSize 与 STAGE_W/H 保持同一口径）
    const scrollCenterX = Math.max(0, (STAGE_W - containerSize.w) / 2);
    const scrollCenterY = Math.max(0, (STAGE_H - containerSize.h) / 2);
    el.scrollLeft = scrollCenterX;
    el.scrollTop = scrollCenterY;
  }, [STAGE_W, STAGE_H, containerSize.w, containerSize.h, currentPageId, CANVAS_W, CANVAS_H, canvasZoom, setCanvasZoom]);

  // ── Observe container resize ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    let pendingSize = { w: lastW, h: lastH };
    const ro = new ResizeObserver((entries) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          pendingSize = { w: width, h: height };
          // 拖拽调整底部导航/左侧面板期间，Canvas 容器尺寸连续变化，
          // 此时跳过 state 更新以避免工作区抖动；结束后再同步最终尺寸
          if (useUIStore.getState().isDraggingLayout) continue;
          // 过滤亚像素抖动：只有变化超过 1px 才更新，减少高频尺寸变化导致的重绘
          if (Math.abs(width - lastW) > 1 || Math.abs(height - lastH) > 1) {
            lastW = width;
            lastH = height;
            hasMeasuredRef.current = true;
            needsCenterRef.current = true;
            setContainerSize({ w: width, h: height });
          }
        }
      });
    });
    // 拖拽结束时立即同步一次最终尺寸
    const prevLayoutRef = { isDraggingLayout: useUIStore.getState().isDraggingLayout };
    const unsub = useUIStore.subscribe((state) => {
      const wasDragging = prevLayoutRef.isDraggingLayout;
      prevLayoutRef.isDraggingLayout = state.isDraggingLayout;
      if (wasDragging && !state.isDraggingLayout) {
        const { w, h } = pendingSize;
        if (Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1) {
          lastW = w;
          lastH = h;
          hasMeasuredRef.current = true;
          needsCenterRef.current = true;
          setContainerSize({ w, h });
        }
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      unsub();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);
}
