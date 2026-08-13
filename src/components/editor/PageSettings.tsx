import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { PAGE_MARGIN_MIN, PAGE_MARGIN_MAX, PAGE_GAP_MIN, PAGE_GAP_MAX, PAGE_GAP_DEFAULT, DEFAULT_SLOT_CORNER_RADIUS, SIZE_PRESETS, PAGE_MARGIN_PRESETS, CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX, isCoverOrBackCoverPage, normalizeSlotCornerRadius } from '../../types';
import type { PageMarginSettings, AlbumSize, AlbumPage } from '../../types';
import { useDraggable } from '../../hooks/useDraggable';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useWheel } from '../../hooks/useWheel';
import { useDialogHotkeys } from '../../hooks/useDialogHotkeys';
import { ModalGuard } from '../../utils/modal-guard';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 页面尺寸软边界（超出仅提示，不阻止保存）
const PAGE_SIZE_SOFT_MIN = 50;  // mm
const PAGE_SIZE_SOFT_MAX = 500; // mm
const CUSTOM_SIZE_ID = 'custom';

const DEFAULT: PageMarginSettings = { top: 15, bottom: 15, left: 15, right: 15 };

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export function PageSettings({ open, onClose }: Props) {
  const albumSize = useEditorStore((s) => s.albumSize);
  const drag = useDraggable(open);
  const { t } = useTranslation();

  // ═══ 影子状态：所有设置暂存本地，确认后批量写入 Store ═══
  const [uniform, setUniform] = useState(true);
  const [margin, setMargin] = useState(DEFAULT);
  const [gap, setGap] = useState(PAGE_GAP_DEFAULT);
  const [cornerRadius, setCornerRadius] = useState(DEFAULT_SLOT_CORNER_RADIUS);
  // 封面/封底照片位圆角：支持每角单独设置 [tl, tr, br, bl]
  const [coverCorners, setCoverCorners] = useState<[number, number, number, number]>([4, 4, 4, 4]);
  const [coverUniform, setCoverUniform] = useState(true);
  const gapInputRef = useRef<HTMLInputElement>(null);
  const radiusInputRef = useRef<HTMLInputElement>(null);

  // React 19 将 onWheel 设为 passive，preventDefault 会报警告；改用原生非 passive 监听
  useWheel(gapInputRef, (e) => {
    e.preventDefault();
    setGap(g => clamp(g + (e.deltaY < 0 ? 1 : -1), PAGE_GAP_MIN, PAGE_GAP_MAX));
  });
  useWheel(radiusInputRef, (e) => {
    e.preventDefault();
    setCornerRadius(r => clamp(r + (e.deltaY < 0 ? 1 : -1), 0, 24));
  });

  const [applyAll, setApplyAll] = useState(false);
  const [showGuidesLocal, setShowGuidesLocal] = useState(false);
  const [showMarginLocal, setShowMarginLocal] = useState(false);

  // 页面尺寸：当前选中的预设 id（'custom' 表示自定义）
  const [sizePresetId, setSizePresetId] = useState<string>(CUSTOM_SIZE_ID);
  const [customW, setCustomW] = useState(210);
  const [customH, setCustomH] = useState(210);
  // 尺寸选项展开状态：默认只显示当前尺寸，点击"修改页面"后展开全部
  const [showSizeOptions, setShowSizeOptions] = useState(false);

  // 弹窗打开时从 Store 同步到本地
  useEffect(() => {
    if (!open) return;
    const s = useEditorStore.getState();
    setMargin(s.pageMargin);
    setGap(s.slotGap);
    setCornerRadius(normalizeSlotCornerRadius(s.pages[s.currentPageIndex]?.slotCornerRadius));
    setApplyAll(s.applyMarginToAll);
    setShowGuidesLocal(s.showGuides);
    setShowMarginLocal(s.showMarginGuide);
    // 同步封面/封底圆角：从第一个封面/封底页读取
    const coverPage = s.pages.find((p) => isCoverOrBackCoverPage(p));
    const rawCover = coverPage?.slotCornerRadius;
    if (typeof rawCover === 'number') {
      setCoverCorners([rawCover, rawCover, rawCover, rawCover]);
      setCoverUniform(true);
    } else if (Array.isArray(rawCover)) {
      setCoverCorners(rawCover);
      setCoverUniform(rawCover.every((v) => v === rawCover[0]));
    } else {
      setCoverCorners([4, 4, 4, 4]);
      setCoverUniform(true);
    }
    // 每次打开弹窗时重置为折叠态（只显示当前尺寸）
    setShowSizeOptions(false);

    // 反查当前 albumSize 匹配的预设（与 CreateDialog 使用同一份 SIZE_PRESETS）
    const cur = s.albumSize;
    if (!cur) return;
    const matched = SIZE_PRESETS.find((p) => p.width === cur.width && p.height === cur.height);
    if (matched) {
      setSizePresetId(matched.id);
    } else {
      setSizePresetId(CUSTOM_SIZE_ID);
    }
    setCustomW(cur.width);
    setCustomH(cur.height);
  }, [open]);

  useEffect(() => {
    if (open) ModalGuard.open();
    return () => { if (open) ModalGuard.close(); };
  }, [open]);

  // ═══ 内容区滚动条自动隐藏（悬浮不占位）═══
  const sb = useScrollbarVisibility<HTMLDivElement>();

  // ═══ 确认：批量写入所有本地设置到 Store（一次性，避免中间态跳变）═══
  const handleConfirm = useCallback(() => {
    // ── 页面尺寸：组装新的 AlbumSize 并写入 ──
    const preset = SIZE_PRESETS.find((p) => p.id === sizePresetId);
    let nextSize: AlbumSize;
    if (sizePresetId === CUSTOM_SIZE_ID || !preset) {
      // 自定义：宽高取自本地状态（确保正数）
      const w = Math.max(1, Math.round(customW));
      const h = Math.max(1, Math.round(customH));
      nextSize = { id: CUSTOM_SIZE_ID, name: t('editor.pageSettings.customSizeName'), width: w, height: h, desc: t('editor.pageSettings.customSizeDesc', { w, h }) };
    } else {
      nextSize = { id: preset.id, name: preset.name, width: preset.width, height: preset.height, desc: preset.desc };
    }

    // 软边界检查：超出仅提示，不阻止保存
    if (nextSize.width < PAGE_SIZE_SOFT_MIN || nextSize.height < PAGE_SIZE_SOFT_MIN
      || nextSize.width > PAGE_SIZE_SOFT_MAX || nextSize.height > PAGE_SIZE_SOFT_MAX) {
      useUIStore.getState().addToast({
        type: 'warning',
        message: t('editor.pageSettings.sizeOutOfRange', { min: PAGE_SIZE_SOFT_MIN, max: PAGE_SIZE_SOFT_MAX }),
      });
    }

    useEditorStore.getState().setAlbumSize(nextSize);
    useEditorStore.getState().batchPageSettings({
      margin, gap, cornerRadius, applyAll,
      showGuides: showGuidesLocal, showMarginGuide: showMarginLocal,
    });

    // 封面/封底圆角：独立应用，不受 applyAll 影响
    const cornerValue: number | [number, number, number, number] = coverUniform
      ? coverCorners[0]
      : coverCorners;
    const store = useEditorStore.getState();
    const newPages = store.pages.map((p: AlbumPage) =>
      isCoverOrBackCoverPage(p) ? { ...p, slotCornerRadius: cornerValue } : p
    );
    store.setPages(newPages);

    onClose();
  }, [sizePresetId, customW, customH, margin, gap, cornerRadius, applyAll, showGuidesLocal, showMarginLocal, coverCorners, coverUniform, onClose]);

  // ═══ 取消：丢弃所有本地修改，直接关闭 ═══
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Enter 确认 / Esc 取消快捷键
  useDialogHotkeys({ onConfirm: handleConfirm, onCancel: handleCancel, enabled: open });

  // ═══ 重置：将本地状态恢复默认（不写 Store，等确认）═══
  const handleReset = useCallback(() => {
    setUniform(true);
    setMargin(DEFAULT);
    setGap(PAGE_GAP_DEFAULT);
    setCornerRadius(DEFAULT_SLOT_CORNER_RADIUS);
    setCoverCorners([4, 4, 4, 4]);
    setCoverUniform(true);
    setApplyAll(false);
    setShowGuidesLocal(false);
    setShowMarginLocal(false);
    // 页面尺寸回到当前 store 实际值
    const cur = useEditorStore.getState().albumSize;
    if (!cur) return;
    const matched = SIZE_PRESETS.find((p) => p.width === cur.width && p.height === cur.height);
    setSizePresetId(matched?.id ?? CUSTOM_SIZE_ID);
    setCustomW(cur.width);
    setCustomH(cur.height);
    setShowSizeOptions(false);
  }, []);

  // 统一边距更新（只改本地）
  const setUniformMargin = useCallback((val: number) => {
    const m = { top: val, bottom: val, left: val, right: val };
    setMargin(m);
  }, []);

  const setSingleMargin = useCallback((key: keyof PageMarginSettings, val: number) => {
    setMargin((prev) => ({ ...prev, [key]: val }));
  }, []);

  if (!open || !albumSize) return null;

  // 预览跟随本地选中的尺寸（未确认也能看到新尺寸的画布比例）
  const activePreset = SIZE_PRESETS.find((p) => p.id === sizePresetId);
  const previewW = sizePresetId === CUSTOM_SIZE_ID || !activePreset ? Math.max(1, customW) : activePreset.width;
  const previewH = sizePresetId === CUSTOM_SIZE_ID || !activePreset ? Math.max(1, customH) : activePreset.height;
  const pw = previewW, ph = previewH;
  const sl = (margin.left / pw) * 100, st = (margin.top / ph) * 100;
  const sw = 100 - sl - (margin.right / pw) * 100, sh = 100 - st - (margin.bottom / ph) * 100;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/30"
      style={{ pointerEvents: 'auto' }}
      onClick={() => { if (!drag.dragging.current) handleCancel(); }}
      onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={drag.ref}
        className="absolute bg-white rounded-2xl w-[560px] max-w-[94vw] max-h-[92vh] flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.18)]"
        style={{ left: drag.pos.x || '50%', top: drag.pos.y || '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>

        {/* ── Header（固定顶部，可拖动） ── */}
        <div className="shrink-0 flex items-center justify-between px-7 pt-6 pb-4 border-b border-[var(--color-border-light)] cursor-grab active:cursor-grabbing"
          onMouseDown={drag.onDown}>
          <h2 className="text-[15px] font-[700] text-[#1e293b] tracking-tight">{t('editor.pageSettings.title')}</h2>
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

          {/* ── 预览（固定 2×2 栅格示意，居中）── */}
          <div className="flex justify-center">
              <div className="w-[120px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-canvas)] relative overflow-hidden"
                style={{ height: Math.round(120 * (ph / pw)) }}>
                <div className="absolute inset-0 bg-[var(--color-surface-canvas)]" />
                {/* 安全区虚线 */}
                <div className="absolute rounded-[1px] border-[1.5px] border-dashed border-[var(--color-brand)] bg-[var(--color-primary-50)]/20"
                  style={{ left: `${sl}%`, top: `${st}%`, width: `${sw}%`, height: `${sh}%` }} />
                {/* 固定 2×2 栅格槽位 */}
                {(() => {
                  const gapPctX = Math.min((gap / pw) * 100, sw * 0.25);
                  const gapPctY = Math.min((gap / ph) * 100, sh * 0.25);
                  const slotW = (sw - gapPctX) / 2;
                  const slotH = (sh - gapPctY) / 2;
                  const slots = [
                    { x: sl, y: st },
                    { x: sl + slotW + gapPctX, y: st },
                    { x: sl, y: st + slotH + gapPctY },
                    { x: sl + slotW + gapPctX, y: st + slotH + gapPctY },
                  ];
                  return slots.map((s, i) => (
                    <div key={i}
                      className="absolute bg-[var(--color-primary-200)]/70 border border-[var(--color-primary-300)]/50"
                      style={{
                        left: `${s.x}%`, top: `${s.y}%`,
                        width: `${slotW}%`, height: `${slotH}%`,
                        borderRadius: `${cornerRadius}px`,
                      }}
                    />
                  ));
                })()}
                {gap > 0 && (
                  <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 bg-white/80 rounded-[2px] px-1 py-0.5 shadow-sm">
                    <svg viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-2 h-1.5 text-[var(--color-brand)]">
                      <line x1="1" y1="1" x2="7" y2="1" /><line x1="1" y1="5" x2="7" y2="5" /><line x1="4" y1="1" x2="4" y2="5" />
                    </svg>
                    <span className="text-[6px] text-[var(--color-brand)] font-[600]">{gap}</span>
                  </div>
                )}
                {cornerRadius > 0 && (
                  <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 bg-white/80 rounded-[2px] px-1 py-0.5 shadow-sm">
                    <svg viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-1.5 h-1.5 text-[var(--color-brand)]">
                      <path d="M5 5V3A3 3 0 003 0H1" strokeLinecap="round" />
                    </svg>
                    <span className="text-[6px] text-[var(--color-brand)] font-[600]">{cornerRadius}</span>
                  </div>
                )}
                <span className="absolute bottom-0.5 right-1.5 text-[8px] text-[var(--color-gray-300)] font-[500]">{pw}×{ph}</span>
              </div>
          </div>

          <div className="h-px bg-[var(--color-border-light)]" />

          {/* ── 页面尺寸 ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.pageSettings.pageSize')}</div>
              {!showSizeOptions && (
                <button
                  onClick={() => setShowSizeOptions(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-white text-[11px] font-[500] text-[var(--color-gray-600)] cursor-pointer hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] hover:bg-[var(--color-primary-50)] transition-all"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                    <path d="M8.5 2.5l3 3-3 3" /><path d="M11.5 5.5H4" /><path d="M3.5 9.5l-3-3 3-3" /><path d="M0.5 6.5H8" />
                  </svg>
                  {t('editor.pageSettings.modifyPage')}
                </button>
              )}
              {showSizeOptions && (
                <button
                  onClick={() => setShowSizeOptions(false)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-white text-[11px] font-[500] text-[var(--color-gray-500)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-all"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                    <path d="M2 5l4-3 4 3" /><path d="M6 2v8" />
                  </svg>
                  {t('editor.pageSettings.collapseSizes')}
                </button>
              )}
            </div>

            {/* 折叠态：仅显示当前尺寸 */}
            {!showSizeOptions && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--color-gray-50)] border border-[var(--color-border-light)]">
                <div className="w-10 h-10 rounded-md bg-white border border-[var(--color-border)] flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-[var(--color-gray-400)]">
                    <rect x="4" y="4" width="16" height="16" rx="1" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  {(() => {
                    const cur = SIZE_PRESETS.find((p) => p.id === sizePresetId);
                    if (cur) {
                      return (
                        <>
                          <div className="text-[13px] font-[600] text-[#334155]">{cur.name}</div>
                          <div className="text-[11px] text-[var(--color-gray-400)]">{cur.desc}</div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div className="text-[13px] font-[600] text-[#334155]">{t('editor.pageSettings.customSizeName')}</div>
                        <div className="text-[11px] text-[var(--color-gray-400)]">{customW}×{customH} mm</div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* 展开态：显示全部尺寸预设（与创建新相册弹窗一致） */}
            {showSizeOptions && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {SIZE_PRESETS.map((preset) => {
                    const active = sizePresetId === preset.id;
                    return (
                      <div key={preset.id} onClick={() => { setSizePresetId(preset.id); setCustomW(preset.width); setCustomH(preset.height); }}
                        title={preset.desc}
                        className={`p-2.5 rounded-lg text-center cursor-pointer border transition-all duration-150 ${
                          active
                            ? 'border-[var(--color-brand)] border-2 bg-[var(--color-primary-50)] shadow-[0_1px_3px_rgba(108,99,255,0.15)]'
                            : 'border-[var(--color-border)] bg-white hover:border-[var(--color-gray-300)] hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)]'
                        }`}>
                        <div className={`text-[12px] font-[600] leading-tight truncate ${active ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-700)]'}`}>{preset.name}</div>
                        <div className="text-[10px] text-[var(--color-gray-400)] mt-0.5">{preset.desc}</div>
                      </div>
                    );
                  })}
                  <div onClick={() => { setSizePresetId(CUSTOM_SIZE_ID); }}
                    className={`p-2.5 rounded-lg text-center cursor-pointer border transition-all duration-150 ${
                      sizePresetId === CUSTOM_SIZE_ID
                        ? 'border-[var(--color-brand)] border-2 bg-[var(--color-primary-50)] shadow-[0_1px_3px_rgba(108,99,255,0.15)]'
                        : 'border-dashed border-[var(--color-gray-300)] bg-[var(--color-gray-25)] hover:border-[var(--color-primary-400)] hover:bg-[var(--color-primary-50)]'
                    }`}>
                    <div className={`text-[12px] font-[600] ${sizePresetId === CUSTOM_SIZE_ID ? 'text-[var(--color-brand)]' : 'text-[var(--color-gray-500)]'}`}>{t('editor.pageSettings.customSizeName')}</div>
                    <div className="text-[10px] text-[var(--color-gray-400)] mt-0.5">{customW}×{customH}</div>
                  </div>
                </div>
                {sizePresetId === CUSTOM_SIZE_ID && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5 min-w-[88px]">
                      <span className="text-[10px] text-[var(--color-gray-400)] font-[500]">{t('editor.pageSettings.width')}</span>
                      <input type="number" min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} value={customW}
                        onChange={(e) => setCustomW(+e.target.value || 0)}
                        className="w-12 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      <span className="text-[10px] text-[var(--color-gray-400)] font-[500]">mm</span>
                    </div>
                    <span className="text-[var(--color-gray-300)] font-[500]">×</span>
                    <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5 min-w-[88px]">
                      <span className="text-[10px] text-[var(--color-gray-400)] font-[500]">{t('editor.pageSettings.height')}</span>
                      <input type="number" min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} value={customH}
                        onChange={(e) => setCustomH(+e.target.value || 0)}
                        className="w-12 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      <span className="text-[10px] text-[var(--color-gray-400)] font-[500]">mm</span>
                    </div>
                    {(customW < PAGE_SIZE_SOFT_MIN || customH < PAGE_SIZE_SOFT_MIN
                      || customW > PAGE_SIZE_SOFT_MAX || customH > PAGE_SIZE_SOFT_MAX) && (
                      <span className="text-[10px] text-[var(--color-warning, #f59e0b)] font-[500]">
                        {t('editor.pageSettings.recommendedRange', { min: PAGE_SIZE_SOFT_MIN, max: PAGE_SIZE_SOFT_MAX })}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="h-px bg-[var(--color-border-light)]" />

          {/* ── 快捷预设 ── */}
          <div>
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('editor.pageSettings.quickPresets')}</div>
            <div className="flex gap-1.5">
              {PAGE_MARGIN_PRESETS.map((p) => (
                <button key={p.label}
                  className={`px-3 py-1.5 rounded-lg border text-[12px] font-[500] cursor-pointer transition-all ${
                    margin.top === p.margin && gap === p.gap && cornerRadius === p.cornerRadius && uniform
                      ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)] shadow-[0_1px_3px_rgba(108,99,255,0.15)]'
                      : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)] hover:text-[var(--color-gray-700)]'
                  }`}
                  onClick={() => {
                    setUniform(true);
                    setUniformMargin(p.margin);
                    setGap(p.gap);
                    setCornerRadius(p.cornerRadius);
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── 统一边距 ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.pageSettings.margin')}</div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <span className="text-[10px] text-[var(--color-gray-400)]">{t('editor.pageSettings.independentSides')}</span>
                <div className={`w-[34px] h-[20px] rounded-full relative transition-colors ${uniform ? 'bg-[var(--color-gray-200)]' : 'bg-[var(--color-brand)]'}`}
                  onClick={() => setUniform(!uniform)}>
                  <div className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                    style={{ left: uniform ? 2 : 16 }} />
                </div>
              </label>
            </div>

            {uniform ? (
              <div className="flex items-center gap-3">
                <input type="range" min={PAGE_MARGIN_MIN} max={PAGE_MARGIN_MAX} step={1} value={margin.top}
                  onChange={(e) => setUniformMargin(+e.target.value)}
                  className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)] rounded-full" />
                <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5 min-w-[56px]">
                  <input type="number" min={PAGE_MARGIN_MIN} max={PAGE_MARGIN_MAX} value={margin.top}
                    onChange={(e) => setUniformMargin(+e.target.value)}
                    className="w-8 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">mm</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {(['top', 'bottom', 'left', 'right'] as const).map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[11px] font-[600] text-[var(--color-gray-400)] w-4 text-center">
                      {{ top: t('editor.pageSettings.top'), bottom: t('editor.pageSettings.bottom'), left: t('editor.pageSettings.left'), right: t('editor.pageSettings.right') }[key]}
                    </span>
                    <input type="range" min={PAGE_MARGIN_MIN} max={PAGE_MARGIN_MAX} step={1} value={margin[key]}
                      onChange={(e) => setSingleMargin(key, +e.target.value)}
                      className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
                    <div className="flex items-center gap-0.5 bg-[var(--color-gray-50)] rounded-md px-1.5 py-0.5 min-w-[44px]">
                      <input type="number" min={PAGE_MARGIN_MIN} max={PAGE_MARGIN_MAX} value={margin[key]}
                        onChange={(e) => setSingleMargin(key, +e.target.value)}
                        className="w-7 border-none bg-transparent text-[12px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="h-px bg-[var(--color-border-light)]" />

          {/* ── 槽位间距 ── */}
          <div>
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('editor.pageSettings.slotGap')}</div>
            <div className="flex items-center gap-3">
              <input type="range" min={PAGE_GAP_MIN} max={PAGE_GAP_MAX} step={1} value={gap}
                onChange={(e) => setGap(+e.target.value)}
                className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              <div className="flex items-center gap-0.5 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                <input ref={gapInputRef} type="number" min={PAGE_GAP_MIN} max={PAGE_GAP_MAX} value={gap}
                  onChange={(e) => setGap(+e.target.value)}
                  className="w-8 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">mm</span>
              </div>
            </div>
          </div>

          {/* ── 槽位圆角 ── */}
          <div>
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('editor.pageSettings.slotRadius')}</div>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={24} step={1} value={cornerRadius}
                onChange={(e) => setCornerRadius(+e.target.value)}
                className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              <div className="flex items-center gap-0.5 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                <input ref={radiusInputRef} type="number" min={0} max={24} value={cornerRadius}
                  onChange={(e) => setCornerRadius(+e.target.value)}
                  className="w-7 border-none bg-transparent text-[13px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">px</span>
              </div>
            </div>
          </div>

          <div className="h-px bg-[var(--color-border-light)]" />

          {/* ── 封面/封底照片位圆角（独立设置，支持每角单独）── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.pageSettings.coverSlotRadius')}</span>
              <button
                onClick={() => setCoverUniform(!coverUniform)}
                className="text-[10px] font-[500] text-[var(--color-gray-400)] hover:text-[var(--color-brand)] transition-colors"
              >
                {coverUniform ? t('editor.pageSettings.perCorner') : t('editor.pageSettings.uniform')}
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
                {([['tl', 0, t('editor.pageSettings.cornerTL')], ['tr', 1, t('editor.pageSettings.cornerTR')], ['bl', 3, t('editor.pageSettings.cornerBL')], ['br', 2, t('editor.pageSettings.cornerBR')]] as const).map(([key, idx, label]) => (
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

          {/* ── 开关 ── */}
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer select-none">
              <span className="text-[12px] font-[500] text-[#334155]">{t('editor.pageSettings.applyToAll')}</span>
              <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${applyAll ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                onClick={() => setApplyAll(!applyAll)}>
                <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                  style={{ left: applyAll ? 17.5 : 2.5 }} />
              </div>
            </label>
            <label className="flex items-center justify-between cursor-pointer select-none">
              <span className="text-[12px] font-[500] text-[#334155]">{t('editor.pageSettings.marginGuide')}</span>
              <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${showMarginLocal ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                onClick={() => setShowMarginLocal(!showMarginLocal)}>
                <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                  style={{ left: showMarginLocal ? 17.5 : 2.5 }} />
              </div>
            </label>
            <label className="flex items-center justify-between cursor-pointer select-none">
              <span className="text-[12px] font-[500] text-[#334155]">{t('editor.pageSettings.guides')}</span>
              <div className={`w-[36px] h-[21px] rounded-full relative transition-colors ${showGuidesLocal ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-gray-200)]'}`}
                onClick={() => setShowGuidesLocal(!showGuidesLocal)}>
                <div className="absolute top-[2.5px] w-[16px] h-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all"
                  style={{ left: showGuidesLocal ? 17.5 : 2.5 }} />
              </div>
            </label>
          </div>
        </div>
        </div>

        {/* ── Footer（固定底部） ── */}
        <div className="shrink-0 flex items-center justify-between px-7 py-4 border-t border-[var(--color-border-light)] bg-[var(--color-gray-25)] rounded-b-2xl">
          <button onClick={handleReset}
            className="text-[12px] font-[500] text-[var(--color-gray-400)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-600)] transition-colors">{t('editor.pageSettings.resetDefault')}</button>
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
