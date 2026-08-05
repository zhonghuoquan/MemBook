/**
 * MemBook — 激活码弹窗
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from './licenseStore';
import { useEditorStore, useUIStore } from '../store';
import { getMachineId } from './licenseService';
import { DEFAULT_WATERMARK_SETTINGS } from '../types';

interface ActivationDialogProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题下方的提示语 */
  hint?: string;
}

export function ActivationDialog({ open, onClose, hint }: ActivationDialogProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isActivated, hasLicense, activate, clear } = useLicenseStore();
  const addToast = useUIStore((s) => s.addToast);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await activate(code.trim(), signature.trim());
    setLoading(false);
    if (result.success) {
      addToast({ type: 'success', message: t('license.activation.activationSuccess') });
      // 首次激活后默认开启时间水印
      const setWatermarkSettings = (useEditorStore.getState() as any).setWatermarkSettings;
      if (setWatermarkSettings) {
        setWatermarkSettings({ ...DEFAULT_WATERMARK_SETTINGS, enabled: true });
      }
      onClose();
    } else {
      setError(result.error || t('license.activation.activationFailed'));
    }
  };

  const handleClear = () => {
    clear();
    setCode('');
    setSignature('');
    setError(null);
  };

  const machineId = getMachineId();
  const showTrialHint = !hasLicense && isActivated;

  const handleCopyMachineId = async () => {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
    } catch {
      // 回退方案：兼容非 HTTPS 或 Tauri WebView
      const ta = document.createElement('textarea');
      ta.value = machineId;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--color-surface-overlay)] backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-card)] rounded-2xl shadow-2xl max-w-lg w-full border border-[var(--color-border)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-[var(--color-primary-600)] to-[var(--color-primary-800)] text-white">
          <button
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 transition-colors border-none cursor-pointer"
            onClick={onClose}
            aria-label={t('license.activation.close')}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="text-xl font-[600] tracking-tight">{t('license.activation.activateTitle')}</h2>
          <p className="text-[13px] text-white/90 mt-1.5 leading-relaxed">
            {hint || t('license.activation.activateHint')}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 bg-[var(--color-surface)]">
          {hasLicense ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[var(--color-success-light)] border border-[var(--color-success-border)] text-[var(--color-success-dark)]">
                <div className="flex items-center gap-2 font-[600] mb-1">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                    <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('license.activation.activated')}
                </div>
                <p className="text-[12px] opacity-90">{t('license.activation.activatedDesc')}</p>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                <span>{t('license.activation.machineIdLabel', { machineId })}</span>
                <button
                  type="button"
                  onClick={handleCopyMachineId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-[500]
                             border border-[var(--color-border)] bg-white text-[var(--color-gray-600)]
                             hover:bg-[var(--color-primary-50)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]
                             active:scale-[0.97] transition-all cursor-pointer shrink-0"
                  title={t('license.activation.copyMachineId')}
                >
                  {copied ? (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 text-[var(--color-success)]">
                        <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('license.activation.copied')}
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M3 11V3h8" strokeLinecap="round" />
                      </svg>
                      {t('license.activation.copy')}
                    </>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="w-full py-2.5 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                           border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                           hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                {t('license.activation.clearActivation')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {showTrialHint && (
                <div className="p-3.5 rounded-xl bg-[var(--color-warning-light)] border border-[var(--color-warning-border)] text-[var(--color-warning-dark)]">
                  <div className="flex items-start gap-2">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4.5 h-4.5 mt-0.5 shrink-0">
                      <circle cx="10" cy="10" r="7" />
                      <path d="M10 6v4l3 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-[12px] leading-relaxed">{t('license.activation.trialHint')}</p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-text-primary)] mb-1.5">
                  {t('license.activation.activationCode')}
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="MBK-XXXX-XXXX-XXXX-XXXX"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)]
                             bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]
                             focus:outline-none focus:border-[var(--color-primary-400)] focus:ring-2 focus:ring-[var(--color-primary-100)]
                             placeholder:text-[var(--color-text-tertiary)]"
                />
              </div>
              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-text-primary)] mb-1.5">
                  {t('license.activation.signature')}
                </label>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder={t('license.activation.signaturePlaceholder')}
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)]
                             bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] text-[12px] font-mono
                             focus:outline-none focus:border-[var(--color-primary-400)] focus:ring-2 focus:ring-[var(--color-primary-100)]
                             placeholder:text-[var(--color-text-tertiary)] resize-none"
                />
              </div>
              {error && (
                <div className="p-3 rounded-lg bg-[var(--color-error-light)] border border-[var(--color-error-border)] text-[var(--color-error-dark)] text-[12px]">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                <span className="truncate">{t('license.activation.machineIdLabel', { machineId })}</span>
                <button
                  type="button"
                  onClick={handleCopyMachineId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-[500]
                             border border-[var(--color-border)] bg-white text-[var(--color-gray-600)]
                             hover:bg-[var(--color-primary-50)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]
                             active:scale-[0.97] transition-all cursor-pointer shrink-0"
                  title={t('license.activation.copyMachineId')}
                >
                  {copied ? (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 text-[var(--color-success)]">
                        <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('license.activation.copied')}
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M3 11V3h8" strokeLinecap="round" />
                      </svg>
                      {t('license.activation.copy')}
                    </>
                  )}
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                             border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                             hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                >
                  {t('license.activation.later')}
                </button>
                <button
                  type="submit"
                  disabled={loading || !code.trim() || !signature.trim()}
                  className="flex-1 py-2.5 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                             bg-[var(--color-primary-600)] text-white
                             hover:bg-[var(--color-primary-700)] disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors cursor-pointer"
                >
                  {loading ? t('license.activation.activating') : t('license.activation.activateNow')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
