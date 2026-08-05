import type { PanelTab } from '../../types';
import { useUIStore } from '../../store';
import { useTranslation } from 'react-i18next';

type TabDef = {
  tab: PanelTab;
  labelKey: string;
  icon: React.ReactNode;
};

const tabs: TabDef[] = [
  {
    tab: 'photos',
    labelKey: 'editor.bottomTabs.photos',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <rect x="1.5" y="1.5" width="15" height="15" rx="2" />
        <circle cx="7" cy="7" r="1.5" />
        <path d="M1.5 13l4-4 3 3 4-4 4 5" />
      </svg>
    ),
  },
  {
    tab: 'templates',
    labelKey: 'editor.bottomTabs.templates',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <rect x="2" y="2" width="14" height="14" rx="2" />
        <rect x="4" y="4" width="10" height="10" rx="1" />
        <line x1="4" y1="8" x2="14" y2="8" />
        <line x1="9" y1="4" x2="9" y2="14" />
      </svg>
    ),
  },
  {
    tab: 'theme',
    labelKey: 'editor.bottomTabs.theme',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="9" cy="9" r="6.5" />
        <path d="M9 2.5a6.5 6.5 0 0 1 0 13" />
        <circle cx="9" cy="9" r="2.5" fill="currentColor" fillOpacity="0.2" />
      </svg>
    ),
  },
  {
    tab: 'tools',
    labelKey: 'editor.bottomTabs.tools',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
        <circle cx="9" cy="9" r="2.5" />
        <path d="M14 4l2-2M16.5 6v-3h-3" />
      </svg>
    ),
  },
  {
    tab: 'market',
    labelKey: 'editor.bottomTabs.market',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M2 5l7-3 7 3v8l-7 3-7-3V5z" />
        <path d="M2 5l7 3 7-3" />
        <path d="M9 8v8" />
      </svg>
    ),
  },
];

export function BottomTabs() {
  const { t } = useTranslation();
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  return (
    <div className="h-11 bg-white border-t border-[var(--color-border)] flex items-stretch shrink-0 px-2 z-[var(--z-flat)]">
      {tabs.map((item) => {
        const isActive = activePanel === item.tab;
        return (
          <button
            key={item.tab}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 mx-0.5 my-1
              border-none rounded-[var(--radius-md)]
              cursor-pointer select-none whitespace-nowrap
              text-[var(--text-body-sm)] font-[500]
              transition-all duration-150
              ${isActive
                ? 'bg-[var(--color-brand)] text-white shadow-sm'
                : 'bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)]'
              }
            `}
            onClick={() => setActivePanel(item.tab)}
          >
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
