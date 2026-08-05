import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store';
import { useDraggable } from '../../hooks/useDraggable';
import { ModalGuard } from '../../utils/modal-guard';
import type { WatermarkSettings, LocationGranularity } from '../../types';
import { DEFAULT_WATERMARK_SETTINGS } from '../../types';
import { formatLocation } from '../../utils/watermarkRenderer';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WatermarkSettings({ open, onClose }: Props) {
  const drag = useDraggable(open);
  const { t } = useTranslation();

  // 影子状态
  const [enabled, setEnabled] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [locationGranularity, setLocationGranularity] = useState<LocationGranularity>('standard');
  const [includeModified, setIncludeModified] = useState(true);

  // 弹窗打开时从 Store 同步
  useEffect(() => {
    if (!open) return;
    const s = (useEditorStore.getState() as any).watermarkSettings as WatermarkSettings | undefined;
    const ws = s ?? DEFAULT_WATERMARK_SETTINGS;
    setEnabled(ws.enabled);
    setShowDate(ws.showDate);
    setShowLocation(ws.showLocation);
    setLocationGranularity(ws.locationGranularity ?? 'standard');
    setIncludeModified(ws.includeModified);
  }, [open]);

  useEffect(() => {
    if (open) ModalGuard.open();
    return () => { if (open) ModalGuard.close(); };
  }, [open]);

  // 预览文案
  const previewParts = [showDate ? '2026年3月21日' : ''];
  const previewRawLocation = '浙江省-杭州市-西湖区-灵隐街道';
  const previewLocation = showLocation ? formatLocation(previewRawLocation, locationGranularity) : '';
  if (previewLocation) previewParts.push(previewLocation);
  const preview = previewParts.filter(Boolean).join(' · ') || t('editor.watermark.previewEmpty');

  const handleConfirm = useCallback(() => {
    (useEditorStore.getState() as any).setWatermarkSettings?.({
      enabled,
      showDate,
      showLocation,
      includeModified,
      locationGranularity,
    });
    onClose();
  }, [enabled, showDate, showLocation, includeModified, locationGranularity, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/30"
      style={{ pointerEvents: 'auto' }}
      onClick={() => { if (!drag.dragging.current) handleCancel(); }}
      onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={drag.ref}
        className="absolute bg-white rounded-2xl w-[440px] max-w-[94vw] max-h-[92vh] flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.18)]"
        style={{ left: drag.pos.x || '50%', top: drag.pos.y || '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between px-7 pt-6 pb-4 border-b border-[var(--color-border-light)] cursor-grab active:cursor-grabbing"
          onMouseDown={drag.onDown}>
          <h2 className="text-[15px] font-[700] text-[#1e293b] tracking-tight">{t('editor.watermark.dialogTitle')}</h2>
          <button onClick={handleCancel}
            className="w-6 h-6 flex items-center justify-center rounded-full border-none bg-transparent text-[var(--color-gray-400)] cursor-pointer hover:bg-[var(--color-gray-50)] hover:text-[var(--color-gray-600)] transition-colors">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5"><line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" /></svg>
          </button>
        </div>

        {/* ── 内容区 ── */}
        <div className="px-7 py-5 space-y-5 overflow-y-auto">

          {/* ── 主开关 ── */}
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-[13px] font-[600] text-[#334155]">{t('editor.watermark.enableTimeWatermark')}</span>
            <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${enabled ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
              onClick={() => setEnabled(!enabled)}>
              <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                style={{ left: enabled ? 17.5 : 2.5 }} />
            </div>
          </label>

          {enabled && (
            <>
              <div className="h-px bg-[var(--color-border-light)]" />

              {/* ── 显示内容 ── */}
              <div>
                <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-3">{t('editor.watermark.showContent')}</div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer select-none">
                    <span className="text-[12px] font-[500] text-[#334155]">{t('editor.watermark.date')}</span>
                    <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${showDate ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                      onClick={() => setShowDate(!showDate)}>
                      <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                        style={{ left: showDate ? 17.5 : 2.5 }} />
                    </div>
                  </label>
                  <label className="flex items-center justify-between cursor-pointer select-none">
                    <span className="text-[12px] font-[500] text-[#334155]">{t('editor.watermark.location')} <span className="text-[10px] text-[var(--color-gray-400)] font-[400]">{t('editor.watermark.locationGpsHint')}</span></span>
                    <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${showLocation ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                      onClick={() => setShowLocation(!showLocation)}>
                      <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                        style={{ left: showLocation ? 17.5 : 2.5 }} />
                    </div>
                  </label>

                  {showLocation && (
                    <div className="ml-1 mt-2">
                      <div className="text-[10px] text-[var(--color-gray-400)] mb-1.5">{t('editor.watermark.locationGranularity')}</div>
                      <div className="flex gap-2">
                        {([
                          { key: 'coarse', label: t('editor.watermark.coarse'), desc: t('editor.watermark.coarseDesc') },
                          { key: 'standard', label: t('editor.watermark.standard'), desc: t('editor.watermark.standardDesc') },
                          { key: 'detailed', label: t('editor.watermark.detailed'), desc: t('editor.watermark.detailedDesc') },
                        ] as { key: LocationGranularity; label: string; desc: string }[]).map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setLocationGranularity(item.key)}
                            className={`flex-1 text-left px-2.5 py-2 rounded-lg border transition-all duration-200 ${
                              locationGranularity === item.key
                                ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)]'
                                : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:border-[var(--color-gray-300)]'
                            }`}
                          >
                            <div className="text-[11px] font-[600]">{item.label}</div>
                            <div className="text-[9px] mt-0.5 opacity-80">{item.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-px bg-[var(--color-border-light)]" />

              {/* ── 高级选项 ── */}
              <div>
                <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-3">{t('editor.watermark.advancedOptions')}</div>
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <div>
                    <span className="text-[12px] font-[500] text-[#334155]">{t('editor.watermark.includeModifiedLabel')}</span>
                    <p className="text-[10px] text-[var(--color-gray-400)] mt-0.5">{t('editor.watermark.includeModifiedHint')}</p>
                  </div>
                  <div className={`w-[36px] h-[21px] rounded-full relative transition-colors shrink-0 ${includeModified ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                    onClick={() => setIncludeModified(!includeModified)}>
                    <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                      style={{ left: includeModified ? 17.5 : 2.5 }} />
                  </div>
                </label>
              </div>

              {/* ── 预览 ── */}
              <div className="h-px bg-[var(--color-border-light)]" />
              <div>
                <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2">{t('editor.watermark.preview')}</div>
                <div className="bg-[var(--color-gray-50)] rounded-lg px-4 py-3 text-center">
                  <span className="text-[13px] text-[var(--color-gray-600)] font-[400] italic tracking-wide">
                    {preview}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-7 py-4 border-t border-[var(--color-border-light)] bg-[var(--color-gray-25)] rounded-b-2xl">
          <button onClick={handleCancel}
            className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[13px] font-[500] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">{t('common.cancel')}</button>
          <button onClick={handleConfirm}
            className="px-5 py-2 rounded-lg border-none bg-[var(--color-brand)] text-white text-[13px] font-[600] cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors shadow-[0_2px_8px_rgba(108,99,255,0.25)]">{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
