import { useEffect, useRef } from 'react';
import { useUIStore } from '../../store';
import type { ToastType } from '../../types';

const bgMap: Record<ToastType, string> = {
  success: 'bg-[var(--color-success)]',
  error: 'bg-[var(--color-error)]',
  warning: 'bg-[var(--color-warning)]',
  info: 'bg-[var(--color-gray-900)]',
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
    // Set auto-dismiss timer for each new toast
    const currentTimers = timersRef.current;
    toasts.forEach((toast) => {
      if (!currentTimers.has(toast.id)) {
        const timer = setTimeout(() => {
          removeToast(toast.id);
          currentTimers.delete(toast.id);
        }, 3000);
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            ${bgMap[toast.type]}
            text-white rounded-[var(--radius-md)] px-4 py-2.5
            text-[var(--text-body-sm)] shadow-[var(--shadow-md)]
            flex items-center gap-2
            animate-[toastIn_0.25s_ease-out]
            pointer-events-auto
          `}
        >
          <span className="w-4 h-4 flex items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
            {iconMap[toast.type]}
          </span>
          <span>{toast.message}</span>
          <button
            className="ml-2 w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/20
                       text-white/70 hover:text-white transition-colors border-none cursor-pointer"
            onClick={() => removeToast(toast.id)}
          >
            <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="w-2.5 h-2.5">
              <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
