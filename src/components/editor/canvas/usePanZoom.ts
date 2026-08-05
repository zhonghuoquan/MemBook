/**
 * 空格键拖拽平移画布的 Hook
 * 从 Canvas.tsx 提取，封装 Space+鼠标拖拽的完整交互逻辑
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import { isInputTarget } from './constants';

interface UsePanZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasW: number;
  canvasH: number;
  canvasZoom: number;
}

interface UsePanZoomResult {
  spaceHeld: boolean;
  isPanning: boolean;
  pageExceedsViewport: () => boolean;
}

/**
 * 仅当“页面本身”超出工作区视口才允许空格拖拽（不包含 Stage 四周的留白边距）
 */
export function usePanZoom({ containerRef, canvasW, canvasH, canvasZoom }: UsePanZoomOptions): UsePanZoomResult {
  // ── Space+鼠标拖拽移动画布（类似全屏浏览的拖拽体验）──
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeldRef = useRef(false);
  const panningRef = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const scrollStart = useRef({ x: 0, y: 0 });

  const pageExceedsViewport = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    return canvasW * canvasZoom > el.clientWidth || canvasH * canvasZoom > el.clientHeight;
  }, [canvasW, canvasH, canvasZoom, containerRef]);

  // 跟踪空格键状态：在 document capture 阶段拦截，避免空格触发按钮 click/弹窗
  // P0-fix: 全屏视图打开时跳过 Space 拦截，让 FullscreenView 的 window 级监听器接收事件
  //   （FullscreenView 用 Space 切换照片，usePanZoom 的 stopPropagation 会阻止它收到事件）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 仅处理 Space，避免与 Ctrl/Meta 冲突；Alt 仍需要阻止默认行为以屏蔽系统窗口菜单
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey) return;
      if (isInputTarget(e.target)) return;
      // 全屏视图打开时不拦截 Space（FullscreenView 用 Space 切换照片）
      if (document.documentElement.classList.contains('fullscreen-open')) return;
      // 始终阻止 Space 的默认行为（包括重复触发的页面滚动），避免与拖拽冲突
      e.preventDefault();
      e.stopPropagation();
      // 若 Alt 被按下，不进入抓手平移状态，仅屏蔽默认行为
      if (e.altKey) return;
      // 重复按键只拦截默认行为，不再重复设置状态
      if (e.repeat) return;
      // 若当前焦点在按钮/链接等会响应 Space 的元素上，先失焦，避免激活弹窗或菜单
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && typeof active.blur === 'function') {
        active.blur();
      }
      // 只有页面本身超出视口时才进入“抓手”平移状态
      const canPan = pageExceedsViewport();
      spaceHeldRef.current = canPan;
      setSpaceHeld(canPan);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // 全屏视图打开时不拦截 Space
      if (document.documentElement.classList.contains('fullscreen-open')) return;
      e.preventDefault();
      e.stopPropagation();
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      panningRef.current = false;
      setIsPanning(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, [pageExceedsViewport]);

  // 用原生事件在 capture 阶段拦截 mousedown（在 event 到达 Konva Stage 前）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (spaceHeldRef.current && e.button === 0 && !panningRef.current && pageExceedsViewport()) {
        e.preventDefault();
        e.stopPropagation();
        panStart.current = { x: e.clientX, y: e.clientY };
        scrollStart.current = { x: el.scrollLeft, y: el.scrollTop };
        panningRef.current = true;
        setIsPanning(true);
      }
    };
    el.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => el.removeEventListener('mousedown', onMouseDown, { capture: true });
  }, [pageExceedsViewport, containerRef]);

  // 平移中：window 级 mousemove/mouseup，使用 ref 状态避免 React 渲染延迟导致卡顿
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      if (!panningRef.current) return;
      ev.preventDefault();
      const dx = ev.clientX - panStart.current.x;
      const dy = ev.clientY - panStart.current.y;
      // 抓手工具模式：鼠标往哪拖，内容往哪走，与全屏浏览拖拽体验一致
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      const maxScrollTop = el.scrollHeight - el.clientHeight;
      el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, scrollStart.current.x - dx));
      el.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollStart.current.y - dy));
    };
    const onUp = () => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setIsPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [containerRef]);

  // 光标样式：space+可滚动→grab, space+drag→grabbing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isPanning) {
      el.style.cursor = 'grabbing';
    } else if (spaceHeld && pageExceedsViewport()) {
      el.style.cursor = 'grab';
    } else {
      el.style.cursor = '';
    }
  }, [spaceHeld, isPanning, pageExceedsViewport, containerRef]);

  return { spaceHeld, isPanning, pageExceedsViewport };
}
