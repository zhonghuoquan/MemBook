import { useEffect } from 'react';
import { Toolbar } from '../editor/Toolbar';
import { PhotoPanel } from '../editor/PhotoPanel';
import { TemplatePanel } from '../editor/TemplatePanel';
import { ThemePanel } from '../editor/ThemePanel';
import { ToolsPanel } from '../editor/ToolsPanel';
import { MarketPanel } from '../editor/MarketPanel';
import { BottomTabs } from '../editor/BottomTabs';
import { Canvas } from '../editor/Canvas';
import { EditFlyout } from '../editor/EditFlyout';
import { BottomNav } from '../editor/BottomNav';
import { useUIStore, useEditorStore, usePhotoStore } from '../../store';
import { getDemoPhotos, getDemoProject } from '../../utils/demoData';
import { createAndSaveProject } from '../../db';

interface EditorViewProps {
  onBack?: () => void;
}

export function EditorView({ onBack }: EditorViewProps) {
  const activePanel = useUIStore((s) => s.activePanel);
  const setPages = useEditorStore((s) => s.setPages);
  const pages = useEditorStore((s) => s.pages);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const addToast = useUIStore((s) => s.addToast);

  // 首次进入编辑器时加载 Demo 数据（兜底：如果前面没保存过）
  useEffect(() => {
    if (pages.length === 0) {
      const demo = getDemoProject();
      setPages(demo.pages);
      setPhotos(getDemoPhotos());
      createAndSaveProject('未命名相册', demo.size, demo.pages);
      addToast({ type: 'info', message: '已加载示例数据，试试编辑吧 ✨' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const renderPanel = () => {
    switch (activePanel) {
      case 'photos':     return <PhotoPanel />;
      case 'templates':  return <TemplatePanel />;
      case 'theme':      return <ThemePanel />;
      case 'tools':      return <ToolsPanel />;
      case 'market':     return <MarketPanel />;
      default:           return <PhotoPanel />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Toolbar onBack={onBack} />

      <div className="flex flex-1 overflow-hidden relative">
        {renderPanel()}
        <Canvas />
        <EditFlyout />
      </div>

      <BottomTabs />
      <BottomNav />
    </div>
  );
}
