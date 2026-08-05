import { useEffect, useRef } from 'react';
import { useUIStore } from '../../store';
import type { ToastType } from '../../types';

const bgColors: Record<ToastType, string> = {
  success: 'color-mix(in srgb, var(--color-success) 80%, transparent)',
  error: 'color-mix(in srgb, var(--color-error) 80%, transparent)',
  warning: 'color-mix(in srgb, var(--color-warning) 80%, transparent)',
  info: 'color-mix(in srgb, var(--color-gray-700) 80%, transparent)',
};

const iconMap: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  warning: '!',
  info: 'i',
};

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // 最多保留 3 条提示
    if (toasts.length > 3) {
      const extras = toasts.slice(0, toasts.length - 3);
      extras.forEach((t) => removeToast(t.id));
    }

    // Set auto-dismiss timer for each new toast
    const currentTimers = timersRef.current;
    toasts.forEach((toast) => {
      if (!currentTimers.has(toast.id)) {
        const timer = setTimeout(() => {
          removeToast(toast.id);
          currentTimers.delete(toast.id);
        }, 2000);
        currentTimers.set(toast.id, timer);
      }
    });

    // Clean up timers for removed toasts
    currentTimers.forEach((timer, id) => {
      if (!toasts.find((t) => t.id === id)) {
        clearTimeout(timer);
        currentTimers.delete(id);
      }
    });
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="relative text-white rounded-[var(--radius-md)] px-4 py-2.5
                     text-[var(--text-body-sm)] shadow-[var(--shadow-md)]
                     flex items-center gap-2 animate-[toastIn_0.25s_ease-out]
                     pointer-events-auto overflow-hidden"
          style={{ backdropFilter: 'blur(4px)' }}
        >
          {/* 半透明背景层 */}
          <div className="absolute inset-0 rounded-[var(--radius-md)]"
            style={{ backgroundColor: bgColors[toast.type] }} />
          <span className="relative z-10 w-4 h-4 flex items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
            {iconMap[toast.type]}
          </span>
          <span className="relative z-10">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
