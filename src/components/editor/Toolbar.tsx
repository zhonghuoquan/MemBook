import { useState, useCallback } from 'react';
import { useUIStore, useEditorStore, useHistoryStore } from '../../store';
import { IconButton } from '../common/IconButton';
import { Button } from '../common/Button';
import { PreviewModal } from './PreviewModal';

interface ToolbarProps {
  onBack?: () => void;
}

export function Toolbar({ onBack }: ToolbarProps) {
  const addToast = useUIStore((s) => s.addToast);
  const pages = useEditorStore((s) => s.pages);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const addPage = useEditorStore((s) => s.addPage);
  const removePage = useEditorStore((s) => s.removePage);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const [showPreview, setShowPreview] = useState(false);

  const handleUndo = useCallback(() => {
    const entry = undo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: '已撤销' });
    }
  }, [undo, addToast]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: '已重做' });
    }
  }, [redo, addToast]);

  const handleAddPage = useCallback(() => {
    addPage();
    addToast({ type: 'success', message: '已添加新页面' });
  }, [addPage, addToast]);

  const handleDeletePage = useCallback(() => {
    if (pages.length <= 1) {
      addToast({ type: 'warning', message: '至少保留一个页面' });
      return;
    }
    removePage(currentPageIndex);
    addToast({ type: 'info', message: '页面已删除' });
  }, [pages.length, currentPageIndex, removePage, addToast]);

  return (
    <>
      <header
        className="h-[var(--layout-toolbar-height)] bg-white border-b border-[var(--color-border)]
                   flex items-center px-4 gap-3 shrink-0 z-[var(--z-flat)]"
      >
        {/* Left: Back + Filename */}
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost-like flex items-center gap-1 text-[var(--color-gray-600)] hover:text-[var(--color-gray-800)] cursor-pointer"
            onClick={onBack}
          >
            <svg className="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
            返回
          </button>
          <div className="w-px h-6 bg-[var(--color-border)]" />
          <input
            className="bg-transparent border-none text-[var(--text-h3)] font-[600] text-[var(--color-text-primary)]
                       outline-none px-1 py-0 max-w-[180px] rounded-[var(--radius-xs)]
                       focus:bg-[var(--color-gray-50)] focus:px-2 transition-all"
            defaultValue="我的回忆"
            maxLength={30}
          />
        </div>

        {/* Center: Actions */}
        <div className="flex-1 flex items-center gap-2">
          <IconButton title="撤销" onClick={handleUndo}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M5 5L2 8l3 3" /><path d="M2 8h8a4 4 0 0 1 0 8" />
            </svg>
          </IconButton>
          <IconButton title="重做" onClick={handleRedo}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M11 5l3 3-3 3" /><path d="M14 8H6a4 4 0 0 0 0 8" />
            </svg>
          </IconButton>
          <div className="w-px h-6 bg-[var(--color-border)]" />
          <Button variant="secondary" size="sm" onClick={() => addToast({ type: 'info', message: '自动排版功能即将上线' })}>
            <svg className="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
            自动排版
          </Button>
        </div>

        {/* Right: Page / Edit actions */}
        <div className="flex items-center gap-1">
          <IconButton title="添加页" onClick={handleAddPage}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
              <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </IconButton>
          <button
            className="btn-ghost-like text-[var(--text-body-sm)] text-[var(--color-gray-600)] hover:text-[var(--color-error)] disabled:text-[var(--color-gray-300)]"
            onClick={handleDeletePage}
            disabled={pages.length <= 1}
          >
            删除页
          </button>
          <IconButton title="预览" onClick={() => setShowPreview(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <circle cx="8" cy="8" r="2.5" /><path d="M1 8s2.5-5.5 7-5.5S15 8 15 8s-2.5 5.5-7 5.5S1 8 1 8z" />
            </svg>
          </IconButton>
          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />
          <Button variant="primary" size="sm" onClick={() => addToast({ type: 'success', message: '导出功能即将上线' })}>
            <svg className="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M4 7l4 4 4-4" /><path d="M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
            </svg>
            导出
          </Button>
        </div>
      </header>

      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
    </>
  );
}
