import { useEffect } from 'react';
import { Toolbar } from '../editor/Toolbar';
import { LeftPanel } from '../editor/LeftPanel';
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
  const pages = useEditorStore((s) => s.pages);
  const setPages = useEditorStore((s) => s.setPages);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    if (pages.length === 0) {
      const demo = getDemoProject();
      setPages(demo.pages);
      setPhotos(getDemoPhotos());
      createAndSaveProject('未命名相册', demo.size, demo.pages);
      addToast({ type: 'info', message: '已加载示例数据，试试编辑吧 ✨' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏：简化版 — 去掉 +页、删除页、预览 */}
      <Toolbar onBack={onBack} />

      {/* 主体区域：左侧面板(Tab导航+内容) + 中央画布 */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 左侧面板：垂直Tab导航 + 面板内容 */}
        <LeftPanel />

        {/* 中央画布 */}
        <Canvas />

        {/* 编辑浮层（双击照片时覆盖左侧区域） */}
        <EditFlyout />
      </div>

      {/* 底部页面导航栏：缩略图 + 控制栏（页码+缩放滑块+页面按钮） */}
      <BottomNav />
    </div>
  );
}
