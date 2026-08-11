/**
 * 橡皮擦/画笔光标跟随组件
 * 从 Canvas.tsx 提取，自包含组件
 *
 * 实现要点（2026-08-09 重构修复显示异常）：
 * 1. 通过 createPortal 渲染到 document.body，避免容器 overflow:auto 裁剪和滚动偏移
 * 2. position:fixed + transform:translate3d 定位，GPU 加速，不触发 layout reflow
 * 3. 监听 document mousemove（始终能收到事件），用 container.contains(target) 判断是否在工作区内
 * 4. rAF 节流更新位置，避免高频样式写入导致掉帧
 * 5. size 不在 effect 依赖中，仅影响渲染，改变笔刷粗细时不重新订阅事件
 */
import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';

/** 共用：跟随鼠标的圆形光标基础逻辑 */
function useFollowCursor(containerRef: RefObject<HTMLDivElement | null>) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    let rafId: number | null = null;
    let cx = 0, cy = 0;
    // 标记鼠标是否在容器内。首次 mousemove 时通过 contains() 检测，
    // 后续由 mouseenter/leave 维护，避免每次 move 都做 DOM 树查询。
    let inside = false;
    let initialized = false;

    const flush = () => {
      rafId = null;
      // translate3d 先平移到鼠标位置，再 translate(-50%,-50%) 居中
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
    };

    const onMove = (e: MouseEvent) => {
      cx = e.clientX;
      cy = e.clientY;
      // 首次移动时确认鼠标是否已在工作区内（处理激活工具时鼠标已在内的情况）
      if (!initialized) {
        initialized = true;
        if (container.contains(e.target as Node)) inside = true;
      }
      if (inside) {
        if (el.style.display === 'none') el.style.display = 'block';
        if (rafId === null) rafId = requestAnimationFrame(flush);
      }
    };

    const onEnter = () => {
      inside = true;
      el.style.display = 'block';
    };
    const onLeave = () => {
      inside = false;
      el.style.display = 'none';
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    container.addEventListener('mouseenter', onEnter);
    container.addEventListener('mouseleave', onLeave);

    return () => {
      document.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseenter', onEnter);
      container.removeEventListener('mouseleave', onLeave);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);

  return elRef;
}

/* ── 橡皮擦光标跟随组件 ── */
/* 红色圆环 + 中心十字，大小反映擦除范围 */
export function EraserCursor({ containerRef, size }: { containerRef: RefObject<HTMLDivElement | null>; size: number }) {
  const elRef = useFollowCursor(containerRef);
  const sz = Math.max(size, 8);
  return createPortal(
    <div
      ref={elRef}
      className="fixed pointer-events-none rounded-full"
      style={{
        width: sz, height: sz, display: 'none',
        top: 0, left: 0,
        zIndex: 99999,
        border: '2px solid #ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
      }}
    >
      {/* 中心十字辅助瞄准 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: '40%', height: '1px', backgroundColor: '#ef4444' }} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: '1px', height: '40%', backgroundColor: '#ef4444' }} />
    </div>,
    document.body,
  );
}

/* ── 画笔光标跟随组件 ── */
/* 圆环反映画笔粗细（含笔触类型宽度倍数），中心填充半透明画笔颜色 */
export function BrushCursor({ containerRef, size, color, opacity }: { containerRef: RefObject<HTMLDivElement | null>; size: number; color: string; opacity: number }) {
  const elRef = useFollowCursor(containerRef);
  return createPortal(
    <div
      ref={elRef}
      className="fixed pointer-events-none rounded-full"
      style={{
        width: Math.max(size, 6),
        height: Math.max(size, 6),
        display: 'none',
        top: 0, left: 0,
        zIndex: 99999,
        border: `1.5px solid ${color}`,
        backgroundColor: color,
        opacity: Math.max(opacity * 0.4, 0.25),
      }}
    />,
    document.body,
  );
}
