/**
 * 画布键盘快捷键 Hook
 * 从 Canvas.tsx 提取，处理保存/撤销/重做/缩放/退出/删除等快捷键
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useEditorStore, usePhotoStore, useHistoryStore, useUIStore } from '../../../store';
import { computeZoomedScroll } from '../../../utils/sharedRender';
import { getCurrentProjectId } from '../../../db';
import { pageLayoutService } from '../../../services/pageLayoutService';
import i18n from '../../../i18n';
import type { Toast } from '../../../types';
import type { SelectedElement } from '../../../store/editorStore/types';

interface UseCanvasKeyboardOptions {
  shiftKeyRef: React.MutableRefObject<boolean>;
  altKeyRef: React.MutableRefObject<boolean>;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasZoom: number;
  selectedSlotId: string | null;
  currentPageIndex: number;
  editFlyoutOpen: boolean;
  editingTextId: string | null;
  selectedTextId: string | null;
  selectedStickyId: string | null;
  selectedStickerId: string | null;
  selectedShapeId: string | null;
  multiSelectedElements: SelectedElement[];
  CANVAS_W: number;
  CANVAS_H: number;
  setSelectedSlot: (id: string | null) => void;
  setCanvasZoom: (zoom: number) => void;
  setEditingTextId: (id: string | null) => void;
  setSelectedTextId: (id: string | null) => void;
  setSelectedStickyId: (id: string | null) => void;
  setSelectedStickerId: (id: string | null) => void;
  setSelectedShapeId: (id: string | null) => void;
  clearMultiSelect: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeTextElement: (pageIndex: number, id: string) => void;
  removeStickyNote: (pageIndex: number, id: string) => void;
  removeStickerElement: (pageIndex: number, id: string) => void;
  removeShapeElement: (pageIndex: number, id: string) => void;
}

export function useCanvasKeyboard({
  shiftKeyRef, altKeyRef, containerRef,
  canvasZoom, selectedSlotId, currentPageIndex, editFlyoutOpen,
  editingTextId, selectedTextId, selectedStickyId, selectedStickerId, selectedShapeId,
  multiSelectedElements,
  CANVAS_W, CANVAS_H,
  setSelectedSlot, setCanvasZoom,
  setEditingTextId, setSelectedTextId, setSelectedStickyId, setSelectedStickerId, setSelectedShapeId,
  clearMultiSelect,
  addToast, removeTextElement, removeStickyNote, removeStickerElement, removeShapeElement,
}: UseCanvasKeyboardOptions) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftKeyRef.current = true;
      if (e.key === 'Alt') {
        // 阻止 Windows 菜单栏聚焦，避免 Alt 释放后按 Space 触发系统窗口菜单
        e.preventDefault();
        altKeyRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftKeyRef.current = false;
      if (e.key === 'Alt') altKeyRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        const pages = useEditorStore.getState().pages;
        const photos = usePhotoStore.getState().photos;
        const albumSize = useEditorStore.getState().albumSize;
        const projectId = getCurrentProjectId();
        if (projectId && pages.length > 0) {
          import('../../../db').then(({ loadProject, saveProject, savePhotos }) => {
            loadProject(projectId).then((existing) => {
              if (existing) {
                saveProject({ ...existing, pages, size: albumSize!, updatedAt: new Date().toISOString() });
                savePhotos(photos, projectId);
                addToast({ type: 'success', message: i18n.t('hooks.canvasKeyboard.saved') });
              }
            });
          });
        }
        return;
      }
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const entry = useHistoryStore.getState().undo();
        if (entry) {
          useEditorStore.getState().setPages(entry.pages);
          if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
          addToast({ type: 'info', message: i18n.t('hooks.canvasKeyboard.undone') });
        }
        return;
      }
      if ((e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey)))) {
        e.preventDefault();
        const entry = useHistoryStore.getState().redo();
        if (entry) {
          useEditorStore.getState().setPages(entry.pages);
          if (entry.selectedSlotId) useEditorStore.getState().setSelectedSlot(entry.selectedSlotId);
          addToast({ type: 'info', message: i18n.t('hooks.canvasKeyboard.redone') });
        }
        return;
      }
      // Ctrl++/Ctrl--/Ctrl+0：以视口中心为锚点缩放，保持 PS 式体验
      const applyZoomWithViewportCenter = (newZoom: number) => {
        const container = containerRef.current;
        if (!container) {
          setCanvasZoom(newZoom);
          return;
        }
        const oldZoom = canvasZoom;
        if (Math.abs(newZoom - oldZoom) < 0.001) {
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
          const c = containerRef.current;
          if (!c) return;
          c.scrollLeft = scrollLeft;
          c.scrollTop = scrollTop;
        });
      };
      if (e.ctrlKey && e.key === '=') { e.preventDefault(); applyZoomWithViewportCenter(Math.min(5, canvasZoom * 1.1)); }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); applyZoomWithViewportCenter(Math.max(0.1, canvasZoom / 1.1)); }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); applyZoomWithViewportCenter(1); }
      // 编辑模式：Esc 退出编辑
      if (e.key === 'Escape') {
        // 优先退出文字编辑
        if (editingTextId) {
          setEditingTextId(null);
          return;
        }
        // 退出跨类型多选
        if (multiSelectedElements.length >= 2) {
          clearMultiSelect();
          return;
        }
        // 退出文字/便利贴选中
        if (selectedTextId) {
          setSelectedTextId(null);
          return;
        }
        if (selectedStickyId) {
          setSelectedStickyId(null);
          return;
        }
        if (selectedStickerId) {
          setSelectedStickerId(null);
          return;
        }
        if (editFlyoutOpen) {
          useUIStore.getState().setEditFlyoutOpen(false);
        }
        setSelectedSlot(null);
        return;
      }
      // 编辑模式：方向键微调照片位置
      if (editFlyoutOpen && selectedSlotId && document.activeElement?.tagName !== 'INPUT') {
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        else if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          const state = useEditorStore.getState();
          const page = state.pages[currentPageIndex];
          const pl = page?.placements.find((p) => p.slotId === selectedSlotId);
          if (pl) {
            const curX = pl.panX || 0;
            const curY = pl.panY || 0;
            state.updatePlacementPan(currentPageIndex, selectedSlotId, curX + dx, curY + dy, undefined);
          }
          return;
        }
      }
      // 快捷删除仅用 Delete 键（Backspace 不触发删除，避免误删页面/元素）
      if (e.key === 'Delete') {
        // 文字/便利贴编辑中：Delete 仅删除字符，不删除元素（contentEditable 聚焦时 tagName 是 DIV，需显式排除）
        if (editingTextId || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
        // 多选删除（优先级高于单选）
        if (multiSelectedElements.length >= 2 && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          for (const m of multiSelectedElements) {
            if (m.type === 'slot') pageLayoutService.removeSlotFromPage(currentPageIndex, m.id);
            else if (m.type === 'text') removeTextElement(currentPageIndex, m.id);
            else if (m.type === 'sticky') removeStickyNote(currentPageIndex, m.id);
            else if (m.type === 'sticker') removeStickerElement(currentPageIndex, m.id);
            else if (m.type === 'shape') removeShapeElement(currentPageIndex, m.id);
          }
          clearMultiSelect();
          return;
        }
        if (selectedSlotId && document.activeElement?.tagName !== 'INPUT' && !editFlyoutOpen) {
          useEditorStore.getState().removePhotoFromSlot(currentPageIndex, selectedSlotId);
          setSelectedSlot(null);
        }
        // 删除选中的文字元素
        if (selectedTextId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          removeTextElement(currentPageIndex, selectedTextId);
          setSelectedTextId(null);
          return;
        }
        // 删除选中的便利贴
        if (selectedStickyId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          removeStickyNote(currentPageIndex, selectedStickyId);
          setSelectedStickyId(null);
          return;
        }
        // 删除选中的贴纸
        if (selectedStickerId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          removeStickerElement(currentPageIndex, selectedStickerId);
          setSelectedStickerId(null);
          return;
        }
        // 删除选中的形状
        if (selectedShapeId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          removeShapeElement(currentPageIndex, selectedShapeId);
          setSelectedShapeId(null);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [canvasZoom, selectedSlotId, currentPageIndex, setSelectedSlot, setCanvasZoom, addToast, editFlyoutOpen,
      editingTextId, selectedTextId, selectedStickyId, selectedStickerId, selectedShapeId,
      multiSelectedElements, clearMultiSelect,
      setEditingTextId, setSelectedTextId, setSelectedStickyId, setSelectedStickerId, setSelectedShapeId,
      removeTextElement, removeStickyNote, removeStickerElement, removeShapeElement]);
}
