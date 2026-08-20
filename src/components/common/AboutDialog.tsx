import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, BUILD_DATE } from '../../version';
import { Logo } from './Logo';
import { useLicenseStore } from '../../license';
import { useUIStore } from '../../store';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

const FEATURE_KEYS: { icon: string; titleKey: string; descKey: string }[] = [
  { icon: '📖', titleKey: 'about.featuresList.spineCover.title', descKey: 'about.featuresList.spineCover.desc' },
  { icon: '🎠', titleKey: 'about.featuresList.flipPreview.title', descKey: 'about.featuresList.flipPreview.desc' },
  { icon: '✨', titleKey: 'about.featuresList.smartLayout.title', descKey: 'about.featuresList.smartLayout.desc' },
  { icon: '🖼️', titleKey: 'about.featuresList.coverTemplates.title', descKey: 'about.featuresList.coverTemplates.desc' },
  { icon: '🧲', titleKey: 'about.featuresList.rulerAlign.title', descKey: 'about.featuresList.rulerAlign.desc' },
  { icon: '🖌️', titleKey: 'about.featuresList.creativeTools.title', descKey: 'about.featuresList.creativeTools.desc' },
  { icon: '🛠️', titleKey: 'about.featuresList.organizeTools.title', descKey: 'about.featuresList.organizeTools.desc' },
  { icon: '💾', titleKey: 'about.featuresList.localFirst.title', descKey: 'about.featuresList.localFirst.desc' },
];

const TECH_STACK = [
  'React 19',
  'TypeScript 5',
  'Vite 6',
  'Tauri 2',
  'Zustand',
  'Konva',
  'Dexie / IndexedDB',
  'Tailwind CSS v4',
  'PWA',
  'exifr',
  'heic2any',
  'jsPDF',
  'JSZip',
];

const MACARON_COLORS: { bg: string; text: string; border: string }[] = [
  { bg: '#FFD1DC', text: '#8B4A5E', border: '#FFB7C5' }, // 樱花粉
  { bg: '#C7CEEA', text: '#4A5580', border: '#A8B3E0' }, // 薰衣草紫
  { bg: '#B5EAD7', text: '#2D6B56', border: '#8FDCC1' }, // 薄荷绿
  { bg: '#FFDAC1', text: '#8B5A3C', border: '#FFC4A0' }, // 蜜桃橘
  { bg: '#E2F0CB', text: '#5A7040', border: '#CCE5A3' }, // 开心果绿
  { bg: '#F8B195', text: '#7A3E2E', border: '#F4967A' }, // 珊瑚橘
  { bg: '#D4C5E2', text: '#5A4A6E', border: '#BBA8D4' }, // 香芋紫
  { bg: '#A8E6CF', text: '#226B52', border: '#7FD9B8' }, // 青柠绿
  { bg: '#FFE2B8', text: '#8A622E', border: '#FFD295' }, // 柠檬黄
  { bg: '#F7B2AD', text: '#7A3A36', border: '#F2938C' }, // 玫瑰粉
  { bg: '#B8E0F0', text: '#2D5A70', border: '#92CEE6' }, //  baby 蓝
  { bg: '#F0D9FF', text: '#6B3D85', border: '#E2B8FF' }, // 薰衣草粉
  { bg: '#C5E3EC', text: '#365B6A', border: '#A3D1E0' }, // 雾蓝
];

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const { t } = useTranslation();
  const isActivated = useLicenseStore((s) => s.isActivated);
  const hasLicense = useLicenseStore((s) => s.hasLicense);
  const trial = useLicenseStore((s) => s.trial);
  const openActivationDialog = useLicenseStore((s) => s.openDialog);
  const clearActivation = useLicenseStore((s) => s.clear);
  const addToast = useUIStore((s) => s.addToast);
  const [teleStatus, setTeleStatus] = useState<'checking' | 'ok' | 'unavailable'>('checking');
  const [confirmClear, setConfirmClear] = useState(false);

  const features = useMemo(
    () => FEATURE_KEYS.map((f) => ({ icon: f.icon, title: t(f.titleKey), desc: t(f.descKey) })),
    [t],
  );

  useEffect(() => {
    if (!open) return;
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setTeleStatus(isTauri ? 'ok' : 'unavailable');
  }, [open]);

  if (!open) return null;

  return (
    <>
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-surface-overlay)] backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-card)] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-8 pb-7 bg-gradient-to-br from-[var(--color-primary-600)] to-[var(--color-primary-800)] text-white">
          <button
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 transition-colors border-none cursor-pointer"
            onClick={onClose}
            aria-label={t('about.close')}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-lg p-2.5">
              <Logo className="w-full h-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  className="text-2xl font-[600] text-white tracking-tight"
                  style={{ fontFamily: "'Quicksand', sans-serif" }}
                >
                  MemBook
                </h2>
                {hasLicense ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    title={t('about.clearActivation')}
                    className="px-2 py-0.5 rounded-full bg-[var(--color-success)]/20 text-[var(--color-success-light)] border border-[var(--color-success)]/40 text-[11px] font-[600] cursor-pointer hover:bg-[var(--color-success)]/40 transition-colors border-none"
                  >
                    {t('about.activated')}
                  </button>
                ) : isActivated ? (
                  <button
                    type="button"
                    onClick={() => openActivationDialog()}
                    title={t('about.clickToActivate')}
                    className="px-2 py-0.5 rounded-full bg-[var(--color-warning)]/20 text-[var(--color-warning-dark)] border border-[var(--color-warning)]/40 text-[11px] font-[600] cursor-pointer hover:bg-[var(--color-warning)]/40 transition-colors border-none"
                  >
                    {t('about.notActivatedTrial', { days: trial.remainingDays })}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openActivationDialog()}
                    title={t('about.clickToActivate')}
                    className="px-2 py-0.5 rounded-full bg-[var(--color-error)]/20 text-[var(--color-error)] border border-[var(--color-error)]/40 text-[11px] font-[600] cursor-pointer hover:bg-[var(--color-error)]/40 transition-colors border-none"
                  >
                    {t('about.notActivatedExpired')}
                  </button>
                )}
              </div>
              <p className="text-[13px] text-white/90 mt-1.5 leading-relaxed max-w-sm">
                {t('about.tagline')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-5 text-[11px]">
            <span className="px-2.5 py-1 rounded-full bg-white/15 text-white font-mono backdrop-blur-sm border border-white/15">
              v{APP_VERSION}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/15 text-white backdrop-blur-sm border border-white/15">
              {t('about.builtOn', { date: BUILD_DATE })}
            </span>
            <span
              className={`px-2.5 py-1 rounded-full font-mono backdrop-blur-sm border ${
                teleStatus === 'ok'
                  ? 'bg-[var(--color-success)]/20 text-[var(--color-success-light)] border-[var(--color-success)]/30'
                  : teleStatus === 'unavailable'
                  ? 'bg-[var(--color-warning)]/20 text-[var(--color-warning-light)] border-[var(--color-warning)]/30'
                  : 'bg-white/15 text-white/80 border-white/15'
              }`}
            >
              {teleStatus === 'checking'
                ? t('about.checking')
                : teleStatus === 'ok'
                ? t('about.desktop')
                : t('about.browser')}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-[var(--color-surface)]">
          <section className="p-4 rounded-xl bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
            <div className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] leading-relaxed space-y-2.5">
              <p className="text-[var(--color-text-primary)] font-[500]">
                {t('about.intro')}
              </p>
              <p>
                {t('about.description1')}
              </p>
              <p>
                {t('about.description2')}
              </p>
              {teleStatus === 'unavailable' && (
                <p className="text-[12px] text-[var(--color-warning-dark)] bg-[var(--color-warning-light)] rounded-lg p-2.5 mt-2 border border-[var(--color-warning-border)]">
                  {t('about.browserWarning')}
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-[var(--text-body-sm)] font-[600] text-[var(--color-text-primary)] mb-3 uppercase tracking-wider">
              {t('about.features')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="flex gap-3 p-3.5 rounded-xl bg-[var(--color-surface-raised)] border border-[var(--color-border)] hover:border-[var(--color-brand)]/40 hover:shadow-sm transition-all"
                >
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--color-primary-50)] text-[var(--color-brand)] flex items-center justify-center text-xl">
                    {f.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[var(--text-body-sm)] font-[600] text-[var(--color-text-primary)]">
                      {f.title}
                    </div>
                    <div className="text-[12px] text-[var(--color-text-secondary)] mt-1 leading-relaxed line-clamp-2">
                      {f.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[var(--text-body-sm)] font-[600] text-[var(--color-text-primary)] mb-3 uppercase tracking-wider">
              {t('about.techStack')}
            </h3>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {TECH_STACK.map((tech, i) => {
                const color = MACARON_COLORS[i % MACARON_COLORS.length];
                return (
                  <span
                    key={tech}
                    className="px-2.5 py-1 rounded-md font-[500] transition-transform hover:-translate-y-0.5 hover:shadow-sm"
                    style={{
                      backgroundColor: color.bg,
                      color: color.text,
                      border: `1px solid ${color.border}`,
                    }}
                  >
                    {tech}
                  </span>
                );
              })}
            </div>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-panel)]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[var(--color-text-secondary)]">
            <div>
              {t('about.copyright')}
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
              <span className="text-[var(--color-text-tertiary)]">{t('about.author')}</span>
              <span className="text-[var(--color-text-primary)] font-[500]">{t('about.authorName')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    {confirmClear && (
      <div
        className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={() => setConfirmClear(false)}
      >
        <div
          className="bg-[var(--color-card)] rounded-2xl shadow-2xl max-w-sm w-full border border-[var(--color-border)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 pt-6 pb-5 bg-[var(--color-error)] text-white">
            <h2 className="text-lg font-[600] tracking-tight">{t('about.clearActivationTitle')}</h2>
            <p className="text-[13px] text-white/90 mt-1.5 leading-relaxed">
              {t('about.clearActivationDesc')}
            </p>
          </div>
          <div className="px-6 py-5 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="flex-1 py-2.5 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                         border border-[var(--color-border)] bg-white text-[var(--color-gray-700)]
                         hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              {t('about.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                clearActivation();
                setConfirmClear(false);
                addToast({ type: 'success', message: t('about.clearActivationToast') });
              }}
              className="flex-1 py-2.5 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500]
                         bg-[var(--color-error)] text-white
                         hover:opacity-90 transition-colors cursor-pointer"
            >
              {t('about.confirmClear')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
