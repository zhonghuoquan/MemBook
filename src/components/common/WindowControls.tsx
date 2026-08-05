import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { safeUnlisten } from '../../utils/tauri';
import { isMacOS } from '../../utils/platform';

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

export function WindowControls() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasTauri, setHasTauri] = useState(false);

  useEffect(() => {
    setHasTauri(isTauri());
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setup = async () => {
      const api = await getWindowApi();
      if (!api) return;
      const win = api.getCurrentWindow();
      setIsMaximized(await win.isMaximized());

      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
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

  // macOS 用原生交通灯按钮，隐藏自定义控件
  if (!hasTauri || isMacOS()) return null;

  const handleMinimize = async () => {
    const api = await getWindowApi();
    if (!api) return;
    await api.getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const api = await getWindowApi();
    if (!api) return;
    const win = api.getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  };

  const handleClose = async () => {
    const api = await getWindowApi();
    if (!api) return;
    await api.getCurrentWindow().close();
  };

  return (
    <div className="flex items-center h-full -mr-2" data-no-drag>
      <WindowBtn onClick={handleMinimize} label={t('common.window.minimize')} hoverBg="hover:bg-black/5">
        <MinimizeIcon />
      </WindowBtn>
      <WindowBtn onClick={handleMaximize} label={isMaximized ? t('common.window.restore') : t('common.window.maximize')} hoverBg="hover:bg-black/5">
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </WindowBtn>
      <WindowBtn onClick={handleClose} label={t('common.window.close')} hoverBg="hover:bg-[#E81123] hover:text-white" className="close-btn">
        <CloseIcon />
      </WindowBtn>
    </div>
  );
}

function WindowBtn({
  children,
  onClick,
  label,
  hoverBg,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  hoverBg: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      data-no-drag
      className={`
        flex items-center justify-center w-11 h-full
        text-[var(--color-gray-600)]
        transition-colors duration-150
        ${hoverBg}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="8" height="8" rx="0.5" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="5.5" height="5.5" rx="0.5" />
      <path d="M3 3V1.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
    </svg>
  );
}
