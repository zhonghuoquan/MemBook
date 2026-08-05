import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 滚动条自动显隐 hook
 * - 默认 thumb 透明（不可见）
 * - 容器 hover 或内容在滚动时显现
 * - 停止滚动 `hideDelay`ms 后渐隐回透明
 * - 鼠标移出立即隐藏
 *
 * 用法 A（hook 自带 ref）：
 *   const sb = useScrollbarVisibility<HTMLDivElement>();
 *   <div ref={sb.ref} className={`overflow-y-auto ps-scroll ${sb.className}`} {...sb.handlers} />
 *
 * 用法 B（合并到外部 ref，例：已有 useRef 用于测宽）：
 *   const innerRef = useRef<HTMLDivElement>(null);
 *   const sb = useScrollbarVisibility<HTMLDivElement>({ externalRef: innerRef });
 *   <div ref={sb.setRef} className={...} {...sb.handlers} />
 */
export function useScrollbarVisibility<T extends HTMLElement = HTMLDivElement>(
  options: { hideDelay?: number; externalRef?: RefObject<T | null> } = {}
) {
  const { hideDelay = 1500, externalRef } = options;
  const internalRef = useRef<T | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);

  const getEl = useCallback((): T | null => {
    return (externalRef?.current ?? internalRef.current) as T | null;
  }, [externalRef]);

  const onScroll = useCallback(() => {
    setActive(true);
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setActive(false), hideDelay);
  }, [hideDelay]);

  const onEnter = useCallback(() => {
    const el = getEl();
    // 同时检查水平和垂直方向是否溢出，确保画布工作区放大后滚动条可见
    if (el && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
      setActive(true);
      clearTimeout(timerRef.current);
    }
  }, [getEl]);

  const onLeave = useCallback(() => {
    setActive(false);
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 合并 ref：同时写入 hook 内部 ref + 外部 ref
  const setRef = useCallback(
    (el: T | null) => {
      internalRef.current = el;
      if (externalRef) (externalRef as React.MutableRefObject<T | null>).current = el;
    },
    [externalRef]
  );

  return {
    ref: setRef,
    active,
    className: active ? 'ps-scroll-active' : '',
    handlers: { onScroll, onMouseEnter: onEnter, onMouseLeave: onLeave },
  };
}
