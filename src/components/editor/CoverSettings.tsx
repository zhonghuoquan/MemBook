import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store';
import { isCoverOrBackCoverPage, isCoverPage } from '../../types';
import type { AlbumPage } from '../../types';
import { useDraggable } from '../../hooks/useDraggable';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useDialogHotkeys } from '../../hooks/useDialogHotkeys';
import { ModalGuard } from '../../utils/modal-guard';

interface Props {
  open: boolean;
  onClose: () => void;
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

/**
 * CoverSettings —— 封面设置
 * ─────────────────────────────────────
 * 独立设置封面（含封底）专用参数：
 *   - 封面/封底照片位圆角（支持每角单独设置）
 *   - 书脊底色（仅封面有书脊，封底无）
 * 仅作用于封面/封底页，不影响普通页面的页面设置。
 */
export function CoverSettings({ open, onClose }: Props) {
  const { t } = useTranslation();
  const drag = useDraggable(open);

  // ═══ 影子状态：暂存本地，确认后批量写入 Store ═══
  const [coverCorners, setCoverCorners] = useState<[number, number, number, number]>([4, 4, 4, 4]);
  const [coverUniform, setCoverUniform] = useState(true);
  const [spineColor, setSpineColor] = useState('#FFFFFF');
  const [hasCover, setHasCover] = useState(false);

  // 弹窗打开时从 Store 同步到本地
  useEffect(() => {
    if (!open) return;
    const s = useEditorStore.getState();
    // 封面/封底圆角：从第一个封面/封底页读取
    const coverPage = s.pages.find((p) => isCoverOrBackCoverPage(p));
    const raw = coverPage?.slotCornerRadius;
    if (typeof raw === 'number') {
      setCoverCorners([raw, raw, raw, raw]);
      setCoverUniform(true);
    } else if (Array.isArray(raw)) {
      setCoverCorners(raw);
      setCoverUniform(raw.every((v) => v === raw[0]));
    } else {
      setCoverCorners([4, 4, 4, 4]);
      setCoverUniform(true);
    }
    // 书脊底色：从第一个封面页读取（仅封面有书脊）
    const coverOnlyPage = s.pages.find((p) => isCoverPage(p));
    setHasCover(!!coverOnlyPage);
    setSpineColor(coverOnlyPage?.spineColor || '#FFFFFF');
  }, [open]);

  useEffect(() => {
    if (open) ModalGuard.open();
    return () => { if (open) ModalGuard.close(); };
  }, [open]);

  // ═══ 内容区滚动条自动隐藏 ═══
  const sb = useScrollbarVisibility<HTMLDivElement>();

  // ═══ 确认：批量写入 Store ═══
  const handleConfirm = useCallback(() => {
    const cornerValue: number | [number, number, number, number] = coverUniform
      ? coverCorners[0]
      : coverCorners;
    const store = useEditorStore.getState();
    const newPages = store.pages.map((p: AlbumPage) =>
      isCoverOrBackCoverPage(p) ? { ...p, slotCornerRadius: cornerValue } : p
    );
    // 书脊底色：仅应用到封面页（封底无书脊）
    if (hasCover) {
      for (let i = 0; i < newPages.length; i++) {
        if (isCoverPage(newPages[i])) newPages[i] = { ...newPages[i], spineColor };
      }
    }
    store.setPages(newPages);
    onClose();
  }, [coverCorners, coverUniform, hasCover, spineColor, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Enter 确认 / Esc 取消快捷键
  useDialogHotkeys({ onConfirm: handleConfirm, onCancel: handleCancel, enabled: open });

  // ═══ 重置：恢复本地默认为当前 store 实际值 ═══
  const handleReset = useCallback(() => {
    const s = useEditorStore.getState();
    const coverPage = s.pages.find((p) => isCoverOrBackCoverPage(p));
    const raw = coverPage?.slotCornerRadius;
    if (typeof raw === 'number') {
      setCoverCorners([raw, raw, raw, raw]);
      setCoverUniform(true);
    } else if (Array.isArray(raw)) {
      setCoverCorners(raw);
      setCoverUniform(raw.every((v) => v === raw[0]));
    }
    const coverOnlyPage = s.pages.find((p) => isCoverPage(p));
    setHasCover(!!coverOnlyPage);
    setSpineColor(coverOnlyPage?.spineColor || '#FFFFFF');
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/30"
      style={{ pointerEvents: 'auto' }}
      onClick={() => { if (!drag.dragging.current) handleCancel(); }}
      onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={drag.ref}
        className="absolute bg-white rounded-2xl w-[440px] max-w-[92vw] max-h-[90vh] flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.18)]"
        style={{ left: drag.pos.x || '50%', top: drag.pos.y || '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>

        {/* ── Header（可拖动） ── */}
        <div className="shrink-0 flex items-center justify-between px-7 pt-6 pb-4 border-b border-[var(--color-border-light)] cursor-grab active:cursor-grabbing"
          onMouseDown={drag.onDown}>
          <h2 className="text-[15px] font-[700] text-[#1e293b] tracking-tight">{t('editor.coverSettings.title')}</h2>
          <button onClick={handleCancel}
            className="w-6 h-6 flex items-center justify-center rounded-full border-none bg-transparent text-[var(--color-gray-400)] cursor-pointer hover:bg-[var(--color-gray-50)] hover:text-[var(--color-gray-600)] transition-colors">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5"><line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" /></svg>
          </button>
        </div>

        {/* ── 内容区（可滚动） ── */}
        <div
          ref={sb.ref}
          className={`flex-1 min-h-0 overflow-y-auto ps-scroll ${sb.className}`}
          {...sb.handlers}>
          <div className="pl-7 pr-[22px] py-5 space-y-5">

            {/* ── 封面/封底照片位圆角（独立设置，支持每角单独） ── */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.coverSettings.coverSlotRadius')}</span>
                <button
                  onClick={() => setCoverUniform(!coverUniform)}
                  className="text-[10px] font-[500] text-[var(--color-gray-400)] hover:text-[var(--color-brand)] transition-colors"
                >
                  {coverUniform ? t('editor.coverSettings.perCorner') : t('editor.coverSettings.uniform')}
                </button>
              </div>
              {coverUniform ? (
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={24} step={1} value={coverCorners[0]}
                    onChange={(e) => { const v = +e.target.value; setCoverCorners([v, v, v, v]); }}
                    className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
                  <div className="flex items-center gap-0.5 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                    <input type="number" min={0} max={24} value={coverCorners[0]}
                      onChange={(e) => { const v = clamp(+e.target.value, 0, 24); setCoverCorners([v, v, v, v]); }}
                      className="w-7 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                    <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">px</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {([['tl', 0, t('editor.coverSettings.cornerTL')], ['tr', 1, t('editor.coverSettings.cornerTR')], ['bl', 3, t('editor.coverSettings.cornerBL')], ['br', 2, t('editor.coverSettings.cornerBR')]] as const).map(([key, idx, label]) => (
                    <div key={key} className="flex items-center gap-2 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                      <span className="text-[10px] font-[500] text-[var(--color-gray-400)] w-8 shrink-0">{label}</span>
                      <input type="number" min={0} max={24} value={coverCorners[idx]}
                        onChange={(e) => {
                          const v = clamp(+e.target.value, 0, 24);
                          setCoverCorners(prev => { const next = [...prev] as [number, number, number, number]; next[idx] = v; return next; });
                        }}
                        className="w-8 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      <span className="text-[10px] text-[var(--color-gray-400)] font-[500]">px</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-[var(--color-border-light)]" />

            {/* ── 书脊底色（仅封面） ── */}
            {hasCover && (
              <div>
                <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('editor.coverSettings.spine')}</div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-[500] text-[var(--color-gray-500)] w-14 shrink-0">{t('editor.coverSettings.spineColor')}</span>
                  <input type="color" value={spineColor}
                    onChange={(e) => setSpineColor(e.target.value)}
                    className="w-9 h-8 rounded-md border border-[var(--color-border)] cursor-pointer bg-transparent p-0"
                  />
                  <input type="text" value={spineColor}
                    onChange={(e) => setSpineColor(e.target.value)}
                    className="flex-1 min-w-0 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5 text-[13px] font-[500] text-[#334155] outline-none border border-transparent focus:border-[var(--color-primary-300)]"
                    placeholder="#FFFFFF"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 flex items-center justify-between px-7 py-4 border-t border-[var(--color-border-light)] bg-[var(--color-gray-25)] rounded-b-2xl">
          <button onClick={handleReset}
            className="text-[12px] font-[500] text-[var(--color-gray-400)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-600)] transition-colors">{t('editor.coverSettings.resetDefault')}</button>
          <div className="flex gap-2">
            <button onClick={handleCancel}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[13px] font-[500] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">{t('common.cancel')}</button>
            <button onClick={handleConfirm}
              className="px-5 py-2 rounded-lg border-none bg-[var(--color-brand)] text-white text-[13px] font-[600] cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors shadow-[0_2px_8px_rgba(108,99,255,0.25)]">{t('common.confirm')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}