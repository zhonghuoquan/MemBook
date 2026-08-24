/**
 * CoverSettings —— 封面设置（右侧面板）
 * ─────────────────────────────────────
 * 在编辑器画布右侧展开的设置面板（参考对象属性面板布局 + 文字/形状工具控件风格）。
 * 修改圆角 / 书脊底色 / 书脊 Logo 颜色 / 书脊宽度时，通过 uiStore.coverPreview 实时驱动
 * 画布上的封面渲染（所见即所得）；点「确认」才写入页面数据（含书脊文字按新宽度重排），
 * 点「取消」/关闭按钮/按 Esc 则恢复原状；面板打开时点击画布不会关闭面板。
 * 仅作用于封面/封底页，不影响普通页面的页面设置。
 */
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore, useHistoryStore } from '../../store';
import { isCoverOrBackCoverPage, isCoverPage } from '../../types';
import type { AlbumPage, PageTextElement } from '../../types';
import { STANDARD_COLORS, PALETTE_COLORS } from '../../constants/colorPalette';
import { SPINE_DATE_BOTTOM_MM } from '../../utils/sharedRender';
import { useDialogHotkeys } from '../../hooks/useDialogHotkeys';
import { DEFAULT_SPINE_WIDTH_MM, SPINE_WIDTH_MIN_MM, SPINE_WIDTH_MAX_MM } from './canvas/constants';

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

/**
 * 应用书脊参数（底色/宽度/Logo 颜色）到封面页。
 * 书脊宽度变化时封面区内容数据一律不移动（书脊从左侧向外扩展，折线与封面内容位置固定），
 * 各渲染端统一按 (当前书脊宽 - 锚点) 偏移封面区内容；书脊自动文字（spine-text-*，相册名/日期）
 * 在数据层按新书脊宽重新水平居中（与画布预览 renderTextForSpine 一致），
 * 保证画布/导出/缩略图三端书脊文字始终居中于书脊。
 * 日期文字固定「水平居中 + 垂直底部对齐」（竖排语义：align=水平、verticalAlign=垂直）+ 底边距固定 SPINE_DATE_BOTTOM_MM（15mm，与 logo 顶边距镜像对称）。
 * 书脊文字默认字体 = 应用默认 思源黑体（旧数据 Helvetica Neue 确认时迁移，用户手动改过的字体保留）。
 * 锚点（spineAnchorMm）= 内容烘焙的书脊偏移量，首次调整时冻结（旧数据缺省回退为当前 spineWidth）。
 */
function applySpineSettings(
  page: AlbumPage,
  params: { spineColor: string; spineWidth: number; spineLogoColor?: string },
  pageHeightMm: number,
): AlbumPage {
  const anchor = page.spineAnchorMm ?? page.spineWidth ?? 0;
  const next: AlbumPage = {
    ...page,
    ...params,
    spineAnchorMm: anchor,
  };
  if (next.textElements?.length) {
    next.textElements = next.textElements.map((el) => {
      if (!el.id.startsWith('spine-text-')) return el;
      let r: PageTextElement = el;
      // 书脊文字默认字体 = 应用默认 思源黑体；旧数据（Helvetica Neue）确认时迁移，用户手动改过的字体保留
      if (r.fontFamily === "'Helvetica Neue', Arial, sans-serif") {
        r = { ...r, fontFamily: '思源黑体' };
      }
      // 日期：水平居中 + 垂直底部对齐（竖排语义：align=水平、verticalAlign=垂直）、底边距固定 15mm
      // （y 为盒顶坐标 = 页高 − 底边距 − 盒高）。与预览 renderTextForSpine 公式一致，确认不产生上下跳。
      if (el.id.includes('date')) {
        r = { ...r, align: 'center', verticalAlign: 'bottom', y: pageHeightMm - SPINE_DATE_BOTTOM_MM - (r.height || 0) };
      }
      // 书脊宽度变化时按新书脊宽重新居中（x）并收窄超宽盒（公式与预览一致）
      if (params.spineWidth !== (page.spineWidth ?? 0)) {
        const boxW = Math.min(r.width || r.fontSize + 6, params.spineWidth);
        r = { ...r, x: params.spineWidth / 2 - boxW / 2 };
        if (boxW !== r.width) r.width = boxW;
      }
      return r;
    });
  }
  return next;
}

/** 纯色选择区（标准色 + 色盘 + 自定义取色器，样式与 ColorPalette 纯色 Tab 一致，仅支持纯色 hex） */
function SpineColorField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-[500] text-[var(--color-gray-500)]">{label}</div>
      {/* 自定义取色器 + 当前色值 */}
      <label className="flex items-center gap-2 flex-1 min-w-0 py-1.5 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white cursor-pointer transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]">
        <input type="color" value={valid} onChange={(e) => onChange(e.target.value)} className="sr-only" title={t('editor.colorPicker.customPicker')} />
        <span className="w-7 h-7 rounded-[4px] border shrink-0 relative overflow-hidden shadow-inner"
          style={{ backgroundColor: valid, borderColor: 'var(--color-border)' }} />
        <span className="flex-1 min-w-0 text-[11px] font-[500] text-[var(--color-gray-700)] truncate">{value.toUpperCase()}</span>
      </label>
      {/* 标准色 */}
      <div className="text-[10px] font-[500] text-[var(--color-gray-400)]">{t('editor.colorPalette.standardColors')}</div>
      <div className="flex gap-1">
        {STANDARD_COLORS.map((c) => (
          <button key={c} onClick={() => onChange(c)}
            className="flex-1 aspect-square rounded-[3px] border cursor-pointer transition-transform hover:scale-105"
            style={{ backgroundColor: c, borderColor: value === c ? 'var(--color-brand)' : 'var(--color-border)' }} title={c} />
        ))}
      </div>
      {/* 色盘 */}
      <div className="text-[10px] font-[500] text-[var(--color-gray-400)]">{t('editor.colorPalette.colorWheel')}</div>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}>
        {PALETTE_COLORS.map((c) => (
          <button key={c} onClick={() => onChange(c)}
            className="w-full aspect-square rounded-[3px] border cursor-pointer transition-transform hover:scale-105"
            style={{ backgroundColor: c, borderColor: value === c ? 'var(--color-brand)' : 'var(--color-border)' }} title={c} />
        ))}
      </div>
    </div>
  );
}

export function CoverSettings() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.coverSettingsOpen);
  const setOpen = useUIStore((s) => s.setCoverSettingsOpen);
  const setCoverPreview = useUIStore((s) => s.setCoverPreview);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  // ═══ 影子状态：暂存本地，变化时实时预览，确认后批量写入 Store ═══
  const [coverCorners, setCoverCorners] = useState<[number, number, number, number]>([4, 4, 4, 4]);
  const [coverUniform, setCoverUniform] = useState(true);
  const [spineColor, setSpineColor] = useState('#FFFFFF');
  const [spineLogoAuto, setSpineLogoAuto] = useState(true);
  const [spineLogoColor, setSpineLogoColor] = useState('#000000');
  const [spineWidth, setSpineWidth] = useState(DEFAULT_SPINE_WIDTH_MM);
  const [hasCover, setHasCover] = useState(false);

  // 打开时从 Store 同步到本地影子状态 + 写入初始预览覆盖 + 清空对象选中（避免右侧对象面板重叠遮挡）
  useEffect(() => {
    if (!open) return;
    const s = useEditorStore.getState();
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
    const coverOnlyPage = s.pages.find((p) => isCoverPage(p));
    setHasCover(!!coverOnlyPage);
    setSpineColor(coverOnlyPage?.spineColor || '#FFFFFF');
    setSpineLogoAuto(!coverOnlyPage?.spineLogoColor);
    setSpineLogoColor(coverOnlyPage?.spineLogoColor || '#000000');
    setSpineWidth(coverOnlyPage?.spineWidth ?? DEFAULT_SPINE_WIDTH_MM);
    clearSelection();
  }, [open, clearSelection]);

  // 影子状态变化 → 实时写入预览覆盖，驱动画布封面刷新（仅在面板打开时）
  useEffect(() => {
    if (!open) return;
    const cornerValue: number | [number, number, number, number] = coverUniform
      ? coverCorners[0]
      : coverCorners;
    setCoverPreview({
      slotCornerRadius: cornerValue,
      spineColor,
      spineWidth,
      spineLogoColor: spineLogoAuto ? undefined : spineLogoColor,
    });
  }, [open, coverCorners, coverUniform, spineColor, spineWidth, spineLogoAuto, spineLogoColor, setCoverPreview]);

  // ═══ 确认：批量写入 Store + 清除预览 + 关闭 ═══
  const handleConfirm = useCallback(() => {
    const cornerValue: number | [number, number, number, number] = coverUniform
      ? coverCorners[0]
      : coverCorners;
    const store = useEditorStore.getState();
    const pageHeightMm = store.albumSize?.height ?? 280;
    const newPages = store.pages.map((p: AlbumPage) =>
      isCoverOrBackCoverPage(p) ? { ...p, slotCornerRadius: cornerValue } : p
    );
    // 书脊参数：仅应用到封面页（封底无书脊）；书脊宽度变化时封面区内容数据一律不移动（书脊向左扩展），
    // 书脊自动文字（spine-text-*）由 applySpineSettings 按新书脊宽在数据层重新居中、日期水平居中+垂直底部+底边距固定 15mm（与画布预览一致）
    if (hasCover) {
      for (let i = 0; i < newPages.length; i++) {
        if (isCoverPage(newPages[i])) {
          newPages[i] = applySpineSettings(newPages[i], {
            spineColor,
            spineWidth,
            spineLogoColor: spineLogoAuto ? undefined : spineLogoColor,
          }, pageHeightMm);
        }
      }
    }
    store.setPages(newPages);
    // 封面设置（书脊/圆角）确认需记历史，否则 Ctrl+Z 撤销不生效（2026-08-19）
    useHistoryStore.getState().pushSnapshot(newPages, useEditorStore.getState().selectedSlotId);
    setCoverPreview(null);
    setOpen(false);
  }, [coverCorners, coverUniform, hasCover, spineColor, spineLogoAuto, spineLogoColor, spineWidth, setCoverPreview, setOpen]);

  // ═══ 取消：清除预览（画布恢复原状）+ 关闭 ═══
  const handleCancel = useCallback(() => {
    setCoverPreview(null);
    setOpen(false);
  }, [setCoverPreview, setOpen]);

  // ═══ 重置：恢复本地为当前 store 实际值（随后预览 effect 自动同步） ═══
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
    setSpineLogoAuto(!coverOnlyPage?.spineLogoColor);
    setSpineLogoColor(coverOnlyPage?.spineLogoColor || '#000000');
    setSpineWidth(coverOnlyPage?.spineWidth ?? DEFAULT_SPINE_WIDTH_MM);
  }, []);

  // Esc 取消 / Enter 确认（右侧面板非遮罩弹窗，不屏蔽画布交互，故不使用 ModalGuard）
  useDialogHotkeys({ onConfirm: handleConfirm, onCancel: handleCancel, enabled: open });

  if (!open) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-50 w-[300px] max-w-[85%] flex flex-col bg-white border-l border-[var(--color-border)] shadow-[-4px_0_16px_rgba(0,0,0,0.06)]"
    >
      {/* ── 头部：书脊图标 + 标题 + 关闭 ── */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border-light)] bg-[var(--color-surface-hover)]/50">
        <span className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-selected)] text-[var(--color-brand)]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><rect x="2" y="2" width="3.5" height="12" rx="1"/><rect x="5.8" y="2" width="8.2" height="12" rx="1"/><path d="M7 5.5h4.5M7 8h4.5M7 10.5h3"/></svg>
        </span>
        <span className="flex-1 text-[12px] font-[600] text-[var(--color-gray-800)] truncate">{t('editor.coverSettings.title')}</span>
        <button
          onClick={handleCancel}
          title={t('common.close')}
          className="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] cursor-pointer border-none bg-transparent"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5"><line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" /></svg>
        </button>
      </div>

      {/* ── 内容区（可滚动） ── */}
      <div className="flex-1 min-h-0 overflow-y-auto ps-scroll px-3.5 py-4 space-y-5">
        {/* ── 封面/封底 · 照片位圆角 ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.coverSettings.coverSection')}</span>
            <button
              onClick={() => setCoverUniform(!coverUniform)}
              className="text-[10px] font-[500] text-[var(--color-gray-400)] hover:text-[var(--color-brand)] transition-colors border-none bg-transparent cursor-pointer"
            >
              {coverUniform ? t('editor.coverSettings.perCorner') : t('editor.coverSettings.uniform')}
            </button>
          </div>

          {coverUniform ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)]">
                <span>{t('editor.coverSettings.coverSlotRadius')}</span>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={24} value={coverCorners[0]}
                    onChange={(e) => { const v = clamp(+e.target.value, 0, 24); setCoverCorners([v, v, v, v]); }}
                    className="w-12 h-6 px-1 border border-[var(--color-border)] rounded text-[10px] bg-white outline-none tabular-nums transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15" />
                  <span className="font-[600] tabular-nums text-[10px] text-[var(--color-gray-400)]">px</span>
                </div>
              </div>
              <input type="range" min={0} max={24} step={1} value={coverCorners[0]}
                onChange={(e) => { const v = +e.target.value; setCoverCorners([v, v, v, v]); }}
                className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {([['tl', 0, t('editor.coverSettings.cornerTL')], ['tr', 1, t('editor.coverSettings.cornerTR')], ['bl', 3, t('editor.coverSettings.cornerBL')], ['br', 2, t('editor.coverSettings.cornerBR')]] as const).map(([key, idx, label]) => (
                <div key={key} className="flex items-center gap-1.5 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] px-2 py-1.5">
                  <span className="text-[10px] font-[500] text-[var(--color-gray-400)] w-7 shrink-0">{label}</span>
                  <input type="number" min={0} max={24} value={coverCorners[idx]}
                    onChange={(e) => {
                      const v = clamp(+e.target.value, 0, 24);
                      setCoverCorners(prev => { const next = [...prev] as [number, number, number, number]; next[idx] = v; return next; });
                    }}
                    className="w-10 border-none bg-transparent text-[12px] font-[600] text-[#334155] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 书脊（仅封面）：宽度 / Logo 颜色 / 底色 ── */}
        {hasCover && (
          <>
            <div className="h-px bg-[var(--color-border-light)]" />
            <section className="space-y-4">
              <div className="text-[10px] font-[600] tracking-wide text-[var(--color-gray-400)] uppercase">{t('editor.coverSettings.spine')}</div>

              {/* 书脊宽度 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-[500] text-[var(--color-gray-500)]">
                  <span>{t('editor.coverSettings.spineWidth')}</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min={SPINE_WIDTH_MIN_MM} max={SPINE_WIDTH_MAX_MM} value={spineWidth}
                      onChange={(e) => setSpineWidth(clamp(+e.target.value || 0, SPINE_WIDTH_MIN_MM, SPINE_WIDTH_MAX_MM))}
                      className="w-12 h-6 px-1 border border-[var(--color-border)] rounded text-[10px] bg-white outline-none tabular-nums transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15" />
                    <span className="font-[600] tabular-nums text-[10px] text-[var(--color-gray-400)]">mm</span>
                  </div>
                </div>
                <input type="range" min={SPINE_WIDTH_MIN_MM} max={SPINE_WIDTH_MAX_MM} step={1} value={spineWidth}
                  onChange={(e) => setSpineWidth(+e.target.value)}
                  className="w-full h-1.5 cursor-pointer accent-[var(--color-brand)]" />
              </div>

              {/* 书脊 Logo 颜色（自动黑/白 或 自定义） */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-[500] text-[var(--color-gray-500)]">{t('editor.coverSettings.spineLogoColor')}</span>
                  <label className="flex items-center gap-1.5 text-[10px] font-[500] text-[var(--color-gray-500)] cursor-pointer">
                    <input type="checkbox" checked={spineLogoAuto}
                      onChange={(e) => setSpineLogoAuto(e.target.checked)}
                      className="accent-[var(--color-brand)]" />
                    {t('editor.coverSettings.spineLogoAuto')}
                  </label>
                </div>
                {!spineLogoAuto && (
                  <SpineColorField
                    label=""
                    value={spineLogoColor}
                    onChange={setSpineLogoColor}
                  />
                )}
              </div>

              {/* 书脊底色 */}
              <SpineColorField
                label={t('editor.coverSettings.spineColor')}
                value={spineColor}
                onChange={setSpineColor}
              />
            </section>
          </>
        )}
      </div>

      {/* ── Footer：恢复默认 / 取消 / 确认 ── */}
      <div className="shrink-0 flex items-center justify-between px-3.5 py-3 border-t border-[var(--color-border-light)] bg-[var(--color-gray-25)]">
        <button onClick={handleReset}
          className="text-[11px] font-[500] text-[var(--color-gray-400)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-600)] transition-colors">{t('editor.coverSettings.resetDefault')}</button>
        <div className="flex gap-2">
          <button onClick={handleCancel}
            className="px-3.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-[12px] font-[500] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">{t('common.cancel')}</button>
          <button onClick={handleConfirm}
            className="px-4 py-1.5 rounded-lg border-none bg-[var(--color-brand)] text-white text-[12px] font-[600] cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors shadow-[0_2px_8px_rgba(108,99,255,0.25)]">{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
