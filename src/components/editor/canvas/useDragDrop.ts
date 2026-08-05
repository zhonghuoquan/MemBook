/**
 * 拖放逻辑 Hook
 * 从 Canvas.tsx 提取，监听 drag-manager 事件并处理照片放置
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import Konva from 'konva';
import { useEditorStore, useUIStore } from '../../../store';
import { resolveTemplate, isGooglePhotosPage, getSlotZIndex, type SlotLayout } from '../../../types';
import { onDragStateChange } from '../../../engine/drag-manager';
import { markPhotoJustPlaced } from './CanvasPhotoRenderer';
import i18n from '../../../i18n';

interface DragThumbData {
  x: number;
  y: number;
  ox: number;
  oy: number;
  photoIds: string[];
  dismissing?: boolean;
}

interface UseDragDropOptions {
  stageRef: RefObject<Konva.Stage | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  groupOX: number;
  groupOY: number;
  canvasZoom: number;
  CANVAS_W: number;
  CANVAS_H: number;
  currentPageIndexRef: React.MutableRefObject<number>;
  dragOverSlotRef: React.MutableRefObject<string | null>;
  setIsDraggingFile: (v: boolean) => void;
  setIsOverPage: (v: boolean) => void;
  setDragOverSlotId: (v: string | null) => void;
  setPendingAddPhoto: (v: { photoIds: string[]; pageIndex: number } | null) => void;
  setDragThumb: React.Dispatch<React.SetStateAction<DragThumbData | null>>;
}

export function useDragDrop({
  stageRef, containerRef, groupOX, groupOY, canvasZoom, CANVAS_W, CANVAS_H,
  currentPageIndexRef, dragOverSlotRef,
  setIsDraggingFile, setIsOverPage, setDragOverSlotId, setPendingAddPhoto, setDragThumb,
}: UseDragDropOptions) {
  // ── 自定义拖拽：监听 drag-manager，鼠标释放时放置照片 ──
  useEffect(() => {
    // 拖拽缩略图淡出定时器，卸载时清理
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onDragStateChange((state) => {
      if (state.active) {
        setIsDraggingFile(true);
        // 清除旧淡出状态，确保新拖拽立即显示
        setDragThumb((prev) => prev && prev.dismissing ? { ...prev, dismissing: false } : prev);
        const stageBox = stageRef.current?.container().getBoundingClientRect();
        if (stageBox) {
          const sx = state.clientX - stageBox.left;
          const sy = state.clientY - stageBox.top;
          const lx = (sx - groupOX) / canvasZoom;
          const ly = (sy - groupOY) / canvasZoom;

          // 检测鼠标是否在页面区域内
          const overPage = lx >= 0 && lx <= CANVAS_W && ly >= 0 && ly <= CANVAS_H;
          setIsOverPage(overPage);

          // 手动 hit test（使用 ref 获取最新 slot 数据）
          // 修复点：
          //   1. 遍历所有槽位（template.slots + page.extraSlots），用户手动添加的槽位也能作为目标
          //   2. 按 zIndex 降序排序候选槽位，重叠时优先选中视觉上最上层的（与渲染顺序一致）
          //   3. 即使鼠标在页面外（如照片位于页面外），只要槽位几何延伸到那里也支持命中
          //      （槽位本身坐标都在页面内，但照片可能被拖到页面外，此处放宽 overPage 限制）
          let hitSlotId: string | null = null;
          const { pages } = useEditorStore.getState();
          const page = pages[currentPageIndexRef.current];
          const tpl = page ? resolveTemplate(page) : null;
          if (tpl && page) {
            // 合并模板槽位 + extraSlots，去重（resolveTemplate 已合并 extraSlots，此处兼容防御）
            const allSlots: SlotLayout[] = [...tpl.slots];
            const seenIds = new Set(tpl.slots.map((s) => s.id));
            for (const s of page.extraSlots ?? []) {
              if (!seenIds.has(s.id)) { allSlots.push(s); seenIds.add(s.id); }
            }
            // slotOrder 决定渲染先后（索引大的渲染在后=视觉顶层），用于 zIndex 相同时的 tiebreaker
            const order = page.slotOrder || tpl.slots.map((s) => s.id);
            // 计算每个槽位的实际几何（应用 slotOverrides）
            const candidates: { slotId: string; z: number; orderIdx: number; rect: { x: number; y: number; w: number; h: number } }[] = [];
            for (const slot of allSlots) {
              const ov = page.slotOverrides?.[slot.id];
              const slx = ov ? ov.x : (slot.x / 100) * CANVAS_W;
              const sly = ov ? ov.y : (slot.y / 100) * CANVAS_H;
              const slw = ov ? ov.width : (slot.width / 100) * CANVAS_W;
              const slh = ov ? ov.height : (slot.height / 100) * CANVAS_H;
              if (lx >= slx && lx <= slx + slw && ly >= sly && ly <= sly + slh) {
                const idx = order.indexOf(slot.id);
                candidates.push({
                  slotId: slot.id,
                  z: getSlotZIndex(page, slot.id),
                  orderIdx: idx >= 0 ? idx : 999,
                  rect: { x: slx, y: sly, w: slw, h: slh },
                });
              }
            }
            if (candidates.length > 0) {
              // 与 Canvas.tsx globalLayerElements 渲染顺序一致：
              //   渲染排序为 z 升序 + slotOrder 稳定序，故视觉顶层 = z 最大，z 相同时 slotOrder 索引最大
              candidates.sort((a, b) => {
                if (a.z !== b.z) return b.z - a.z;        // zIndex 降序
                return b.orderIdx - a.orderIdx;            // slotOrder 索引降序（渲染在后=顶层）
              });
              hitSlotId = candidates[0].slotId;
            }
          }
          setDragOverSlotId(hitSlotId);
          dragOverSlotRef.current = hitSlotId;
        }
        // 拖拽中缩略图跟随鼠标
        setDragThumb({
          x: state.clientX,
          y: state.clientY,
          ox: state.offsetX,
          oy: state.offsetY,
          photoIds: [...state.photoIds],
        });
      } else {
        // 释放：active=false
        setIsDraggingFile(false);
        setIsOverPage(false);
        const slotId = dragOverSlotRef.current;
        setDragOverSlotId(null);
        dragOverSlotRef.current = null;

        if (slotId && state.photoIds.length > 0) {
          // 在照片槽位上释放：直接放置
          setDragThumb(null);
          if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
          const { pages: pgs } = useEditorStore.getState();
          const cpi = currentPageIndexRef.current;
          if (pgs[cpi]) {
            const page = pgs[cpi];
            const tpl = resolveTemplate(page);
            if (state.photoIds.length === 1) {
              // 单张照片：放入目标槽位
              useEditorStore.getState().placePhoto(cpi, slotId, state.photoIds[0]);
              // 标记刚放置，触发 CanvasPhotoRenderer 入场动效
              markPhotoJustPlaced(slotId, state.photoIds[0]);
              useEditorStore.getState().setSelectedSlot(slotId);
              useUIStore.getState().addToast({ type: 'success', message: i18n.t('hooks.dragDrop.photoPlaced') });
            } else {
              // 多张照片：第一张放入目标槽位，其余按顺序放入页面空槽
              // 修复：合并 template.slots + extraSlots，让用户手动添加的槽位也能接收照片
              const allSlots: SlotLayout[] = tpl ? [...tpl.slots] : [];
              if (tpl) {
                const seenIds = new Set(tpl.slots.map((s) => s.id));
                for (const s of page.extraSlots ?? []) {
                  if (!seenIds.has(s.id)) { allSlots.push(s); seenIds.add(s.id); }
                }
              }
              const emptySlots = allSlots.filter((s) => !page.placements.find((p) => p.slotId === s.id && p.photoId));
              const targetIdx = emptySlots.findIndex((s) => s.id === slotId);
              if (targetIdx >= 0) emptySlots.splice(targetIdx, 1);
              useEditorStore.getState().placePhoto(cpi, slotId, state.photoIds[0]);
              markPhotoJustPlaced(slotId, state.photoIds[0]);
              let placed = 1;
              for (let i = 1; i < state.photoIds.length && emptySlots.length > 0; i++) {
                const nextSlot = emptySlots.shift()!;
                useEditorStore.getState().placePhoto(cpi, nextSlot.id, state.photoIds[i]);
                markPhotoJustPlaced(nextSlot.id, state.photoIds[i]);
                placed++;
              }
              useEditorStore.getState().setSelectedSlot(slotId);
              useUIStore.getState().addToast({ type: 'success', message: i18n.t('hooks.dragDrop.photosPlaced', { count: placed }) });
            }
          }
        } else if (state.photoIds.length > 0) {
          // 空白区松手：仅在 Canvas 工作区内释放才触发添加/提示，并排除 PageToolbar 等浮动 UI
          const containerBox = containerRef.current?.getBoundingClientRect();
          if (containerBox) {
            const overWorkspace = state.clientX >= containerBox.left && state.clientX <= containerBox.right && state.clientY >= containerBox.top && state.clientY <= containerBox.bottom;
            // elementFromPoint 可穿透 pointer-events-none 的 dragThumb，用于判断鼠标下方的真实 UI
            const targetEl = document.elementFromPoint(state.clientX, state.clientY);
            const overPageToolbar = !!targetEl?.closest('[data-page-toolbar]');
            if (overWorkspace && !overPageToolbar) {
              setDragThumb(null);
              if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
              const { pages: pgs2 } = useEditorStore.getState();
              const cpi = currentPageIndexRef.current;
              const pg = pgs2[cpi];
              if (pg && isGooglePhotosPage(pg)) {
                // GP 页面：暂存待确认，弹窗后重排（支持多张照片同时添加）
                setPendingAddPhoto({ photoIds: state.photoIds, pageIndex: cpi });
              } else if (pg) {
                useUIStore.getState().addToast({ type: 'info', message: i18n.t('hooks.dragDrop.onlySmartLayoutSupportAdd') });
              }
            } else {
              // 拖到工作区外或 PageToolbar 上：无响应，缩略图回弹淡出后消失
              setDragThumb((prev) => {
                if (!prev) return null;
                if (dismissTimer) clearTimeout(dismissTimer);
                dismissTimer = setTimeout(() => {
                  setDragThumb(null);
                  dismissTimer = null;
                }, 220);
                return { ...prev, dismissing: true };
              });
            }
          }
        } else {
          // 无可放置照片，直接清理
          setDragThumb(null);
          if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
        }
      }
    });
    return () => {
      unsubscribe();
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [groupOX, groupOY, canvasZoom, CANVAS_W, CANVAS_H]);
}
