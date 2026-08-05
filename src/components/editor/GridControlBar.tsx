import { useCallback } from 'react';
import { useUIStore } from '../../store';
import { Tooltip } from '../common/Tooltip';
import { useTranslation } from 'react-i18next';

interface GridControlBarProps {
  pageCount: number;
  selectedCount?: number;
  onFullscreen?: () => void;
}

export function GridControlBar({ pageCount, selectedCount, onFullscreen }: GridControlBarProps) {
  const { t } = useTranslation();
  const gridZoom = useUIStore((s) => s.gridZoom);
  const setGridZoom = useUIStore((s) => s.setGridZoom);
  const setViewMode = useUIStore((s) => s.setViewMode);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;
  const ZOOM_RATIO = ZOOM_MAX / ZOOM_MIN;
  const sliderVal = Math.round(Math.log(gridZoom / ZOOM_MIN) / Math.log(ZOOM_RATIO) * 1000);

  const handleZoomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value) / 1000;
    setGridZoom(ZOOM_MIN * Math.pow(ZOOM_RATIO, pos));
  }, [setGridZoom]);

  const handleBackToEdit = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setViewMode('single');
  }, [setViewMode]);

  return (
    <div className="bg-[image:var(--gradient-brand-soft)] border-t border-[var(--color-border)] flex items-center justify-between px-4 py-2 shrink-0">
      {/* 左侧：页数信息 */}
      <div className="flex items-center gap-3">
        <span className="text-[var(--text-body-sm)] text-[var(--color-gray-600)] tabular-nums">
          {t('editor.gridControl.pageCount', { count: pageCount })}
        </span>
        {selectedCount !== undefined && selectedCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-[var(--color-brand)] text-white text-[var(--text-caption)] font-[500]">
            {t('editor.gridControl.selected', { count: selectedCount })}
          </span>
        )}
      </div>

      {/* 中间：缩放滑块 */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-[var(--color-border)]">
        <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">{t('editor.gridControl.small')}</span>
        <Tooltip text={t('editor.gridControl.zoomLevel', { percent: Math.round(gridZoom * 100) })}>
          <input
            type="range"
            min="0"
            max="1000"
            step="1"
            value={sliderVal}
            onChange={handleZoomChange}
            className="w-28 h-1.5 cursor-pointer accent-[var(--color-brand)]"
          />
        </Tooltip>
        <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">{t('editor.gridControl.large')}</span>
        <span className="text-[var(--text-caption)] text-[var(--color-gray-600)] min-w-[2.8em] tabular-nums select-none">
          {Math.round(gridZoom * 100)}%
        </span>
        <Tooltip text={t('editor.gridControl.resetZoom')}>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-white text-[var(--text-caption)] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors shrink-0"
            onClick={() => setGridZoom(1.0)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M2 7a5 5 0 1 0 1.5-3.5" /><path d="M2 2v3h3" />
            </svg>
            <span className="font-[500]">{t('editor.gridControl.reset')}</span>
          </button>
        </Tooltip>
      </div>

      {/* 右侧：视图切换 */}
      <div className="flex items-center gap-2">
        <Tooltip text={t('editor.gridControl.backToEditor')}>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)] cursor-pointer transition-colors"
            onClick={(e) => handleBackToEdit(e)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="1" y="1" width="5" height="5" rx="1" />
              <rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" />
              <rect x="8" y="8" width="5" height="5" rx="1" />
            </svg>
            <span className="text-[var(--text-caption)] font-[500]">{t('editor.gridControl.grid')}</span>
          </button>
        </Tooltip>
        <Tooltip text={t('editor.gridControl.fullscreenHint')}>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-white text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors"
            onClick={onFullscreen}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M2 6V3a1 1 0 0 1 1-1h3" />
              <path d="M8 2h3a1 1 0 0 1 1 1v3" />
              <path d="M2 8v3a1 1 0 0 0 1 1h3" />
              <path d="M12 8v3a1 1 0 0 1-1 1H8" />
            </svg>
            <span className="text-[var(--text-caption)] font-[500]">{t('editor.gridControl.fullscreen')}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
