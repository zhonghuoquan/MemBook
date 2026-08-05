import { useTranslation } from 'react-i18next';

/** 按钮级 spinner */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** 全页/区域 skeleton */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--color-gray-200)] rounded-[var(--radius-md)] ${className}`} />;
}

/** 居中加载指示器 */
export function CenterLoading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-3">
      <Spinner size={32} />
      <span className="text-[var(--text-caption)] text-[var(--color-text-tertiary)]">{label ?? t('common.loading')}</span>
    </div>
  );
}

/** 全屏遮罩加载 */
export function OverlayLoading({ label, progress }: { label?: string; progress?: number }) {
  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-8 flex flex-col items-center gap-4 min-w-[200px]">
        <Spinner size={40} />
        {label && <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)] font-[500]">{label}</span>}
        {typeof progress === 'number' && (
          <div className="w-full h-1.5 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--color-brand)] rounded-full transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
