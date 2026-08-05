import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorView } from './components/views/EditorView';
import { HomeView } from './components/views/HomeView';
import { SmartLayoutView } from './components/views/SmartLayoutView';
import { ToastContainer } from './components/common/Toast';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { UpdateDialog } from './components/common/UpdateDialog';
import { ActivationDialog, useLicenseStore } from './license';
import { checkForUpdate, isWithinCheckCooldown, type UpdateInfo } from './utils/updater';
import { safeUnlisten } from './utils/tauri';
import './styles/globals.css';

type Page = 'home' | 'editor' | 'smart-layout';

const SESSION_KEY = 'membook-session-page';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function App() {
  const { t } = useTranslation();
  const [initialized, setInitialized] = useState(false);
  const initLicense = useLicenseStore((s) => s.init);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  // 初始化许可证服务（必须在任何权限检查前完成）
  useEffect(() => {
    initLicense().then(() => setInitialized(true));
  }, [initLicense]);

  // 启动后静默检查更新（仅桌面端 + 非冷却期内 + 许可证初始化完成后）
  useEffect(() => {
    if (!initialized) return;
    if (!isTauri) return;
    if (isWithinCheckCooldown()) return;
    // 延迟 3 秒检查，避免与启动初始化竞争网络资源
    const timer = setTimeout(async () => {
      const info = await checkForUpdate();
      if (info) setUpdateInfo(info);
    }, 3000);
    return () => clearTimeout(timer);
  }, [initialized]);

  // 恢复会话中的页面状态（刷新后保持编辑器）；智能排版是临时状态，不恢复
  const [page, setPage] = useState<Page>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved === 'editor') return saved;
    } catch { /* ignore */ }
    return 'home';
  });

  const [isMaximized, setIsMaximized] = useState(false);

  // 持久化页面状态：智能排版是临时状态，不持久化
  useEffect(() => {
    try {
      if (page === 'editor' || page === 'home') {
        sessionStorage.setItem(SESSION_KEY, page);
      }
    } catch { /* ignore */ }
  }, [page]);

  // Tauri 模式下：标记 html 以启用透明背景 + 监听最大化状态用于圆角
  useEffect(() => {
    if (!isTauri) return;
    document.documentElement.classList.add('tauri-mode');

    let unlisten: (() => void) | undefined;
    let disposed = false;
    const setup = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
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

    // 屏蔽 WebView 默认右键菜单，防止误点「刷新」导致内存状态丢失
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', blockContextMenu);

    return () => {
      disposed = true;
      safeUnlisten(unlisten);
      unlisten = undefined;
      document.documentElement.classList.remove('tauri-mode');
      document.removeEventListener('contextmenu', blockContextMenu);
    };
  }, []);

  const handleNavigateToEditor = () => {
    setPage('editor');
  };

  const handleBackToHome = () => {
    // 清除项目 ID 以便下次进入编辑器从主页创建新项目
    setPage('home');
  };

  const dialogOpen = useLicenseStore((s) => s.dialogOpen);
  const dialogHint = useLicenseStore((s) => s.dialogHint);
  const closeLicenseDialog = useLicenseStore((s) => s.closeDialog);
  const checkFeature = useLicenseStore((s) => s.checkFeature);

  const handleNavigateToSmartLayout = () => {
    if (checkFeature('smartLayout', t('license.smartLayoutRequiresActivation'))) {
      setPage('smart-layout');
    }
  };

  if (!initialized) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--color-surface)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">{t('common.initializing')}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-app-root className={`h-full w-full overflow-hidden ${isTauri ? 'app-rounded' : ''} ${isMaximized ? 'app-maximized' : ''}`}>
      <ErrorBoundary>
        {page === 'home' && (
          <HomeView onNavigateToEditor={handleNavigateToEditor} />
        )}
        {page === 'editor' && (
          <EditorView onBack={handleBackToHome} onNavigateToSmartLayout={handleNavigateToSmartLayout} />
        )}
        {page === 'smart-layout' && (
          <SmartLayoutView onBack={handleNavigateToEditor} />
        )}
      </ErrorBoundary>
      <ToastContainer />
      <ActivationDialog open={dialogOpen} onClose={closeLicenseDialog} hint={dialogHint} />
      {updateInfo && (
        <UpdateDialog update={updateInfo} onClose={() => setUpdateInfo(null)} />
      )}
    </div>
  );
}
