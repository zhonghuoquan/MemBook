import { Button } from '../common/Button';
import { useTranslation } from 'react-i18next';

interface EmptyStateProps {
  onCreateAlbum: () => void;
}

export function EmptyState({ onCreateAlbum }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full">
      {/* Dashed border placeholder */}
      <div className="w-36 h-44 mb-6 border-2 border-dashed border-[var(--color-primary-300)] rounded-[var(--radius-2xl)]
                      flex items-center justify-center bg-[image:var(--gradient-brand-soft)] shadow-[var(--shadow-soft)]">
        <svg viewBox="0 0 40 40" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" className="w-12 h-12">
          <rect x="4" y="4" width="32" height="32" rx="4" fill="currentColor" fillOpacity="0.06" />
          <circle cx="16" cy="15" r="4" />
          <path d="M6 32l8-8 6 5 8-8 8 11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Title */}
      <h2 className="text-[var(--text-h1)] font-[700] text-[var(--color-gray-800)] mb-2">
        {t('home.emptyState.title')}
      </h2>

      {/* Description */}
      <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-8 max-w-sm text-center leading-relaxed">
        {t('home.emptyState.description')}
      </p>

      {/* CTA Button */}
      <Button
        variant="primary"
        size="lg"
        onClick={onCreateAlbum}
        data-onboarding="home-create-btn"
        className="!h-12 !px-7 !rounded-[var(--radius-lg)] !bg-[image:var(--gradient-brand)] !font-[600] hover:!shadow-[var(--shadow-md)] hover:!-translate-y-px transition-all"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="10" cy="10" r="7" />
          <line x1="10" y1="6" x2="10" y2="14" />
          <line x1="6" y1="10" x2="14" y2="10" />
        </svg>
        {t('home.emptyState.startCreating')}
      </Button>
    </div>
  );
}
