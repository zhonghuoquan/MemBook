/**
 * LanguageSwitcher — 语言切换组件
 *
 * 下拉式语言选择器，支持简体中文和英文。
 * 选择后立即切换并持久化到 localStorage。
 *
 * 注意：必须使用 useTranslation() 订阅 i18n 状态变化，
 * 否则切换语言后组件不会重渲染，"当前选中"高亮态不更新。
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, changeLanguage } from '../../i18n';

interface LanguageSwitcherProps {
  /** 紧凑模式：只显示国旗图标 */
  compact?: boolean;
  className?: string;
}

export function LanguageSwitcher({ compact = false, className = '' }: LanguageSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 订阅 i18n 语言变化：切换语言时组件会自动重渲染，确保高亮态同步
  const { i18n } = useTranslation();
  const current = i18n.language;

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === current) ?? SUPPORTED_LANGUAGES[0];

  const handleSelect = (code: string) => {
    changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-tauri-drag-region="false"
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-[600]
                   text-[var(--color-gray-600)] bg-white/40 hover:bg-white/80
                   border border-transparent hover:border-[var(--color-border)]
                   transition-all duration-150 cursor-pointer backdrop-blur-sm"
        title={currentLang.label}
      >
        <span className="text-base leading-none">{currentLang.flag}</span>
        {!compact && <span>{currentLang.label}</span>}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] bg-white rounded-lg shadow-lg border border-[var(--color-border)] overflow-hidden z-50">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => handleSelect(lang.code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-[500] transition-colors cursor-pointer border-none
                ${lang.code === current
                  ? 'bg-[var(--color-brand-bg)] text-[var(--color-brand)]'
                  : 'bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                }`}
            >
              <span className="text-base leading-none">{lang.flag}</span>
              <span className="flex-1 text-left">{lang.label}</span>
              {lang.code === current && (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
