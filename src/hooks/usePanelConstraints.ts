import { useEffect, useRef, useState, useCallback } from 'react';
import { useUIStore } from '../store';

export interface WorkspaceBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FALLBACK_TOP = 56;
const FALLBACK_BOTTOM_OFFSET = 150;

function getFallbackBounds(): WorkspaceBounds {
  const root = getComputedStyle(document.documentElement);
  const navW = parseInt(root.getPropertyValue('--layout-nav-width')) || 64;
  const panelW = parseInt(root.getPropertyValue('--layout-panel-width')) || 440;
  return {
    left: navW + panelW,
    top: FALLBACK_TOP,
    right: window.innerWidth,
    bottom: window.innerHeight - FALLBACK_BOTTOM_OFFSET,
  };
}

function boundsEqual(a: WorkspaceBounds, b: WorkspaceBounds): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

export function usePanelConstraints() {
  const bottomNavHeight = useUIStore((s) => s.bottomNavHeight);
  const [bounds, setBounds] = useState<WorkspaceBounds>(getFallbackBounds);
  const boundsRef = useRef<WorkspaceBounds>(bounds);

  // 保持 ref 与 state 同步
  boundsRef.current = bounds;

  useEffect(() => {
    const update = () => {
      const leftPanel = document.querySelector('[data-left-panel]') as HTMLElement | null;
      const toolbar = document.querySelector('[data-toolbar]') as HTMLElement | null;
      const left = leftPanel?.getBoundingClientRect().right ?? getFallbackBounds().left;
      const top = toolbar?.getBoundingClientRect().bottom ?? FALLBACK_TOP;
      const next: WorkspaceBounds = {
        left,
        top,
        right: window.innerWidth,
        bottom: window.innerHeight - bottomNavHeight,
      };
      setBounds((prev) => (boundsEqual(prev, next) ? prev : next));
    };

    update();

    const ro = new ResizeObserver(update);
    const leftPanel = document.querySelector('[data-left-panel]');
    const toolbar = document.querySelector('[data-toolbar]');
    if (leftPanel) ro.observe(leftPanel);
    if (toolbar) ro.observe(toolbar);
    window.addEventListener('resize', update);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [bottomNavHeight]);

  // constrain 不依赖 bounds state，避免拖动监听被重新绑定
  const constrain = useCallback((x: number, y: number, width: number, height: number): { x: number; y: number } => {
    const b = boundsRef.current;
    return {
      x: Math.max(b.left, Math.min(b.right - width, x)),
      y: Math.max(b.top, Math.min(b.bottom - height, y)),
    };
  }, []);

  return { bounds, constrain };
}
