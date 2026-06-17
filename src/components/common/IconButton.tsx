import { type ButtonHTMLAttributes, forwardRef } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ active = false, className = '', children, ...props }, ref) => (
    <button
      ref={ref}
      className={`
        inline-flex items-center justify-center
        w-8 h-8
        border-none rounded-[var(--radius-sm)]
        cursor-pointer select-none
        transition-[background-color,color] duration-150 ease-in-out
        ${active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
          : 'bg-transparent text-[var(--color-gray-600)]'
        }
        hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)]
        active:bg-[var(--color-surface-selected)] active:text-[var(--color-brand)]
        disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
