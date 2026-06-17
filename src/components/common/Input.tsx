import { type InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error = false, fullWidth = false, className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`
        h-9 px-3 py-2
        bg-white text-[var(--color-gray-800)]
        border ${error ? 'border-[var(--color-border-error)]' : 'border-[var(--color-border)]'}
        rounded-[var(--radius-md)]
        text-[var(--text-body)] leading-[1.5]
        transition-[border-color,box-shadow] duration-150 ease-in-out
        placeholder:text-[var(--color-text-tertiary)]
        hover:border-[var(--color-border-hover)]
        focus:outline-none focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
        disabled:bg-[var(--color-gray-50)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `.trim()}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
