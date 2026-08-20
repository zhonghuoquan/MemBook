import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { pageLayoutService } from '../../services/pageLayoutService';
import { usePanelConstraints } from '../../hooks/usePanelConstraints';
import { usePhotoSrc } from '../../hooks/usePhotoSrc';
import { resolveTemplate } from '../../types';
import type { Photo, SlotOverride } from '../../types';
import { useTranslation } from 'react-i18next';

/**
 * P0-fix: 计算槽位在页面上的视觉位置（百分比坐标），用于排序照片重排列表。
 * 让用户在面板里看到的照片顺序与页面上的槽位顺序对应：
 *   - 模板页面：读 slot.x/y（百分比 0-100）
 *   - Google Photos 页面：读 slotOverrides[gp-N] 的 x/y（像素值，需除以画布像素尺寸转百分比）
 * 排序规则：先按 y（顶部→底部），再按 x（左→右），符合用户视觉阅读顺序。
 */
function getSlotVisualPos(
  slotId: string,
  page: { templateId: string; slotOverrides?: Record<string, SlotOverride> },
  template: ReturnType<typeof resolveTemplate>,
  albumSize: { width: number; height: number } | null,
): { x: number; y: number } {
  // Google Photos 动态布局页面：slotOverrides 中存的是像素值（mm × 2）
  const ov = page.slotOverrides?.[slotId];
  if (ov) {
    const w = (albumSize?.width ?? 210) * 2;
    const h = (albumSize?.height ?? 280) * 2;
    return { x: (ov.x / w) * 100, y: (ov.y / h) * 100 };
  }
  // 静态模板：直接读 slot 的百分比坐标
  const slot = template?.slots.find((s) => s.id === slotId);
  if (slot) return { x: slot.x, y: slot.y };
  return { x: 0, y: 0 };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY_PHOTO = { id: '', name: '', width: 0, height: 0, src: '' } as Photo;

/* ── 缩略图子组件：使用 usePhotoSrc hook 加载照片，避免直接 photo.src 导致加载失败 ── */
function ReorderThumbnail({
  photo,
  isDragged,
  isActive,
  index,
  onMouseDown,
  itemRef,
}: {
  photo: Photo | undefined;
  isDragged: boolean;
  isActive: boolean;
  index: number;
  onMouseDown: (e: React.MouseEvent) => void;
  itemRef: (el: HTMLDivElement | null) => void;
}) {
  const resolvedSrc = usePhotoSrc(photo ?? EMPTY_PHOTO, { level: 'thumb' });

  return (
    <div
      ref={itemRef}
      onMouseDown={onMouseDown}
      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all select-none bg-[var(--color-gray-100)]
        ${isDragged ? 'opacity-40' : ''}
        ${isActive ? 'border-[var(--color-brand)] scale-[1.03] shadow-md' : 'border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)] cursor-grab active:cursor-grabbing'}`}
    >
      {/* 序号 */}
      <div className="absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-black/40 text-white text-[10px] font-[600]">
        {index + 1}
      </div>
      {resolvedSrc ? (
        <img
          src={resolvedSrc}
          alt=""
          className="w-full h-full object-cover pointer-events-none select-none"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[var(--color-gray-400)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-6 h-6">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
            <path d="M5 19l5-5 3 3 4-4 5 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

/* ── 拖拽跟随缩略图：独立组件使用 usePhotoSrc，通过 blobUrlCache 即时取图 ── */
function DragGhostThumbnail({ photo, pos }: { photo: Photo | undefined; pos: { x: number; y: number } }) {
  const resolvedSrc = usePhotoSrc(photo ?? EMPTY_PHOTO, { level: 'thumb' });
  if (!resolvedSrc) return null;
  return (
    <div
      className="fixed z-[9999] w-20 h-20 rounded-lg overflow-hidden shadow-xl border-2 border-[var(--color-brand)] pointer-events-none"
      style={{ left: pos.x - 40, top: pos.y - 40 }}
    >
      <img src={resolvedSrc} alt="" className="w-full h-full object-cover" draggable={false} />
    </div>
  );
}

export function PhotoReorderDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const allPhotos = usePhotoStore((s) => s.photos);
  const albumSize = useEditorStore((s) => s.albumSize);

  const page = pages[currentPageIndex];

  // 过滤出有照片的有效 placement 项，并按槽位视觉位置排序
  // （先 y 后 x：顶部→底部，左→右），让面板顺序与页面照片位置一一对应。
  // 布局切换/角度切换后槽位坐标变化，排序自动跟随。
  const filledItems = useMemo(() => {
    if (!page) return [];
    const template = resolveTemplate(page);
    const items = page.placements
      .map((pl, index) => ({ ...pl, index }))
      .filter((pl) => pl.photoId);
    items.sort((a, b) => {
      const pa = getSlotVisualPos(a.slotId, page, template, albumSize);
      const pb = getSlotVisualPos(b.slotId, page, template, albumSize);
      // y 容差 0.5% 内视作同一行，按 x 排序
      if (Math.abs(pa.y - pb.y) > 0.5) return pa.y - pb.y;
      return pa.x - pb.x;
    });
    return items;
  }, [page, albumSize]);

  // 照片 id → 照片对象（useMemo 避免每次渲染重建 Map）
  const photoMap = useMemo(
    () => new Map(allPhotos.map((p) => [p.id, p])),
    [allPhotos],
  );

  // ── 窗口层级 ──
  const activeFloatingPanel = useUIStore((s) => s.activeFloatingPanel);
  const setActiveFloatingPanel = useUIStore((s) => s.setActiveFloatingPanel);
  const isActive = activeFloatingPanel === 'photoReorder';

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

  // 弹窗打开时复位到默认位置，避免之前拖动过的位置覆盖新的默认定位
  useEffect(() => {
    if (open) {
      setWinPos({ x: -1, y: -1 });
      setActiveFloatingPanel('photoReorder');
    }
  }, [open, setActiveFloatingPanel]);

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

  // ── 鼠标拖拽交换（比 HTML5 DnD 在 Tauri WebView2 中更可靠）──
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragOriginRef = useRef<{ idx: number; startX: number; startY: number } | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 用 ref 镜像 filledItems / currentPageIndex / swapPagePhotos，
  // 让 mousemove/mouseup 回调读取最新值，同时让 effect 只依赖 dragIndex（不会因 filledItems 重建而反复注册/注销监听）
  const filledItemsRef = useRef(filledItems);
  filledItemsRef.current = filledItems;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const swapPhotosRef = useRef(pageLayoutService.swapPagePhotos);
  swapPhotosRef.current = pageLayoutService.swapPagePhotos;

  const handleMouseDown = (e: React.MouseEvent, idx: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragOriginRef.current = { idx, startX: e.clientX, startY: e.clientY };
    setDragIndex(idx);
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (dragIndex === null) return;
    const onMove = (e: MouseEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      // 计算当前鼠标悬停的过滤后索引
      let hovered: number | null = null;
      for (let i = 0; i < itemRefs.current.length; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          hovered = i;
        }
      }
      setDragOverIndex(hovered);
    };
    const onUp = (e: MouseEvent) => {
      const origin = dragOriginRef.current;
      const items = filledItemsRef.current;
      if (origin) {
        let targetFilteredIdx: number | null = null;
        for (let i = 0; i < itemRefs.current.length; i++) {
          const el = itemRefs.current[i];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            targetFilteredIdx = i;
          }
        }
        const targetItem = targetFilteredIdx !== null ? items[targetFilteredIdx] : null;
        if (targetItem && targetItem.index !== origin.idx) {
          swapPhotosRef.current(currentPageIndexRef.current, origin.idx, targetItem.index);
        }
      }
      dragOriginRef.current = null;
      setDragIndex(null);
      setDragOverIndex(null);
      setDragPos(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragIndex]); // 仅依赖 dragIndex，避免 filledItems 变化导致监听反复注册

  const handleShuffle = () => {
    pageLayoutService.shufflePagePhotos(currentPageIndex);
  };

  if (!open) return null;

  const panelStyle: React.CSSProperties = {
    ...(winPos.x >= 0
      ? { left: winPos.x, top: winPos.y }
      : {
          // 默认显示在工作区左侧，与排版变化面板顶部对齐，左侧距左侧面板 6px
          left: bounds.left + 6,
          top: 152,
        }),
    zIndex: isActive ? 'calc(var(--z-dropdown) + 10)' : 'var(--z-dropdown)',
  };

  // 拖拽跟随缩略图所需的照片对象
  const draggedItem = dragIndex !== null ? filledItems.find((it) => it.index === dragIndex) : undefined;
  const draggedPhoto = draggedItem?.photoId ? photoMap.get(draggedItem.photoId) : undefined;

  return (
    <div
      ref={panelRef}
      onMouseDown={() => setActiveFloatingPanel('photoReorder')}
      className="fixed z-[var(--z-dropdown)] bg-[var(--color-surface)] rounded-xl shadow-[var(--shadow-lg)] border border-[var(--color-border)] w-[220px]"
      style={panelStyle}
    >
      {/* 标题栏（可拖动） */}
      <div
        onMouseDown={onTitleMouseDown}
        className="flex items-center justify-between px-3 py-2 cursor-move border-b border-[var(--color-border-light)]"
      >
        <span className="text-[12px] font-[600] text-[var(--color-gray-800)] select-none">
          {t('editor.photoReorder.title', { page: currentPageIndex + 1 })}
        </span>
        <button onClick={onClose} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-700)] cursor-pointer border-none bg-transparent p-0">
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      <div className="p-3">
        <>
          {/* 随机重排按钮 */}
          <button
              className="w-full flex items-center justify-center gap-1.5 h-8 px-3 mb-3 rounded-lg text-[11px] font-[500]
                         bg-[var(--color-gray-50)] text-[var(--color-gray-700)] hover:bg-[var(--color-primary-50)] hover:text-[var(--color-primary-700)]
                         transition-colors border-none cursor-pointer"
              onClick={handleShuffle}
              title={t('editor.photoReorder.randomShuffleHint')}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                <path d="M1 3.5h2.5l2 7H11" />
                <path d="M1 10.5h2.5l2-7H11" />
                <path d="M9.5 1.5l3 3-3 3" />
                <path d="M9.5 6.5l3 3-3 3" />
              </svg>
              {t('editor.photoReorder.randomShuffle')}
            </button>

            {filledItems.length < 2 ? (
              <p className="text-[11px] text-[var(--color-gray-500)] text-center py-3">
                {t('editor.photoReorder.insufficient')}
              </p>
            ) : (
              <>
                <p className="text-[10px] text-[var(--color-gray-400)] mb-2 text-center">
                  {t('editor.photoReorder.dragHint')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {filledItems.map((pl, i) => {
                    const photo = pl.photoId ? photoMap.get(pl.photoId) : undefined;
                    return (
                      <ReorderThumbnail
                        key={pl.slotId}
                        photo={photo}
                        index={i}
                        isDragged={dragIndex === pl.index}
                        isActive={dragOverIndex === i && dragIndex !== pl.index}
                        onMouseDown={(e) => handleMouseDown(e, pl.index)}
                        itemRef={(el) => { itemRefs.current[i] = el; }}
                      />
                    );
                  })}
                </div>

                {/* 拖拽跟随缩略图：独立组件使用 usePhotoSrc，通过 blobUrlCache 即时取图 */}
                {dragIndex !== null && dragPos && (
                  <DragGhostThumbnail photo={draggedPhoto} pos={dragPos} />
                )}
              </>
            )}
          </>
      </div>
    </div>
  );
}
