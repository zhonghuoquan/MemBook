import type { ReactNode } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

export function Tooltip({ text, children, side = 'top' }: TooltipProps) {
  const sideClasses = side === 'top'
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
    : 'top-full left-1/2 -translate-x-1/2 mt-1.5';

  return (
    <span className="relative inline-flex items-center justify-center group/tooltip">
      {children}
      <span
        className={`
          absolute ${sideClasses}
          pointer-events-none z-[var(--z-tooltip)]
          px-2 py-1 rounded-[var(--radius-md)]
          bg-[var(--color-gray-800)] text-white
          text-[var(--text-caption)] font-[500] whitespace-nowrap
          opacity-0 scale-95
          group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100
          transition-[opacity,transform] duration-150 ease-out
          shadow-[var(--shadow-md)]
        `}
      >
        {text}
        <span
          className={`
            absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[var(--color-gray-800)] rotate-45
            ${side === 'top' ? 'top-full -mt-1' : 'bottom-full -mb-1'}
          `}
        />
      </span>
    </span>
  );
}
