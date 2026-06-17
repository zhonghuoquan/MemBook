import { useUIStore, useEditorStore, useHistoryStore } from '../../store';
import { Button } from '../common/Button';

interface ToolbarProps {
  onBack?: () => void;
}

export function Toolbar({ onBack }: ToolbarProps) {
  const addToast = useUIStore((s) => s.addToast);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const handleUndo = () => {
    const entry = undo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: '已撤销' });
    }
  };

  const handleRedo = () => {
    const entry = redo();
    if (entry) {
      useEditorStore.getState().setPages(entry.pages);
      if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
      addToast({ type: 'info', message: '已重做' });
    }
  };

  return (
    <header className="h-[var(--layout-toolbar-height)] bg-white border-b border-[var(--color-border)] flex items-center px-3 gap-2 shrink-0 z-[var(--z-flat)]">
      {/* Left: Logo + Back */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[var(--text-h3)] font-[700] text-[var(--color-brand)] select-none mr-1">MemBook</span>
        <button
          className="flex items-center gap-1 px-2 py-1 text-[var(--text-body-sm)] text-[var(--color-gray-600)] border-none rounded-[var(--radius-sm)] bg-transparent cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] transition-colors"
          onClick={onBack}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          主页
        </button>
      </div>

      <div className="w-px h-5 bg-[var(--color-border)] shrink-0 mx-1" />

      {/* File label */}
      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-500)] shrink-0">文件</span>

      {/* Undo / Redo */}
      <button
        className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)] transition-colors"
        title="撤销 (Ctrl+Z)"
        onClick={handleUndo}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M5 5L2 8l3 3" /><path d="M2 8h8a4 4 0 0 1 0 8" />
        </svg>
      </button>
      <button
        className="flex items-center justify-center w-7 h-7 border-none rounded-[var(--radius-xs)] bg-transparent text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)] transition-colors"
        title="重做 (Ctrl+Y)"
        onClick={handleRedo}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M11 5l3 3-3 3" /><path d="M14 8H6a4 4 0 0 0 0 8" />
        </svg>
      </button>

      <div className="w-px h-5 bg-[var(--color-border)] shrink-0 mx-1" />

      {/* Auto Layout */}
      <Button variant="secondary" size="sm" onClick={() => addToast({ type: 'info', message: '自动排版功能即将上线' })}>
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
        自动排版
      </Button>

      {/* Project Title - center */}
      <div className="flex-1 flex justify-center min-w-0 px-2">
        <input
          className="bg-transparent border-none text-[var(--text-h3)] font-[600] text-[var(--color-text-primary)] text-center outline-none px-2 py-0 max-w-[380px] rounded-[var(--radius-xs)] focus:bg-[var(--color-gray-50)] transition-all truncate"
          defaultValue="未命名的设计-相册（29.7 x 21厘米）"
          maxLength={40}
        />
      </div>

      {/* Right: Export */}
      <Button variant="primary" size="sm" onClick={() => addToast({ type: 'success', message: '导出功能即将上线' })}>
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M4 7l4 4 4-4" /><path d="M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
        </svg>
        导出
      </Button>
    </header>
  );
}
