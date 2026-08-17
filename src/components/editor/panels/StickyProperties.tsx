/**
 * 便利贴属性面板（对象属性面板 / 左侧工具面板共用）
 */
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store';
import { STICKY_COLORS } from '../../../types';
import type { StickyNote } from '../../../types';

export function StickyProperties({ el }: { el: StickyNote }) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const updateStickyNote = useEditorStore((s) => s.updateStickyNote);

  return (
    <div className="space-y-3">
      {/* 颜色 */}
      <div>
        <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">{t('editor.tools.color')}</div>
        <div className="flex gap-1.5 flex-wrap">
          {STICKY_COLORS.map((sc) => (
            <button
              key={sc.color}
              onClick={() => updateStickyNote(currentPageIndex, el.id, { color: sc.color })}
              className={`w-7 h-7 rounded-[4px] border-2 cursor-pointer transition-transform hover:scale-110
                ${el.color === sc.color ? 'border-[var(--color-brand)] scale-110' : 'border-[var(--color-border)]'}`}
              style={{ backgroundColor: sc.color }}
              title={sc.name}
            />
          ))}
        </div>
      </div>
      {/* 样式 */}
      <div>
        <div className="text-[10px] font-[500] text-[var(--color-gray-500)] mb-1.5">{t('editor.tools.style')}</div>
        <div className="flex gap-1.5">
          {([
            { key: 'rounded' as const, label: t('editor.tools.styleRounded') },
            { key: 'square' as const, label: t('editor.tools.styleSquare') },
            { key: 'tape' as const, label: t('editor.tools.styleTape') },
            { key: 'shadow' as const, label: t('editor.tools.styleShadow') },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => updateStickyNote(currentPageIndex, el.id, { style: key })}
              className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-[10px] font-[500] border cursor-pointer transition-colors
                ${(el.style || 'rounded') === key
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}