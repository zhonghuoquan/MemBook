import type { PanelTab } from '../../types';
import { useUIStore } from '../../store';
import { PhotoPanel } from './PhotoPanel';
import { TemplatePanel } from './TemplatePanel';
import { ToolsPanel } from './ToolsPanel';

type TabItem = {
  tab: PanelTab;
  label: string;
  icon: React.ReactNode;
};

const tabs: TabItem[] = [
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
    label: '模版',
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

const panelContent: Record<PanelTab, React.ReactNode> = {
  photos: <PhotoPanel />,
  templates: <TemplatePanel />,
  theme: <ToolsPanel />,    // 主题归入工具面板
  tools: <ToolsPanel />,
  market: <ToolsPanel />,
};

export function LeftPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  return (
    <div className="flex shrink-0" style={{ width: 'var(--layout-panel-width)' }}>
      {/* Vertical Tab Bar */}
      <nav className="w-[var(--layout-nav-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)] flex flex-col items-center py-3 gap-1 shrink-0">
        {tabs.map((item) => {
          const isActive = activePanel === item.tab;
          return (
            <button
              key={item.tab}
              className={`
                flex flex-col items-center justify-center
                w-11 py-2.5 px-1
                border-none rounded-[var(--radius-md)]
                cursor-pointer select-none
                text-[var(--text-nano)] font-[500]
                transition-all duration-150
                ${isActive
                  ? 'bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)]'
                }
              `}
              onClick={() => setActivePanel(item.tab)}
            >
              {item.icon}
              <span className="mt-1 leading-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Panel Content */}
      <div className="flex-1 bg-[var(--color-surface)] border-r border-[var(--color-border)] overflow-y-auto">
        {panelContent[activePanel]}
      </div>
    </div>
  );
}
