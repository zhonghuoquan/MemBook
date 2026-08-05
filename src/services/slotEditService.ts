import { useEditorStore } from '../store/editorStore';
import { usePhotoStore } from '../store/photoStore';
import { useHistoryStore } from '../store/historyStore';
import {
  calcSlotPixelSize,
  DEFAULT_MM_W, DEFAULT_MM_H, MM_TO_PX,
} from '../store/editorStore/helpers';
import { resolveTemplate } from '../types';
import { calcCoverFitWithRotation, computePanForResizedSlot } from '../utils/photoGeometry';

const SNAPSHOT_MERGE_MS = 300;
let lastSnapshotKey: string | null = null;
let lastSnapshotAt = 0;

function pushSnapshot(pages: Parameters<ReturnType<typeof useHistoryStore.getState>['pushSnapshot']>[0], selectedSlotId: string | null, mergeKey?: string): void {
  if (pages.length === 0) return;
  const now = Date.now();
  if (mergeKey && mergeKey === lastSnapshotKey && now - lastSnapshotAt < SNAPSHOT_MERGE_MS) {
    lastSnapshotAt = now;
    return;
  }
  lastSnapshotKey = mergeKey ?? null;
  lastSnapshotAt = now;
  useHistoryStore.getState().pushSnapshot(pages, selectedSlotId);
}

/**
 * 单槽位编辑协调服务：处理需要读取 photoStore 照片的旋转/平移几何计算，
 * 避免 editorStore placementSlice 直接依赖 photoStore。
 */
export const slotEditService = {
  rotatePhoto(pageIndex: number, slotId: string): void {
    const s = useEditorStore.getState();
    const newPages = [...s.pages];
    if (!newPages[pageIndex]) return;
    const page = newPages[pageIndex];
    const pl = page.placements.find((p) => p.slotId === slotId);
    if (!pl || !pl.photoId) return;
    const oldRotation = pl.panRotation || 0;
    const newRotation = (oldRotation + 90) % 360;

    const template = resolveTemplate(page);
    if (!template) return;
    const slot = template.slots.find((sl) => sl.id === slotId);
    if (!slot) return;
    const canvasW = (s.albumSize?.width ?? DEFAULT_MM_W) * MM_TO_PX;
    const canvasH = (s.albumSize?.height ?? DEFAULT_MM_H) * MM_TO_PX;
    const { width: slotW, height: slotH } = calcSlotPixelSize(slot, page.slotOverrides, canvasW, canvasH);

    const photo = usePhotoStore.getState().photoMap.get(pl.photoId!);
    if (!photo || photo.width <= 0 || photo.height <= 0) {
      newPages[pageIndex] = {
        ...page,
        placements: page.placements.map((p) =>
          p.slotId === slotId ? { ...p, panRotation: newRotation, panX: undefined, panY: undefined } : p
        ),
      };
      useEditorStore.setState({ pages: newPages });
      pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    const ps = Math.max(pl.panScale || 1, 1);
    const oldCF = calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, oldRotation);
    const oldPanX = pl.panX ?? (slotW - oldCF.boundingW * ps) / 2;
    const oldPanY = pl.panY ?? (slotH - oldCF.boundingH * ps) / 2;
    const newPan = computePanForResizedSlot(
      photo.width, photo.height, slotW, slotH, slotW, slotH,
      newRotation, ps, oldPanX, oldPanY
    );

    newPages[pageIndex] = {
      ...page,
      placements: page.placements.map((p) =>
        p.slotId === slotId
          ? { ...p, panRotation: newRotation, panScale: ps, panX: newPan.panX, panY: newPan.panY }
          : p
      ),
    };
    useEditorStore.setState({ pages: newPages });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
  },

  updatePlacementPanRotation(
    pageIndex: number,
    slotId: string,
    panRotation: number,
    resetZoom?: boolean,
    recordHistory = true,
  ): void {
    const s = useEditorStore.getState();
    const newPages = [...s.pages];
    if (!newPages[pageIndex]) return;
    if (resetZoom) {
      newPages[pageIndex] = {
        ...newPages[pageIndex],
        placements: newPages[pageIndex].placements.map((p) =>
          p.slotId === slotId
            ? { ...p, panRotation, panScale: undefined, panX: undefined, panY: undefined }
            : p
        ),
      };
      useEditorStore.setState({ pages: newPages });
      if (recordHistory) pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    const page = newPages[pageIndex];
    const pl = page.placements.find((p) => p.slotId === slotId);
    if (!pl || !pl.photoId) return;

    const template = resolveTemplate(page);
    if (!template) return;
    const slot = template.slots.find((sl) => sl.id === slotId);
    if (!slot) return;
    const canvasW = (s.albumSize?.width ?? DEFAULT_MM_W) * MM_TO_PX;
    const canvasH = (s.albumSize?.height ?? DEFAULT_MM_H) * MM_TO_PX;
    const { width: slotW, height: slotH } = calcSlotPixelSize(slot, page.slotOverrides, canvasW, canvasH);

    const photo = usePhotoStore.getState().photoMap.get(pl.photoId!);
    if (!photo || photo.width <= 0 || photo.height <= 0) {
      newPages[pageIndex] = {
        ...page,
        placements: page.placements.map((p) =>
          p.slotId === slotId ? { ...p, panRotation } : p
        ),
      };
      useEditorStore.setState({ pages: newPages });
      if (recordHistory) pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    const oldRot = pl.panRotation ?? (pl.rotation || 0);
    const ps = Math.max(pl.panScale || 1, 1);
    const oldCF = calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, oldRot);
    const oldPanX = pl.panX ?? (slotW - oldCF.boundingW * ps) / 2;
    const oldPanY = pl.panY ?? (slotH - oldCF.boundingH * ps) / 2;
    const newPan = computePanForResizedSlot(
      photo.width, photo.height, slotW, slotH, slotW, slotH,
      panRotation, ps, oldPanX, oldPanY
    );

    newPages[pageIndex] = {
      ...page,
      placements: page.placements.map((p) =>
        p.slotId === slotId
          ? { ...p, panRotation, panScale: ps, panX: newPan.panX, panY: newPan.panY }
          : p
      ),
    };
    useEditorStore.setState({ pages: newPages });
    if (recordHistory) pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
  },
};
