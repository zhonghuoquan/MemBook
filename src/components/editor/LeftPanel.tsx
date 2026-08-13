import React, { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelTab } from '../../types';
import type { UsePhotoImportResult } from '../../hooks/usePhotoImport';
import { useUIStore } from '../../store';
import { PhotoPanel } from './PhotoPanel';
import { TemplatePanel } from './TemplatePanel';
import { ToolsPanel } from './ToolsPanel';
import { StickerPanel } from './StickerPanel';
import { CoverLibraryPanel } from './CoverLibraryPanel';
import { useTheme } from '../../contexts/ThemeContext';

type TabItem = {
  tab: PanelTab;
  labelKey: string;
  icon: React.ReactNode;
};

const tabs: TabItem[] = [
  {
    tab: 'photos',
    labelKey: 'editor.toolbar.photos',
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
    labelKey: 'editor.toolbar.templates',
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
    tab: 'covers',
    labelKey: 'editor.toolbar.covers',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M4 3.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5z" />
        <line x1="6" y1="3.5" x2="6" y2="16.5" />
        <rect x="8" y="7" width="5" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    tab: 'stickers',
    labelKey: 'editor.toolbar.stickers',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M14.5 2.5l3 3a1.5 1.5 0 0 1 0 2.1l-9.9 9.9a1.5 1.5 0 0 1-1 .4H4a1.5 1.5 0 0 1-1.5-1.5v-2.6a1.5 1.5 0 0 1 .4-1l9.9-9.9a1.5 1.5 0 0 1 2.1 0z" />
        <path d="M12 5l3 3" />
        <circle cx="15" cy="14" r="3" />
      </svg>
    ),
  },
  {
    tab: 'tools',
    labelKey: 'editor.toolbar.tools',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <circle cx="10" cy="10" r="3" />
        <path d="M15 5l3-3M18 7v-4h-4" />
      </svg>
    ),
  },
];

function getPanelContent(activePanel: PanelTab, photoImport: UsePhotoImportResult, onNavigateToSmartLayout: () => void): React.ReactNode {
  switch (activePanel) {
    case 'photos': return <PhotoPanel photoImport={photoImport} onNavigateToSmartLayout={onNavigateToSmartLayout} />;
    case 'templates': return <TemplatePanel />;
    case 'stickers': return <StickerPanel />;
    case 'tools': return <ToolsPanel />;
    case 'covers': return <CoverLibraryPanel />;
    case 'theme': return <ToolsPanel />;
    case 'market': return <ToolsPanel />;
    default: return null;
  }
}

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 640;

interface LeftPanelProps {
  photoImport: UsePhotoImportResult;
  onNavigateToSmartLayout: () => void;
}

export function LeftPanel({ photoImport, onNavigateToSmartLayout }: LeftPanelProps) {
  const { t } = useTranslation();
  const activePanel = useUIStore((s) => s.activePanel);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const setDraggingLayout = useUIStore((s) => s.setDraggingLayout);
  const panelWidth = useUIStore((s) => s.panelWidth);
  const setPanelWidth = useUIStore((s) => s.setPanelWidth);
  const { resolved, toggle: toggleTheme } = useTheme();
  const isDark = resolved === 'dark';
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpRef = useRef<(() => void) | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    // 鼠标移入弹窗时停止面板拖拽
    if ((e.target as HTMLElement)?.closest?.('.fixed.inset-0')) {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      return;
    }
    const delta = e.clientX - startX.current;
    const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startW.current + delta));
    setPanelWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', mouseMoveRef.current!);
    window.removeEventListener('mouseup', mouseUpRef.current!);
    setDraggingLayout(false);
  }, [setDraggingLayout]);

  // Store refs so we can remove them from within handleMouseUp
  mouseMoveRef.current = handleMouseMove;
  mouseUpRef.current = handleMouseUp;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startX.current = e.clientX;
    startW.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setDraggingLayout(true);
    window.addEventListener('mousemove', mouseMoveRef.current!);
    window.addEventListener('mouseup', mouseUpRef.current!);
  }, [panelWidth, setDraggingLayout]);

  // No useEffect needed — events are added in handleMouseDown, removed in handleMouseUp

  return (
    <div ref={panelRef} data-left-panel className="flex shrink-0 relative" style={{ width: panelWidth }}>
      {/* Vertical Tab Bar */}
      <nav className="w-[var(--layout-nav-width)] bg-[var(--color-gray-50)] border-r border-[var(--color-border-light)] flex flex-col items-center py-3 gap-1.5 shrink-0">
        {tabs.map((item) => {
          const isActive = activePanel === item.tab;
          return (
            <button
              key={item.tab}
              className={`
                flex flex-col items-center justify-center gap-0.5
                w-[48px] h-[48px] rounded-[var(--radius-lg)]
                border-none cursor-pointer select-none
                transition-all duration-150
                ${isActive
                  ? 'bg-white text-[var(--color-primary-600)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--color-primary-200)]'
                  : 'bg-transparent text-[var(--color-gray-400)] hover:bg-white/60 hover:text-[var(--color-gray-600)]'
                }
              `}
              onClick={() => setActivePanel(item.tab)}
            >
              {React.isValidElement(item.icon) && React.cloneElement(item.icon as React.ReactElement<{ className?: string }>, {
                className: (item.icon as React.ReactElement<{ className?: string }>).props.className?.replace('w-5 h-5', 'w-[18px] h-[18px]'),
              })}
              <span className={`text-[10px] font-[500] leading-none ${isActive ? 'text-[var(--color-primary-600)]' : 'text-[var(--color-gray-400)]'}`}>{t(item.labelKey)}</span>
            </button>
          );
        })}

        {/* 推到底部 */}
        <div className="flex-1" />

        {/* 亮/暗主题切换 */}
        <button
          onClick={toggleTheme}
          title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
          className="flex flex-col items-center justify-center w-12 py-2 px-1
                     border-none rounded-[var(--radius-md)] cursor-pointer select-none
                     text-[var(--color-gray-400)] text-[var(--text-nano)] font-[500]
                     bg-transparent hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-600)]
                     transition-[background-color,color] duration-150"
        >
          {isDark ? (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="3.5" />
              <line x1="10" y1="2" x2="10" y2="4" />
              <line x1="10" y1="16" x2="10" y2="18" />
              <line x1="2" y1="10" x2="4" y2="10" />
              <line x1="16" y1="10" x2="18" y2="10" />
              <line x1="3.5" y1="3.5" x2="5" y2="5" />
              <line x1="15" y1="15" x2="16.5" y2="16.5" />
              <line x1="3.5" y1="16.5" x2="5" y2="15" />
              <line x1="15" y1="5" x2="16.5" y2="3.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
              <path d="M16.5 12.5A6.5 6.5 0 0 1 7.5 3.5a6.5 6.5 0 1 0 9 9z" />
            </svg>
          )}
          <span className="mt-1 text-[10px]">{isDark ? t('theme.light') : t('theme.dark')}</span>
        </button>
      </nav>

      {/* Panel Content —— 子组件（PhotoPanel 等）自身有 ps-scroll 滚动容器 */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden border-r border-[var(--color-border-light)]">
        {getPanelContent(activePanel, photoImport, onNavigateToSmartLayout)}
      </div>

      {/* Drag handle */}
      <div
        className="absolute right-[-3px] top-0 bottom-0 w-[7px] cursor-col-resize z-10 group"
        onMouseDown={handleMouseDown}
      >
        <div className="w-[3px] h-full mx-auto rounded-full bg-[var(--color-primary-300)] opacity-0 group-hover:opacity-60 group-active:opacity-100 transition-all" />
      </div>
    </div>
  );
}
