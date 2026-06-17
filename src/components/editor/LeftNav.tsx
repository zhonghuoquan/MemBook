import type { PanelTab } from '../../types';
import { useUIStore } from '../../store';

type NavItemDef = {
  tab: PanelTab;
  label: string;
  icon: React.ReactNode;
};

const items: NavItemDef[] = [
  {
    tab: 'photos',
    label: '照片',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="2" y="2" width="16" height="16" rx="2" />
        <circle cx="7.5" cy="7.5" r="1.5" />
        <path d="M2 14l4-4 3 3 3-3 6 5" />
      </svg>
    ),
  },
  {
    tab: 'templates',
    label: '模板',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <rect x="5" y="5" width="10" height="10" rx="1" />
        <line x1="5" y1="9" x2="15" y2="9" />
        <line x1="10" y1="5" x2="10" y2="15" />
      </svg>
    ),
  },
  {
    tab: 'tools',
    label: '工具',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <circle cx="10" cy="10" r="3" />
        <path d="M15 5l3-3M18 7v-4h-4" />
      </svg>
    ),
  },
];

export function LeftNav() {
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  return (
    <nav className="w-[var(--layout-nav-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                    flex flex-col items-center py-2 gap-1 shrink-0">
      {items.map((item) => (
        <button
          key={item.tab}
          className={`
            flex flex-col items-center justify-center
            w-12 py-2 px-1
            border-none rounded-[var(--radius-md)]
            cursor-pointer select-none
            text-[var(--text-nano)] font-[500]
            transition-[background-color,color] duration-150 ease-in-out
            ${activePanel === item.tab
              ? 'bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
              : 'bg-transparent text-[var(--color-gray-600)]'
            }
            hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)]
          `}
          onClick={() => setActivePanel(item.tab)}
        >
          {item.icon}
          <span className="mt-1">{item.label}</span>
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings at bottom */}
      <button className="flex flex-col items-center justify-center w-12 py-2 px-1 border-none rounded-[var(--radius-md)]
                         cursor-pointer bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)]"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <circle cx="10" cy="10" r="2.5" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
        </svg>
        <span className="mt-1 text-[var(--text-nano)]">设置</span>
      </button>
    </nav>
  );
}
