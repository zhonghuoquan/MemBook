import { useEffect, useRef } from 'react';
import { Toolbar } from '../editor/Toolbar';
import { LeftPanel } from '../editor/LeftPanel';
import { Canvas } from '../editor/Canvas';
import { EditFlyout } from '../editor/EditFlyout';
import { BottomNav } from '../editor/BottomNav';
import { useUIStore, useEditorStore, usePhotoStore } from '../../store';
import { getDemoPhotos, getDemoProject } from '../../utils/demoData';
import { loadProject, loadPhotos, createAndSaveProject, saveProject, savePhotos, scheduleAutoSave } from '../../db';

interface EditorViewProps {
  onBack?: () => void;
}

const SAVED_PROJECT_KEY = 'membook_current_project_id';

export function EditorView({ onBack }: EditorViewProps) {
  const pages = useEditorStore((s) => s.pages);
  const setPages = useEditorStore((s) => s.setPages);
  const setAlbumSize = useEditorStore((s) => s.setAlbumSize);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const addToast = useUIStore((s) => s.addToast);
  const bottomNavHeight = useUIStore((s) => s.bottomNavHeight);
  const initialized = useRef(false);

  // ── 加载已保存项目 ──
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const savedId = localStorage.getItem(SAVED_PROJECT_KEY);
      if (savedId) {
        // 有保存的项目 → 加载
        try {
          const project = await loadProject(savedId);
          if (project && project.pages.length > 0) {
            setPages(project.pages);
            setAlbumSize(project.size);
            // 恢复照片（没有就空，不要回退到演示照片）
            const savedPhotos = await loadPhotos();
            setPhotos(savedPhotos || []);
            addToast({ type: 'info', message: `已恢复项目「${project.name}」` });
            return;
          }
        } catch {
          // 加载失败，回退到 demo
        }
      }

      // 没有已保存项目 → 创建新项目（用 demo 数据）
      const demo = getDemoProject();
      setPages(demo.pages);
      setAlbumSize(demo.size);
      setPhotos(getDemoPhotos());
      await createAndSaveProject('未命名相册', demo.size, demo.pages);
      addToast({ type: 'info', message: '已创建新相册，开始制作吧 ✨' });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 自动保存：每次 pages 变化时调度 ──
  useEffect(() => {
    if (pages.length === 0) return;
    scheduleAutoSave(2000); // 2s 防抖
  }, [pages]);

  // ── 页面离开/返回主页时强制保存 ──
  const handleBack = async () => {
    // 立即保存（await 确保数据写完后才切回主页）
    const currentPages = useEditorStore.getState().pages;
    const currentPhotos = usePhotoStore.getState().photos;
    const projectId = localStorage.getItem(SAVED_PROJECT_KEY);
    if (projectId && currentPages.length > 0) {
      try {
        const existing = await loadProject(projectId);
        if (existing) {
          await saveProject({ ...existing, pages: currentPages, updatedAt: new Date().toISOString() });
        }
        await savePhotos(currentPhotos);
      } catch (e) {
        console.error('保存失败:', e);
      }
    }
    onBack?.();
  };

  return (
    <div className="flex flex-col h-full">
      <Toolbar onBack={handleBack} />
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧面板占满整列高度 */}
        <LeftPanel />
        {/* 右侧：画布 + 底部导航 */}
        <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto relative" style={{ minHeight: 0 }}>
            <Canvas />
            <EditFlyout />
          </div>
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
