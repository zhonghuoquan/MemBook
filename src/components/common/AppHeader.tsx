import { useState, useEffect, useCallback, useRef } from 'react';
import { WindowControls } from './WindowControls';
import { logger } from '../../utils/logger';
import { safeUnlisten } from '../../utils/tauri';
import { isMacOS, MAC_TRAFFIC_LIGHTS_WIDTH } from '../../utils/platform';

let windowApi: Awaited<typeof import('@tauri-apps/api/window')> | null = null;

async function getWindowApi() {
  if (windowApi) return windowApi;
  try {
    windowApi = await import('@tauri-apps/api/window');
    return windowApi;
  } catch {
    return null;
  }
}

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useWindowMaximize() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setup = async () => {
      const api = await getWindowApi();
      if (!api) return;
      const win = api.getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      try {
        setIsFullscreen(await win.isFullscreen());
      } catch {
        // isFullscreen 在某些平台可能不可用，忽略
      }

      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
        try {
          setIsFullscreen(await win.isFullscreen());
        } catch {
          // 忽略
        }
      });
      // 竞态处理：如果组件在 await 期间已卸载，立即注销
      if (disposed) {
        safeUnlisten(unlisten);
        unlisten = undefined;
      }
    };

    setup();
    return () => {
      disposed = true;
      safeUnlisten(unlisten);
      unlisten = undefined;
    };
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const api = await getWindowApi();
      if (!api) return;
      const win = api.getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (err) {
      logger.error('[AppHeader] toggleMaximize failed:', err);
    }
  }, []);

  return { isMaximized, isFullscreen, toggleMaximize };
}

interface AppHeaderProps {
  children: React.ReactNode;
  className?: string;
  height?: 'toolbar' | 'home';
}

export function AppHeader({ children, className = '', height = 'toolbar' }: AppHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const { isMaximized, isFullscreen, toggleMaximize } = useWindowMaximize();

  const heightClass = height === 'home'
    ? 'h-[var(--layout-home-header-height)]'
    : 'h-[var(--layout-toolbar-height)]';

  // 自动将 data-no-drag 区域标记为不可拖拽，兼容 Tauri 原生拖拽区域
  useEffect(() => {
    if (!isTauri() || !headerRef.current) return;
    const header = headerRef.current;
    const markNoDrag = () => {
      header.querySelectorAll('[data-no-drag]').forEach((el) => {
        el.setAttribute('data-tauri-drag-region', 'false');
      });
    };
    markNoDrag();
    const observer = new MutationObserver(markNoDrag);
    observer.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-no-drag'] });
    return () => observer.disconnect();
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    // macOS: 系统原生处理双击标题栏最大化/还原，不需要前端介入
    // 前端 toggleMaximize 会与系统行为冲突导致窗口异常
    if (isMacOS()) return;
    toggleMaximize();
  }, [toggleMaximize]);

  // macOS: 最大化/全屏时交通灯按钮按系统逻辑隐藏，logo 和工具栏左对齐（移除让位 padding）
  // 使用 CSS transition 让 padding 平滑过渡，避免内容瞬移
  const trafficLightsHidden = isMaximized || isFullscreen;
  const macStyle = isMacOS()
    ? {
        paddingLeft: trafficLightsHidden ? '1rem' : `${MAC_TRAFFIC_LIGHTS_WIDTH}px`,
        transition: 'padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }
    : undefined;

  return (
    <header
      ref={headerRef}
      data-tauri-drag-region
      data-toolbar={height === 'toolbar' ? '' : undefined}
      onDoubleClick={handleDoubleClick}
      className={`${heightClass} bg-[image:var(--gradient-header)] flex items-center px-4 gap-1 shrink-0 z-[var(--z-toolbar)] select-none ${className}`}
      // macOS: 标题栏左侧留出空间给交通灯按钮（红黄绿）；最大化/全屏时平滑过渡到 1rem
      style={macStyle}
    >
      {children}
      <WindowControls />
    </header>
  );
}