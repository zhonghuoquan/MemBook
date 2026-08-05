import { useTranslation } from 'react-i18next';

interface ProgressDialogProps {
  open: boolean;
  title: string;
  current: number;
  total: number;
  label?: string;
  onCancel?: () => void;
}

export function ProgressDialog({ open, title, current, total, label, onCancel }: ProgressDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  const progress = total > 0 ? current / total : 0;
  const percent = Math.round(progress * 100);
  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-6 w-[400px] max-w-[90vw]">
        <h3 className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)] mb-4">{title}</h3>
        {/* 进度条 */}
        <div className="w-full h-2 bg-[var(--color-gray-200)] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-[image:var(--gradient-brand)] rounded-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        {/* 进度文本 */}
        <div className="flex items-center justify-between text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
          <span>{label || `${current} / ${total}`}</span>
          <span>{percent}%</span>
        </div>
        {/* 取消按钮 */}
        {onCancel && (
          <div className="flex justify-end mt-5">
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)] bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              onClick={onCancel}
            >
              {t('common.progressDialog.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
