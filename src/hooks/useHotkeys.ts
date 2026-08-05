import { useEffect, useRef } from 'react';

type KeyHandler = () => void;
type KeyMap = Record<string, KeyHandler>;

function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function matchKey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  // code 或 key 都匹配
  const eKey = (e.code || e.key || '').toLowerCase();
  return (
    e.ctrlKey === needCtrl && e.metaKey === needCtrl &&
    e.shiftKey === needShift && e.altKey === needAlt &&
    (eKey === key || e.key.toLowerCase() === key)
  );
}

export function useHotkeys(keyMap: KeyMap, enabled: boolean = true) {
  const ref = useRef(keyMap);
  ref.current = keyMap;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (isInputTarget(e.target)) return;
      for (const combo of Object.keys(ref.current)) {
        if (matchKey(e, combo)) {
          e.preventDefault();
          e.stopPropagation();
          ref.current[combo]();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled]);
}
