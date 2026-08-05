import { useState, useRef, useCallback, useEffect } from 'react';
import { useEditorStore, useUIStore } from '../../store';
import { pageLayoutService } from '../../services/pageLayoutService';
import { usePanelConstraints } from '../../hooks/usePanelConstraints';
import { isGooglePhotosPage, buildVirtualTemplate } from '../../types';
import { PageSlotPreview } from '../common/PageSlotPreview';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PREVIEW_W = 180;

export function LayoutSwitchDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);

  const page = pages[currentPageIndex];
  const isGP = page ? isGooglePhotosPage(page) : false;

  // ── 窗口层级 ──
  const activeFloatingPanel = useUIStore((s) => s.activeFloatingPanel);
  const setActiveFloatingPanel = useUIStore((s) => s.setActiveFloatingPanel);
  const isActive = activeFloatingPanel === 'layoutSwitch';

  // ── 窗口拖动（限制在工作区内，并随面板调整自动避让）──
  const { bounds, constrain } = usePanelConstraints();
  const [winPos, setWinPos] = useState({ x: -1, y: -1 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<() => void>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const curX = winPos.x < 0 ? r.left : winPos.x;
    const curY = winPos.y < 0 ? r.top : winPos.y;
    const startX = e.clientX;
    const startY = e.clientY;
    const w = r.width;
    const h = r.height;

    setWinPos({ x: curX, y: curY });

    const onMove = (ev: MouseEvent) => {
      const rawX = curX + ev.clientX - startX;
      const rawY = curY + ev.clientY - startY;
      const c = constrain(rawX, rawY, w, h);
      setWinPos({ x: c.x, y: c.y });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  }, [winPos, constrain]);

  // 组件卸载时清理可能存在的拖动监听
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  // 当左侧面板/底部面板尺寸变化导致当前窗口被遮挡时，自动内移
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const c = constrain(r.left, r.top, r.width, r.height);
    if (c.x !== r.left || c.y !== r.top) {
      setWinPos({ x: c.x, y: c.y });
    }
  }, [bounds, open, constrain]);

  if (!open) return null;

  const panelStyle: React.CSSProperties = {
    ...(winPos.x >= 0 ? { left: winPos.x, top: winPos.y } : { right: 16, top: 380 }),
    zIndex: isActive ? 'calc(var(--z-dropdown) + 10)' : 'var(--z-dropdown)',
  };

  const previewH = albumSize ? (PREVIEW_W * albumSize.height) / albumSize.width : PREVIEW_W * 1.4;

  return (
    <div
      ref={panelRef}
      onMouseDown={() => setActiveFloatingPanel('layoutSwitch')}
      className="fixed z-[var(--z-dropdown)] bg-white rounded-xl shadow-[var(--shadow-lg)] border border-[var(--color-border)] w-[220px]"
      style={panelStyle}
    >
      {/* 标题栏（可拖动） */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center justify-between px-3 py-2 cursor-move border-b border-[var(--color-border-light)]"
      >
        <span className="text-[12px] font-[600] text-[var(--color-gray-800)] select-none">
          {t('editor.layoutSwitch.title', { page: currentPageIndex + 1 })}
        </span>
        <button onClick={onClose} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-700)] cursor-pointer border-none bg-transparent p-0">
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* 内容 */}
      <div className="p-3">
        {!isGP ? (
          <div className="text-center py-5 px-2">
            <div className="text-[11px] text-[var(--color-gray-400)]">{t('editor.layoutSwitch.notSupported')}</div>
            <div className="text-[10px] text-[var(--color-gray-400)] mt-1">{t('editor.layoutSwitch.notSupportedDesc')}</div>
            <button
              onClick={() => pageLayoutService.convertPageToGooglePhotos(currentPageIndex)}
              className="mt-4 h-6 px-3 rounded-[var(--radius-md)] text-[11px] text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] transition-colors border-none cursor-pointer"
            >
              {t('editor.layoutSwitch.convert')}
            </button>
          </div>
        ) : (
          <>
            {/* 按钮区 */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => pageLayoutService.rotatePageLayout(currentPageIndex)}
                className="flex-1 flex items-center justify-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] transition-colors border border-[var(--color-border)] bg-transparent cursor-pointer"
                title={t('editor.layoutSwitch.rotate90')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <path d="M2 5a4 4 0 0 1 7-2.5" /><path d="M9 1v2.5H6.5" />
                  <path d="M12 9a4 4 0 0 1-7 2.5" /><path d="M5 13v-2.5h2.5" />
                </svg>
                {t('editor.layoutSwitch.angleSwitch')}
              </button>
              <button
                onClick={() => pageLayoutService.shufflePageLayout(currentPageIndex)}
                className="flex-1 flex items-center justify-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] transition-colors border border-[var(--color-border)] bg-transparent cursor-pointer"
                title={t('editor.layoutSwitch.randomShuffle')}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <rect x="1.5" y="1.5" width="4" height="4" rx="0.5" /><rect x="8.5" y="1.5" width="4" height="4" rx="0.5" />
                  <rect x="1.5" y="8.5" width="4" height="4" rx="0.5" /><rect x="8.5" y="8.5" width="4" height="4" rx="0.5" />
                </svg>
                {t('editor.layoutSwitch.randomSwitch')}
              </button>
            </div>

            {/* 缩略图预览 — 与模板面板风格保持一致 */}
            <div className="flex justify-center">
              <div
                className="rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-border)] bg-white"
                style={{ width: PREVIEW_W, height: previewH }}
              >
                <PageSlotPreview
                  page={page}
                  template={buildVirtualTemplate(page)}
                  width={PREVIEW_W}
                  height={previewH}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
