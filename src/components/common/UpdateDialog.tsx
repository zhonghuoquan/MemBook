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

/** 将 Release 说明按行拆分，供「本次更新内容」列表渲染 */
function splitNotes(body?: string): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 更新提示弹窗：新版本已后台下载完成，展示版本信息与本次更新内容，用户确认后安装并重启。
 * 安装由 installPrepared() 完成（内含 relaunch），仅保留 idle/installing/error 三态。
 * 层级使用 z-[var(--z-modal)]，确保不被编辑器/书封面等元素遮挡。
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

  const notes = splitNotes(update.body);

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-sm" onClick={phase === 'idle' ? handleRemindLater : undefined} />
      <div
        className="relative bg-[var(--color-card)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] w-full max-w-[560px] overflow-hidden border border-[var(--color-border)] animate-[modalFadeIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — 品牌渐变 + 版本徽章 */}
        <div className="relative px-7 pt-7 pb-6 bg-gradient-to-br from-[var(--color-primary-600)] via-[var(--color-primary-700)] to-[var(--color-primary-800)] text-white overflow-hidden">
          {/* 装饰圆环 */}
          <div className="absolute -right-10 -top-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-24 -bottom-16 w-32 h-32 rounded-full bg-white/5 blur-xl" />

          <div className="relative flex items-start gap-4">
            {/* 渐变图标徽章：下载就绪箭头 */}
            <div className="shrink-0 w-12 h-12 rounded-[var(--radius-xl)] bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 3v12" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-[600] tracking-tight text-white">{t('updater.title')}</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 border border-white/25 text-[11px] font-[600] text-white">
                  v{update.version}
                </span>
              </div>
              <p className="text-[12px] text-white/70 mt-1 leading-relaxed">
                {t('updater.updateComplete')}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-5 space-y-5">
          {/* 版本对比 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 p-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
                {t('updater.currentVersion')}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-[600] text-[var(--color-text-primary)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]">
                  <path d="M8 12h8M13 8l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-mono">v{update.currentVersion}</span>
              </div>
            </div>

            {/* 箭头 */}
            <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M5 12h14m0 0l-4-4m4 4l-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="flex-1 p-3 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary-600)]/10 to-[var(--color-primary-700)]/10 border border-[var(--color-primary-500)]/30">
              <div className="text-[11px] text-[var(--color-primary-600)] uppercase tracking-wider mb-1 font-[600]">
                {t('updater.versionLabel')}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-[600] text-[var(--color-primary-700)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M20 12v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 12h18M12 3v9m0 0l-3-3m3 3l3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-mono">v{update.version}</span>
              </div>
            </div>
          </div>

          {/* 版本元信息 */}
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
              </svg>
              {formatDate(update.date)}
            </span>
          </div>

          {/* 本次更新内容 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 text-[var(--color-primary-600)]">
                <path d="M9 11l3 3 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[13px] font-[600] text-[var(--color-text-primary)]">
                {t('updater.releaseNotes')}
              </span>
            </div>

            <div className="max-h-48 overflow-y-auto ps-scroll rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              {notes.length > 0 ? (
                <ul className="p-3 space-y-1.5">
                  {notes.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                      <span className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-primary-400)]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-[13px] text-[var(--color-text-tertiary)]">{t('updater.noNotes')}</p>
              )}
            </div>
          </div>

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
        <div className="px-7 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-panel)] flex items-center justify-end gap-2.5">
          {phase === 'idle' && (
            <>
              <button
                onClick={handleRemindLater}
                className="px-4 py-2 rounded-[var(--radius-2xl)] text-[var(--text-body-sm)] font-[500]
                           border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                           hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                {t('updater.remindLater')}
              </button>
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-5 py-2 rounded-[var(--radius-2xl)] text-[var(--text-body-sm)] font-[600]
                           bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                           text-white border-none shadow-sm
                           hover:opacity-90 hover:shadow-[0_4px_12px_var(--color-primary-200)] transition-all cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 3v10m0 0l-3-3m3 3l3-3" />
                  <path d="M5 21v-2h14v2" />
                </svg>
                {t('updater.installAndRestart')}
              </button>
            </>
          )}

          {phase === 'installing' && (
            <button
              disabled
              className="px-5 py-2 rounded-[var(--radius-2xl)] text-[var(--text-body-sm)] font-[600]
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
                className="px-4 py-2 rounded-[var(--radius-2xl)] text-[var(--text-body-sm)] font-[500]
                           border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                           hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                {t('common.close')}
              </button>
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-5 py-2 rounded-[var(--radius-2xl)] text-[var(--text-body-sm)] font-[600]
                           bg-gradient-to-r from-[var(--color-primary-600)] to-[var(--color-primary-700)]
                           text-white border-none shadow-sm
                           hover:opacity-90 hover:shadow-[0_4px_12px_var(--color-primary-200)] transition-all cursor-pointer"
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