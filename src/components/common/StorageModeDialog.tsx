import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { useUIStore } from '../../store';
import { isTauri } from '../../utils/tauri';
import type { StorageMode } from '../../types';

interface StorageModeOptionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tags: string[];
  selected?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}

function StorageModeOption({
  icon,
  title,
  description,
  tags,
  selected,
  disabled,
  disabledHint,
  onClick,
}: StorageModeOptionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded-[var(--radius-xl)] border-2 p-4 transition-all duration-200 ${
        disabled
          ? 'border-[var(--color-gray-200)] bg-[var(--color-gray-100)]/50 opacity-60 cursor-not-allowed'
          : selected
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)]'
            : 'border-[var(--color-gray-200)] bg-[var(--color-card)] hover:border-[var(--color-primary-300)] hover:bg-[var(--color-primary-50)]/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
          disabled ? 'bg-[var(--color-gray-200)]' : 'bg-[var(--color-primary-100)]'
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-[600] text-[var(--color-text-primary)]">{title}</span>
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)] font-[500]"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">{description}</p>
          {disabledHint && (
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1.5">{disabledHint}</p>
          )}
        </div>
      </div>
    </button>
  );
}

export function StorageModeDialog() {
  const { t } = useTranslation();
  const storageMode = useUIStore((s) => s.storageMode);
  const isStorageModePromptOpen = useUIStore((s) => s.isStorageModePromptOpen);
  const pendingImportFiles = useUIStore((s) => s.pendingImportFiles);
  const pendingImportPaths = useUIStore((s) => s.pendingImportPaths);
  const resolveStorageModePrompt = useUIStore((s) => s.resolveStorageModePrompt);
  const cancelStorageModePrompt = useUIStore((s) => s.cancelStorageModePrompt);

  const handleSelect = useCallback((mode: StorageMode) => {
    resolveStorageModePrompt(mode);
  }, [resolveStorageModePrompt]);

  // Tauri 路径模式下 pendingImportFiles 为空数组，实际数量在 pendingImportPaths
  const count = pendingImportPaths?.length ?? pendingImportFiles?.length ?? 0;
  const tauri = isTauri();

  return (
    <Modal
      open={isStorageModePromptOpen}
      onClose={cancelStorageModePrompt}
      title={t('storageMode.title')}
      maxWidth="480px"
      footer={(
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={cancelStorageModePrompt}
            className="text-[13px] px-4 py-2 rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-gray-100)] transition-colors cursor-pointer"
          >
            {t('storageMode.cancelImport')}
          </button>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            {t('storageMode.choiceHint')}
          </p>
        </div>
      )}
    >
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
        {t('storageMode.detected', { count })}
      </p>
      <div className="space-y-3">
        <StorageModeOption
          icon="📥"
          title={t('storageMode.importMode.title')}
          description={t('storageMode.importMode.description')}
          tags={[t('storageMode.importMode.tagRecommended'), t('storageMode.importMode.tagStable')]}
          selected={storageMode === 'import'}
          onClick={() => handleSelect('import')}
        />
        <StorageModeOption
          icon="📂"
          title={t('storageMode.directMode.title')}
          description={t('storageMode.directMode.description')}
          tags={[t('storageMode.directMode.tagSpaceSaving')]}
          selected={storageMode === 'direct'}
          disabled={!tauri}
          disabledHint={!tauri ? t('storageMode.directMode.disabledHint') : undefined}
          onClick={() => handleSelect('direct')}
        />
      </div>
      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-4 leading-relaxed">
        {t('storageMode.tip')}
      </p>
    </Modal>
  );
}
