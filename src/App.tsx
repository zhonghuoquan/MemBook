import { useState } from 'react';
import { EditorView } from './components/views/EditorView';
import { HomeView } from './components/views/HomeView';
import { ToastContainer } from './components/common/Toast';
import './styles/globals.css';

/**
 * App 根组件 — 管理页面之间的路由切换
 * - 'home' → 主页（空状态/项目列表）
 * - 'editor' → 编辑器
 */
type Page = 'home' | 'editor';

export default function App() {
  const [page, setPage] = useState<Page>('home');

  const handleNavigateToEditor = () => {
    setPage('editor');
  };

  const handleBackToHome = () => {
    setPage('home');
  };

  return (
    <div className="h-full w-full overflow-hidden">
      {page === 'home' && (
        <HomeView
          onNavigateToEditor={handleNavigateToEditor}
        />
      )}
      {page === 'editor' && (
        <EditorView onBack={handleBackToHome} />
      )}
      <ToastContainer />
    </div>
  );
}
