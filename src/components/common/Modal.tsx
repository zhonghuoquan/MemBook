import { useEffect, type ReactNode } from 'react';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Enter 快捷键确认回调。在 input 中按 Enter 触发；textarea 中 Enter 仍为换行 */
  onConfirm?: () => void;
  /** 确认按钮是否可用（disabled 时不响应 Enter），默认 true */
  confirmDisabled?: boolean;
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, onConfirm, confirmDisabled = false, title, footer, children, maxWidth = '640px' }: ModalProps) {
  const sb = useScrollbarVisibility<HTMLDivElement>();
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter' && onConfirm && !confirmDisabled) {
        const target = e.target as HTMLElement;
        const tag = target?.tagName;
        // textarea 中 Enter 为换行，不触发确认；contenteditable 同理
        if (tag === 'TEXTAREA' || target?.isContentEditable) return;
        // Shift+Enter 在 input 中也视为换行（部分用户习惯），不触发确认
        if (e.shiftKey) return;
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, onConfirm, confirmDisabled]);

  // 弹窗打开时锁定 body 滚动
  useEffect(() => {
    if (!open) { document.body.style.overflow = ''; return; }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]"
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
      {/* Dialog */}
      <div
        className="relative bg-[var(--color-card)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] w-[90vw] max-h-[90vh] grid grid-rows-[auto_1fr_auto] overflow-hidden animate-[modalFadeIn_0.2s_ease-out]"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button onClick={onClose}
          className="absolute top-4 right-4 inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] hover:bg-[var(--color-gray-100)] cursor-pointer transition-all duration-150 border-none bg-transparent z-10">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        {title && (
          <h2 className="text-[var(--text-h2)] font-[600] text-[var(--color-text-primary)] mb-3 px-8 pt-8">
            {title}
          </h2>
        )}
        {/* 内容区：贴边滚动条 —— 滚动条容器紧贴 Dialog 右边缘（webkit 始终占 6px 透明轨道）。
            几何：内容右沿距 Dialog 边缘 32px，其中 6px 滚动条 + 26px 真实 padding。
            内层 content 用 pl-8(32px) + pr-[26px]，footer 同样 32px/26px。 */}
        <div ref={sb.ref} className={`overflow-y-auto min-h-0 ps-scroll ${sb.className}`} {...sb.handlers}>
          <div className="pl-8 pr-[26px] pb-2">
            {children}
          </div>
        </div>
        {footer && (
          <div className="pl-8 pr-[26px] pb-6">{footer}</div>
        )}
      </div>
    </div>
  );
}
