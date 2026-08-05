import { useRef, useState, useEffect } from 'react';

const DRAG_THRESHOLD = 3; // 移动超过 3px 才算拖拽

/** 使弹窗支持拖拽移动，依赖变化时自动重置位置 */
export function useDraggable(resetOn: boolean = true) {
  const ref = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);

  useEffect(() => {
    if (resetOn) setPos({ x: 0, y: 0 });
  }, [resetOn]);

  const onDown = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    // 以对话框中心为原点计算偏移
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    offset.current = { x: e.clientX - cx, y: e.clientY - cy };
    dragging.current = false;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        moved = true;
        dragging.current = true;
      }
      setPos({ x: ev.clientX - offset.current.x, y: ev.clientY - offset.current.y });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // 拖拽后阻止后续 click 事件触发关闭
      if (dragging.current) {
        setTimeout(() => { dragging.current = false; }, 0);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return { ref, pos, onDown, dragging };
}

/** 弹窗基础样式（居中，带偏移） */
export function dragStyle(pos: { x: number; y: number }, centered = true): React.CSSProperties {
  if (!pos.x && !pos.y && centered) return {};
  return {
    left: pos.x || '50%',
    top: pos.y || '50%',
    transform: centered ? 'translate(-50%, -50%)' : 'none',
  };
}
