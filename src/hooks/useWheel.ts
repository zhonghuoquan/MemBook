 import { useEffect, useRef } from 'react';

/**
 * 为指定元素附加原生 wheel 监听器（non-passive）。
 * React 19 将 onWheel 默认设为 passive，preventDefault 会触发警告，
 * 需要原生 addEventListener({ passive: false }) 才能阻止默认滚动。
 */
export function useWheel<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: (e: WheelEvent) => void,
  deps: React.DependencyList = [],
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => handlerRef.current(e);
    el.addEventListener('wheel', listener as EventListener, { passive: false } as EventListenerOptions);
    return () => el.removeEventListener('wheel', listener as EventListener, { passive: false } as EventListenerOptions);
  }, deps);
}
