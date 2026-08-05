import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  downloadAndInstall, relaunchApp,
  markChecked, type UpdateInfo, type UpdateProgress,
} from '../../utils/updater';
import { captureError } from '../../utils/sentry';
import { useUIStore } from '../../store';

interface UpdateDialogProps {
  /** 初始更新信息（由 App 启动时检查传入） */
  update: UpdateInfo | null;
  /** 关闭弹窗 */
  onClose: () => void;
}

type Phase = 'idle' | 'downloading' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

/**
 * 更新提示弹窗：展示新版本信息，支持下载安装进度与重启。
 */
export function UpdateDialog({ update, onClose }: UpdateDialogProps) {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setPhase('downloading');
    setError(null);
    try {
      await downloadAndInstall((p) => {
        setProgress(p);
        if (p.phase === 'installing') setPhase('done');
      });
      setPhase('done');
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(msg);
      setPhase('error');
      captureError(e as Error, { context: 'update_download' });
    }
  }, []);

  const handleInstallAndRestart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch (e) {
      addToast({ type: 'error', message: t('updater.updateFailed', { message: (e as Error).message }) });
    }
  }, [addToast, t]);

  const handleRemindLater = useCallback(() => {
    markChecked();
    onClose();
  }, [onClose]);

  if (!update) return null;

  const pct = progress?.total && (progress.total ?? 0) > 0
    ? Math.min(100, Math.round(((progress.downloaded ?? 0) / (progress.total as number)) * 100))
    : 0;

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

          {/* 下载进度条 */}
          {phase === 'downloading' && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
                <span>{t('updater.downloading')}</span>
                <span className="font-mono">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--color-surface-raised)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-600)] transition-all duration-200 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {(progress.total ?? 0) > 0 && (
                <div className="text-[11px] text-[var(--color-text-tertiary)] text-right font-mono">
                  {formatBytes(progress.downloaded ?? 0)} / {formatBytes(progress.total ?? 0)}
                </div>
              )}
            </div>
          )}

          {/* 安装完成提示 */}
          {phase === 'done' && (
            <div className="p-3 rounded-[var(--radius-lg)] bg-[var(--color-success-light)] border border-[var(--color-success)]/30">
              <p className="text-[13px] text-[var(--color-text-primary)] leading-relaxed">
                {t('updater.updateComplete')}
              </p>
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
                onClick={handleDownload}
                className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                           bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                           text-white border-none
                           hover:opacity-90 transition-opacity cursor-pointer
                           shadow-sm"
              >
                {t('updater.downloadNow')}
              </button>
            </>
          )}

          {phase === 'downloading' && (
            <button
              disabled
              className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                         bg-[var(--color-surface-raised)] text-[var(--color-text-tertiary)]
                         border border-[var(--color-border)] cursor-not-allowed"
            >
              {t('updater.downloading')}
            </button>
          )}

          {phase === 'done' && (
            <button
              onClick={handleInstallAndRestart}
              className="px-5 py-2 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600]
                         bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                         text-white border-none
                         hover:opacity-90 transition-opacity cursor-pointer
                         shadow-sm"
            >
              {t('updater.installAndRestart')}
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
                onClick={handleDownload}
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
