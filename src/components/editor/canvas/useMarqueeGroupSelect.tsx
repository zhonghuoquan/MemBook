/**
 * 框选 Hook（仅负责框选检测）
 *
 * 从 Canvas.tsx 提取的交互状态机：
 *   1. 空白处拖拽框选多个元素（完全包含语义）
 *   2. 框选完成后统一产出 multiSelectedElements（与 Ctrl+click 多选同一套状态）
 *
 * 包围盒渲染、组合缩放/移动由 useMultiElementGroupSelect 统一处理，
 * 不再维护独立的 multiSelectedSlots 状态，消除两套多选实现。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Rect } from 'react-konva';
import type { AlbumPage, Template } from '../../../types';
import {
  hitTestMarquee,
  type SlotRect,
} from '../../../engine/selection-engine';
import type { SelectedElement } from '../../../store/editorStore/types';
import { useEditorStore } from '../../../store';
import { MM_TO_PX } from './constants';

export interface UseMarqueeGroupSelectOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  template: Template | undefined;
  currentPage: AlbumPage | undefined;
  canvasZoom: number;
  groupOX: number;
  groupOY: number;
  CANVAS_W: number;
  CANVAS_H: number;
  clearSelection: () => void;
  setMultiSelectedElements: (elements: SelectedElement[]) => void;
  /** 清理引导线等瞬态 UI（框选开始 / 全局 mouseup 时调用） */
  resetTransientUI: () => void;
}

export function useMarqueeGroupSelect({
  stageRef, template, currentPage, canvasZoom, groupOX, groupOY, CANVAS_W, CANVAS_H,
  clearSelection, setMultiSelectedElements, resetTransientUI,
}: UseMarqueeGroupSelectOptions) {
  /* ── 框选状态 ── */
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const marqueeStartRef = useRef({ x: 0, y: 0 });

  const isBusy = isMarqueeSelecting;

  /** Stage 指针位置 → 页面逻辑坐标 */
  const pointerLogical = useCallback(() => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - groupOX) / canvasZoom,
      y: (pos.y - groupOY) / canvasZoom,
    };
  }, [stageRef, groupOX, groupOY, canvasZoom]);

  /** Stage onMouseDown 时清理旧的框选状态 */
  const resetInteraction = useCallback(() => {
    setIsMarqueeSelecting(false);
    setMarquee(null);
  }, []);

  /** 空白处按下（左键、非编辑模式）：开始框选 */
  const startMarquee = useCallback(() => {
    clearSelection();
    resetTransientUI();
    const pos = pointerLogical();
    if (!pos) return;
    marqueeStartRef.current = { x: pos.x, y: pos.y };
    setMarquee({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
    setIsMarqueeSelecting(true);
  }, [clearSelection, resetTransientUI, pointerLogical]);

  /** Stage onMouseMove：处理框选预览；消费事件返回 true */
  const handleMove = useCallback((): boolean => {
    if (!isMarqueeSelecting) return false;
    const pos = pointerLogical();
    if (!pos) return true;
    setMarquee((prev) => (prev ? { ...prev, x2: pos.x, y2: pos.y } : null));
    return true;
  }, [isMarqueeSelecting, pointerLogical]);

  /** Stage onMouseUp：完成框选命中检测；消费事件返回 true */
  const handleUp = useCallback((): boolean => {
    if (!isMarqueeSelecting) return false;
    setIsMarqueeSelecting(false);
    if (!marquee || !template || !currentPage) {
      setMarquee(null);
      return true;
    }
    // 收集所有可选元素的 px 几何（槽位 + 文字 + 便利贴 + 贴纸），统一参与框选命中检测
    // 带类型标记，用于命中后还原 SelectedElement
    const candidates: (SlotRect & { type: SelectedElement['type'] })[] = [];
    // 槽位（模板槽位 + extraSlots）
    for (const slot of template.slots) {
      const ov = currentPage.slotOverrides?.[slot.id];
      candidates.push({
        id: slot.id, type: 'slot',
        x: ov ? ov.x : (slot.x / 100) * CANVAS_W,
        y: ov ? ov.y : (slot.y / 100) * CANVAS_H,
        width: ov ? ov.width : (slot.width / 100) * CANVAS_W,
        height: ov ? ov.height : (slot.height / 100) * CANVAS_H,
      });
    }
    if (currentPage.extraSlots) {
      for (const slot of currentPage.extraSlots) {
        const ov = currentPage.slotOverrides?.[slot.id];
        candidates.push({
          id: slot.id, type: 'slot',
          x: ov ? ov.x : (slot.x / 100) * CANVAS_W,
          y: ov ? ov.y : (slot.y / 100) * CANVAS_H,
          width: ov ? ov.width : (slot.width / 100) * CANVAS_W,
          height: ov ? ov.height : (slot.height / 100) * CANVAS_H,
        });
      }
    }
    // 文字元素（x/y 为左上角）
    if (currentPage.textElements) {
      for (const el of currentPage.textElements) {
        candidates.push({
          id: el.id, type: 'text',
          x: el.x * MM_TO_PX, y: el.y * MM_TO_PX,
          width: el.width * MM_TO_PX, height: el.height * MM_TO_PX,
        });
      }
    }
    // 便利贴（x/y 为左上角）
    if (currentPage.stickyNotes) {
      for (const note of currentPage.stickyNotes) {
        candidates.push({
          id: note.id, type: 'sticky',
          x: note.x * MM_TO_PX, y: note.y * MM_TO_PX,
          width: note.width * MM_TO_PX, height: note.height * MM_TO_PX,
        });
      }
    }
    // 贴纸（x/y 为中心点，需转换为左上角）
    if (currentPage.stickerElements) {
      for (const st of currentPage.stickerElements) {
        candidates.push({
          id: st.id, type: 'sticker',
          x: (st.x - st.width / 2) * MM_TO_PX,
          y: (st.y - st.height / 2) * MM_TO_PX,
          width: st.width * MM_TO_PX,
          height: st.height * MM_TO_PX,
        });
      }
    }
    // 命中检测：完全包含在框选矩形内的元素
    const hits = candidates.filter((s) => hitTestMarquee(marquee, s));
    setMarquee(null);
    if (hits.length > 1) {
      setMultiSelectedElements(hits.map((s) => ({ type: s.type, id: s.id })));
    } else if (hits.length === 1) {
      // 单个命中：按类型设置单选
      const h = hits[0];
      if (h.type === 'slot') useEditorStore.getState().setSelectedSlot(h.id);
      else if (h.type === 'text') useEditorStore.getState().setSelectedTextId(h.id);
      else if (h.type === 'sticky') useEditorStore.getState().setSelectedStickyId(h.id);
      else if (h.type === 'sticker') useEditorStore.getState().setSelectedStickerId(h.id);
    }
    return true;
  }, [isMarqueeSelecting, marquee, template, currentPage, CANVAS_W, CANVAS_H, setMultiSelectedElements]);

  /* ── 全局 mouseup 兜底：防止在 Stage 外释放鼠标导致框选态泄漏 ── */
  useEffect(() => {
    const cleanup = () => {
      if (isMarqueeSelecting) {
        setIsMarqueeSelecting(false);
        setMarquee(null);
      }
      resetTransientUI();
    };
    window.addEventListener('mouseup', cleanup);
    return () => window.removeEventListener('mouseup', cleanup);
  }, [isMarqueeSelecting, resetTransientUI]);

  /* ── 框选矩形渲染 ── */
  const renderMarquee = useCallback(() => {
    if (!marquee) return null;
    return (
      <Rect
        x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)}
        width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)}
        fill="rgba(108,99,255,0.08)" stroke="#6C63FF" strokeWidth={1} dash={[4, 4]} listening={false}
      />
    );
  }, [marquee]);

  return {
    marquee,
    isBusy,
    resetInteraction,
    startMarquee,
    handleMove,
    handleUp,
    renderMarquee,
  };
}
