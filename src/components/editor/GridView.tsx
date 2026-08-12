import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { invalidatePageThumbnail } from '../../utils/gridThumbnailRenderer';
import { PageCard } from './PageCard';
import { GridControlBar } from './GridControlBar';
import { Toolbar } from './Toolbar';
import { FullscreenView } from './FullscreenView';
import { useWheel } from '../../hooks/useWheel';
import type { AlbumPage } from '../../types';
import { isCoverPage, isBackCoverPage } from '../../types';

/** 4-5 图的随机模板池 */
const RANDOM_4_5_TEMPLATES = [
  'quad-col', 'quad-grid', 'quad-hero', 'quad-asym', 'quad-stagger',
  'five-top2-bot3', 'five-top3-bot2', 'five-left3-right2', 'five-left2-right3', 'five-left3-right2-big',
];

function randomTemplateId(): string {
  return RANDOM_4_5_TEMPLATES[Math.floor(Math.random() * RANDOM_4_5_TEMPLATES.length)];
}

/* ── 常量 ── */
const CARD_GAP = 14;
const INSERT_WIDTH = 28;
const MIN_CARD_H = 60;
const MAX_CARD_H = 220;
const GRID_PADDING = 16;
const DRAG_ACTIVATE_DIST = 6;
const DRAG_ACTIVATE_DELAY = 120;

interface GridViewProps {
  onBack?: () => void;
}

export function GridView({ onBack }: GridViewProps) {
  const { t } = useTranslation();
  const pages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const insertPage = useEditorStore((s) => s.insertPage);
  const copyPage = useEditorStore((s) => s.copyPage);
  const removePage = useEditorStore((s) => s.removePage);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const appendPages = useEditorStore((s) => s.appendPages);
  const gridZoom = useUIStore((s) => s.gridZoom);
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const addToast = useUIStore((s) => s.addToast);
  const gridSelectedPages = useUIStore((s) => s.gridSelectedPages);
  const toggleGridPageSelect = useUIStore((s) => s.toggleGridPageSelect);
  const setGridSelectedPages = useUIStore((s) => s.setGridSelectedPages);
  const clearGridSelection = useUIStore((s) => s.clearGridSelection);
  const hiddenGridPageIds = useUIStore((s) => s.hiddenGridPageIds);
  const toggleHiddenGridPage = useUIStore((s) => s.toggleHiddenGridPage);
  const setHiddenGridPageIds = useUIStore((s) => s.setHiddenGridPageIds);
  const clearHiddenGridPages = useUIStore((s) => s.clearHiddenGridPages);

  const [pageMenu, setPageMenu] = useState<{
    originalIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [fullscreenStartIndex, setFullscreenStartIndex] = useState(0);

  const [insertHoverIndex, setInsertHoverIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [containerWidth, setContainerWidth] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    srcOriginal: -1,
    overOriginal: -1,
    preview: null as HTMLElement | null,
    ox: 0,
    oy: 0,
    srcEl: null as HTMLElement | null,
  });
  const dragHappenedRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClickRef = useRef<{ originalIndex: number } | null>(null);
  const copiedPagesRef = useRef<AlbumPage[]>([]);

  // 网格视图只显示未隐藏的页面
  const visiblePages = useMemo(() => {
    return pages
      .map((page, originalIndex) => ({ page, originalIndex }))
      .filter(({ page }) => !hiddenGridPageIds.includes(page.id));
  }, [pages, hiddenGridPageIds]);

  // 计算卡片尺寸
  const albumAspect = useMemo(() => {
    if (!albumSize || albumSize.width === 0) return 0.75;
    return albumSize.width / albumSize.height;
  }, [albumSize]);

  const cardHeight = useMemo(() => {
    return Math.round(MIN_CARD_H + (MAX_CARD_H - MIN_CARD_H) * ((gridZoom - 0.5) / 1.5));
  }, [gridZoom]);

  const cardWidth = useMemo(() => {
    return Math.round(cardHeight * albumAspect);
  }, [cardHeight, albumAspect]);

  // 根据容器宽度自动计算列数，保证行列整齐
  const columns = useMemo(() => {
    if (!containerWidth || cardWidth <= 0) return 1;
    const unit = cardWidth + CARD_GAP;
    return Math.max(1, Math.floor((containerWidth - GRID_PADDING * 2 + CARD_GAP) / unit));
  }, [containerWidth, cardWidth]);

  // 监听容器宽度变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 退出网格视图时清空选择，避免状态残留
  useEffect(() => {
    return () => {
      clearGridSelection();
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, [clearGridSelection]);

  // 网格视图快捷键：ESC 退出、Ctrl+A 全选、Ctrl+C/V 复制粘贴、Delete 删除
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        // 仅当真正处于网格视图时才响应，避免对底部缩略图/单页编辑造成干扰
        if (viewMode !== 'grid') return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

        // ESC 退出网格视图，返回编辑器
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          setViewMode('single');
          return;
        }

        // Ctrl+A 全选
      if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setGridSelectedPages(visiblePages.map(({ page }) => page.id));
        return;
      }

      // Ctrl+C 复制选中页面
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (gridSelectedPages.length === 0) {
          addToast({ type: 'warning', message: t('editor.gridView.selectPageFirst') });
          return;
        }
        const toCopy = pages
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => gridSelectedPages.includes(p.id))
          .map(({ p }) => JSON.parse(JSON.stringify(p)) as AlbumPage);
        copiedPagesRef.current = toCopy;
        addToast({ type: 'success', message: t('editor.gridView.pagesCopied', { count: toCopy.length }) });
        return;
      }

      // Ctrl+V 粘贴到选中页面之后（无选中则追加到末尾）
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (copiedPagesRef.current.length === 0) {
          addToast({ type: 'warning', message: t('editor.gridView.noCopiedPages') });
          return;
        }
        const newPages = copiedPagesRef.current.map((p) => ({
          ...JSON.parse(JSON.stringify(p)),
          id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }));
        let insertAfter = -1;
        if (gridSelectedPages.length > 0) {
          const lastId = gridSelectedPages[gridSelectedPages.length - 1];
          insertAfter = pages.findIndex((p) => p.id === lastId);
        }
        appendPages(insertAfter >= 0 ? insertAfter : pages.length - 1, newPages);
        addToast({ type: 'success', message: t('editor.gridView.pagesPasted', { count: newPages.length }) });
        return;
      }

      // Delete 删除选中页面
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visiblePages, gridSelectedPages, pages, setGridSelectedPages, appendPages, addToast, viewMode, setViewMode]);

  // 点击页面卡片：普通单击选页；快速双击同一页进入编辑器
  const handlePageClick = useCallback((originalIndex: number, e: React.MouseEvent) => {
    if (dragHappenedRef.current) {
      dragHappenedRef.current = false;
      return;
    }
    const id = pages[originalIndex]?.id || '';

    // Ctrl / Cmd 多选
    if (e.ctrlKey || e.metaKey) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      pendingClickRef.current = null;
      toggleGridPageSelect(id);
      return;
    }

    // Shift 范围选
    if (e.shiftKey && gridSelectedPages.length > 0) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      pendingClickRef.current = null;
      const lastId = gridSelectedPages[gridSelectedPages.length - 1];
      const lastOriginal = pages.findIndex((p) => p.id === lastId);
      if (lastOriginal >= 0) {
        const start = Math.min(lastOriginal, originalIndex);
        const end = Math.max(lastOriginal, originalIndex);
        setGridSelectedPages(pages.slice(start, end + 1).map((p) => p.id));
      }
      return;
    }

    // 双击检测：200ms 内再次点击同一页视为双击
    if (pendingClickRef.current?.originalIndex === originalIndex) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      pendingClickRef.current = null;
      setCurrentPage(originalIndex);
      setViewMode('single');
      return;
    }

    // 单击：立即选中
    setGridSelectedPages([id]);
    pendingClickRef.current = { originalIndex };
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      pendingClickRef.current = null;
    }, 200);
  }, [pages, gridSelectedPages, toggleGridPageSelect, setGridSelectedPages, setCurrentPage, setViewMode]);

  // 页间插入（index 为可见页面之间的缺口索引，0..visiblePages.length）
  const handleInsertPage = useCallback((visibleIndex: number) => {
    const originalIndex = visibleIndex < visiblePages.length
      ? visiblePages[visibleIndex].originalIndex
      : pages.length;
    insertPage(originalIndex, randomTemplateId());
    addToast({ type: 'success', message: t('editor.gridView.pageInserted') });
    setInsertHoverIndex(null);
  }, [insertPage, addToast, visiblePages, pages.length]);

  // 复制单个页面
  const handleCopyPage = useCallback((originalIndex: number) => {
    copyPage(originalIndex);
    addToast({ type: 'success', message: t('editor.gridView.pageReordered') });
    setPageMenu(null);
  }, [copyPage, addToast]);

  // 删除单个页面
  const handleDeletePage = useCallback((originalIndex: number) => {
    if (pages.length <= 1) {
      addToast({ type: 'warning', message: t('editor.gridView.keepAtLeastOne') });
      return;
    }
    const pageId = pages[originalIndex]?.id || '';
    removePage(originalIndex);
    invalidatePageThumbnail(pageId);
    setHiddenGridPageIds(hiddenGridPageIds.filter((id) => id !== pageId));
    addToast({ type: 'info', message: t('editor.gridView.pageDeleted') });
    setPageMenu(null);
  }, [pages, removePage, addToast, hiddenGridPageIds, setHiddenGridPageIds, t]);

  // 批量删除
  const handleDeleteSelected = useCallback(() => {
    if (gridSelectedPages.length === 0) return;
    if (pages.length - gridSelectedPages.length < 1) {
      addToast({ type: 'warning', message: t('editor.gridView.keepAtLeastOne') });
      return;
    }
    const toRemove = pages
      .map((_, i) => i)
      .filter((i) => gridSelectedPages.includes(pages[i].id))
      .reverse();

    for (const i of toRemove) {
      if (useEditorStore.getState().pages.length <= 1) break;
      useEditorStore.getState().removePage(i);
      invalidatePageThumbnail(pages[i]?.id || '');
    }

    setHiddenGridPageIds(hiddenGridPageIds.filter((id) => !gridSelectedPages.includes(id)));
    clearGridSelection();
    addToast({ type: 'info', message: t('editor.gridView.pagesDeleted', { count: toRemove.length }) });
  }, [pages, gridSelectedPages, clearGridSelection, addToast, hiddenGridPageIds, setHiddenGridPageIds, t]);

  // 批量复制
  const handleCopySelected = useCallback(() => {
    if (gridSelectedPages.length === 0) return;
    const indices = pages
      .map((p, i) => ({ id: p.id, i }))
      .filter(({ id }) => gridSelectedPages.includes(id))
      .map(({ i }) => i);
    const copied = [...indices].sort((a, b) => b - a);
    for (const i of copied) {
      useEditorStore.getState().copyPage(i);
    }
    addToast({ type: 'success', message: t('editor.gridView.pagesCopied', { count: copied.length }) });
  }, [pages, gridSelectedPages, addToast]);

  // 批量隐藏
  const handleHideSelected = useCallback(() => {
    if (gridSelectedPages.length === 0) return;
    const next = Array.from(new Set([...hiddenGridPageIds, ...gridSelectedPages]));
    setHiddenGridPageIds(next);
    clearGridSelection();
    addToast({ type: 'info', message: t('editor.gridView.pagesHidden', { count: gridSelectedPages.length }) });
  }, [gridSelectedPages, hiddenGridPageIds, setHiddenGridPageIds, clearGridSelection, addToast]);

  // 全屏浏览：从当前选中的第一页开始，没有选中则从首页开始
  const handleOpenFullscreen = useCallback(() => {
    const startOriginal = gridSelectedPages.length > 0
      ? Math.max(0, pages.findIndex((p) => gridSelectedPages[0] === p.id))
      : 0;
    setFullscreenStartIndex(startOriginal);
    setIsFullscreenOpen(true);
  }, [pages, gridSelectedPages]);

  // 根据鼠标位置计算应插入的可见缺口索引（0..visiblePages.length）；空白处返回 -1，避免误触发到行末尾
  const findDropGap = useCallback((clientX: number, clientY: number): number => {
    const container = containerRef.current;
    if (!container) return -1;
    const cards = Array.from(container.querySelectorAll('[data-page-card]')) as HTMLElement[];
    if (cards.length === 0) return 0;

    // 优先取鼠标正下方的卡片，按卡片左右半区决定插入位置
    const el = document.elementFromPoint(clientX, clientY);
    const hoveredCard = el?.closest('[data-page-card]') as HTMLElement | null;
    if (hoveredCard) {
      const idx = cards.indexOf(hoveredCard);
      if (idx >= 0) {
        const r = hoveredCard.getBoundingClientRect();
        return clientX < r.left + r.width / 2 ? idx : idx + 1;
      }
    }

    // 计算网格整体边界与行列尺寸
    const first = cards[0].getBoundingClientRect();
    const last = cards[cards.length - 1].getBoundingClientRect();
    const colWidth = first.width + CARD_GAP;
    const rowHeight = first.height + CARD_GAP;
    const gridLeft = first.left;
    const gridRight = last.right;
    const gridTop = first.top;
    const gridBottom = last.bottom;

    // 明显超出网格区域视为空白，不响应
    if (clientY < gridTop - rowHeight / 2 || clientY > gridBottom + rowHeight / 2) return -1;
    if (clientX < gridLeft - colWidth / 2 || clientX > gridRight + colWidth / 2) return -1;

    // 按行匹配：鼠标所在行的卡片中按 X 找缺口
    const rowCards: { idx: number; r: DOMRect }[] = [];
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY >= r.top - CARD_GAP / 2 && clientY <= r.bottom + CARD_GAP / 2) {
        rowCards.push({ idx: i, r });
      }
    }
    if (rowCards.length > 0) {
      rowCards.sort((a, b) => a.r.left - b.r.left);
      for (const { idx, r } of rowCards) {
        if (clientX < r.left + r.width / 2) return idx;
      }
      return rowCards[rowCards.length - 1].idx + 1;
    }

    // 未命中任何行，按垂直方向最近行推断
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return cards.length;
  }, []);

  // 拖拽排序：按下后先不启动，满足“移动超过阈值 + 延迟”才真正激活，避免快速点击误判为拖拽
  const handleDragStart = useCallback((e: React.MouseEvent, visibleIndex: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-page-menu]')) return;
    const card = (e.currentTarget as HTMLElement).closest('[data-page-card]') as HTMLElement;
    if (!card) return;
    e.preventDefault();

    const cardInner = card.querySelector('[data-card-inner]') as HTMLElement | null;
    const sourceEl = cardInner || card;
    const rect = sourceEl.getBoundingClientRect();
    const st = dragRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = Date.now();
    st.srcOriginal = visiblePages[visibleIndex]?.originalIndex ?? -1;
    st.overOriginal = -1;
    st.ox = rect.width / 2;
    st.oy = rect.height / 2;
    st.srcEl = sourceEl;
    st.preview = null;
    st.active = false;
    dragHappenedRef.current = false;

    let moved = false;
    let activated = false;
    let rafId = 0;
    let cleaned = false;

    const activate = () => {
      if (activated || cleaned) return;
      activated = true;
      moved = true;
      st.active = true;
      dragHappenedRef.current = true;

      const preview = sourceEl.cloneNode(true) as HTMLElement;
      Object.assign(preview.style, {
        position: 'fixed',
        left: `${startX - st.ox}px`,
        top: `${startY - st.oy}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: 'none',
        zIndex: '9999',
        opacity: '0.85',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        transform: 'scale(1.05)',
      });
      document.body.appendChild(preview);
      st.preview = preview;
      sourceEl.style.opacity = '0.35';

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    };

    const onMove = (ev: MouseEvent) => {
      if (cleaned) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!activated && Math.hypot(dx, dy) > DRAG_ACTIVATE_DIST && Date.now() - startTime > DRAG_ACTIVATE_DELAY) {
        activate();
      }
      if (!activated) return;
      if (st.preview) {
        st.preview.style.left = `${ev.clientX - st.ox}px`;
        st.preview.style.top = `${ev.clientY - st.oy}px`;
      }
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const gap = findDropGap(ev.clientX, ev.clientY);
        if (gap >= 0 && gap !== st.overOriginal) {
          st.overOriginal = gap;
          setDragOverIndex(gap);
        } else if (gap < 0 && st.overOriginal >= 0) {
          st.overOriginal = -1;
          setDragOverIndex(null);
        }
      });
    };

    const onUp = () => {
      if (cleaned) return;
      cleaned = true;
      if (!activated) {
        // 未激活拖拽，交给 click 处理为普通点击
        dragHappenedRef.current = false;
        st.srcOriginal = -1;
        st.srcEl = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        return;
      }
      st.active = false;
      if (st.preview?.parentNode) st.preview.parentNode.removeChild(st.preview);
      st.preview = null;
      if (st.srcEl) st.srcEl.style.opacity = '';

      const srcOriginal = st.srcOriginal;
      const overVisible = st.overOriginal;
      if (srcOriginal >= 0 && overVisible >= 0 && moved) {
        const targetOriginal = overVisible < visiblePages.length
          ? visiblePages[overVisible].originalIndex
          : pages.length;
        let target = targetOriginal;
        if (target !== srcOriginal && target !== srcOriginal + 1) {
          if (target > srcOriginal) target--;
          reorderPages(srcOriginal, target);
          addToast({ type: 'success', message: t('editor.gridView.pageReordered') });
        }
      }
      st.srcOriginal = -1;
      st.overOriginal = -1;
      setDragOverIndex(null);

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [findDropGap, visiblePages, pages.length, reorderPages, addToast]);

  // 点击网格空白处取消选择
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-page-card], [data-page-menu], [data-grid-toolbar]')) return;
    e.stopPropagation();
    clearGridSelection();
  }, [clearGridSelection]);

  // Ctrl+滚轮缩放网格（卡片大小）
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const next = Math.max(0.5, Math.min(3.0, gridZoom + delta));
    useUIStore.getState().setGridZoom(Number(next.toFixed(1)));
  }, [gridZoom]);

  // React 19 将 onWheel 设为 passive，preventDefault 会报警告；改用原生非 passive 监听
  useWheel(rootRef, handleWheel, [gridZoom]);

  // 全局拦截浏览器 Ctrl+wheel 缩放（网格视图下 Canvas 未挂载，需独立拦截）
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handler as EventListener, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handler as EventListener, { capture: true });
  }, []);

  const isAllSelected = visiblePages.length > 0 && visiblePages.every(({ page }) => gridSelectedPages.includes(page.id));

  return (
    <div
      ref={rootRef}
      className="flex flex-col h-full bg-[var(--color-surface)] relative"
      onClick={() => setPageMenu(null)}
    >
      {/* ═══ 顶部工具栏：与编辑器保持一致 ═══ */}
      <Toolbar onBack={onBack} />

      {/* ═══ 顶部悬浮工具栏：常驻显示，预留空间 ═══ */}
      <div
        data-grid-toolbar
        className="flex justify-center items-center py-2 shrink-0"
      >
        <GridFloatingToolbar
          selectedCount={gridSelectedPages.length}
          isAllSelected={isAllSelected}
          hasHidden={hiddenGridPageIds.length > 0}
          onSelectAll={() => setGridSelectedPages(visiblePages.map(({ page }) => page.id))}
          onDeselectAll={clearGridSelection}
          onDelete={handleDeleteSelected}
          onCopy={handleCopySelected}
          onHide={handleHideSelected}
          onShowHidden={clearHiddenGridPages}
        />
      </div>

      {/* ═══ 页面网格 ═══ */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto relative"
        style={{
          paddingTop: GRID_PADDING / 2,
          paddingRight: GRID_PADDING,
          paddingBottom: GRID_PADDING,
          paddingLeft: GRID_PADDING,
          backgroundImage: 'var(--gradient-surface)',
        }}
        onClick={handleContainerClick}
      >
        {visiblePages.length === 0 ? (
          <div className="flex flex-col items-center justify-center w-full h-full text-[var(--color-gray-500)]">
            {pages.length === 0 ? (
              <>
                <span className="text-sm mb-3">{t('editor.gridView.noPages')}</span>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary-50)] text-[var(--color-brand)] hover:bg-[var(--color-primary-100)] transition-colors cursor-pointer"
                    onClick={() => { useEditorStore.getState().addCoverPage(); addToast({ type: 'success', message: t('editor.gridView.coverAdded') }); }}
                  >
                    📕 {t('editor.gridView.addCover')}
                  </button>
                  <button
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary-50)] text-[var(--color-brand)] hover:bg-[var(--color-primary-100)] transition-colors cursor-pointer"
                    onClick={() => { useEditorStore.getState().addPage(); }}
                  >
                    {t('editor.gridView.addPage')}
                  </button>
                  <button
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary-50)] text-[var(--color-brand)] hover:bg-[var(--color-primary-100)] transition-colors cursor-pointer"
                    onClick={() => { useEditorStore.getState().addBackCoverPage(); addToast({ type: 'success', message: t('editor.gridView.backCoverAdded') }); }}
                  >
                    📗 {t('editor.gridView.addBackCover')}
                  </button>
                </div>
              </>
            ) : (
              <span className="text-sm">{t('editor.gridView.allPagesHidden')}</span>
            )}
            {hiddenGridPageIds.length > 0 && (
              <button
                className="mt-3 px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary-50)] text-[var(--color-brand)] hover:bg-[var(--color-primary-100)] transition-colors"
                onClick={clearHiddenGridPages}
              >
                {t('editor.gridView.showAllPages')}
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`,
              gap: CARD_GAP,
              justifyContent: 'center',
              alignContent: 'start',
            }}
          >
            {visiblePages.map(({ page, originalIndex }, visibleIndex) => {
              const isSelected = gridSelectedPages.includes(page.id);
              let shiftX = 0;
              // 悬停插入：在 insertIndex 处打开较小缺口，减少抖动
              if (insertHoverIndex !== null) {
                if (visibleIndex === insertHoverIndex) shiftX += 10;
                if (visibleIndex === insertHoverIndex - 1) shiftX -= 10;
              }
              // 拖拽排序：在 dragOverIndex 处打开较小缺口
              const srcVisible = dragRef.current.active
                ? visiblePages.findIndex((v) => v.originalIndex === dragRef.current.srcOriginal)
                : -1;
              const isDropTarget = dragRef.current.active && dragOverIndex !== null && dragOverIndex !== srcVisible && dragOverIndex !== srcVisible + 1;
              if (isDropTarget) {
                if (visibleIndex === dragOverIndex) shiftX += 10;
                if (visibleIndex === dragOverIndex - 1) shiftX -= 10;
              }
              return (
                <GridPageItem
                  key={page.id}
                  page={page}
                  originalIndex={originalIndex}
                  visibleIndex={visibleIndex}
                  visibleCount={visiblePages.length}
                  columns={columns}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  isSelected={isSelected}
                  isMultiSelected={gridSelectedPages.length > 1 && isSelected}
                  gridZoom={gridZoom}
                  shiftX={shiftX}
                  insertHoverIndex={insertHoverIndex}
                  dragOverIndex={dragOverIndex}
                  isDragging={dragRef.current.active}
                  onMouseDown={handleDragStart}
                  onClick={handlePageClick}
                  onActivateInsert={setInsertHoverIndex}
                  onDeactivateInsert={() => setInsertHoverIndex(null)}
                  onInsertAt={handleInsertPage}
                  onMenuOpen={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setPageMenu({ originalIndex, x: rect.right - 4, y: rect.top + 4 });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ 底部控制栏 ═══ */}
      <GridControlBar
        pageCount={pages.length}
        selectedCount={gridSelectedPages.length}
        onFullscreen={handleOpenFullscreen}
      />

      <FullscreenView
        open={isFullscreenOpen}
        onClose={() => setIsFullscreenOpen(false)}
        initialPageIndex={fullscreenStartIndex}
      />

      {/* ═══ 页面右上角菜单 ═══ */}
      {pageMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setPageMenu(null)} />
          <div
            data-menu
            className="fixed z-[9999] bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-150 origin-top-right"
            style={{ right: window.innerWidth - pageMenu.x, top: pageMenu.y }}
          >
            {/* 封面/封底专属操作：编辑 / 重新生成 */}
            {(() => {
              const pg = pages[pageMenu.originalIndex];
              if (!pg) return null;
              if (isCoverPage(pg)) {
                return (
                  <>
                    <MenuButton
                      icon={EditCoverIcon}
                      label={t('editor.gridView.editCover')}
                      onClick={() => {
                        const idx = pageMenu.originalIndex;
                        setPageMenu(null);
                        setCurrentPage(idx);
                        setViewMode('single');
                      }}
                    />
                    <MenuButton
                      icon={ShuffleIcon}
                      label={t('editor.gridView.regenerateCover')}
                      onClick={() => {
                        useEditorStore.getState().regenerateCoverPage(1);
                        invalidatePageThumbnail(pg.id);
                        setPageMenu(null);
                        addToast({ type: 'success', message: t('editor.gridView.coverRegenerated') });
                      }}
                    />
                    <div className="h-px bg-[var(--color-border-light)] my-1" />
                  </>
                );
              }
              if (isBackCoverPage(pg)) {
                return (
                  <>
                    <MenuButton
                      icon={EditCoverIcon}
                      label={t('editor.gridView.editBackCover')}
                      onClick={() => {
                        const idx = pageMenu.originalIndex;
                        setPageMenu(null);
                        setCurrentPage(idx);
                        setViewMode('single');
                      }}
                    />
                    <div className="h-px bg-[var(--color-border-light)] my-1" />
                  </>
                );
              }
              return null;
            })()}
            <MenuButton
              icon={CopyIcon}
              label={t('editor.gridView.copyPage')}
              onClick={() => handleCopyPage(pageMenu.originalIndex)}
            />
            <MenuButton
              icon={HideIcon}
              label={t('editor.gridView.hidePage')}
              onClick={() => {
                toggleHiddenGridPage(pages[pageMenu.originalIndex]?.id || '');
                setPageMenu(null);
                addToast({ type: 'info', message: t('editor.gridView.pageHidden') });
              }}
            />
            <div className="h-px bg-[var(--color-border-light)] my-1" />
            <MenuButton
              icon={DeleteIcon}
              label={t('editor.gridView.deletePage')}
              onClick={() => handleDeletePage(pageMenu.originalIndex)}
              danger
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ══════ 网格页面项（卡片 + 页码 + 三点菜单） ══════ */

function GridPageItem({
  page,
  originalIndex,
  visibleIndex,
  visibleCount,
  columns,
  cardWidth,
  cardHeight,
  isSelected,
  isMultiSelected,
  gridZoom,
  shiftX,
  insertHoverIndex,
  dragOverIndex,
  isDragging,
  onMouseDown,
  onClick,
  onMenuOpen,
  onActivateInsert,
  onDeactivateInsert,
  onInsertAt,
}: {
  page: ReturnType<typeof useEditorStore.getState>['pages'][number];
  originalIndex: number;
  visibleIndex: number;
  visibleCount: number;
  columns: number;
  cardWidth: number;
  cardHeight: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  gridZoom: number;
  shiftX: number;
  insertHoverIndex: number | null;
  dragOverIndex: number | null;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent, visibleIndex: number) => void;
  onClick: (originalIndex: number, e: React.MouseEvent) => void;
  onMenuOpen: (e: React.MouseEvent) => void;
  onActivateInsert: (idx: number) => void;
  onDeactivateInsert: () => void;
  onInsertAt: (idx: number) => void;
}) {
  const col = visibleIndex % columns;
  // 左插入区：首页显示在 leading 位置；同行内左侧间隙由本页左区覆盖
  const showLeftZone = visibleIndex === 0 || col !== 0;
  // 右插入区：每行最后一列或最后一页显示在 trailing 位置（避免与下一行首列左区重复）
  const showRightZone = visibleIndex === visibleCount - 1 || col === columns - 1;
  const leftGapIndex = visibleIndex;
  const rightGapIndex = visibleIndex + 1;

  return (
    <div
      data-page-card
      className="flex flex-col items-center gap-1 select-none relative group/card"
      onMouseDown={(e) => onMouseDown(e, visibleIndex)}
      onClick={(e) => onClick(originalIndex, e)}
    >
      {showLeftZone && (
        <GridPageInsertZone
          side="left"
          gapIndex={leftGapIndex}
          cardHeight={cardHeight}
          isActive={insertHoverIndex === leftGapIndex}
          isDropTarget={dragOverIndex === leftGapIndex}
          disabled={isDragging}
          onActivate={onActivateInsert}
          onDeactivate={onDeactivateInsert}
          onInsert={onInsertAt}
        />
      )}
      {showRightZone && (
        <GridPageInsertZone
          side="right"
          gapIndex={rightGapIndex}
          cardHeight={cardHeight}
          isActive={insertHoverIndex === rightGapIndex}
          isDropTarget={dragOverIndex === rightGapIndex}
          disabled={isDragging}
          onActivate={onActivateInsert}
          onDeactivate={onDeactivateInsert}
          onInsert={onInsertAt}
        />
      )}
      {/* 卡片与页码放在独立 transform 容器中，插入区保持居中不跟随卡片位移 */}
      <div
        data-card-inner
        className="relative flex flex-col items-center gap-1"
        style={{
          transform: shiftX !== 0 ? `translateX(${shiftX}px)` : undefined,
          transition: 'transform 200ms ease-out',
        }}
      >
        <PageCard
          page={page}
          index={originalIndex}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          isSelected={isSelected}
          isMultiSelected={isMultiSelected}
          gridZoom={gridZoom}
        />
        {/* 右上角三点菜单按钮 */}
        <button
          data-page-menu
          className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/40 border border-white/20 text-white opacity-0 group-hover/card:opacity-100 hover:bg-black/60 transition-all duration-150 cursor-pointer z-10 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); onMenuOpen(e); }}
        >
          <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
            <circle cx="6" cy="2.5" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="6" cy="9.5" r="1.2" />
          </svg>
        </button>
        <span
          className="text-[10px] leading-tight tabular-nums"
          style={{
            color: isSelected ? 'var(--color-brand)' : 'var(--color-gray-500)',
            fontWeight: isSelected ? 600 : 400,
          }}
        >
          {originalIndex + 1}
        </span>
      </div>
    </div>
  );
}

/* ══════ 页面卡片间隙插入区（绝对定位在 grid gap 中，不破坏行列对齐） ══════ */

const INSERT_HOVER_DELAY = 300;

function GridPageInsertZone({
  side,
  gapIndex,
  cardHeight,
  isActive,
  isDropTarget,
  disabled,
  onActivate,
  onDeactivate,
  onInsert,
}: {
  side: 'left' | 'right';
  gapIndex: number;
  cardHeight: number;
  isActive: boolean;
  isDropTarget: boolean;
  disabled: boolean;
  onActivate: (idx: number) => void;
  onDeactivate: () => void;
  onInsert: (idx: number) => void;
}) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleEnter = () => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setShow(true); onActivate(gapIndex); }, INSERT_HOVER_DELAY);
  };
  const handleLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setShow(false);
    onDeactivate();
  };

  const active = isActive || show || isDropTarget;
  const offset = -(INSERT_WIDTH / 2 + CARD_GAP / 2);

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer z-[5]"
      style={{
        [side]: offset,
        width: INSERT_WIDTH,
        height: cardHeight,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => { e.stopPropagation(); if (!disabled && active) onInsert(gapIndex); }}
    >
      {active && (
        <>
          <div
            className={`
              absolute rounded-full transition-all duration-200 ease-out
              ${isDropTarget ? 'w-1.5 h-[88%] bg-[var(--color-brand)]' : 'w-1 h-[80%] bg-[var(--color-primary-500)]'}
            `}
          />
          {!isDropTarget && (
            <div className="absolute flex items-center justify-center w-7 h-7 rounded-full bg-[var(--color-brand)] text-white shadow-[0_3px_14px_rgba(108,99,255,0.45)] transition-all duration-200 ease-out z-10 hover:scale-110">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ width: 14, height: 14 }}>
                <line x1="6" y1="2" x2="6" y2="10" /><line x1="2" y1="6" x2="10" y2="6" />
              </svg>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ══════ 顶部悬浮工具栏 ══════ */

function GridFloatingToolbar({
  selectedCount,
  isAllSelected,
  hasHidden,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onCopy,
  onHide,
  onShowHidden,
}: {
  selectedCount: number;
  isAllSelected: boolean;
  hasHidden: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onHide: () => void;
  onShowHidden: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-white/95 backdrop-blur-sm border border-[var(--color-border)] rounded-full shadow-[var(--shadow-md)]">
      {selectedCount === 0 ? (
        <>
          <ToolbarButton icon={SelectAllIcon} label={t('editor.gridView.selectAll')} onClick={onSelectAll} />
          {hasHidden && <ToolbarButton icon={ShowIcon} label={t('editor.gridView.showHidden')} onClick={onShowHidden} />}
        </>
      ) : (
        <>
          <ToolbarButton icon={isAllSelected ? DeselectIcon : SelectAllIcon} label={isAllSelected ? t('editor.gridView.deselectAll') : t('editor.gridView.selectAll')} onClick={isAllSelected ? onDeselectAll : onSelectAll} />
          <div className="w-px h-4 bg-[var(--color-border-light)] mx-1" />
          <ToolbarButton icon={CopyIcon} label={t('editor.gridView.copy')} onClick={onCopy} />
          <ToolbarButton icon={HideIcon} label={t('editor.gridView.hide')} onClick={onHide} />
          <ToolbarButton icon={DeleteIcon} label={t('editor.gridView.delete')} onClick={onDelete} danger />
        </>
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`
        flex items-center gap-1 px-2.5 py-1 rounded-full text-[var(--text-caption)] font-[500]
        border-none bg-transparent cursor-pointer transition-colors
        ${danger ? 'text-[var(--color-error)] hover:bg-[var(--color-error-light)]' : 'text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]'}
      `}
      onClick={onClick}
      title={label}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

/* ══════ 菜单按钮 ══════ */

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)] border-none bg-transparent cursor-pointer transition-colors"
      style={{
        color: danger ? 'var(--color-error)' : 'var(--color-gray-700)',
        backgroundColor: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = danger
          ? 'var(--color-error-light)'
          : 'var(--color-surface-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {icon}
      {label}
    </button>
  );
}

const CopyIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
    <path d="M9.5 2.5v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v1" />
    <path d="M6.5 6.5h-1a1 1 0 0 0-1 1v1" />
    <path d="M7.5 6.5h1a1 1 0 0 1 1 1v1" />
  </svg>
);

const DeleteIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <path d="M2 4h10" />
    <path d="M5 4V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4" />
    <path d="M11 4v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4" />
  </svg>
);

const SelectAllIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
    <path d="M4 7l2 2 4-4" />
  </svg>
);

const DeselectIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
    <path d="M5 5l4 4M9 5l-4 4" />
  </svg>
);

const ShowIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <path d="M2 7c1.5-2.5 4-4 5-4s3.5 1.5 5 4c-1.5 2.5-4 4-5 4s-3.5-1.5-5-4z" />
    <circle cx="7" cy="7" r="1.8" />
  </svg>
);

const HideIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <path d="M2 7c1.5-2.5 4-4 5-4s3.5 1.5 5 4c-1.5 2.5-4 4-5 4s-3.5-1.5-5-4z" />
    <circle cx="7" cy="7" r="1.8" />
    <path d="M3 11l8-8" />
  </svg>
);

const EditCoverIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <path d="M2 2h6l4 4v6H2z" />
    <path d="M8 2v4h4" />
    <path d="M5 8h4M5 10h3" />
  </svg>
);

const ShuffleIcon = (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
    <path d="M12.5 3.5L8 8M11.5 5V3h-2" />
    <path d="M2 12L6 8M3 8H2M12 11h-1M2 4h1" />
  </svg>
);


