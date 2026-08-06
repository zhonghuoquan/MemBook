import { useEffect } from 'react';

/**
 * 弹窗快捷键 Hook：为自实现（非通用 Modal）的弹窗统一注入 Enter/Esc 快捷键。
 *
 * - Enter：触发 onConfirm（textarea/contenteditable 中 Enter 仍为换行；Shift+Enter 不触发）
 * - Escape：触发 onCancel
 *
 * 用法：
 *   useDialogHotkeys({ onConfirm: handleConfirm, onCancel: onClose, enabled: open, confirmDisabled });
 *
 * 与 Modal 组件内的逻辑保持一致，避免各弹窗重复实现。
 */
export function useDialogHotkeys({
  onConfirm,
  onCancel,
  enabled = true,
  confirmDisabled = false,
}: {
  onConfirm?: () => void;
  onCancel?: () => void;
  enabled?: boolean;
  confirmDisabled?: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key === 'Enter' && onConfirm && !confirmDisabled) {
        const target = e.target as HTMLElement;
        const tag = target?.tagName;
        // textarea 中 Enter 为换行，不触发确认；contenteditable 同理
        if (tag === 'TEXTAREA' || target?.isContentEditable) return;
        // Shift+Enter 视为换行（部分用户习惯），不触发确认
        if (e.shiftKey) return;
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, onConfirm, onCancel, confirmDisabled]);
}
