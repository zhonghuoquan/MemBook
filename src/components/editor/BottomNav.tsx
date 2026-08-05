import { useMemo, useState, useCallback, useRef, useEffect, forwardRef, memo } from 'react';
import { useEditorStore, usePhotoStore, useUIStore, useHistoryStore } from '../../store';
import { GOOGLE_PHOTOS_TEMPLATE_ID, resolveTemplate, type SlotOverride, type SlotLayout } from '../../types';
import { MM_TO_PX, computeZoomedScroll, computeCenteredScroll } from '../../utils/sharedRender';
import CanvasPageThumbnail from '../common/CanvasPageThumbnail';
import type { AlbumPage, Template, Photo, PhotoPlacement, PageTextElement, StickyNote, StickerElement } from '../../types';
import { readPhotoFromDB, readDirectPhoto } from '../../engine/storage-engine';
import { FullscreenView } from './FullscreenView';
import { Tooltip } from '../common/Tooltip';
import { LRUCache } from '../../utils/lruCache';
import { useTranslation } from 'react-i18next';

const MIN_NAV_HEIGHT = 90;
const MAX_NAV_HEIGHT = 280;
const NAV_STORAGE_KEY = 'membook-bottom-nav-height';

/* ── 剪贴板数据：支持整页或单个元素复制/粘贴 ──
 * placement 类型扩展：携带 slotOverride（槽位几何）与 slotLayout（用于无空槽时重建槽位）
 * 这样粘贴时不仅复制照片属性，还复制槽位的尺寸/位置，实现"完整照片位"复制
 */
type ClipboardData =
  | { type: 'page'; page: AlbumPage }
  | { type: 'placement'; placement: PhotoPlacement; slotOverride?: SlotOverride; slotLayout?: SlotLayout }
  | { type: 'text'; element: PageTextElement }
  | { type: 'sticky'; note: StickyNote }
  | { type: 'sticker'; sticker: StickerElement };

/** 粘贴单个元素时的位置偏移（mm） */
const PASTE_OFFSET_MM = 10;

function loadSavedHeight(): number {
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (saved) {
      const h = parseInt(saved, 10);
      if (!isNaN(h) && h >= MIN_NAV_HEIGHT && h <= MAX_NAV_HEIGHT) return h;
    }
  } catch { /* ignore */ }
  return 150;
}

export function BottomNav() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const pages = useEditorStore((s) => s.pages);
  const insertPage = useEditorStore((s) => s.insertPage);
  const copyPage = useEditorStore((s) => s.copyPage);
  const removePage = useEditorStore((s) => s.removePage);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const addTextElement = useEditorStore((s) => s.addTextElement);
  const addStickyNote = useEditorStore((s) => s.addStickyNote);
  const addStickerElement = useEditorStore((s) => s.addStickerElement);
  const photos = usePhotoStore((s) => s.photos);
  const bottomNav = useUIStore((s) => s.bottomNav);
  const toggleBottomNav = useUIStore((s) => s.toggleBottomNav);
  const navHeight = useUIStore((s) => s.bottomNavHeight);
  const setBottomNavHeight = useUIStore((s) => s.setBottomNavHeight);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const setCanvasZoom = useUIStore((s) => s.setCanvasZoom);
  const viewMode = useUIStore((s) => s.viewMode);
  const addToast = useUIStore((s) => s.addToast);
  const setDraggingLayout = useUIStore((s) => s.setDraggingLayout);

  // 防止页面删除/隐藏后 currentPageIndex 越界，确保底部缩略图只有一页高亮
  const safeCurrentIndex = Math.min(currentPageIndex, pages.length - 1);

  useEffect(() => {
    if (currentPageIndex >= pages.length && pages.length > 0) {
      setCurrentPage(pages.length - 1);
    }
  }, [currentPageIndex, pages.length, setCurrentPage]);

  // 对数映射滑块：低倍率区精度更高
  const ZOOM_MIN = 0.1, ZOOM_MAX = 5.0, ZOOM_RATIO = ZOOM_MAX / ZOOM_MIN;
  const sliderVal = useMemo(() => Math.round(Math.log(canvasZoom / ZOOM_MIN) / Math.log(ZOOM_RATIO) * 1000), [canvasZoom]);

  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isEditingPageNumber, setIsEditingPageNumber] = useState(false);
  const [pageNumberInput, setPageNumberInput] = useState('');
  const pageNumberInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const thumbElsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  const dragRef = useRef({ active: false, src: -1, over: -1, preview: null as HTMLElement | null, ox: 0, oy: 0, startX: 0, startY: 0, moved: false });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 剪贴板：可存放整页或单个元素（照片槽/文字/便利贴）
  const clipboardRef = useRef<ClipboardData | null>(null);
  const bottomNavRef = useRef<HTMLElement>(null);

  const collapsed = bottomNav === 'collapsed';

  // ── 根据相册宽高比和导航栏高度动态计算缩略图尺寸 ──
  const albumSize = useEditorStore((s) => s.albumSize);
  const albumAspect = useMemo(() => {
    if (!albumSize || albumSize.width === 0 || albumSize.height === 0) return 3 / 4;
    return albumSize.width / albumSize.height;
  }, [albumSize]);

  // 当前页面逻辑尺寸（用于缩放锚点计算）
  const CANVAS_W = albumSize ? albumSize.width * MM_TO_PX : 0;
  const CANVAS_H = albumSize ? albumSize.height * MM_TO_PX : 0;

  const thumbSize = useMemo(() => {
    if (collapsed) return { w: 36, h: 48 };
    // navHeight 现在只控制缩略图区域 max-height
    // 开销：拖拽手柄(6) + row py-1(8) + 页码(16) + 缓冲(5)
    const availH = Math.max(28, navHeight - 35);
    const h = Math.min(128, availH);
    const w = Math.max(20, Math.round(h * albumAspect));
    return { w, h };
  }, [navHeight, collapsed, albumAspect]);

  // ── 选中页自动居中滚动（虚拟滚动下先跳近似位置再精确定位）──
  const scrollToPage = useCallback((pageIndex: number, retry = 0) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const thumb = thumbElsRef.current.get(pageIndex);
    if (!thumb) {
      // 缩略图尚未渲染：先滚动到近似位置，触发虚拟范围更新后再精确定位
      const unit = 26 + thumbSize.w;
      const pageCenter = 11 + unit * pageIndex + thumbSize.w / 2;
      const target = pageCenter - container.clientWidth / 2;
      const maxScroll = container.scrollWidth - container.clientWidth;
      const bounded = Math.max(0, Math.min(target, maxScroll));
      if (Math.abs(container.scrollLeft - bounded) > 2) {
        container.scrollTo({ left: bounded, behavior: retry === 0 ? 'auto' : 'smooth' });
      }
      if (retry < 5) requestAnimationFrame(() => scrollToPage(pageIndex, retry + 1));
      return;
    }
    const cr = container.getBoundingClientRect();
    if (cr.width === 0) return;
    const tr = thumb.getBoundingClientRect();
    const center = (tr.left + tr.width / 2) - cr.left + container.scrollLeft;
    const target = center - container.clientWidth / 2;
    const maxScroll = container.scrollWidth - container.clientWidth;
    const bounded = Math.max(0, Math.min(target, maxScroll));
    if (Math.abs(container.scrollLeft - bounded) > 2) container.scrollTo({ left: bounded, behavior: 'smooth' });
  }, [thumbSize.w]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => scrollToPage(currentPageIndex));
    return () => cancelAnimationFrame(raf);
  }, [currentPageIndex, scrollToPage]);

  // 页面通过其他方式切换时，关闭页码输入框
  useEffect(() => {
    if (isEditingPageNumber) setIsEditingPageNumber(false);
  }, [safeCurrentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 缩略图渲染用照片查找表，只传递每页用到的照片并保持引用稳定 ──
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    for (const p of photos) map.set(p.id, p);
    return map;
  }, [photos]);

  const pagePhotosCacheRef = useRef<Map<string, Photo[]>>(new Map());
  const pagePhotosMap = useMemo(() => {
    const result = new Map<string, Photo[]>();
    for (const page of pages) {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const pl of page.placements) {
        if (pl.photoId && !seen.has(pl.photoId)) {
          ids.push(pl.photoId);
          seen.add(pl.photoId);
        }
      }
      const cached = pagePhotosCacheRef.current.get(page.id);
      const same = cached &&
        cached.length === ids.length &&
        ids.every((id, i) => cached[i].id === id && cached[i] === photoMap.get(id));
      if (same) {
        result.set(page.id, cached!);
      } else {
        const arr = ids.map(id => photoMap.get(id)).filter((p): p is Photo => !!p);
        result.set(page.id, arr);
        pagePhotosCacheRef.current.set(page.id, arr);
      }
    }
    // 清理已删除页面的缓存
    for (const id of pagePhotosCacheRef.current.keys()) {
      if (!pages.some(p => p.id === id)) pagePhotosCacheRef.current.delete(id);
    }
    return result;
  }, [pages, photoMap]);

  // ── 缩略图滚动区域虚拟滚动状态 ──
  const [scrollState, setScrollState] = useState({ left: 0, width: 0 });
  const [scrollActive, setScrollActive] = useState(false);
  const scrollActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateScrollbar = useCallback(() => {
    setScrollActive(true);
    if (scrollActiveTimerRef.current) clearTimeout(scrollActiveTimerRef.current);
    scrollActiveTimerRef.current = setTimeout(() => setScrollActive(false), 1500);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => {
      setScrollState({ left: container.scrollLeft, width: container.clientWidth });
      activateScrollbar();
    };
    update();
    container.addEventListener('scroll', update, { passive: true });

    // 缩略图区域滚轮 → 转换为横向滚动，并阻止冒泡/默认行为，避免触发画布翻页
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      container.scrollBy({ left: delta, behavior: 'auto' });
      activateScrollbar();
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => {
      container.removeEventListener('scroll', update);
      container.removeEventListener('wheel', onWheel);
      ro.disconnect();
      if (scrollActiveTimerRef.current) clearTimeout(scrollActiveTimerRef.current);
    };
  }, [activateScrollbar]);

  // ── 初始化时从 localStorage 读入 store ──
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    setBottomNavHeight(loadSavedHeight());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 垂直拖拽调整高度（同步到 store）──
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startY.current = e.clientY;
    startH.current = useUIStore.getState().bottomNavHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    setDraggingLayout(true);

    let rafId = 0;
    let tempHeight = startH.current;
    const onMove = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement)?.closest?.('.fixed.inset-0')) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const delta = ev.clientY - startY.current;
        tempHeight = Math.min(MAX_NAV_HEIGHT, Math.max(MIN_NAV_HEIGHT, startH.current - delta));
        setBottomNavHeight(tempHeight);
      });
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setBottomNavHeight(tempHeight);
      setDraggingLayout(false);
      try { localStorage.setItem(NAV_STORAGE_KEY, String(tempHeight)); } catch { /* */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setBottomNavHeight, setDraggingLayout]);
  useEffect(() => {
    if (menuOpenIndex === null) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenIndex(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenIndex]);

  const handleInsertPage = useCallback((index: number) => {
    // Insert at position `index` → copy previous page's template (not photos)
    const prevPage = index > 0 ? pages[index - 1] : undefined;
    const tplId = prevPage?.templateId;
    insertPage(index, tplId === GOOGLE_PHOTOS_TEMPLATE_ID ? 'pin-shape' : tplId);
    addToast({ type: 'success', message: t('editor.bottomNav.pageInserted') });
    setInsertIndex(null);
  }, [pages, insertPage, addToast]);

  // ── Page menu actions ──
  const handleCopyPage = useCallback((index: number) => {
    copyPage(index);
    addToast({ type: 'success', message: t('editor.bottomNav.pageCopied') });
    setMenuOpenIndex(null);
  }, [copyPage, addToast]);

  const handleCopyStyle = useCallback((index: number) => {
    if (pages[index]) {
      setPageTemplate(currentPageIndex, pages[index].templateId);
      addToast({ type: 'success', message: t('editor.bottomNav.pageStyleApplied') });
    }
    setMenuOpenIndex(null);
  }, [pages, currentPageIndex, setPageTemplate, addToast]);

  const handleDeletePage = useCallback((index: number) => {
    // If deleting current page, navigate to a safe page first
    if (index === currentPageIndex) {
      const target = index > 0 ? index - 1 : 0;
      setCurrentPage(target);
    } else if (index < currentPageIndex) {
      // Adjust currentPageIndex when deleting a page before it
      setCurrentPage(currentPageIndex - 1);
    }
    removePage(index);
    addToast({ type: 'info', message: t('editor.bottomNav.pageDeleted') });
    setMenuOpenIndex(null);
  }, [pages, currentPageIndex, removePage, setCurrentPage, addToast]);

  // ── 页面级快捷键：左右切换、Delete 删除、Ctrl+C/V 复制粘贴 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框内不响应
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // 页面菜单打开时不响应
      if (menuOpenIndex !== null) return;
      // 网格视图由 GridView 自己处理快捷键，底部缩略图不拦截
      if (viewMode === 'grid') return;

      const { selectedSlotId } = useEditorStore.getState();
      const { editFlyoutOpen } = useUIStore.getState();

      // 左右方向键：编辑照片位时不切换页面
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(editFlyoutOpen && selectedSlotId)) {
        if (e.key === 'ArrowLeft' && currentPageIndex > 0) {
          e.preventDefault();
          setCurrentPage(currentPageIndex - 1);
        } else if (e.key === 'ArrowRight' && currentPageIndex < pages.length - 1) {
          e.preventDefault();
          setCurrentPage(currentPageIndex + 1);
        }
        return;
      }

      // Delete / Backspace：删除当前页面（仅在无选中元素时触发）
      // 选中了元素（照片槽/文字/便利贴/贴纸）时交由画布的 useCanvasKeyboard 处理元素删除
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.altKey) {
        const state = useEditorStore.getState();
        const { selectedSlotId, selectedTextId, selectedStickyId, selectedStickerId } = state;
        const page = state.pages[currentPageIndex];
        const hasSelectedElement =
          !!selectedSlotId ||
          !!selectedTextId ||
          !!selectedStickyId ||
          !!selectedStickerId;
        // 进一步校验选中元素在当前页确实存在（避免选中态残留导致 Delete 失效）
        const selectedExistsInPage = page && (
          (selectedSlotId && page.placements.some((p) => p.slotId === selectedSlotId)) ||
          (selectedTextId && page.textElements?.some((t) => t.id === selectedTextId)) ||
          (selectedStickyId && page.stickyNotes?.some((n) => n.id === selectedStickyId)) ||
          (selectedStickerId && page.stickerElements?.some((s) => s.id === selectedStickerId))
        );
        if (hasSelectedElement && selectedExistsInPage) {
          // 让画布处理器（冒泡阶段）处理元素删除
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleDeletePage(currentPageIndex);
        return;
      }

      // Ctrl+C：优先复制选中元素（照片槽/文字/便利贴/贴纸），无选中则复制整页
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const state = useEditorStore.getState();
        const { selectedSlotId, selectedTextId, selectedStickyId, selectedStickerId } = state;
        const page = state.pages[currentPageIndex];
        if (!page) return;

        // 1. 选中了照片槽且有照片：复制 placement（含照片与编辑状态）+ 槽位几何（slotOverride + slotLayout）
        //    这样粘贴时可完整重建"照片位+照片"组合，而非仅复制照片到其他空槽位
        if (selectedSlotId) {
          const pl = page.placements.find((p) => p.slotId === selectedSlotId);
          if (pl && pl.photoId) {
            // 槽位几何：优先取 slotOverrides（用户自定义），无则从模板/extraSlots 取默认布局
            const slotOverride = page.slotOverrides?.[selectedSlotId];
            // 从模板定义或 extraSlots 中查找槽位默认 layout（百分比坐标）
            const tpl = resolveTemplate(page);
            const slotDef = tpl?.slots.find((s) => s.id === selectedSlotId);
            const slotLayout: SlotLayout | undefined = slotDef
              ? { id: slotDef.id, x: slotDef.x, y: slotDef.y, width: slotDef.width, height: slotDef.height }
              : page.extraSlots?.find((s) => s.id === selectedSlotId);
            clipboardRef.current = {
              type: 'placement',
              placement: JSON.parse(JSON.stringify(pl)),
              slotOverride: slotOverride ? JSON.parse(JSON.stringify(slotOverride)) : undefined,
              slotLayout: slotLayout ? JSON.parse(JSON.stringify(slotLayout)) : undefined,
            };
            addToast({ type: 'success', message: t('editor.bottomNav.slotCopied') });
            return;
          }
        }
        // 2. 选中了文字元素：复制文字
        if (selectedTextId) {
          const el = page.textElements?.find((t) => t.id === selectedTextId);
          if (el) {
            clipboardRef.current = { type: 'text', element: JSON.parse(JSON.stringify(el)) };
            addToast({ type: 'success', message: t('editor.bottomNav.textCopied') });
            return;
          }
        }
        // 3. 选中了便利贴：复制便利贴
        if (selectedStickyId) {
          const note = page.stickyNotes?.find((n) => n.id === selectedStickyId);
          if (note) {
            clipboardRef.current = { type: 'sticky', note: JSON.parse(JSON.stringify(note)) };
            addToast({ type: 'success', message: t('editor.bottomNav.stickyCopied') });
            return;
          }
        }
        // 4. 选中了贴纸：复制贴纸元素
        if (selectedStickerId) {
          const st = page.stickerElements?.find((s) => s.id === selectedStickerId);
          if (st) {
            clipboardRef.current = { type: 'sticker', sticker: JSON.parse(JSON.stringify(st)) };
            addToast({ type: 'success', message: t('editor.bottomNav.stickerCopied') });
            return;
          }
        }
        // 5. 无选中元素：复制整页
        clipboardRef.current = { type: 'page', page: JSON.parse(JSON.stringify(page)) };
        addToast({ type: 'success', message: t('editor.bottomNav.pageCopiedToast') });
        return;
      }

      // Ctrl+V：根据剪贴板内容类型决定粘贴行为
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        const clip = clipboardRef.current;
        if (!clip) {
          addToast({ type: 'warning', message: t('editor.bottomNav.clipboardEmpty') });
          return;
        }

        // 整页粘贴：在当前页后插入新页面并跳转
        if (clip.type === 'page') {
          const newPage: AlbumPage = {
            ...JSON.parse(JSON.stringify(clip.page)),
            id: `page-${Date.now()}`,
          };
          useEditorStore.getState().appendPages(currentPageIndex, [newPage]);
          setCurrentPage(currentPageIndex + 1);
          addToast({ type: 'success', message: t('editor.bottomNav.pagePasted') });
          return;
        }

        // 单个元素粘贴：在当前页粘贴，新 ID + 位置偏移 PASTE_OFFSET_MM
        const state = useEditorStore.getState();
        const page = state.pages[currentPageIndex];
        if (!page) return;

        if (clip.type === 'placement') {
          // 照片槽位粘贴：完整复制"槽位+照片"组合
          // 策略：
          //   1. 优先找空槽位（template.slots + extraSlots，跳过源槽位）复用几何
          //   2. 若无空槽位，自动创建新槽位（extraSlots + slotOverride 复制源槽位几何）
          //   3. 跨槽位粘贴时重置 panX/panY/panScale（与 swapPagePhotoPlacements 一致），
          //      避免 pan 是相对原槽位尺寸的，新槽位尺寸不同时照片位置错位
          const template = resolveTemplate(page);
          if (!template) return;

          // 1. 查找空槽位（合并 template.slots + extraSlots）
          const allSlots: SlotLayout[] = [...template.slots];
          const seenIds = new Set(template.slots.map((s) => s.id));
          for (const s of page.extraSlots ?? []) {
            if (!seenIds.has(s.id)) { allSlots.push(s); seenIds.add(s.id); }
          }
          const emptySlot = allSlots.find((slot) => {
            if (slot.id === clip.placement.slotId) return false; // 跳过源槽位
            const pl = page.placements.find((p) => p.slotId === slot.id);
            return !pl || !pl.photoId;
          });

          // 2. 无空槽位时创建新槽位（基于源槽位几何 + PASTE_OFFSET_MM 偏移）
          let targetSlotId: string;
          let targetSlotOverride: SlotOverride | undefined;
          let newExtraSlots = page.extraSlots ? [...page.extraSlots] : [];
          let newSlotOrder = page.slotOrder ? [...page.slotOrder] : [];
          let newSlotZIndices = page.slotZIndices ? { ...page.slotZIndices } : undefined;

          if (emptySlot) {
            targetSlotId = emptySlot.id;
          } else {
            // 创建新槽位：基于源 slotLayout（百分比坐标），加 PASTE_OFFSET_MM 偏移（转换为百分比）
            const albumSize = state.albumSize;
            if (!albumSize || !clip.slotLayout) {
              addToast({ type: 'warning', message: t('editor.bottomNav.noEmptySlot') });
              return;
            }
            const newSlotId = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // 偏移量转百分比（PASTE_OFFSET_MM 是 mm，需除以页面尺寸 mm）
            const offsetXPercent = (PASTE_OFFSET_MM / albumSize.width) * 100;
            const offsetYPercent = (PASTE_OFFSET_MM / albumSize.height) * 100;
            const newSlotLayout: SlotLayout = {
              id: newSlotId,
              x: Math.max(0, Math.min(70, clip.slotLayout.x + offsetXPercent)),
              y: Math.max(0, Math.min(70, clip.slotLayout.y + offsetYPercent)),
              width: clip.slotLayout.width,
              height: clip.slotLayout.height,
            };
            newExtraSlots.push(newSlotLayout);
            // 新槽位加入 slotOrder 末尾（后渲染 = 上层）
            newSlotOrder.push(newSlotId);
            // 若源槽位有 slotOverride，也复制一份并加偏移
            if (clip.slotOverride) {
              const px = MM_TO_PX;
              targetSlotOverride = {
                x: clip.slotOverride.x + PASTE_OFFSET_MM * px,
                y: clip.slotOverride.y + PASTE_OFFSET_MM * px,
                width: clip.slotOverride.width,
                height: clip.slotOverride.height,
              };
            }
            // 新槽位置顶层（跨装饰元素），与 addPhotoSlot 行为一致
            const allZs = Object.values(newSlotZIndices ?? {});
            const maxZ = allZs.length > 0 ? Math.max(...allZs) : 0;
            if (!newSlotZIndices) newSlotZIndices = {};
            newSlotZIndices[newSlotId] = maxZ + 1;
            targetSlotId = newSlotId;
          }

          // 3. 构建新 placement：复制源 placement 但重置 pan 相关字段
          const sourcePl = JSON.parse(JSON.stringify(clip.placement)) as PhotoPlacement;
          const newPlacement: PhotoPlacement = {
            ...sourcePl,
            slotId: targetSlotId,
            // 重置 pan：跨槽位粘贴后旧 pan 无意义，由渲染层按新槽位尺寸重新居中 cover-fit
            panX: undefined,
            panY: undefined,
            panScale: undefined,
          };

          const newPages = [...state.pages];
          const existIdx = page.placements.findIndex((p) => p.slotId === targetSlotId);
          const newPlacements = existIdx >= 0
            ? page.placements.map((p, i) => (i === existIdx ? newPlacement : p))
            : [...page.placements, newPlacement];

          // 合并 slotOverrides（若创建了新槽位且有自定义几何）
          const newSlotOverrides = targetSlotOverride
            ? { ...(page.slotOverrides || {}), [targetSlotId]: targetSlotOverride }
            : page.slotOverrides;

          newPages[currentPageIndex] = {
            ...page,
            placements: newPlacements,
            extraSlots: newExtraSlots,
            slotOrder: newSlotOrder,
            slotZIndices: newSlotZIndices,
            slotOverrides: newSlotOverrides,
          };
          useEditorStore.setState({ pages: newPages, selectedSlotId: targetSlotId });
          useHistoryStore.getState().pushSnapshot(newPages, targetSlotId);
          addToast({ type: 'success', message: t('editor.bottomNav.photoPasted') });
          return;
        }

        if (clip.type === 'text') {
          // 文字元素：新 ID + 位置偏移，zIndex 由 addTextElement 自动分配
          const newEl: PageTextElement = {
            ...JSON.parse(JSON.stringify(clip.element)),
            id: `text-${Date.now()}`,
            x: clip.element.x + PASTE_OFFSET_MM,
            y: clip.element.y + PASTE_OFFSET_MM,
          };
          addTextElement(currentPageIndex, newEl);
          addToast({ type: 'success', message: t('editor.bottomNav.textPasted') });
          return;
        }

        if (clip.type === 'sticky') {
          // 便利贴：新 ID + 位置偏移，zIndex 由 addStickyNote 自动分配
          const newNote: StickyNote = {
            ...JSON.parse(JSON.stringify(clip.note)),
            id: `sticky-${Date.now()}`,
            x: clip.note.x + PASTE_OFFSET_MM,
            y: clip.note.y + PASTE_OFFSET_MM,
          };
          addStickyNote(currentPageIndex, newNote);
          addToast({ type: 'success', message: t('editor.bottomNav.stickyPasted') });
          return;
        }

        if (clip.type === 'sticker') {
          // 贴纸：新 ID + 位置偏移，zIndex 由 addStickerElement 自动分配
          const newSticker: StickerElement = {
            ...JSON.parse(JSON.stringify(clip.sticker)),
            id: `sticker-el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            x: clip.sticker.x + PASTE_OFFSET_MM,
            y: clip.sticker.y + PASTE_OFFSET_MM,
          };
          addStickerElement(currentPageIndex, newSticker);
          addToast({ type: 'success', message: t('editor.bottomNav.stickerPasted') });
          return;
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [currentPageIndex, pages.length, menuOpenIndex, handleDeletePage, addToast, viewMode, addTextElement, addStickyNote, addStickerElement]);

  const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

  // ── 页码输入跳转 ──
  const handlePageNumberClick = useCallback(() => {
    if (pages.length <= 1) return;
    setIsEditingPageNumber(true);
    setPageNumberInput(String(safeCurrentIndex + 1));
    requestAnimationFrame(() => {
      pageNumberInputRef.current?.focus();
      pageNumberInputRef.current?.select();
    });
  }, [pages.length, safeCurrentIndex]);

  const handlePageNumberSubmit = useCallback(() => {
    const num = parseInt(pageNumberInput, 10);
    if (!isNaN(num) && num >= 1 && num <= pages.length) {
      setCurrentPage(num - 1);
    }
    setIsEditingPageNumber(false);
  }, [pageNumberInput, pages.length, setCurrentPage]);

  const handlePageNumberKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePageNumberSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingPageNumber(false);
    }
  }, [handlePageNumberSubmit]);

  // ── 鼠标拖拽排序 ──
  const DRAG_THRESHOLD = 3;
  const handleThumbMouseDown = useCallback((e: React.MouseEvent, srcIndex: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(`[title="${t('editor.bottomNav.pageActions')}"]`)) return;
    const btn = (e.currentTarget as HTMLElement).querySelector('button');
    if (!btn) return;
    e.preventDefault();
    const rect = btn.getBoundingClientRect();
    const st = dragRef.current;
    st.active = true; st.src = srcIndex; st.over = -1; st.moved = false;
    st.startX = e.clientX; st.startY = e.clientY;
    st.ox = e.clientX - rect.left; st.oy = e.clientY - rect.top;
    document.body.style.userSelect = 'none';
    let rafId = 0;
    const startDrag = (ev: MouseEvent) => {
      if (st.moved) return;
      st.moved = true;
      setIsDraggingThumb(true);
      const preview = btn.cloneNode(true) as HTMLElement;
      Object.assign(preview.style, {
        position: 'fixed', left: `${ev.clientX - st.ox}px`, top: `${ev.clientY - st.oy}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: 'none',
        zIndex: '9999', opacity: '0.85', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      });
      document.body.appendChild(preview); st.preview = preview;
      (e.currentTarget as HTMLElement).style.opacity = '0.4';
      document.body.style.cursor = 'grabbing';
    };
    const onMove = (ev: MouseEvent) => {
      if (!st.active) return;
      if ((ev.target as HTMLElement)?.closest?.('.fixed.inset-0')) return;
      if (!st.moved) {
        const dx = Math.abs(ev.clientX - st.startX);
        const dy = Math.abs(ev.clientY - st.startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        startDrag(ev);
      }
      if (st.preview) { st.preview.style.left = `${ev.clientX - st.ox}px`; st.preview.style.top = `${ev.clientY - st.oy}px`; }
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const container = scrollContainerRef.current;
        const found = (() => {
          if (!container || pages.length === 0) return -1;
          const cr = container.getBoundingClientRect();
          if (ev.clientY < cr.top || ev.clientY > cr.bottom) return -1;
          const x = ev.clientX - cr.left + container.scrollLeft;
          const unit = 26 + thumbSize.w;
          // gap index：0 表示第一页之前，pages.length 表示最后一页之后
          return Math.max(0, Math.min(pages.length, Math.round((x - 13) / unit)));
        })();
        if (found !== st.over) { st.over = found; setDragOverIdx(found >= 0 ? found : null); }
      });
    };
    const onUp = () => {
      if (!st.active) return; st.active = false;
      if (st.preview && st.preview.parentNode) st.preview.parentNode.removeChild(st.preview); st.preview = null;
      document.querySelectorAll('.group\\/thumb').forEach((el) => { if (el instanceof HTMLElement) el.style.opacity = ''; });
      if (st.moved) {
        // 拖拽结束：执行排序
        setIsDraggingThumb(false);
        const src = st.src;
        let target = st.over; // gap index 0..pages.length
        if (src >= 0 && target >= 0 && target !== src && target !== src + 1) {
          // 从 src 移到 gap target 之前；移除 src 后 target 会左移一位
          if (target > src) target--;
          reorderPages(src, target);
          setCurrentPage(target);
        }
      } else {
        // 未移动：视为点击，切换到对应页面
        if (srcIndex >= 0 && srcIndex < pages.length) {
          setCurrentPage(srcIndex);
        }
      }
      st.src = -1; st.over = -1; st.moved = false; setDragOverIdx(null);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, [reorderPages, setCurrentPage, thumbSize.w, pages.length]);

  // ── 切换缩略图显示（纯 CSS 过渡，工具栏不受影响）──
  const handleToggleThumbnails = useCallback(() => {
    const next = !showThumbnails;
    setShowThumbnails(next);
    if (next) setBottomNavHeight(loadSavedHeight());
  }, [showThumbnails, setBottomNavHeight]);

  // ── 底部缩略图虚拟滚动：只渲染可见单元，减少大量页面时的 DOM 开销 ──
  const GAP_WIDTH = 26;
  const UNIT_WIDTH = GAP_WIDTH + thumbSize.w;
  const virtualBuffer = 2;
  const virtualStart = isDraggingThumb
    ? 0
    : Math.max(0, Math.floor(scrollState.left / UNIT_WIDTH) - virtualBuffer);
  const virtualEnd = isDraggingThumb
    ? pages.length - 1
    : Math.min(pages.length - 1, Math.ceil((scrollState.left + scrollState.width) / UNIT_WIDTH) + virtualBuffer);
  const totalContentWidth = pages.length * UNIT_WIDTH + GAP_WIDTH;
  const leadingSpacer = virtualStart * UNIT_WIDTH;
  const trailingInsertVisible = isDraggingThumb || pages.length * UNIT_WIDTH < scrollState.left + scrollState.width + virtualBuffer * UNIT_WIDTH;
  const trailingSpacer = Math.max(0, (pages.length - virtualEnd - 1) * UNIT_WIDTH + (trailingInsertVisible ? 0 : GAP_WIDTH));

  return (
    <nav
      ref={bottomNavRef}
      data-onboarding="bottom-nav"
      className="bg-white border-t border-[var(--color-border)] flex flex-col shrink-0 relative"
    >
      {/* ══════════ Thumb Area（独立折叠，不影响工具栏）══════ */}
      {!collapsed && (
        <div
          data-thumb-area
          className="border-b border-[var(--color-border)] overflow-hidden"
          style={{
            maxHeight: showThumbnails ? `${navHeight}px` : '0px',
            opacity: showThumbnails ? 1 : 0,
            transition: 'max-height 300ms ease-out, opacity 250ms ease-out',
            willChange: 'max-height, opacity',
          }}
        >
        {/* Drag handle (top edge) */}
        <div
          className="relative h-1.5 cursor-row-resize z-10 group"
          onMouseDown={handleResizeMouseDown}
        >
          <div className="w-8 h-0.5 mx-auto rounded-full bg-[var(--color-border)] opacity-0 group-hover:opacity-60 group-active:opacity-100 transition-opacity absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="flex items-center px-1.5 py-1">
          {/* Thumbnails scroll area */}
          <div
            ref={scrollContainerRef}
            className={`flex-1 flex items-center overflow-x-auto nav-scroll-x py-1 ${scrollActive ? 'nav-scroll-x-active' : ''}`}
            onMouseLeave={() => setInsertIndex(null)}
          >
            {pages.length === 0 ? (
              <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] px-2">{t('editor.bottomNav.noPages')}</div>
            ) : (
              <div className="flex items-center" style={{ minWidth: totalContentWidth }}>
                <div style={{ width: leadingSpacer, flexShrink: 0 }} />
                {pages.slice(virtualStart, virtualEnd + 1).map((page, offset) => {
                  const i = virtualStart + offset;
                  let shiftX = 0;
                  // 悬停插入：在 insertIndex 处打开缺口（insertIndex 即缺口索引，位于 page insertIndex-1 与 insertIndex 之间）
                  if (insertIndex !== null) {
                    if (i === insertIndex) shiftX += 14;
                    if (i === insertIndex - 1) shiftX -= 14;
                  }
                  // 拖拽排序：在 dragOverIdx 处打开缺口，与对应 InsertZone 对齐
                  const isDropTarget = isDraggingThumb && dragOverIdx !== null && dragOverIdx !== dragRef.current.src && dragOverIdx !== dragRef.current.src + 1;
                  if (isDropTarget) {
                    if (i === dragOverIdx) shiftX += 14;
                    if (i === dragOverIdx - 1) shiftX -= 14;
                  }
                  return (
                  <div key={page.id} className="flex items-center">
                    <InsertZone index={i} isActive={insertIndex === i} isDropTarget={isDropTarget && dragOverIdx === i}
                      onActivate={() => setInsertIndex(i)} onDeactivate={() => setInsertIndex(null)}
                      onInsert={() => handleInsertPage(i)} thumbH={thumbSize.h} disabled={dragRef.current.active} />
                    <div className="flex flex-col items-center gap-0.5 flex-shrink-0 relative transition-transform duration-300 ease-out"
                      style={{ transform: shiftX !== 0 ? `translateX(${shiftX}px)` : undefined }}>
                      <div className="relative group/thumb"
                        onMouseDown={(e) => handleThumbMouseDown(e, i)}
                      >
                        <button
                          ref={(el) => { if (el) thumbElsRef.current.set(i, el); else thumbElsRef.current.delete(i); }}
                          className={`rounded-[var(--radius-xs)] overflow-hidden border-2 cursor-pointer transition-[border-color,transform] duration-150 p-0 relative block ${
                            i === safeCurrentIndex
                              ? 'border-[var(--color-brand)] scale-105 shadow-[0_2px_8px_rgba(108,99,255,0.2)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-gray-400)]'
                          }`}
                          style={{ backgroundColor: page.background, width: thumbSize.w, height: thumbSize.h }}
                        >
                          <PageThumbnail page={page} template={resolveTemplate(page)} pagePhotos={pagePhotosMap.get(page.id) || []} thumbW={thumbSize.w - 4} thumbH={thumbSize.h - 4} />
                        </button>
                        <button
                          ref={(el) => { if (el) moreBtnRefs.current.set(i, el); }}
                          className="absolute top-1 right-1 w-[22px] h-[22px] flex items-center justify-center bg-black/40 border border-white/20 rounded-full text-white opacity-0 group-hover/thumb:opacity-100 hover:bg-black/60 hover:scale-110 transition-all duration-150 cursor-pointer z-10 backdrop-blur-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (menuOpenIndex === i) { setMenuOpenIndex(null); return; }
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setMenuStyle({ right: window.innerWidth - rect.right + 8, top: rect.top - 4, transform: 'translateY(-100%)' });
                            setMenuOpenIndex(i);
                          }}
                          title={t('editor.bottomNav.pageActions')}
                        >
                          <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                            <circle cx="6" cy="2.5" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="6" cy="9.5" r="1.2" />
                          </svg>
                        </button>
                        {menuOpenIndex === i && (
                          <PageMenu ref={menuRef} style={menuStyle} pageIndex={i} pageCount={pages.length}
                            onCopy={() => handleCopyPage(i)} onCopyStyle={() => handleCopyStyle(i)}
                            onDelete={() => handleDeletePage(i)} onClose={() => setMenuOpenIndex(null)} />
                        )}
                      </div>
                      <span className={`text-[10px] leading-tight ${i === safeCurrentIndex ? 'text-[var(--color-brand)] font-[600]' : 'text-[var(--color-gray-500)]'}`}>{i + 1}</span>
                    </div>
                  </div>
                );})}
                {trailingInsertVisible && (
                  <InsertZone index={pages.length} isActive={insertIndex === pages.length}
                    isDropTarget={isDraggingThumb && dragOverIdx === pages.length}
                    onActivate={() => setInsertIndex(pages.length)} onDeactivate={() => setInsertIndex(null)}
                    onInsert={() => handleInsertPage(pages.length)} thumbH={thumbSize.h} disabled={dragRef.current.active} />
                )}
                <div style={{ width: trailingSpacer, flexShrink: 0 }} />
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ══════════ Tool Bar（始终固定，不受折叠影响）══ */}
      {!collapsed && (
        <div className="flex items-center justify-end gap-4 px-3 py-2 shrink-0">
          {/* Zoom slider — 对数映射，低倍率区精度更高 */}
          <div className="flex items-center gap-2">
            <Tooltip text={t('editor.bottomNav.zoomLevel', { percent: formatPercent(canvasZoom) })}>
              <input
                type="range"
                min="0"
                max="1000"
                step="1"
                value={sliderVal}
                onChange={(e) => {
                  const pos = parseFloat(e.target.value) / 1000;
                  const newZoom = Math.max(0.1, Math.min(5, ZOOM_MIN * Math.pow(ZOOM_RATIO, pos)));
                  const oldZoom = useUIStore.getState().canvasZoom;
                  if (Math.abs(newZoom - oldZoom) < 0.001 || CANVAS_W === 0 || CANVAS_H === 0) {
                    setCanvasZoom(newZoom);
                    return;
                  }
                  const container = document.querySelector('[data-canvas-container]') as HTMLElement | null;
                  if (!container) {
                    setCanvasZoom(newZoom);
                    return;
                  }
                  const { scrollLeft, scrollTop } = computeZoomedScroll(
                    container,
                    CANVAS_W,
                    CANVAS_H,
                    oldZoom,
                    newZoom,
                    { x: container.clientWidth / 2, y: container.clientHeight / 2 },
                  );
                  setCanvasZoom(newZoom);
                  requestAnimationFrame(() => {
                    container.scrollLeft = scrollLeft;
                    container.scrollTop = scrollTop;
                  });
                }}
                className="w-32 h-1.5 cursor-pointer accent-[var(--color-brand)]"
              />
            </Tooltip>
            <span className="text-[var(--text-caption)] text-[var(--color-gray-600)] min-w-[2.5em] tabular-nums select-none">
              {formatPercent(canvasZoom)}
            </span>
            <Tooltip text={t('editor.bottomNav.resetZoom')}>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-white text-[var(--text-caption)] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors shrink-0"
                onClick={() => {
                  setCanvasZoom(1);
                  // 重置后让页面回到视口中央，与最大化/最小化居中行为一致
                  const container = document.querySelector('[data-canvas-container]') as HTMLElement | null;
                  if (container && CANVAS_W > 0 && CANVAS_H > 0) {
                    const { scrollLeft, scrollTop } = computeCenteredScroll(container, CANVAS_W, CANVAS_H, 1);
                    requestAnimationFrame(() => {
                      container.scrollLeft = scrollLeft;
                      container.scrollTop = scrollTop;
                    });
                  }
                }}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M2 7a5 5 0 1 0 1.5-3.5" /><path d="M2 2v3h3" />
                </svg>
                <span className="font-[500]">{t('common.reset')}</span>
              </button>
            </Tooltip>
          </div>

          {/* Page / Thumbnails toggle */}
          <Tooltip text={showThumbnails ? t('editor.bottomNav.hideThumbnails') : t('editor.bottomNav.showThumbnails')}>
            <button
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border cursor-pointer transition-colors ${
                showThumbnails
                  ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)]'
              }`}
              onClick={handleToggleThumbnails}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <rect x="1" y="1" width="12" height="12" rx="1.5" />
                <rect x="3" y="3" width="3.5" height="3.5" rx="0.5" />
                <rect x="7.5" y="3" width="3.5" height="3.5" rx="0.5" />
                <rect x="3" y="7.5" width="3.5" height="3.5" rx="0.5" />
              </svg>
              <span className="text-[var(--text-caption)] font-[500]">{t('editor.bottomNav.pages')}</span>
            </button>
          </Tooltip>

          {/* Page counter */}
          {isEditingPageNumber ? (
            <div className="flex items-center gap-0.5 text-[var(--text-body-sm)] text-[var(--color-gray-700)] font-[500] tabular-nums">
              <input
                ref={pageNumberInputRef}
                type="text"
                inputMode="numeric"
                value={pageNumberInput}
                onChange={(e) => setPageNumberInput(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={handlePageNumberKeyDown}
                onBlur={handlePageNumberSubmit}
                className="w-9 h-6 text-center text-[13px] border border-[var(--color-brand)] rounded-[var(--radius-xs)] outline-none focus:ring-2 focus:ring-[var(--color-primary-200)] bg-white text-[var(--color-gray-800)] px-1"
              />
              <span>{t('editor.bottomNav.pageCount', { count: pages.length })}</span>
            </div>
          ) : (
            <span
              className="text-[var(--text-body-sm)] text-[var(--color-gray-700)] font-[500] whitespace-nowrap tabular-nums cursor-pointer hover:text-[var(--color-brand)] transition-colors"
              onClick={handlePageNumberClick}
              title={pages.length > 1 ? t('editor.bottomNav.clickToJump') : undefined}
            >
              {safeCurrentIndex + 1}{t('editor.bottomNav.pageCount', { count: pages.length })}
            </span>
          )}

          {/* Grid view */}
          <Tooltip text={t('editor.viewModes.grid')}>
            <button
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border cursor-pointer transition-colors ${
                viewMode === 'grid'
                  ? 'border-[var(--color-brand)] bg-[var(--color-primary-50)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-white text-[var(--color-gray-600)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]'
              }`}
              onClick={() => useUIStore.getState().setViewMode('grid')}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
                <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
                <rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" />
              </svg>
              <span className="text-[var(--text-caption)] font-[500]">{t('editor.viewModes.grid')}</span>
            </button>
          </Tooltip>

          {/* Fullscreen */}
          <Tooltip text={t('editor.viewModes.fullscreen')}>
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-white text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)] transition-colors"
              onClick={() => setIsFullscreenOpen(true)}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M2 6V3a1 1 0 0 1 1-1h3" /><path d="M8 2h3a1 1 0 0 1 1 1v3" />
                <path d="M2 8v3a1 1 0 0 0 1 1h3" /><path d="M12 8v3a1 1 0 0 1-1 1H8" />
              </svg>
              <span className="text-[var(--text-caption)] font-[500]">{t('editor.viewModes.fullscreen')}</span>
            </button>
          </Tooltip>
        </div>
      )}

      {collapsed && (
        <div className="flex items-center w-full h-full px-3 justify-between">
          <button
            className="flex items-center gap-1 text-[var(--text-caption)] text-[var(--color-gray-500)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-700)]"
            onClick={toggleBottomNav}
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M3 2l4 3-4 3" />
            </svg>
            {t('editor.bottomNav.collapsedPageLabel', { current: safeCurrentIndex + 1, total: pages.length })}
          </button>
          <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
            {formatPercent(canvasZoom)}
          </span>
        </div>
      )}

      <FullscreenView
        open={isFullscreenOpen}
        onClose={() => setIsFullscreenOpen(false)}
        initialPageIndex={currentPageIndex}
      />
    </nav>
  );
}

/* ═══════════════════════════════════════
   插入区域 — 两个页面之间的「+」按钮
   ═══════════════════════════════════════ */

const INSERT_HOVER_DELAY = 300;

function InsertZone({
  isActive,
  isDropTarget,
  onActivate,
  onDeactivate,
  onInsert,
  thumbH,
  disabled,
}: {
  index: number;
  isActive: boolean;
  isDropTarget?: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onInsert: () => void;
  thumbH: number;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleEnter = () => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShow(true);
      onActivate();
    }, INSERT_HOVER_DELAY);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShow(false);
    onDeactivate();
  };

  const active = isActive || show || isDropTarget;

  return (
    <div
      className="flex items-center justify-center shrink-0 relative cursor-pointer group/insert"
      style={{ width: 26, height: thumbH }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => { if (!disabled && (isActive || show)) onInsert(); }}
    >
      {active && (
        <>
          {/* 紫色竖线（倒圆角）*/}
          <div
            className={`
              absolute rounded-full transition-all duration-200 ease-out
              ${isDropTarget
                ? 'w-1 h-[80%] bg-[var(--color-primary-500)]'
                : 'w-0.5 h-[72%] bg-[var(--color-primary-500)]'
              }
            `}
          />

          {/* 悬停时显示 + 按钮 */}
          {!isDropTarget && (
            <div
              className="
                absolute flex items-center justify-center
                w-7 h-7 rounded-full border-none
                bg-[var(--color-primary-600)] text-white scale-100
                shadow-[0_2px_12px_rgba(108,99,255,0.35)]
                transition-all duration-200 ease-out z-10
              "
            >
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
                <line x1="5" y1="2" x2="5" y2="8" /><line x1="2" y1="5" x2="8" y2="5" />
              </svg>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   页面操作菜单 — 仿项目卡片 ⋮ 下拉菜单
   ═══════════════════════════════════════ */

const PageMenu = forwardRef(function PageMenu(
  {
    style,
    onCopy,
    onCopyStyle,
    onDelete,
    onClose,
  }: {
    style?: React.CSSProperties;
    pageIndex: number;
    pageCount: number;
    onCopy: () => void;
    onCopyStyle: () => void;
    onDelete: () => void;
    onClose: () => void;
  },
  ref: React.Ref<HTMLDivElement>,
) {
  const { t } = useTranslation();
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      {/* Menu - fixed to screen, positioned via style */}
      <div
        ref={ref}
        style={style}
        className="fixed z-[9999] bg-white
                   border border-[var(--color-border)] rounded-[var(--radius-md)]
                   shadow-[var(--shadow-md)] py-1 min-w-[140px] animate-in fade-in zoom-in-95
                   duration-150 origin-bottom-right"
      >
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M9.5 2.5v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v1" />
            <path d="M6.5 6.5h-1a1 1 0 0 0-1 1v1" />
            <path d="M7.5 6.5h1a1 1 0 0 1 1 1v1" />
          </svg>
          {t('editor.bottomNav.copyPage')}
        </button>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onCopyStyle(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0">
            <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
            <rect x="1" y="8" width="5" height="5" rx="1" />
          </svg>
          {t('editor.bottomNav.copyPageStyle')}
        </button>
        <div className="h-px bg-[var(--color-border-light)] my-1" />
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                     text-[var(--color-error)] hover:bg-[var(--color-error-light)]
                     border-none bg-transparent cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
            <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
          </svg>
          {t('editor.bottomNav.deletePage')}
        </button>
      </div>
    </>
  );
});

/* ═══════════════════════════════════════
   PageThumbnail — Canvas 2D 缩略图（渲染所有元素类型）
   ═══════════════════════════════════════ */

const PageThumbnail = memo(function PageThumbnail({
  page,
  template: _template,
  pagePhotos,
  thumbW,
  thumbH: _thumbH,
}: {
  page: AlbumPage;
  template?: Template;
  pagePhotos: Photo[];
  thumbW: number;
  thumbH: number;
}) {
  // Canvas 2D 渲染所有元素类型（照片/文本/便签/贴纸/画笔笔触），
  // 模板在 drawPageToCanvas 内部通过 resolveTemplate 解析，无需外部传入。
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <CanvasPageThumbnail
        page={page}
        photos={pagePhotos}
        width={thumbW}
        height={_thumbH}
        cacheSuffix="nav"
        scale={1}
      />
    </div>
  );
});

/* ── 底部导航缩略图 URL 缓存：避免滚动时反复读取 IndexedDB ──
 * P0-3 LOD 优化：底部导航缩略图仅 36-128px，原先直接用 photo.src（1200px 预览图），
 * 每张位图 ~10MB，79 页 × 3 照片 = 237 张 ≈ 2.4GB。改用 thumbBlobId（256px）后
 * 每张 ~0.5MB，同样场景仅 ~120MB，内存降低 20x。 */
const thumbUrlCache = new LRUCache<string, string>(120);

/** 清空底部导航缩略图缓存（用于项目切换/退出编辑器）。
 *  P0: thumbUrlCache 无 onEvict 回调，缓存中的 blob URL 不会被 revoke，
 *    项目切换时 120 条 thumb URL 残留。这些 URL 来自 readPhotoFromDB，
 *    已在 blobUrlRegistry 中注册，revokeAllBlobUrls 会统一 revoke，
 *    这里只需清空缓存条目避免持有已失效的 URL 字符串。 */
export function clearThumbUrlCache(): void {
  thumbUrlCache.clear();
}

/** 解析 thumb 档 src（256px），用于底部导航小缩略图。
 *  优先级：thumbBlobId → previewBlobId → blobId → direct 原文件 → photo.src 兜底 */
async function resolveThumbSrc(photo: Photo): Promise<string | null> {
  const cached = thumbUrlCache.get(photo.id);
  if (cached) return cached;

  let url: string | null = null;
  // import 和 direct 模式都可能生成 thumbBlobId（256px）
  const thumbId = photo.thumbBlobId || photo.previewBlobId || photo.blobId || photo.originalBlobId;
  if (thumbId) {
    url = await readPhotoFromDB(thumbId);
  }
  // direct 模式无 IndexedDB 缩略图时读原文件
  if (!url && photo.storageMode === 'direct' && photo.relativePath) {
    url = await readDirectPhoto(photo.relativePath);
  }
  // 兜底：用 photo.src
  if (!url && photo.src) url = photo.src;

  if (url) thumbUrlCache.set(photo.id, url);
  return url;
}

/* ── 缩略图组件：使用 thumb 档（256px）替代 photo.src（1200px 预览图）──
 * PageThumbnail 已改用 Canvas 2D 渲染，此处保留定义并导出以备其他位置复用。 */
export const PhotoThumb = memo(function PhotoThumb({ photo }: { photo: Photo }) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [showBroken, setShowBroken] = useState(false);
  const loadRef = useRef(0);
  const errorRetryRef = useRef(0);

  // photo 变化时重置并重新解析 thumb 档 URL
  useEffect(() => {
    setShowBroken(false);
    setThumbSrc(null);
    errorRetryRef.current = 0;
    const rid = ++loadRef.current;
    let cancelled = false;
    resolveThumbSrc(photo).then((url) => {
      if (cancelled || rid !== loadRef.current) return;
      if (url) setThumbSrc(url);
      else setShowBroken(true);
    });
    return () => { cancelled = true; };
  }, [photo.id, photo.src, photo.storageMode, photo.relativePath, photo.thumbBlobId, photo.previewBlobId, photo.blobId, photo.originalBlobId]);

  const handleImgError = useCallback(() => {
    // BUG-4 修复：URL 可能已被 blobUrlCache LRU 淘汰并 revoke，
    // 清除缓存后重试一次（而非永久显示破损图标）
    thumbUrlCache.delete(photo.id);
    if (errorRetryRef.current < 1) {
      errorRetryRef.current++;
      setThumbSrc(null);
      const rid = ++loadRef.current;
      resolveThumbSrc(photo).then((url) => {
        if (rid !== loadRef.current) return;
        if (url) {
          setThumbSrc(url);
        } else {
          setShowBroken(true);
        }
      });
    } else {
      setShowBroken(true);
    }
  }, [photo.id]);

  if (photo.processing || (!thumbSrc && !showBroken)) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-gray-100)' }}>
        <div style={{ width: 12, height: 12, border: '2px solid var(--color-primary-300)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      </div>
    );
  }

  if (showBroken) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-gray-100)' }}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14, color: 'var(--color-gray-400)' }}>
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" strokeDasharray="1.5 1.5" />
          <circle cx="7" cy="6" r="1" fill="currentColor" stroke="none" />
          <path d="M2 12l3.5-3.5 2 2 3-3 3.5 5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={thumbSrc!}
      alt=""
      loading="lazy"
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      onError={handleImgError}
    />
  );
});
