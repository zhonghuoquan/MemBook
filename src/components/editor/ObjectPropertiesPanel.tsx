/**
 * 右侧「对象属性」浮动面板
 *
 * 点选页面上的文字 / 便利贴 / 形状后，在画布右侧弹出对应属性面板，快速设计，
 * 无需切到左侧工具面板。支持收起（折叠为右侧窄条，状态持久化）。
 *
 * 属性内容复用 panels/TextProperties、StickyProperties、ShapeProperties（与左侧工具面板共用）。
 */
import { useTranslation } from 'react-i18next';
import { useUIStore, useEditorStore } from '../../store';
import { TextProperties } from './panels/TextProperties';
import { StickyProperties } from './panels/StickyProperties';
import { ShapeProperties } from './panels/ShapeProperties';

export function ObjectPropertiesPanel() {
  const { t } = useTranslation();
  const collapsed = useUIStore((s) => s.objectPanelCollapsed);
  const setCollapsed = useUIStore((s) => s.setObjectPanelCollapsed);

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const currentPage = pages[currentPageIndex];
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const selectedStickyId = useEditorStore((s) => s.selectedStickyId);
  const selectedShapeId = useEditorStore((s) => s.selectedShapeId);

  const textEl = currentPage?.textElements?.find((e) => e.id === selectedTextId);
  const sticky = currentPage?.stickyNotes?.find((n) => n.id === selectedStickyId);
  const shape = currentPage?.shapeElements?.find((s) => s.id === selectedShapeId);

  // 未选中任何对象：不显示面板
  if (!textEl && !sticky && !shape) return null;

  const typeLabel = textEl
    ? t('editor.tools.textProperties')
    : sticky
      ? t('editor.tools.stickyProperties')
      : t('editor.tools.shapeProperties');

  // 对象类型小图标
  const typeIcon = textEl ? (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><path d="M4 3.5h8M8 3.5V12.5M5.5 12.5h5"/></svg>
  ) : sticky ? (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><rect x="2.5" y="2.5" width="9" height="9" rx="1.5"/><path d="M5.5 6h5M5.5 8.5h3.5"/></svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>
  );

  // 折叠态：画布右侧一条窄竖条，点击展开
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title={t('editor.objectPanel.expand')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3 px-1.5 py-4 rounded-l-lg bg-[var(--color-surface)] border border-r-0 border-[var(--color-border)] shadow-lg cursor-pointer hover:bg-[var(--color-surface-hover)]"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4 text-[var(--color-brand)]"><path d="M6 3l5 5-5 5"/></svg>
        <span className="text-[10px] text-[var(--color-gray-500)]" style={{ writingMode: 'vertical-rl' }}>{t('editor.objectPanel.title')}</span>
      </button>
    );
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 z-40 w-[272px] max-w-[70%] flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-[-4px_0_16px_rgba(0,0,0,0.06)]">
      {/* 头部：类型图标 + 标题 + 收起 */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border-light)] bg-[var(--color-surface-hover)]/50">
        <span className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]">{typeIcon}</span>
        <span className="flex-1 text-[12px] font-[600] text-[var(--color-gray-800)] truncate">{typeLabel}</span>
        <button
          onClick={() => setCollapsed(true)}
          title={t('editor.objectPanel.collapse')}
          className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] cursor-pointer border-none bg-transparent"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4"><path d="M10 3l-5 5 5 5"/></svg>
        </button>
      </div>
      {/* 属性内容 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5">
        {textEl && <TextProperties el={textEl} />}
        {sticky && <StickyProperties el={sticky} />}
        {shape && <ShapeProperties shape={shape} />}
      </div>
    </div>
  );
}