/**
 * 页面显示模式切换按钮
 * - 'full'  全显模式：显示页面外内容（眼睛睁开）
 * - 'page'  页面模式：裁剪到页面边界（眼睛闭上）
 * 位置：工作区右上角固定
 */
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store';
import { useEditorStore } from '../../store';
import { RULER_SIZE } from './CanvasRulers';

export function PageDisplayModeToggle() {
  const { t } = useTranslation();
  const pageDisplayMode = useUIStore((s) => s.pageDisplayMode);
  const setPageDisplayMode = useUIStore((s) => s.setPageDisplayMode);
  const pagesLength = useEditorStore((s) => s.pages.length);
  const rulerEnabled = useUIStore((s) => s.rulerEnabled);

  if (pagesLength === 0) return null;

  const isFull = pageDisplayMode === 'full';
  const toggle = () => setPageDisplayMode(isFull ? 'page' : 'full');

  return (
    <div className="absolute right-3 z-[var(--z-dropdown)]" style={{ top: rulerEnabled ? RULER_SIZE + 12 : 12 }}>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-white shadow-md border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer text-[var(--color-gray-600)] text-xs font-medium"
        title={isFull ? t('editor.displayMode.fullHint') : t('editor.displayMode.pageHint')}
      >
        {isFull ? (
          /* 眼睛睁开：全显模式 */
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          /* 眼睛闭上：页面模式 */
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        )}
        <span>{isFull ? t('editor.displayMode.full') : t('editor.displayMode.page')}</span>
      </button>
    </div>
  );
}
