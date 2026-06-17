import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = '640px' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]"
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
      {/* Dialog */}
      <div
        className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] p-8 w-[90vw] animate-[modalFadeIn_0.2s_ease-out]"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 className="text-[var(--text-h2)] font-[600] text-[var(--color-text-primary)] mb-3">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
