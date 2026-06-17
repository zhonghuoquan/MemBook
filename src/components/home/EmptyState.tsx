import { Button } from '../common/Button';

interface EmptyStateProps {
  onCreateAlbum: () => void;
}

export function EmptyState({ onCreateAlbum }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full">
      {/* Dashed border placeholder */}
      <div className="w-32 h-40 mb-6 border-2 border-dashed border-[var(--color-gray-300)] rounded-[var(--radius-xl)]
                      flex items-center justify-center bg-white">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-10 h-10 text-[var(--color-gray-300)]">
          <rect x="4" y="4" width="32" height="32" rx="4" fill="currentColor" fillOpacity="0.04" />
          <circle cx="16" cy="15" r="4" />
          <path d="M6 32l8-8 6 5 8-8 8 11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Title */}
      <h2 className="text-[var(--text-h1)] font-[600] text-[var(--color-gray-800)] mb-2">
        还没有相册
      </h2>

      {/* Description */}
      <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-8 max-w-sm text-center leading-relaxed">
        将美好回忆整理成册，制作一本专属于你的相册书
      </p>

      {/* CTA Button */}
      <Button
        variant="primary"
        size="lg"
        onClick={onCreateAlbum}
        className="!h-11 !px-6 !rounded-[var(--radius-md)]"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="10" cy="10" r="7" />
          <line x1="10" y1="6" x2="10" y2="14" />
          <line x1="6" y1="10" x2="14" y2="10" />
        </svg>
        开始制作
      </Button>
    </div>
  );
}
