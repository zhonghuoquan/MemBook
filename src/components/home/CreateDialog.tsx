import { useState, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import {
  ALBUM_SIZES, type AlbumSize,
  CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX, CUSTOM_SIZE_STEP, CUSTOM_SIZE_DEFAULT,
  PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT,
  PAGE_MARGIN_MIN, PAGE_MARGIN_MAX, PAGE_MARGIN_STEP,
  PAGE_GAP_MIN, PAGE_GAP_MAX, PAGE_GAP_STEP,
} from '../../types';
import type { PageMargin } from '../../types';

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, size: AlbumSize, margin: PageMargin) => void;
  title?: string;
}

export function CreateDialog({ open, onClose, onCreate, title = '创建新相册' }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [selectedSize, setSelectedSize] = useState<AlbumSize>(ALBUM_SIZES[0]);
  const [customW, setCustomW] = useState(CUSTOM_SIZE_DEFAULT);
  const [customH, setCustomH] = useState(CUSTOM_SIZE_DEFAULT);
  const [marginVal, setMarginVal] = useState(PAGE_MARGIN_DEFAULT);
  const [gapVal, setGapVal] = useState(PAGE_GAP_DEFAULT);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isCustom = selectedSize.id === 'custom';
  const customDesc = useMemo(
    () => `${customW}×${customH} mm · 自定义`,
    [customW, customH],
  );

  const handleCreate = () => {
    const albumName = name.trim() || '未命名相册';
    const finalSize: AlbumSize = isCustom
      ? { id: 'custom', name: '自定义', width: customW, height: customH, desc: customDesc }
      : selectedSize;
    onCreate(albumName, finalSize, { margin: marginVal, gap: gapVal });
    setName('');
    setCustomW(CUSTOM_SIZE_DEFAULT);
    setCustomH(CUSTOM_SIZE_DEFAULT);
    setMarginVal(PAGE_MARGIN_DEFAULT);
    setGapVal(PAGE_GAP_DEFAULT);
    setShowAdvanced(false);
    onClose();
  };

  const canCreate = !isCustom || (customW >= CUSTOM_SIZE_MIN && customH >= CUSTOM_SIZE_MIN);

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="560px">
      <div className="space-y-5">
        {/* Album Name */}
        <div>
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">
            相册名称
          </label>
          <input
            type="text"
            className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body)] text-[var(--color-gray-800)]
                       placeholder:text-[var(--color-text-tertiary)]
                       outline-none hover:border-[var(--color-border-hover)]
                       focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
                       transition-all"
            placeholder="给你的相册起个名字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={30}
          />
        </div>

        {/* Size Selection */}
        <div>
          <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2">
            选择尺寸
          </label>
          <div className="grid grid-cols-2 gap-3">
            {ALBUM_SIZES.map((size) => (
              <div
                key={size.id}
                className={`
                  p-4 rounded-[var(--radius-lg)] text-center cursor-pointer
                  border transition-all duration-150
                  ${selectedSize.id === size.id
                    ? 'border-[var(--color-primary-600)] border-2 bg-[var(--color-surface-selected)] shadow-[var(--shadow-xs)]'
                    : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-card-hover)]'
                  }
                `}
                  onClick={() => setSelectedSize(size)}
              >
                <div className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)]">{size.name}</div>
                <div className="text-[var(--text-caption)] text-[var(--color-text-secondary)] mt-0.5">
                  {size.id === 'custom' ? '自定义尺寸' : size.desc}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Custom Size Inputs */}
        {isCustom && (
          <div className="animate-[slideIn_0.2s_ease-out]">
            <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-2.5">
              自定义尺寸（mm）
            </label>
            <div className="flex items-center gap-3">
              {/* Width */}
              <div className="flex-1">
                <label className="block text-[var(--text-caption)] text-[var(--color-gray-500)] mb-1">宽</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={CUSTOM_SIZE_MIN}
                    max={CUSTOM_SIZE_MAX}
                    step={CUSTOM_SIZE_STEP}
                    value={customW}
                    onChange={(e) => setCustomW(Math.max(CUSTOM_SIZE_MIN, Math.min(CUSTOM_SIZE_MAX, Number(e.target.value) || 0)))}
                    className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                               text-[var(--text-body)] text-[var(--color-gray-800)] text-center
                               outline-none hover:border-[var(--color-border-hover)]
                               focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
                               transition-all [appearance:textfield]
                               [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[var(--text-caption)] text-[var(--color-gray-400)] min-w-[1.5em]">mm</span>
                </div>
              </div>

              <span className="text-[var(--text-h3)] text-[var(--color-gray-400)] mt-6">×</span>

              {/* Height */}
              <div className="flex-1">
                <label className="block text-[var(--text-caption)] text-[var(--color-gray-500)] mb-1">高</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={CUSTOM_SIZE_MIN}
                    max={CUSTOM_SIZE_MAX}
                    step={CUSTOM_SIZE_STEP}
                    value={customH}
                    onChange={(e) => setCustomH(Math.max(CUSTOM_SIZE_MIN, Math.min(CUSTOM_SIZE_MAX, Number(e.target.value) || 0)))}
                    className="w-full h-9 px-3 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                               text-[var(--text-body)] text-[var(--color-gray-800)] text-center
                               outline-none hover:border-[var(--color-border-hover)]
                               focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
                               transition-all [appearance:textfield]
                               [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[var(--text-caption)] text-[var(--color-gray-400)] min-w-[1.5em]">mm</span>
                </div>
              </div>
            </div>

            {/* Quick preset buttons */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[var(--text-nano)] text-[var(--color-gray-400)]">快速切换：</span>
              {[
                { label: '6寸', w: 152, h: 102 },
                { label: 'A5', w: 210, h: 148 },
                { label: 'A4', w: 297, h: 210 },
                { label: '方形大', w: 300, h: 300 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  className="px-2 py-1 border border-[var(--color-border)] rounded-[var(--radius-xs)]
                             text-[var(--text-nano)] text-[var(--color-gray-500)] bg-white cursor-pointer
                             hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)]
                             transition-colors"
                  onClick={() => { setCustomW(preset.w); setCustomH(preset.h); }}
                >
                  {preset.label} ({preset.w}×{preset.h})
                </button>
              ))}
            </div>

            {/* Validation hint */}
            {(customW < CUSTOM_SIZE_MIN || customH < CUSTOM_SIZE_MIN) && (
              <p className="text-[var(--text-nano)] text-[var(--color-error)] mt-2">
                尺寸不能小于 {CUSTOM_SIZE_MIN}mm
              </p>
            )}
            {(customW > CUSTOM_SIZE_MAX || customH > CUSTOM_SIZE_MAX) && (
              <p className="text-[var(--text-nano)] text-[var(--color-warning)] mt-2">
                尺寸不能超过 {CUSTOM_SIZE_MAX}mm
              </p>
            )}

            {/* Size preview */}
            <div className="mt-3 flex items-center gap-2 text-[var(--text-caption)] text-[var(--color-text-secondary)]">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-4 h-4">
                <rect x="1.5" y="1.5" width="13" height="13" rx="1" />
                <line x1="8" y1="1.5" x2="8" y2="14.5" />
                <line x1="1.5" y1="8" x2="14.5" y2="8" />
              </svg>
              <span>最终尺寸：{customW} × {customH} mm</span>
              <span className="text-[var(--color-gray-400)]">
                ({((customW * customH) / 100).toFixed(0)} cm²)
              </span>
            </div>
          </div>
        )}

        {/* ── Advanced Options (Margin/Gap) ── */}
        <div className="border-t border-[var(--color-border-light)] pt-2">
          <button
            className="flex items-center gap-1.5 w-full py-2 text-[var(--text-body-sm)] font-[500]
                       text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] cursor-pointer
                       transition-colors border-none bg-transparent"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <svg
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              className={`w-4 h-4 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}
            >
              <polyline points="6,4 10,8 6,12" />
            </svg>
            高级选项
            <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] ml-auto">
              边距 {marginVal}mm · 间距 {gapVal}mm
            </span>
          </button>

          {showAdvanced && (
            <div className="animate-[slideIn_0.2s_ease-out] pt-1 pb-2">
              <div className="flex gap-4">
                {/* Left: controls */}
                <div className="flex-1 min-w-0 space-y-3.5">
                  {/* Margin Slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)]">边距</label>
                      <span className="text-[var(--text-caption)] text-[var(--color-primary-600)] font-[600] min-w-[2ch] text-right">
                        {marginVal}mm
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] w-4 text-right">{PAGE_MARGIN_MIN}</span>
                      <div className="flex-1 relative">
                        <input
                          type="range"
                          min={PAGE_MARGIN_MIN}
                          max={PAGE_MARGIN_MAX}
                          step={PAGE_MARGIN_STEP}
                          value={marginVal}
                          onChange={(e) => setMarginVal(Number(e.target.value))}
                          className="w-full h-1.5 appearance-none bg-[var(--color-gray-200)] rounded-full outline-none
                                     cursor-pointer
                                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-500)]
                                     [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)]
                                     [&::-webkit-slider-thumb]:cursor-pointer
                                     [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
                                     [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-primary-500)]
                                     [&::-moz-range-thumb]:cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, var(--color-primary-400) 0%, var(--color-primary-400) ${(marginVal - PAGE_MARGIN_MIN) / (PAGE_MARGIN_MAX - PAGE_MARGIN_MIN) * 100}%, var(--color-gray-200) ${(marginVal - PAGE_MARGIN_MIN) / (PAGE_MARGIN_MAX - PAGE_MARGIN_MIN) * 100}%, var(--color-gray-200) 100%)`,
                          }}
                        />
                      </div>
                      <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] w-4">{PAGE_MARGIN_MAX}</span>
                    </div>
                  </div>

                  {/* Gap Slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)]">间距</label>
                      <span className="text-[var(--text-caption)] text-[var(--color-primary-600)] font-[600] min-w-[2ch] text-right">
                        {gapVal}mm
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] w-4 text-right">{PAGE_GAP_MIN}</span>
                      <div className="flex-1 relative">
                        <input
                          type="range"
                          min={PAGE_GAP_MIN}
                          max={PAGE_GAP_MAX}
                          step={PAGE_GAP_STEP}
                          value={gapVal}
                          onChange={(e) => setGapVal(Number(e.target.value))}
                          className="w-full h-1.5 appearance-none bg-[var(--color-gray-200)] rounded-full outline-none
                                     cursor-pointer
                                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-primary-500)]
                                     [&::-webkit-slider-thumb]:shadow-[var(--shadow-xs)]
                                     [&::-webkit-slider-thumb]:cursor-pointer
                                     [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
                                     [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-primary-500)]
                                     [&::-moz-range-thumb]:cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, var(--color-primary-400) 0%, var(--color-primary-400) ${(gapVal - PAGE_GAP_MIN) / (PAGE_GAP_MAX - PAGE_GAP_MIN) * 100}%, var(--color-gray-200) ${(gapVal - PAGE_GAP_MIN) / (PAGE_GAP_MAX - PAGE_GAP_MIN) * 100}%, var(--color-gray-200) 100%)`,
                          }}
                        />
                      </div>
                      <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] w-4">{PAGE_GAP_MAX}</span>
                    </div>
                  </div>

                  {/* Quick presets */}
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] shrink-0">预设：</span>
                    {[
                      { label: '紧凑', margin: 5, gap: 3 },
                      { label: '标准', margin: 15, gap: 5 },
                      { label: '宽松', margin: 25, gap: 10 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        className={`px-2.5 py-1 rounded-[var(--radius-xs)] text-[var(--text-nano)] font-[500] cursor-pointer border transition-all ${
                          marginVal === preset.margin && gapVal === preset.gap
                            ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)] text-[var(--color-primary-700)]'
                            : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]'
                        }`}
                        onClick={() => { setMarginVal(preset.margin); setGapVal(preset.gap); }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: visual preview */}
                <div className="w-[140px] shrink-0">
                  <div className="bg-[var(--color-gray-50)] rounded-[var(--radius-sm)] p-2.5 border border-[var(--color-border-light)]">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3 h-3 text-[var(--color-gray-400)]">
                        <rect x="1.5" y="1.5" width="13" height="13" rx="1" />
                      </svg>
                      <span className="text-[var(--text-nano)] text-[var(--color-gray-500)]">预览</span>
                    </div>
                    <div className="aspect-square bg-white rounded-[var(--radius-xs)] border border-[var(--color-border)] p-0.5">
                      {/* Simulated page area */}
                      <div className="w-full h-full rounded-[1px] relative" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                        {/* Margin visualization */}
                        <div
                          className="absolute inset-0 bg-white rounded-[1px] flex items-center justify-center"
                          style={{ margin: `${Math.min(marginVal / PAGE_MARGIN_MAX * 30, 30)}%` }}
                        >
                          {/* Gap visualization inside */}
                          <div className="flex gap-0.5 w-3/4 h-3/4">
                            {[0, 1].map((col) => (
                              <div key={col} className="flex-1 flex flex-col gap-0.5">
                                {[0, 1].map((row) => (
                                  <div
                                    key={row}
                                    className="flex-1 rounded-[1px]"
                                    style={{
                                      backgroundColor: `var(--color-primary-${col === 0 && row === 0 ? '200' : col === 1 && row === 0 ? '150' : col === 0 && row === 1 ? '100' : '50'})`,
                                      gap: `${gapVal}px`,
                                    }}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canCreate}>创建相册</Button>
        </div>
      </div>
    </Modal>
  );
}
