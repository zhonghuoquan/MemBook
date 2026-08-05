/**
 * 橡皮擦/画笔光标跟随组件
 * 从 Canvas.tsx 提取，自包含组件
 */
import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';

/* ── 橡皮擦光标跟随组件 ── */
export function EraserCursor({ containerRef, size }: { containerRef: RefObject<HTMLDivElement | null>; size: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = elRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const move = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      el.style.left = (e.clientX - rect.left) + 'px';
      el.style.top = (e.clientY - rect.top) + 'px';
      el.style.display = 'block';
    };
    const leave = () => { el.style.display = 'none'; };
    container.addEventListener('mousemove', move);
    container.addEventListener('mouseleave', leave);
    return () => {
      container.removeEventListener('mousemove', move);
      container.removeEventListener('mouseleave', leave);
    };
  }, [containerRef, size]);
  return (
    <div
      ref={elRef}
      className="absolute pointer-events-none rounded-full border-2 border-[var(--color-error)] opacity-60"
      style={{ width: size, height: size, display: 'none', transform: 'translate(-50%, -50%)' }}
    />
  );
}

/* ── 画笔光标跟随组件 ── */
export function BrushCursor({ containerRef, size, color, opacity }: { containerRef: RefObject<HTMLDivElement | null>; size: number; color: string; opacity: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = elRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const move = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      el.style.left = (e.clientX - rect.left) + 'px';
      el.style.top = (e.clientY - rect.top) + 'px';
      el.style.display = 'block';
    };
    const leave = () => { el.style.display = 'none'; };
    container.addEventListener('mousemove', move);
    container.addEventListener('mouseleave', leave);
    return () => {
      container.removeEventListener('mousemove', move);
      container.removeEventListener('mouseleave', leave);
    };
  }, [containerRef, size]);
  return (
    <div
      ref={elRef}
      className="absolute pointer-events-none rounded-full"
      style={{
        width: Math.max(size, 4),
        height: Math.max(size, 4),
        display: 'none',
        transform: 'translate(-50%, -50%)',
        border: `1.5px solid ${color}`,
        backgroundColor: color,
        opacity: opacity * 0.4,
      }}
    />
  );
}
