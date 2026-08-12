/**
 * 版本阶梯对比面板（Free / Pro）
 *
 * 展示 Free 与 Pro 各版本能做什么、Pro 相比 Free 多解锁哪些能力，
 * 让用户清楚「为什么要付费、付费能多得到什么」，避免一刀切锁死带来的困惑。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TIER_FEATURES, type LicenseTier } from './tiers';

export function TierComparisonPanel({
  currentTier,
  /** 是否可折叠（默认 true，点击标题后再展开/收起） */
  collapsible = true,
  /** 初始是否展开 */
  defaultCollapsed = true,
}: {
  currentTier: LicenseTier;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = () => setCollapsed((c) => !c);

  return (
    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
      {collapsible && (
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-[var(--color-gray-50)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <span className="text-[12px] font-[600] text-[var(--color-gray-800)]">
            {t('license.tier.comparison', '版本对比')}
          </span>
          <span className="text-[11px] text-[var(--color-primary-600)] font-[500]">
            {collapsed ? t('license.tier.expand', '展开对比') : t('license.tier.collapse', '收起')}
          </span>
        </button>
      )}
      {!collapsed && (
      <>
      {/* 表头：Free / Pro */}
      <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-[var(--color-gray-50)] border-b border-[var(--color-border)]">
        <div className="px-3 py-2 text-[11px] font-[600] text-[var(--color-text-secondary)]">
          {t('license.tier.feature', '功能')}
        </div>
        <div className={`px-3 py-2 text-center text-[11px] font-[700] ${currentTier === 'free' ? 'text-[var(--color-gray-600)]' : 'text-[var(--color-gray-400)]'}`}>
          {t('license.tier.free', 'Free')}
          {currentTier === 'free' && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-[var(--color-gray-200)]">当前</span>}
        </div>
        <div className={`px-3 py-2 text-center text-[11px] font-[700] ${currentTier === 'pro' ? 'text-[var(--color-primary-600)]' : 'text-[var(--color-primary-500)]'}`}>
          {t('license.tier.pro', 'Pro')}
          {currentTier === 'pro' && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-[var(--color-primary-100)] text-[var(--color-primary-600)]">当前</span>}
        </div>
      </div>

      {/* 功能行 */}
      {TIER_FEATURES.map((f) => (
        <div
          key={f.key}
          className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-[var(--color-border)]/50 last:border-b-0 items-center"
        >
          <div className="px-3 py-2 text-[12px] font-[500] text-[var(--color-gray-800)]">{f.label}</div>
          <div className={`px-3 py-2 text-center text-[11px] ${f.proOnly ? 'text-[var(--color-gray-400)]' : 'text-[var(--color-gray-600)]'}`}>
            {f.proOnly ? (
              <span className="inline-flex items-center gap-1">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3 text-[var(--color-gray-400)]">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
                {f.freeLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[var(--color-gray-700)]">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-[var(--color-success)]">
                  <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {f.freeLabel}
              </span>
            )}
          </div>
          <div className="px-3 py-2 text-center text-[11px] text-[var(--color-primary-600)] font-[500]">
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-[var(--color-primary-500)]">
                <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {f.proLabel}
            </span>
          </div>
        </div>
      ))}

      {/* 底部提示 */}
      <div className="px-3 py-2.5 bg-[var(--color-gray-50)] text-center">
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          {currentTier === 'free'
            ? t('license.tier.upgradeHint', '激活 Pro 解锁全部能力')
            : t('license.tier.proActive', '您已解锁全部 Pro 能力')}
        </span>
      </div>
      </>
      )}
    </div>
  );
}
