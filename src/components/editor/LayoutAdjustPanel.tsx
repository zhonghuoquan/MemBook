import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, usePhotoStore, useHistoryStore, useUIStore } from '../../store';
import { pageLayoutService } from '../../services/pageLayoutService';
import { usePanelConstraints } from '../../hooks/usePanelConstraints';
import type { SlotOverride } from '../../types';
import { refitPage, refitPageWithRotation } from '../../engine/google-photos-layout';
import type { TierPattern } from '../../engine/google-photos-layout';
import { calcCoverFitWithRotation, computePanForResizedSlot } from '../../utils/photoGeometry';

const MM_TO_PX = 2;

/** 将屏幕坐标系下的 XY 偏压转换为基准坐标系下的偏压（与视觉旋转方向一致） */
function transformBiasToBase(bx: number, by: number, rotation: 0 | 90 | 180 | 270): { bx: number; by: number } {
  switch (rotation) {
    case 0: return { bx, by };
    case 90: return { bx: -by, by: bx };
    case 180: return { bx: -bx, by: -by };
    case 270: return { bx: by, by: -bx };
  }
}

/** 将基准坐标系下的 XY 偏压转换为屏幕坐标系下显示（与视觉旋转方向一致） */
function transformBiasFromBase(bx: number, by: number, rotation: 0 | 90 | 180 | 270): { bx: number; by: number } {
  switch (rotation) {
    case 0: return { bx, by };
    case 90: return { bx: by, by: -bx };
    case 180: return { bx: -bx, by: -by };
    case 270: return { bx: -by, by: bx };
  }
}

interface LayoutAdjustPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LayoutAdjustPanel({ open, onClose }: LayoutAdjustPanelProps) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);
  const photos = usePhotoStore((s) => s.photos);
  const setPages = useEditorStore((s) => s.setPages);

  const page = pages[currentPageIndex];
  const supported = !!(page?.googlePhotosLayoutRows && page?.googlePhotosMmConfig && albumSize);

  const rotation = (page?.perPageRotation ?? 0) as 0 | 90 | 180 | 270;
  const initialBias = transformBiasFromBase(page?.perPageBiasX ?? 0, page?.perPageBiasY ?? 0, rotation);
  const [biasX, setBiasX] = useState(initialBias.bx);
  const [biasY, setBiasY] = useState(initialBias.by);

  useEffect(() => {
    if (open) {
      const r = (page?.perPageRotation ?? 0) as 0 | 90 | 180 | 270;
      const transformed = transformBiasFromBase(page?.perPageBiasX ?? 0, page?.perPageBiasY ?? 0, r);
      setBiasX(transformed.bx);
      setBiasY(transformed.by);
    }
  }, [open, currentPageIndex, page?.perPageBiasX, page?.perPageBiasY, page?.perPageRotation]);

  // ── photoMap（重排用） ──
  const photoMap = useMemo(() => {
    const m = new Map<string, typeof photos[number]>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

  // ── 重排 ──
  const applyRefit = useCallback((bx: number, by: number, skipHistory = false) => {
    // 实时从 store 读取最新页面数据，避免拖拽过程中闭包过期
    const store = useEditorStore.getState();
    const curPage = store.pages[currentPageIndex];
    const curAlbumSize = store.albumSize;
    if (!curPage?.googlePhotosLayoutRows || !curPage?.googlePhotosMmConfig || !curAlbumSize) return;

    const cfg = curPage.googlePhotosMmConfig;
    const rowsMeta = curPage.googlePhotosLayoutRows;
    const basePageSize = curPage.googlePhotosBasePageSize ?? { width: curAlbumSize.width, height: curAlbumSize.height };
    const contentW = basePageSize.width - cfg.margin.left - cfg.margin.right;
    const contentH = basePageSize.height - cfg.margin.top - cfg.margin.bottom;
    if (contentW <= 0 || contentH <= 0) return;

    const rot = (curPage.perPageRotation ?? 0) as 0 | 90 | 180 | 270;
    const baseBias = transformBiasToBase(bx, by, rot);
    const pattern = (curPage.perPageTierPattern as TierPattern | undefined) ?? 'hero-first';
    const result = rot !== 0
      ? refitPageWithRotation(rowsMeta, photoMap, contentW, contentH, cfg.margin.left, cfg.margin.top, cfg.gap, baseBias.bx, baseBias.by, rot, basePageSize.width, basePageSize.height, curAlbumSize.width, curAlbumSize.height, cfg.margin, pattern)
      : refitPage(rowsMeta, photoMap, contentW, contentH, cfg.margin.left, cfg.margin.top, cfg.gap, baseBias.bx, baseBias.by, pattern);

    const slotOverrides: Record<string, SlotOverride> = {};
    const mmLayout: Array<{ photoId: string; x: number; y: number; width: number; height: number }> = [];
    curPage.placements.forEach((pl, i) => {
      const pr = result.photos[i];
      if (!pr) return;
      slotOverrides[pl.slotId] = { x: pr.x * MM_TO_PX, y: pr.y * MM_TO_PX, width: pr.width * MM_TO_PX, height: pr.height * MM_TO_PX };
      mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
    });

    setBiasX(bx);
    setBiasY(by);

    const curPages = store.pages;
    const newPages = [...curPages];
    // 迁移照片编辑状态：用旋转感知的 cover-fit 计算包围盒，保持 panScale，
    // 通过 computePanForResizedSlot 把旧槽位的 panX/panY 映射到新槽位，最后多边形约束防露白。
    const oldOverrides = curPage.slotOverrides ?? {};
    newPages[currentPageIndex] = {
      ...curPage,
      slotOverrides,
      googlePhotosMmLayout: mmLayout,
      perPageBiasX: baseBias.bx,
      perPageBiasY: baseBias.by,
      placements: curPage.placements.map((pl) => {
        const photo = photoMap.get(pl.photoId ?? '');
        const oldOv = oldOverrides[pl.slotId];
        const newOv = slotOverrides[pl.slotId];
        if (!photo || !oldOv || !newOv || photo.width <= 0 || photo.height <= 0) return pl;

        // 无编辑记录：保持默认居中
        if (pl.panX == null && pl.panY == null && pl.panScale == null && pl.panRotation == null) return pl;

        const totalRot = pl.panRotation ?? (pl.rotation || 0);
        const ps = Math.max(pl.panScale || 1, 1);
        const oldCF = calcCoverFitWithRotation(photo.width, photo.height, oldOv.width, oldOv.height, totalRot);
        const oldPanX = pl.panX ?? (oldOv.width - oldCF.boundingW * ps) / 2;
        const oldPanY = pl.panY ?? (oldOv.height - oldCF.boundingH * ps) / 2;

        const newPan = computePanForResizedSlot(
          photo.width, photo.height, oldOv.width, oldOv.height, newOv.width, newOv.height,
          totalRot, ps, oldPanX, oldPanY
        );

        return {
          ...pl,
          panX: newPan.panX,
          panY: newPan.panY,
          panScale: ps,
        };
      }),
    };
    if (!skipHistory) {
      useHistoryStore.getState().pushSnapshot(curPages, useEditorStore.getState().selectedSlotId);
    }
    setPages(newPages);
  }, [currentPageIndex, photoMap]);

  // ref 始终指向最新 applyRefit，供事件回调避免闭包过期
  const applyRefitRef = useRef(applyRefit);
  applyRefitRef.current = applyRefit;

  // ── XY pad 拖拽 ──
  const padRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragBiasRef = useRef({ x: 0, y: 0 }); // ref 存最新拖拽值，避免闭包陷阱
  const [isDragging, setIsDragging] = useState(false);
  const [dragBiasX, setDragBiasX] = useState(0);
  const [dragBiasY, setDragBiasY] = useState(0);

  const updateBiasFromClient = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let bx = Math.round(((clientX - r.left) / r.width - 0.5) * 200) / 10;
    let by = Math.round((0.5 - (clientY - r.top) / r.height) * 200) / 10;
    bx = Math.max(-10, Math.min(10, bx));
    by = Math.max(-10, Math.min(10, by));
    dragBiasRef.current = { x: bx, y: by };
    setDragBiasX(bx);
    setDragBiasY(by);
  }, []);

  const onPadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setIsDragging(true);
    dragBiasRef.current = { x: biasX, y: biasY };
    setDragBiasX(biasX);
    setDragBiasY(biasY);
    updateBiasFromClient(e.clientX, e.clientY);
  }, [biasX, biasY, updateBiasFromClient]);

  // 拖拽事件：仅在 isDragging 时绑定，依赖数组完整，不会无限循环
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      updateBiasFromClient(e.clientX, e.clientY);
      // 实时重排：用 ref 读取最新拖拽值 + 最新 applyRefit，skipHistory 避免拖拽中写大量快照
      const { x, y } = dragBiasRef.current;
      applyRefitRef.current(x, y, true);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      // 松手时写一次 history（支持撤销）
      const { x, y } = dragBiasRef.current;
      applyRefitRef.current(x, y, false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, updateBiasFromClient, applyRefit]);

  const handleReset = useCallback(() => {
    setDragBiasX(0);
    setDragBiasY(0);
    applyRefit(0, 0);
  }, [applyRefit]);

  const showX = isDragging ? dragBiasX : biasX;
  const showY = isDragging ? dragBiasY : biasY;
  const padW = padRef.current?.clientWidth ?? 200;
  const dotX = ((showX + 10) / 20) * padW;
  const dotY = ((10 - showY) / 20) * padW;

  // ── 窗口层级 ──
  const activeFloatingPanel = useUIStore((s) => s.activeFloatingPanel);
  const setActiveFloatingPanel = useUIStore((s) => s.setActiveFloatingPanel);
  const isActive = activeFloatingPanel === 'layoutAdjust';

  // ── 窗口拖动（限制在工作区内，并随面板调整自动避让）──
  const { bounds, constrain } = usePanelConstraints();
  const [winPos, setWinPos] = useState({ x: -1, y: -1 }); // -1 = 用 CSS 默认右侧定位
  const panelRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<() => void>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    // 仅左键拖动
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    // 首次拖动时把 CSS 定位转为坐标
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
    ...(winPos.x >= 0 ? { left: winPos.x, top: winPos.y } : { right: 16, top: 152 }),
    zIndex: isActive ? 'calc(var(--z-dropdown) + 10)' : 'var(--z-dropdown)',
  };

  return (
    <div
      ref={panelRef}
      onMouseDown={() => setActiveFloatingPanel('layoutAdjust')}
      className="fixed z-[var(--z-dropdown)] bg-white rounded-xl shadow-[var(--shadow-lg)] border border-[var(--color-border)] w-[220px]"
      style={panelStyle}
    >
      {/* 标题栏（可拖动） */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center justify-between px-3 py-2 cursor-move border-b border-[var(--color-border-light)]"
      >
        <span className="text-[12px] font-[600] text-[var(--color-gray-800)] select-none">
          {t('editor.layoutAdjust.title', { page: currentPageIndex + 1 })}
        </span>
        <div className="flex items-center gap-1.5">
          {supported && (
            <button
              onClick={handleReset}
              className="text-[10px] text-[var(--color-gray-500)] border border-[var(--color-border)] rounded-full px-1.5 py-0 hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors cursor-pointer"
            >
              {t('editor.layoutAdjust.reset')}
            </button>
          )}
          <button onClick={onClose} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-700)] cursor-pointer border-none bg-transparent p-0">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-3">
        {!supported ? (
          <div className="text-center py-5 px-2">
            <div className="text-[11px] text-[var(--color-gray-400)]">{t('editor.layoutAdjust.notSupported')}</div>
            <div className="text-[10px] text-[var(--color-gray-400)] mt-1">{t('editor.layoutAdjust.notSupportedDesc')}</div>
            <button
              onClick={() => pageLayoutService.convertPageToGooglePhotos(currentPageIndex)}
              className="mt-4 h-6 px-3 rounded-[var(--radius-md)] text-[11px] text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] transition-colors border-none cursor-pointer"
            >
              {t('editor.layoutAdjust.convert')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div
              ref={padRef}
              onMouseDown={onPadMouseDown}
              onDoubleClick={handleReset}
              className="relative bg-[var(--color-gray-50)] rounded-lg border border-[var(--color-gray-200)] cursor-crosshair select-none w-full aspect-square"
              style={{ touchAction: 'none' }}
            >
              <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-[var(--color-gray-300)]" style={{ marginTop: -0.5 }} />
              <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-[var(--color-gray-300)]" style={{ marginLeft: -0.5 }} />
              <span className="absolute top-0 left-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.layoutAdjust.biasTop')}</span>
              <span className="absolute top-0 right-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.layoutAdjust.biasRight')}</span>
              <span className="absolute bottom-0 left-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.layoutAdjust.biasLeft')}</span>
              <span className="absolute bottom-0 right-0 text-[8px] text-[var(--color-gray-400)] p-0.5">{t('editor.layoutAdjust.biasBottom')}</span>
              <div
                className="absolute w-3.5 h-3.5 rounded-full bg-[var(--color-brand)] border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] cursor-grab active:cursor-grabbing"
                style={{ left: dotX - 7, top: dotY - 7, transition: isDragging ? 'none' : 'left 0.1s, top 0.1s' }}
              />
            </div>
            <div className="text-[9px] text-[var(--color-gray-400)] text-center">
              {showX > 0 ? t('editor.layoutAdjust.biasRightVal', { v: showX.toFixed(1) }) : showX < 0 ? t('editor.layoutAdjust.biasLeftVal', { v: showX.toFixed(1) }) : t('editor.layoutAdjust.biasHorizontalCenter')} · {showY > 0 ? t('editor.layoutAdjust.biasTopVal', { v: showY.toFixed(1) }) : showY < 0 ? t('editor.layoutAdjust.biasBottomVal', { v: showY.toFixed(1) }) : t('editor.layoutAdjust.biasVerticalCenter')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
