import { useState, useEffect } from 'react';
import { EditorView } from './components/views/EditorView';
import { HomeView } from './components/views/HomeView';
import { ToastContainer } from './components/common/Toast';
import './styles/globals.css';

type Page = 'home' | 'editor';

const SESSION_KEY = 'membook-session-page';

export default function App() {
  // 恢复会话中的页面状态（刷新后保持编辑器）
  const [page, setPage] = useState<Page>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved === 'editor') return 'editor';
    } catch { /* ignore */ }
    return 'home';
  });

  // 持久化页面状态
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, page); } catch { /* ignore */ }
  }, [page]);

  const handleNavigateToEditor = () => {
    setPage('editor');
  };

  const handleBackToHome = () => {
    // 清除项目 ID 以便下次进入编辑器从主页创建新项目
    setPage('home');
  };

  return (
    <div className="h-full w-full overflow-hidden">
      {page === 'home' && (
        <HomeView onNavigateToEditor={handleNavigateToEditor} />
      )}
      {page === 'editor' && (
        <EditorView onBack={handleBackToHome} />
      )}
      <ToastContainer />
    </div>
  );
}
