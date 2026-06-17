import { type ButtonHTMLAttributes, forwardRef } from 'react';

/* ── Button Variants ── */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary-600)] text-white font-[600] border-none ' +
    'hover:bg-[var(--color-primary-700)] hover:shadow-[var(--shadow-sm)] ' +
    'active:bg-[var(--color-primary-800)] ' +
    'disabled:bg-[var(--color-gray-100)] disabled:text-[var(--color-gray-400)] disabled:cursor-not-allowed ' +
    'focus-visible:shadow-[0_0_0_3px_rgba(108,99,255,0.2)]',
  secondary:
    'bg-white text-[var(--color-gray-700)] border border-[var(--color-border)] font-[500] ' +
    'hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-xs)] ' +
    'active:bg-[var(--color-gray-100)] ' +
    'disabled:bg-transparent disabled:text-[var(--color-text-tertiary)] disabled:border-[var(--color-border-light)] ' +
    'focus-visible:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]',
  ghost:
    'bg-transparent text-[var(--color-gray-600)] border-none ' +
    'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] ' +
    'active:bg-[var(--color-surface-selected)] active:text-[var(--color-brand)] ' +
    'disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed',
  danger:
    'bg-[var(--color-error)] text-white font-[600] border-none ' +
    'hover:bg-[var(--color-error-dark)] ' +
    'focus-visible:shadow-[0_0_0_3px_rgba(229,72,77,0.2)]',
  cta:
    'bg-[var(--color-primary-600)] text-white font-[600] border-none ' +
    'hover:bg-[var(--color-primary-700)] ' +
    'active:bg-[var(--color-primary-800)] ' +
    'disabled:bg-[var(--color-gray-100)] disabled:text-[var(--color-gray-400)] disabled:cursor-not-allowed',
};

const sizeStyles = {
  sm: 'h-8 px-[10px] text-[var(--text-body-sm)] rounded-[var(--radius-sm)]',
  md: 'h-9 px-5 text-[var(--text-body)] rounded-[var(--radius-md)]',
  lg: 'h-10 px-7 text-[var(--text-body-lg)] rounded-[var(--radius-md)]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => (
    <button
      ref={ref}
      className={`
        inline-flex items-center justify-center gap-[var(--space-2)]
        whitespace-nowrap cursor-pointer select-none
        transition-[background-color,border-color,color,box-shadow] duration-150 ease-in-out
        ${variantStyles[variant]} ${sizeStyles[size]}
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
