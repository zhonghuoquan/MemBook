import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  installPrepared, markChecked, type UpdateInfo,
} from '../../utils/updater';
import { captureError } from '../../utils/sentry';

interface UpdateDialogProps {
  /** 已下载完成、待安装的更新信息（由 App 后台自动下载后传入） */
  update: UpdateInfo | null;
  /** 关闭弹窗 */
  onClose: () => void;
}

type Phase = 'idle' | 'installing' | 'error';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

/**
 * 更新提示弹窗：新版本已后台下载完成，展示版本信息，用户确认后安装并重启。
 * 安装由 installPrepared() 完成（内含 relaunch），仅保留 idle/installing/error 三态。
 */
export function UpdateDialog({ update, onClose }: UpdateDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // 安装已后台下载好的新版并重启（installPrepared 内含 relaunch）
  const handleInstall = useCallback(async () => {
    setPhase('installing');
    setError(null);
    try {
      await installPrepared();
      setPhase('idle');
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(msg);
      setPhase('error');
      captureError(e as Error, { context: 'update_install' });
    }
  }, []);

  const handleRemindLater = useCallback(() => {
    markChecked();
    onClose();
  }, [onClose]);

  if (!update) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-sm" onClick={phase === 'idle' ? handleRemindLater : undefined} />
      <div
        className="relative bg-[var(--color-card)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] w-[90vw] max-w-[480px] overflow-hidden border border-[var(--color-border)] animate-[modalFadeIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — 品牌渐变 + 磨砂玻璃质感 */}
        <div className="relative px-6 pt-7 pb-5 bg-gradient-to-br from-[var(--color-primary-600)] to-[var(--color-primary-800)] text-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[var(--radius-xl)] bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" className="w-6 h-6">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-[600] tracking-tight">{t('updater.title')}</h2>
              <p className="text-[12px] text-white/80 mt-0.5">
                {t('updater.versionLabel')} v{update.version}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* 版本信息 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
                {t('updater.currentVersion')}
              </div>
              <div className="text-sm font-[600] text-[var(--color-text-primary)] font-mono">
                v{update.currentVersion}
              </div>
            </div>
            <div className="p-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
                {t('updater.releaseDate')}
              </div>
              <div className="text-sm font-[600] text-[var(--color-text-primary)]">
                {formatDate(update.date)}
              </div>
            </div>
          </div>

          {/* 更新内容 */}
          {update.body && (
            <div>
              <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                {t('updater.releaseNotes')}
              </div>
              <div className="max-h-40 overflow-y-auto p-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
                <pre className="text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                  {update.body}
                </pre>
              </div>
            </div>
          )}

          {/* 正在安装 */}
          {phase === 'installing' && (
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-[var(--color-primary-600)] animate-spin">
                <path d="M21 12a9 9 0 11-6.2-8.5" strokeLinecap="round" />
              </svg>
              <span className="text-[13px] text-[var(--color-text-secondary)]">
                {t('updater.installing')}
              </span>
            </div>
          )}

          {/* 错误提示 */}
          {phase === 'error' && error && (
            <div className="p-3 rounded-[var(--radius-lg)] bg-[var(--color-error-light)] border border-[var(--color-error)]/30">
              <p className="text-[13px] text-[var(--color-error)] leading-relaxed">
                {t('updater.updateFailed', { message: error })}
              </p>
            </div>
          )}
        </div>

        {/* Footer — 按状态切换按钮 */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-panel)] flex items-center justify-end gap-2">
          {phase === 'idle' && (
            <>
              <button
                onClick={handleRemindLater}
                className="px-4 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                           border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                           hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                {t('updater.remindLater')}
              </button>
              <button
                onClick={handleInstall}
                className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                           bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                           text-white border-none
                           hover:opacity-90 transition-opacity cursor-pointer
                           shadow-sm"
              >
                {t('updater.installAndRestart')}
              </button>
            </>
          )}

          {phase === 'installing' && (
            <button
              disabled
              className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                         bg-[var(--color-surface-raised)] text-[var(--color-text-tertiary)]
                         border border-[var(--color-border)] cursor-not-allowed"
            >
              {t('updater.installing')}
            </button>
          )}

          {phase === 'error' && (
            <>
              <button
                onClick={handleRemindLater}
                className="px-4 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                           border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                           hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                {t('common.close')}
              </button>
              <button
                onClick={handleInstall}
                className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                           bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                           text-white border-none
                           hover:opacity-90 transition-opacity cursor-pointer
                           shadow-sm"
              >
                {t('common.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
