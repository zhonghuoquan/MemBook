/**
 * 跨类型多选包围盒 Hook
 *
 * 功能：
 *   1. 基于 multiSelectedElements 计算统一包围盒（slot/text/sticky/sticker）
 *   2. 渲染包围盒 + 8 控制点
 *   3. 支持组合整体移动
 *   4. 支持组合等比/非等比缩放
 *   5. 交互过程中只更新预览，松手一次性提交到各 store
 *
 * 坐标系：
 *   - slot 使用 canvas 逻辑像素（px）
 *   - text/sticky/sticker 使用 mm，需通过 MM_TO_PX 互转
 *   - 内部统一用 px (SlotRect) 计算，提交时转回各类型原生单位
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Rect } from 'react-konva';
import type { AlbumPage, Template } from '../../../types';
import {
  computeBBox, computeScaledSlots, computeMovedSlots,
  type SlotRect, type AnchorHandle,
} from '../../../engine/selection-engine';
import { useEditorStore, usePhotoStore } from '../../../store';
import { useHistoryStore } from '../../../store/historyStore';
import { calcCoverFitWithRotation, computePanForResizedSlot } from '../../../utils/photoGeometry';
import { MM_TO_PX } from './constants';

export interface UseMultiElementGroupSelectOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  template: Template | undefined;
  currentPage: AlbumPage | undefined;
  currentPageIndex: number;
  multiSelectedElements: { type: 'slot' | 'text' | 'sticky' | 'sticker'; id: string }[];
  canvasZoom: number;
  groupOX: number;
  groupOY: number;
  CANVAS_W: number;
  CANVAS_H: number;
}

/** 收集所有选中元素的 px 几何（统一为 SlotRect 格式） */
function collectElementRects(
  multiSelectedElements: { type: string; id: string }[],
  template: Template | undefined,
  currentPage: AlbumPage | undefined,
  CANVAS_W: number,
  CANVAS_H: number,
): SlotRect[] {
  if (!currentPage) return [];
  const rects: SlotRect[] = [];
  for (const m of multiSelectedElements) {
    if (m.type === 'slot') {
      // 模板槽位 + extraSlots
      const slot =
        template?.slots.find((s) => s.id === m.id) ??
        currentPage.extraSlots?.find((s) => s.id === m.id);
      if (!slot) continue;
      const ov = currentPage.slotOverrides?.[slot.id];
      rects.push({
        id: m.id,
        x: ov ? ov.x : (slot.x / 100) * CANVAS_W,
        y: ov ? ov.y : (slot.y / 100) * CANVAS_H,
        width: ov ? ov.width : (slot.width / 100) * CANVAS_W,
        height: ov ? ov.height : (slot.height / 100) * CANVAS_H,
      });
    } else if (m.type === 'text') {
      const el = currentPage.textElements?.find((e) => e.id === m.id);
      if (!el) continue;
      rects.push({
        id: m.id,
        x: el.x * MM_TO_PX,
        y: el.y * MM_TO_PX,
        width: el.width * MM_TO_PX,
        height: el.height * MM_TO_PX,
      });
    } else if (m.type === 'sticky') {
      const note = currentPage.stickyNotes?.find((n) => n.id === m.id);
      if (!note) continue;
      rects.push({
        id: m.id,
        x: note.x * MM_TO_PX,
        y: note.y * MM_TO_PX,
        width: note.width * MM_TO_PX,
        height: note.height * MM_TO_PX,
      });
    } else if (m.type === 'sticker') {
      const st = currentPage.stickerElements?.find((s) => s.id === m.id);
      if (!st) continue;
      // StickerElement.x/y 是中心点，需转换为左上角
      rects.push({
        id: m.id,
        x: (st.x - st.width / 2) * MM_TO_PX,
        y: (st.y - st.height / 2) * MM_TO_PX,
        width: st.width * MM_TO_PX,
        height: st.height * MM_TO_PX,
      });
    }
  }
  return rects;
}

export function useMultiElementGroupSelect({
  stageRef, template, currentPage, currentPageIndex, multiSelectedElements,
  canvasZoom, groupOX, groupOY, CANVAS_W, CANVAS_H,
}: UseMultiElementGroupSelectOptions) {
  /* ── 组合缩放/移动状态 ── */
  const [scaleHandle, setScaleHandle] = useState<AnchorHandle | null>(null);
  const [previewRects, setPreviewRects] = useState<SlotRect[] | null>(null);
  const scaleStartRef = useRef({ mx: 0, my: 0, bbox: null as ReturnType<typeof computeBBox>, originRects: [] as SlotRect[] });
  const [isMovingGroup, setIsMovingGroup] = useState(false);
  const moveStartRef = useRef({ mx: 0, my: 0, rects: [] as SlotRect[] });

  const isBusy = scaleHandle !== null || isMovingGroup;

  /** 原始元素 px 几何（无预览时） */
  const originRects = useMemo(
    () => collectElementRects(multiSelectedElements, template, currentPage, CANVAS_W, CANVAS_H),
    [multiSelectedElements, template, currentPage, CANVAS_W, CANVAS_H],
  );

  /** 当前生效的 rects（预览优先） */
  const activeRects = previewRects ?? originRects;

  /** previewRects → Map（按 id 索引，供渲染层读取临时几何） */
  const previewRectMap = useMemo(() => {
    const map = new Map<string, SlotRect>();
    if (!previewRects) return map;
    for (const r of previewRects) map.set(r.id, r);
    return map;
  }, [previewRects]);

  /** Stage 指针位置 → 页面逻辑坐标 */
  const pointerLogical = useCallback(() => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - groupOX) / canvasZoom,
      y: (pos.y - groupOY) / canvasZoom,
    };
  }, [stageRef, groupOX, groupOY, canvasZoom]);

  /** 提交预览几何到各 store */
  const commitPreview = useCallback((rects: SlotRect[] | null) => {
    if (!rects || !currentPage) return;
    const store = useEditorStore.getState();
    // 收集旧几何（commit 之前 currentPage 尚未更新，可得到原始槽位尺寸）
    const oldRectMap = new Map<string, SlotRect>();
    const oldRects = collectElementRects(multiSelectedElements, template, currentPage, CANVAS_W, CANVAS_H);
    for (const r of oldRects) oldRectMap.set(r.id, r);
    // 按类型分组提交
    const slotUpdates: { slotId: string; override: { x: number; y: number; width: number; height: number } }[] = [];
    const panUpdates: { slotId: string; panX: number; panY: number; panScale: number }[] = [];
    const photos = usePhotoStore.getState().photos;
    const photoMap = new Map(photos.map((p) => [p.id, p]));
    for (const r of rects) {
      // 通过 multiSelectedElements 查找该 id 对应的类型
      const sel = multiSelectedElements.find((m) => m.id === r.id);
      if (!sel) continue;
      if (sel.type === 'slot') {
        slotUpdates.push({ slotId: r.id, override: { x: r.x, y: r.y, width: r.width, height: r.height } });
        // 修复漏白：槽位尺寸变化时重算照片 panX/panY，确保照片始终铺满槽位
        const oldRect = oldRectMap.get(r.id);
        const pl = currentPage.placements.find((p) => p.slotId === r.id);
        if (oldRect && pl?.photoId) {
          const photo = photoMap.get(pl.photoId);
          if (photo && photo.width > 0 && photo.height > 0
              && (Math.abs(oldRect.width - r.width) > 0.01 || Math.abs(oldRect.height - r.height) > 0.01)) {
            const totalRot = pl.panRotation ?? (pl.rotation || 0);
            const ps = Math.max(pl.panScale || 1, 1);
            const oldCF = calcCoverFitWithRotation(photo.width, photo.height, oldRect.width, oldRect.height, totalRot);
            const oldPanX = pl.panX ?? (oldRect.width - oldCF.boundingW * ps) / 2;
            const oldPanY = pl.panY ?? (oldRect.height - oldCF.boundingH * ps) / 2;
            const newPan = computePanForResizedSlot(
              photo.width, photo.height, oldRect.width, oldRect.height, r.width, r.height,
              totalRot, ps, oldPanX, oldPanY,
            );
            panUpdates.push({ slotId: r.id, panX: newPan.panX, panY: newPan.panY, panScale: ps });
          }
        }
      } else if (sel.type === 'text') {
        store.updateTextElement(currentPageIndex, r.id, {
          x: r.x / MM_TO_PX,
          y: r.y / MM_TO_PX,
          width: r.width / MM_TO_PX,
          height: r.height / MM_TO_PX,
        }, false);
      } else if (sel.type === 'sticky') {
        store.updateStickyNote(currentPageIndex, r.id, {
          x: r.x / MM_TO_PX,
          y: r.y / MM_TO_PX,
          width: r.width / MM_TO_PX,
          height: r.height / MM_TO_PX,
        }, false);
      } else if (sel.type === 'sticker') {
        store.updateStickerElement(currentPageIndex, r.id, {
          x: r.x / MM_TO_PX,
          y: r.y / MM_TO_PX,
          width: r.width / MM_TO_PX,
          height: r.height / MM_TO_PX,
        }, false);
      }
    }
    // 先更新照片 pan（recordHistory=false 跳过逐个快照），再批量提交 slot overrides（统一 pushSnapshot 一次，快照同时包含 pan + 几何）
    for (const pu of panUpdates) {
      store.updatePlacementPan(currentPageIndex, pu.slotId, pu.panX, pu.panY, pu.panScale, false);
    }
    if (slotUpdates.length > 0) {
      store.batchUpdateSlotOverrides(currentPageIndex, slotUpdates);
    }
    // 装饰元素用 recordHistory=false 跳过逐个快照，此处统一补一次快照
    const hasDecoration = rects.some((r) => {
      const sel = multiSelectedElements.find((m) => m.id === r.id);
      return sel && sel.type !== 'slot';
    });
    if (hasDecoration) {
      const { pages, selectedSlotId } = useEditorStore.getState();
      useHistoryStore.getState().pushSnapshot(pages, selectedSlotId);
    }
  }, [currentPage, currentPageIndex, multiSelectedElements, template, CANVAS_W, CANVAS_H]);

  /** Stage onMouseDown 时清理旧的预览状态 */
  const resetInteraction = useCallback(() => {
    setPreviewRects(null);
    setScaleHandle(null);
    setIsMovingGroup(false);
  }, []);

  /** Stage onMouseMove：处理缩放/移动预览；消费事件返回 true */
  const handleMove = useCallback((): boolean => {
    if (!scaleHandle && !isMovingGroup) return false;
    const pos = pointerLogical();
    if (!pos) return true;

    if (scaleHandle) {
      const { bbox, originRects } = scaleStartRef.current;
      if (!bbox) return true;
      const scaled = computeScaledSlots(originRects, bbox, scaleHandle, pos.x, pos.y, CANVAS_W, CANVAS_H);
      if (scaled) setPreviewRects(scaled);
      return true;
    }
    const { mx, my, rects } = moveStartRef.current;
    setPreviewRects(computeMovedSlots(rects, pos.x - mx, pos.y - my));
    return true;
  }, [scaleHandle, isMovingGroup, pointerLogical, CANVAS_W, CANVAS_H]);

  /** Stage onMouseUp：提交缩放/移动；消费事件返回 true */
  const handleUp = useCallback((): boolean => {
    if (scaleHandle && previewRects) {
      commitPreview(previewRects);
      setPreviewRects(null);
      setScaleHandle(null);
      return true;
    }
    if (isMovingGroup && previewRects) {
      commitPreview(previewRects);
      setPreviewRects(null);
      setIsMovingGroup(false);
      return true;
    }
    return false;
  }, [scaleHandle, previewRects, isMovingGroup, commitPreview]);

  /* ── 全局 mouseup 兜底 ── */
  useEffect(() => {
    const cleanup = () => {
      if (scaleHandle) {
        setScaleHandle(null);
        commitPreview(previewRects);
        setPreviewRects(null);
      }
      if (isMovingGroup) {
        setIsMovingGroup(false);
        commitPreview(previewRects);
        setPreviewRects(null);
      }
    };
    window.addEventListener('mouseup', cleanup);
    return () => window.removeEventListener('mouseup', cleanup);
  }, [scaleHandle, isMovingGroup, previewRects, commitPreview]);

  /* ── 包围盒 + 8 控制点渲染 ── */
  const renderGroupBox = useCallback(() => {
    if (multiSelectedElements.length < 2 || !currentPage) return null;
    const rects = activeRects;
    if (rects.length === 0) return null;
    const bbox = computeBBox(rects, CANVAS_W, CANVAS_H);
    if (!bbox) return null;
    const AS = 8;
    const pts = [
      { k: 'nw', x: bbox.minX, y: bbox.minY },
      { k: 'n', x: bbox.centerX, y: bbox.minY },
      { k: 'ne', x: bbox.maxX, y: bbox.minY },
      { k: 'w', x: bbox.minX, y: bbox.centerY },
      { k: 'e', x: bbox.maxX, y: bbox.centerY },
      { k: 'sw', x: bbox.minX, y: bbox.maxY },
      { k: 's', x: bbox.centerX, y: bbox.maxY },
      { k: 'se', x: bbox.maxX, y: bbox.maxY },
    ] as const;
    return (
      <>
        <Rect x={bbox.minX} y={bbox.minY} width={bbox.width} height={bbox.height}
          dash={[4, 3]} stroke="#6C63FF" strokeWidth={1.5} fill="transparent" listening={false} name="me-bbox" />
        {pts.map((p) => (
          <Rect key={p.k} id={`me-anchor-${p.k}`}
            x={p.x - AS / 2} y={p.y - AS / 2} width={AS} height={AS}
            fill="#fff" stroke="#6C63FF" strokeWidth={2} cornerRadius={1}
            listening={true}
            onMouseEnter={() => {
              const cursor = p.k === 'nw' || p.k === 'se' ? 'nwse-resize'
                : p.k === 'ne' || p.k === 'sw' ? 'nesw-resize'
                : p.k === 'n' || p.k === 's' ? 'ns-resize'
                : 'ew-resize';
              stageRef.current?.container().style.setProperty('cursor', cursor, 'important');
            }}
            onMouseLeave={() => {
              stageRef.current?.container().style.setProperty('cursor', '', 'important');
            }}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              setScaleHandle(p.k as AnchorHandle);
              const pos = pointerLogical();
              scaleStartRef.current = {
                mx: pos?.x ?? 0,
                my: pos?.y ?? 0,
                bbox, originRects: rects,
              };
            }}
          />
        ))}
        <Rect x={bbox.minX} y={bbox.minY} width={bbox.width} height={bbox.height}
          fill="transparent" name="me-bbox" listening={true}
          onMouseEnter={() => { stageRef.current?.container().style.setProperty('cursor', 'move', 'important'); }}
          onMouseLeave={() => { stageRef.current?.container().style.setProperty('cursor', '', 'important'); }}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            setIsMovingGroup(true);
            const pos = pointerLogical();
            moveStartRef.current = {
              mx: pos?.x ?? 0,
              my: pos?.y ?? 0,
              rects,
            };
          }}
        />
      </>
    );
  }, [multiSelectedElements, currentPage, activeRects, CANVAS_W, CANVAS_H, stageRef, pointerLogical]);

  return {
    previewRectMap,
    isBusy,
    resetInteraction,
    handleMove,
    handleUp,
    renderGroupBox,
  };
}
