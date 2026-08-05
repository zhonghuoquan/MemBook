import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import {
  SIZE_PRESETS, type SizePreset,
  ALBUM_TYPES, type AlbumTypeId,
  CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX, CUSTOM_SIZE_STEP, CUSTOM_SIZE_DEFAULT,
  PAGE_MARGIN_MIN, PAGE_MARGIN_MAX,
  PAGE_GAP_MIN, PAGE_GAP_MAX,
  PAGE_MARGIN_PRESETS,
} from '../../types';
import type { AlbumSize, PageMargin } from '../../types';

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    size: AlbumSize,
    margin: PageMargin,
    albumType?: AlbumTypeId,
    description?: string,
    cornerRadius?: number,
  ) => void;
  title?: string;
}

// 快捷预设默认"标准"：{ margin: 15, gap: 5, cornerRadius: 8 }
const STANDARD_PRESET = PAGE_MARGIN_PRESETS.find((p) => p.label === '标准')!;

export function CreateDialog({ open, onClose, onCreate, title }: CreateDialogProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('home.createDialog.title');
  const [name, setName] = useState('');
  const [albumType, setAlbumType] = useState<AlbumTypeId | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<SizePreset>(SIZE_PRESETS[0]);
  const [isCustom, setIsCustom] = useState(false);
  const [customW, setCustomW] = useState(CUSTOM_SIZE_DEFAULT);
  const [customH, setCustomH] = useState(CUSTOM_SIZE_DEFAULT);
  const [marginVal, setMarginVal] = useState(STANDARD_PRESET.margin);
  const [gapVal, setGapVal] = useState(STANDARD_PRESET.gap);
  const [cornerRadius, setCornerRadius] = useState(STANDARD_PRESET.cornerRadius);
  const [flipped, setFlipped] = useState(false);

  // 弹窗每次打开时复位所有状态为默认值
  useEffect(() => {
    if (!open) return;
    setName('');
    setAlbumType(undefined);
    setDescription('');
    setSelectedPreset(SIZE_PRESETS[0]);
    setIsCustom(false);
    setFlipped(false);
    setCustomW(CUSTOM_SIZE_DEFAULT);
    setCustomH(CUSTOM_SIZE_DEFAULT);
    setMarginVal(STANDARD_PRESET.margin);
    setGapVal(STANDARD_PRESET.gap);
    setCornerRadius(STANDARD_PRESET.cornerRadius);
  }, [open]);

  const currentSize = useMemo((): { width: number; height: number } => {
    if (isCustom) return { width: customW, height: customH };
    if (flipped && selectedPreset.orientation !== 'square')
      return { width: selectedPreset.height, height: selectedPreset.width };
    return { width: selectedPreset.width, height: selectedPreset.height };
  }, [isCustom, customW, customH, selectedPreset, flipped]);

  const handleFlip = () => {
    if (isCustom) { setCustomW(currentSize.height); setCustomH(currentSize.width); }
    else if (selectedPreset.orientation !== 'square') setFlipped(!flipped);
  };

  const handleCreate = () => {
    const albumName = name.trim() || t('home.createDialog.unnamedAlbum');
    const finalSize: AlbumSize = isCustom
      ? { id: 'custom', name: t('home.createDialog.custom'), width: currentSize.width, height: currentSize.height, desc: `${currentSize.width}×${currentSize.height} mm` }
      : {
          id: flipped ? `${selectedPreset.id}-flipped` : selectedPreset.id,
          name: flipped ? `${selectedPreset.name}${t('home.createDialog.flipped')}` : selectedPreset.name,
          width: currentSize.width, height: currentSize.height,
          desc: `${currentSize.width}×${currentSize.height} mm`,
        };
    onCreate(albumName, finalSize, { margin: marginVal, gap: gapVal }, albumType, description.trim() || undefined, cornerRadius);
    setName(''); setAlbumType(undefined); setDescription('');
    setSelectedPreset(SIZE_PRESETS[0]); setIsCustom(false); setFlipped(false);
    setCustomW(CUSTOM_SIZE_DEFAULT); setCustomH(CUSTOM_SIZE_DEFAULT);
    setMarginVal(STANDARD_PRESET.margin); setGapVal(STANDARD_PRESET.gap);
    setCornerRadius(STANDARD_PRESET.cornerRadius);
    onClose();
  };

  const canCreate = isCustom ? customW >= CUSTOM_SIZE_MIN && customH >= CUSTOM_SIZE_MIN : true;

  const previewMaxW = 140, previewMaxH = 94;
  const previewScale = Math.min(previewMaxW / currentSize.width, previewMaxH / currentSize.height);
  const previewW = Math.round(currentSize.width * previewScale);
  const previewH = Math.round(currentSize.height * previewScale);

  const marginPx = useMemo(() => Math.round((marginVal / PAGE_MARGIN_MAX) * Math.min(previewW, previewH) * 0.25), [marginVal, previewW, previewH]);
  const gapPx = useMemo(() => Math.round((gapVal / PAGE_GAP_MAX) * Math.min(previewW, previewH) * 0.12), [gapVal, previewW, previewH]);

  const contentW = useMemo(() => Math.max(previewW - marginPx * 2, 4), [previewW, marginPx]);
  const contentH = useMemo(() => Math.max(previewH - marginPx * 2, 4), [previewH, marginPx]);
  const cellW = useMemo(() => Math.max(Math.floor((contentW - gapPx) / 2), 1), [contentW, gapPx]);
  const cellH = useMemo(() => Math.max(Math.floor((contentH - gapPx) / 2), 1), [contentH, gapPx]);

  const orientationLabel = useMemo(() => {
    if (currentSize.width > currentSize.height) return t('home.createDialog.orientationHorizontal');
    if (currentSize.height > currentSize.width) return t('home.createDialog.orientationVertical');
    return t('home.createDialog.orientationSquare');
  }, [currentSize, t]);

  const ratioLabel = useMemo(() => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(currentSize.width, currentSize.height);
    return `${currentSize.width / g}:${currentSize.height / g}`;
  }, [currentSize]);

  const canFlip = (!isCustom && selectedPreset.orientation !== 'square') || isCustom;

  return (
    <Modal open={open} onClose={onClose} title={resolvedTitle} maxWidth="640px"
      footer={
        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--color-border-light)]">
          <Button variant="secondary" onClick={onClose}>{t('home.createDialog.cancel')}</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canCreate}>{t('home.createDialog.create')}</Button>
        </div>
      }
    >
      <div className="space-y-5">

        {/* 相册名称 */}
        <div>
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('home.createDialog.albumName')}</label>
          <input type="text" className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--text-body)] text-[var(--color-gray-800)] placeholder:text-[var(--color-text-tertiary)] outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)] transition-all" placeholder={t('home.createDialog.albumNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={30} />
        </div>

        {/* ═══════ 相册类型 + 尺寸预览（左右排版，统一高度） ═══════ */}
        <div className="flex gap-4 items-stretch">
          {/* 左侧：相册类型 — 窄两列，垂直居中 */}
          <div className="w-[38%] shrink-0 flex flex-col">
            <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2">{t('home.createDialog.albumType')}</label>
            <div className="grid grid-cols-2 gap-1.5 flex-1 content-center">
              {ALBUM_TYPES.map((type) => {
                const sel = albumType === type.id;
                return (
                  <button key={type.id} onClick={() => setAlbumType(sel ? undefined : type.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-md)] border text-[var(--text-caption)] font-[500] cursor-pointer transition-all duration-150
                      ${sel ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)] shadow-[var(--shadow-xs)]' : 'bg-white text-[var(--color-gray-600)] border-[var(--color-border)] hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)]'}`}>
                    <span className="text-xs leading-none">{type.icon}</span>{type.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧：预览示意图 + 页面信息 */}
          <div className="flex-1 flex gap-3 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)] p-3">
            {/* 预览矩形 */}
            <div className="relative flex items-center justify-center bg-white rounded-[var(--radius-md)] border border-[var(--color-border)]" style={{ width: previewMaxW + 16, height: previewMaxH + 16 }}>
              {/* 页面背景 — 模拟整页 */}
              <div className="rounded-[var(--radius-xs)] bg-[var(--color-primary-50)] border-2 border-[var(--color-primary-300)] flex items-center justify-center"
                style={{ width: previewW, height: previewH, transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }}>
                {/* 内容区（扣除边距） */}
                <div className="flex items-center justify-center bg-white rounded-[1px]"
                  style={{ width: contentW, height: contentH, transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }}>
                  {/* 2×2 排版网格（体现间距） */}
                  <div className="flex flex-col" style={{ gap: `${gapPx}px`, width: cellW * 2 + gapPx, height: cellH * 2 + gapPx }}>
                    <div className="flex" style={{ gap: `${gapPx}px` }}>
                      <div className="rounded-[1px]" style={{ width: cellW, height: cellH, background: 'var(--color-primary-200)', transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }} />
                      <div className="rounded-[1px]" style={{ width: cellW, height: cellH, background: 'var(--color-primary-150)', transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }} />
                    </div>
                    <div className="flex" style={{ gap: `${gapPx}px` }}>
                      <div className="rounded-[1px]" style={{ width: cellW, height: cellH, background: 'var(--color-primary-100)', transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }} />
                      <div className="rounded-[1px]" style={{ width: cellW, height: cellH, background: 'var(--color-primary-50)', transition: 'width 80ms linear, height 80ms linear', willChange: 'width, height' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 页面信息面板 */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] shrink-0">{t('home.createDialog.size')}</span>
                <span className="text-[var(--text-caption)] font-[600] text-[var(--color-gray-800)]">{currentSize.width} × {currentSize.height} mm</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] shrink-0">{t('home.createDialog.orientation')}</span>
                <span className={`inline-block px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[var(--text-nano)] font-[500] ${currentSize.width > currentSize.height ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-700)]' : currentSize.height > currentSize.width ? 'bg-[var(--color-warning-50)] text-[var(--color-warning-700)]' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)]'}`}>{orientationLabel}</span>
                {canFlip && (
                  <button onClick={handleFlip}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-white text-[var(--text-nano)] text-[var(--color-gray-400)] cursor-pointer transition-all duration-200 hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)] hover:bg-[var(--color-primary-50)]">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3 h-3">
                      <path d="M2 3.5h5.5A2.5 2.5 0 0 1 10 6M10 8.5H4.5A2.5 2.5 0 0 1 2 6" />
                      <polyline points="8,5 10,3 8,1" /><polyline points="4,7 2,9 4,11" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] shrink-0">{t('home.createDialog.ratio')}</span>
                <span className="text-[var(--text-caption)] text-[var(--color-gray-700)]">{ratioLabel}</span>
              </div>

            </div>
          </div>
        </div>

        {/* ═══════ 选择尺寸 — 平铺全部 ═══════ */}
        <div>
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2">{t('home.createDialog.selectSize')}</label>
          <div className="grid grid-cols-4 gap-2">
            {SIZE_PRESETS.map((preset) => {
              const sel = !isCustom && selectedPreset.id === preset.id;
              return (
                <div key={preset.id} onClick={() => { setSelectedPreset(preset); setIsCustom(false); }}
                  className={`p-2.5 rounded-[var(--radius-md)] text-center cursor-pointer border transition-all duration-150
                    ${sel ? 'border-[var(--color-primary-600)] border-2 bg-[var(--color-surface-selected)] shadow-[var(--shadow-xs)]' : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-card-hover)]'}`}>
                  <div className="text-[var(--text-caption)] font-[600] text-[var(--color-gray-800)] leading-tight truncate">{preset.name}</div>
                  <div className="text-[var(--text-nano)] text-[var(--color-text-secondary)] mt-0.5">{preset.desc}</div>
                </div>
              );
            })}
            <div onClick={() => setIsCustom(true)}
              className={`p-2.5 rounded-[var(--radius-md)] text-center cursor-pointer border transition-all duration-150
                ${isCustom ? 'border-[var(--color-primary-600)] border-2 bg-[var(--color-surface-selected)] shadow-[var(--shadow-xs)]' : 'border-dashed border-[var(--color-gray-300)] bg-[var(--color-gray-25)] hover:border-[var(--color-primary-400)] hover:bg-[var(--color-surface-selected)]'}`}>
              <div className="text-[var(--text-caption)] font-[600] text-[var(--color-gray-600)]">{t('home.createDialog.custom')}</div>
              <div className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] mt-0.5">{t('home.createDialog.customSize')}</div>
            </div>
          </div>
        </div>

        {/* 自定义尺寸输入 */}
        {isCustom && (
          <div className="animate-[slideIn_0.2s_ease-out]">
            <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2.5">{t('home.createDialog.customSizeMm')}</label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[var(--text-caption)] text-[var(--color-gray-500)] mb-1">{t('home.createDialog.width')}</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} step={CUSTOM_SIZE_STEP} value={customW}
                    onChange={(e) => setCustomW(Math.max(CUSTOM_SIZE_MIN, Math.min(CUSTOM_SIZE_MAX, Number(e.target.value) || 0)))}
                    className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--text-body)] text-[var(--color-gray-800)] text-center outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)] transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-[var(--text-caption)] text-[var(--color-gray-400)] min-w-[1.5em]">mm</span>
                </div>
              </div>
              <span className="text-[var(--text-h3)] text-[var(--color-gray-400)] mt-6">×</span>
              <div className="flex-1">
                <label className="block text-[var(--text-caption)] text-[var(--color-gray-500)] mb-1">{t('home.createDialog.height')}</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} step={CUSTOM_SIZE_STEP} value={customH}
                    onChange={(e) => setCustomH(Math.max(CUSTOM_SIZE_MIN, Math.min(CUSTOM_SIZE_MAX, Number(e.target.value) || 0)))}
                    className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--text-body)] text-[var(--color-gray-800)] text-center outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)] transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-[var(--text-caption)] text-[var(--color-gray-400)] min-w-[1.5em]">mm</span>
                </div>
              </div>
            </div>
            {(customW < CUSTOM_SIZE_MIN || customH < CUSTOM_SIZE_MIN) && (
              <p className="text-[var(--text-nano)] text-[var(--color-error)] mt-2">{t('home.createDialog.sizeTooSmall', { min: CUSTOM_SIZE_MIN })}</p>
            )}
          </div>
        )}

        {/* ═══════ 边距与间距（与编辑器页面设置风格一致） ═══════ */}
        <div>
          {/* 快捷预设 */}
          <div>
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('home.createDialog.quickPresets')}</div>
            <div className="flex gap-1.5">
              {PAGE_MARGIN_PRESETS.map((p) => {
                const active = marginVal === p.margin && gapVal === p.gap && cornerRadius === p.cornerRadius;
                return (
                  <button key={p.label} onClick={() => { setMarginVal(p.margin); setGapVal(p.gap); setCornerRadius(p.cornerRadius); }}
                    className={`px-3 py-1.5 rounded-lg border text-[12px] font-[500] cursor-pointer transition-all ${active ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)] shadow-[0_1px_3px_rgba(108,99,255,0.15)]' : 'border-[var(--color-border)] bg-white text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)] hover:text-[var(--color-gray-700)]'}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-[var(--color-border-light)] mt-5" />

          {/* 页面边距 */}
          <div className="mt-5">
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('home.createDialog.pageMargin')}</div>
            <div className="flex items-center gap-3">
              <input type="range" min={PAGE_MARGIN_MIN} max={PAGE_MARGIN_MAX} step={1} value={marginVal}
                onChange={(e) => setMarginVal(+e.target.value)}
                className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                <span className="text-[13px] font-[600] text-[#334155] tabular-nums min-w-[18px] text-center">{marginVal}</span>
                <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">mm</span>
              </div>
            </div>
          </div>

          {/* 槽位间距 */}
          <div className="mt-5">
            <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('home.createDialog.slotGap')}</div>
            <div className="flex items-center gap-3">
              <input type="range" min={PAGE_GAP_MIN} max={PAGE_GAP_MAX} step={1} value={gapVal}
                onChange={(e) => setGapVal(+e.target.value)}
                className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                <span className="text-[13px] font-[600] text-[#334155] tabular-nums min-w-[18px] text-center">{gapVal}</span>
                <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">mm</span>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--color-border-light)]" />

        {/* ═══════ 照片槽圆角 ═══════ */}
        <div>
          <div className="text-[11px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase mb-2.5">{t('home.createDialog.slotRadius')}</div>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={24} step={1} value={cornerRadius}
              onChange={(e) => setCornerRadius(+e.target.value)}
              className="flex-1 h-1.5 cursor-pointer accent-[var(--color-brand)]" />
            <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
              <span className="text-[13px] font-[600] text-[#334155] tabular-nums min-w-[18px] text-center">{cornerRadius}</span>
              <span className="text-[11px] text-[var(--color-gray-400)] font-[500]">px</span>
            </div>
          </div>
        </div>

        {/* 相册描述 */}
        <div>
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">
            {t('home.createDialog.albumDescription')} <span className="text-[var(--color-text-tertiary)] font-[400]">({t('home.createDialog.albumDescriptionOptional')})</span>
          </label>
          <textarea className="w-full h-14 px-3 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-800)] placeholder:text-[var(--color-text-tertiary)] resize-none outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)] transition-all"
            placeholder={t('home.createDialog.albumDescriptionPlaceholder')}
            value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          <div className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-0.5 text-right">{description.length}/200</div>
        </div>

        </div>
    </Modal>
  );
}
