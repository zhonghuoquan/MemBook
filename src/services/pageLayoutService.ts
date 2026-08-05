import type { AlbumPage, Photo, PhotoPlacement, SlotOverride } from '../types';
import { TEMPLATES, GOOGLE_PHOTOS_TEMPLATE_ID, isGooglePhotosPage } from '../types';
import { refitPageWithRotation, layoutSinglePage } from '../engine/google-photos-layout';
import type { TierPattern } from '../engine/google-photos-layout';
import { calcCoverFitWithRotation, computePanForResizedSlot } from '../utils/photoGeometry';
import { shufflePagePhotos as computeShuffledPagePhotos, shuffleWithSeed } from '../utils/shufflePagePhotos';
import { useEditorStore } from '../store/editorStore';
import { usePhotoStore } from '../store/photoStore';
import { useUIStore } from '../store/uiStore';
import { useHistoryStore } from '../store/historyStore';
import { makePlacementMigrator, buildRegenPageData } from '../store/editorStore/helpers';
import i18n from '../i18n';

const SNAPSHOT_MERGE_MS = 300;
let lastSnapshotKey: string | null = null;
let lastSnapshotAt = 0;

function pushSnapshot(pages: AlbumPage[], selectedSlotId: string | null, mergeKey?: string): void {
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

function getPhotoMap(): Map<string, Photo> {
  const allPhotos = usePhotoStore.getState().photos;
  const photoMap = new Map<string, Photo>();
  for (const p of allPhotos) photoMap.set(p.id, p);
  return photoMap;
}



/**
 * 页面布局协调服务：处理 Google Photos 智能排版页面的重排、旋转、转换等跨域业务。
 * 将原本 placementSlice 中对 photoStore / uiStore 的依赖下沉到服务层。
 */
export const pageLayoutService = {
  removeSlotFromPage(pageIndex: number, slotId: string): void {
    const { pages, albumSize, pageMargin, slotGap } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page) return;

    // 统一处理：用户通过"添加照片位"按钮创建的槽位存在于 extraSlots 中，无论 GP 还是模板页面都支持完整删除
    // 注意：extraSlot 删除不需要 albumSize，只有后续 GP 重排才需要
    const isExtraSlot = (page.extraSlots ?? []).some((s) => s.id === slotId);
    if (isExtraSlot) {
      useEditorStore.setState((s) => {
        const np = [...s.pages];
        const cur = np[pageIndex];
        if (!cur) return s;
        np[pageIndex] = {
          ...cur,
          extraSlots: (cur.extraSlots ?? []).filter((s) => s.id !== slotId),
          placements: cur.placements.filter((p) => p.slotId !== slotId),
          slotOrder: (cur.slotOrder ?? []).filter((id) => id !== slotId),
          // 保留 slotOverrides 中其他槽位的几何，仅删除目标槽位；若原本为 undefined 则不设置
          slotOverrides: cur.slotOverrides
            ? Object.fromEntries(Object.entries(cur.slotOverrides).filter(([k]) => k !== slotId))
            : undefined,
          slotZIndices: cur.slotZIndices
            ? Object.fromEntries(Object.entries(cur.slotZIndices).filter(([k]) => k !== slotId))
            : undefined,
        };
        return { pages: np, selectedSlotId: null };
      });
      pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    // 以下分支（模板清空 / GP 重排）需要 albumSize
    if (!albumSize) return;

    // 模板内置槽位：记录到 hiddenTemplateSlotIds 运行时隐藏（保留原模板结构，支持删除至空白）
    if (!isGooglePhotosPage(page)) {
      useEditorStore.setState((s) => {
        const np = [...s.pages];
        const cur = np[pageIndex];
        if (!cur) return s;
        const hidden = new Set(cur.hiddenTemplateSlotIds ?? []);
        hidden.add(slotId);
        np[pageIndex] = {
          ...cur,
          hiddenTemplateSlotIds: Array.from(hidden),
          placements: cur.placements.filter((p) => p.slotId !== slotId),
          slotOrder: (cur.slotOrder ?? []).filter((id) => id !== slotId),
          slotOverrides: cur.slotOverrides
            ? Object.fromEntries(Object.entries(cur.slotOverrides).filter(([k]) => k !== slotId))
            : undefined,
          slotZIndices: cur.slotZIndices
            ? Object.fromEntries(Object.entries(cur.slotZIndices).filter(([k]) => k !== slotId))
            : undefined,
        };
        return { pages: np, selectedSlotId: null };
      });
      pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    const remainingPlacements = page.placements.filter((p) => p.slotId !== slotId);
    const photoMap = getPhotoMap();
    const remainingPhotos = remainingPlacements
      .map((pl) => pl.photoId)
      .filter((id): id is string => id != null)
      .map((id) => photoMap.get(id))
      .filter((p): p is Photo => p != null);

    // 一键成册页面：允许删除至空白状态（画面显示空白），与模板页删除行为一致
    if (remainingPhotos.length === 0) {
      useEditorStore.setState((s) => {
        const np = [...s.pages];
        const cur = np[pageIndex];
        if (!cur) return s;
        // 保留 extraSlots 中用户添加的空槽位
        const extraSlotPlacements = (cur.extraSlots ?? [])
          .map((es) => ({ slotId: es.id, photoId: null as string | null }));
        np[pageIndex] = {
          ...cur,
          placements: extraSlotPlacements,
          slotOverrides: {},
          googlePhotosMmLayout: [],
          googlePhotosBaseMmLayout: [],
          googlePhotosLayoutRows: [],
          googlePhotosBaseLayoutRows: [],
          googlePhotosInternalRows: [],
        };
        return { pages: np, selectedSlotId: null };
      });
      pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      return;
    }

    const bx = page.perPageBiasX ?? 0;
    const by = page.perPageBiasY ?? 0;
    const result = layoutSinglePage(remainingPhotos, {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density: 'auto',
      layoutRhythm: 'auto',
      dateGrouping: 'continuous',
      pageOverrides: new Map([[0, { biasX: bx, biasY: by }]]),
    });

    if (result.pages.length === 0) {
      useEditorStore.getState().removePhotoFromSlot(pageIndex, slotId);
      return;
    }

    const migrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
    const regen = buildRegenPageData(result.pages[0].photos, migrator);

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      // 保留 extraSlots 中用户添加的空槽位的 placement
      const extraSlotPlacements = (page.extraSlots ?? [])
        .filter((es) => !regen.placements.some((p) => p.slotId === es.id))
        .map((es) => ({ slotId: es.id, photoId: null as string | null }));
      np[pageIndex] = {
        ...page,
        placements: [...regen.placements, ...extraSlotPlacements],
        slotOverrides: regen.slotOverrides,
        googlePhotosMmLayout: regen.mmLayout,
        googlePhotosBaseMmLayout: regen.mmLayout,
        googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
        googlePhotosInternalRows: result.internalRows[0] || [],
        googlePhotosLayoutRows: result.layoutRows[0] || [],
        googlePhotosBaseLayoutRows: result.layoutRows[0] || [],
        googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
        perPageBiasX: bx,
        perPageBiasY: by,
        perPageRotation: 0,
      };
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
  },

  shufflePagePhotos(pageIndex: number): boolean {
    const { pages, albumSize } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page || !albumSize) return false;

    const photoCount = page.placements.filter((p) => p.photoId != null).length;
    if (photoCount <= 1) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.insufficientPhotos') });
      return false;
    }

    const seed = Date.now();

    if (isGooglePhotosPage(page)) {
      const shuffled = computeShuffledPagePhotos(page, seed);
      if (!shuffled) return false;

      const photoMap = getPhotoMap();
      const migrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
      const regen = buildRegenPageData(shuffled.mmLayout, migrator);

      useEditorStore.setState((s) => {
        const np = [...s.pages];
        // 保留 extraSlots 中用户添加的空槽位的 placement
        const extraSlotPlacements = (page.extraSlots ?? [])
          .filter((es) => !regen.placements.some((p) => p.slotId === es.id))
          .map((es) => ({ slotId: es.id, photoId: null as string | null }));
        np[pageIndex] = {
          ...page,
          placements: [...regen.placements, ...extraSlotPlacements],
          slotOverrides: regen.slotOverrides,
          googlePhotosMmLayout: regen.mmLayout,
          layoutSeed: seed,
        };
        return { pages: np, selectedSlotId: null };
      });
      pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
      useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.shuffled') });
      return true;
    }

    const photoStateKeys: (keyof PhotoPlacement)[] = [
      'photoId', 'crop', 'rotation', 'flipH', 'flipV', 'adjustments',
      'filter', 'filterIntensity', 'panX', 'panY', 'panScale', 'panRotation',
    ];

    const filledIndices = page.placements
      .map((p, i) => (p.photoId ? i : -1))
      .filter((i): i is number => i >= 0);

    const photoStates = filledIndices.map((i) => {
      const state: Record<string, unknown> = {};
      for (const k of photoStateKeys) state[k] = page.placements[i][k];
      return state;
    });
    const shuffledStates = shuffleWithSeed(photoStates, seed);

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      const npPage = { ...page };
      const npPlacements = npPage.placements.map((p, i) => {
        const pos = filledIndices.indexOf(i);
        if (pos < 0) return p;
        const newP = { ...p } as Record<string, unknown>;
        for (const k of photoStateKeys) {
          newP[k] = shuffledStates[pos][k];
        }
        return newP as PhotoPlacement;
      });

      np[pageIndex] = { ...npPage, placements: npPlacements };
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
    useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.shuffled') });
    return true;
  },

  addPhotoToPage(pageIndex: number, photoIdOrIds: string | string[]): void {
    const { pages, albumSize, pageMargin, slotGap } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page || !albumSize) return;

    if (!isGooglePhotosPage(page)) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.onlySmartLayoutSupportAdd') });
      return;
    }

    const rawIds = Array.isArray(photoIdOrIds) ? photoIdOrIds : [photoIdOrIds];
    const uniqueIds = [...new Set(rawIds)].filter(Boolean);
    if (uniqueIds.length === 0) return;

    const photoMap = getPhotoMap();

    const currentPhotoIds = page.placements
      .map((pl) => pl.photoId)
      .filter((id): id is string => id != null);

    const addedIds: string[] = [];
    const skippedIds: string[] = [];
    for (const id of uniqueIds) {
      if (currentPhotoIds.includes(id)) {
        skippedIds.push(id);
      } else if (photoMap.has(id)) {
        addedIds.push(id);
      }
    }
    if (addedIds.length === 0) {
      useUIStore.getState().addToast({ type: 'info', message: skippedIds.length > 0 ? i18n.t('services.pageLayout.photosAlreadyInPage') : i18n.t('services.pageLayout.photoInfoMissing') });
      return;
    }

    const sourceUpdates = new Map<number, string[]>();
    for (const photoId of addedIds) {
      for (let i = 0; i < pages.length; i++) {
        if (i === pageIndex) continue;
        if (pages[i].placements.some((pl) => pl.photoId === photoId)) {
          const list = sourceUpdates.get(i) ?? [];
          list.push(photoId);
          sourceUpdates.set(i, list);
          break;
        }
      }
    }

    const targetPhotoIds = [...currentPhotoIds, ...addedIds];
    const targetPhotos = targetPhotoIds
      .map((id) => photoMap.get(id))
      .filter((p): p is Photo => p != null);

    const tBx = page.perPageBiasX ?? 0;
    const tBy = page.perPageBiasY ?? 0;
    const targetResult = layoutSinglePage(targetPhotos, {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density: 'auto',
      layoutRhythm: 'auto',
      dateGrouping: 'continuous',
      pageOverrides: new Map([[0, { biasX: tBx, biasY: tBy }]]),
    });

    if (targetResult.pages.length === 0) {
      useUIStore.getState().addToast({ type: 'error', message: i18n.t('services.pageLayout.layoutFailed') });
      return;
    }

    const sourceUpdatedPages = new Map<number, AlbumPage>();
    for (const [sourcePageIndex, movedIds] of sourceUpdates.entries()) {
      const srcPage = pages[sourcePageIndex];
      const srcRemaining = srcPage.placements
        .filter((pl) => !movedIds.includes(pl.photoId ?? ''))
        .map((pl) => pl.photoId)
        .filter((id): id is string => id != null)
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => p != null);

      let updated: AlbumPage;
      if (srcRemaining.length === 0) {
        updated = {
          ...srcPage,
          placements: srcPage.placements.filter((pl) => !movedIds.includes(pl.photoId ?? '')),
          slotOverrides: {},
          googlePhotosMmLayout: [],
          googlePhotosBaseMmLayout: [],
          googlePhotosLayoutRows: [],
          googlePhotosBaseLayoutRows: [],
          googlePhotosInternalRows: [],
          googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
          googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
          perPageBiasX: srcPage.perPageBiasX ?? 0,
          perPageBiasY: srcPage.perPageBiasY ?? 0,
          perPageRotation: 0,
        };
      } else {
        const sBx = srcPage.perPageBiasX ?? 0;
        const sBy = srcPage.perPageBiasY ?? 0;
        const srcResult = layoutSinglePage(srcRemaining, {
          pageWidth: albumSize.width,
          pageHeight: albumSize.height,
          margin: pageMargin,
          gap: slotGap,
          density: 'auto',
          layoutRhythm: 'auto',
          dateGrouping: 'continuous',
          pageOverrides: new Map([[0, { biasX: sBx, biasY: sBy }]]),
        });
        if (srcResult.pages.length > 0) {
          const srcMigrator = makePlacementMigrator(srcPage.placements, srcPage.slotOverrides ?? {}, photoMap);
          const srcRegen = buildRegenPageData(srcResult.pages[0].photos, srcMigrator);
          updated = {
            ...srcPage,
            placements: srcRegen.placements,
            slotOverrides: srcRegen.slotOverrides,
            googlePhotosMmLayout: srcRegen.mmLayout,
            googlePhotosBaseMmLayout: srcRegen.mmLayout,
            googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
            googlePhotosInternalRows: srcResult.internalRows[0] || [],
            googlePhotosLayoutRows: srcResult.layoutRows[0] || [],
            googlePhotosBaseLayoutRows: srcResult.layoutRows[0] || [],
            googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
            perPageBiasX: sBx,
            perPageBiasY: sBy,
            perPageRotation: 0,
          };
        } else {
          updated = srcPage;
        }
      }
      sourceUpdatedPages.set(sourcePageIndex, updated);
    }

    const targetMigrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
    const targetRegen = buildRegenPageData(targetResult.pages[0].photos, targetMigrator);

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      // GP 重排后，保留 extraSlots 中用户添加的空槽位的 placement（photoId=null），
      // 否则 extraSlot 仍存在于 extraSlots/slotOrder 但 placements 缺失，导致数据不一致
      const extraSlotPlacements = (page.extraSlots ?? [])
        .filter((es) => !targetRegen.placements.some((p) => p.slotId === es.id))
        .map((es) => ({ slotId: es.id, photoId: null as string | null }));
      np[pageIndex] = {
        ...page,
        placements: [...targetRegen.placements, ...extraSlotPlacements],
        slotOverrides: targetRegen.slotOverrides,
        googlePhotosMmLayout: targetRegen.mmLayout,
        googlePhotosBaseMmLayout: targetRegen.mmLayout,
        googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
        googlePhotosInternalRows: targetResult.internalRows[0] || [],
        googlePhotosLayoutRows: targetResult.layoutRows[0] || [],
        googlePhotosBaseLayoutRows: targetResult.layoutRows[0] || [],
        googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
        perPageBiasX: tBx,
        perPageBiasY: tBy,
        perPageRotation: 0,
      };
      for (const [idx, updatedPage] of sourceUpdatedPages.entries()) {
        np[idx] = updatedPage;
      }
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);

    const movedCount = Array.from(sourceUpdates.values()).reduce((sum, ids) => sum + ids.length, 0);
    if (targetResult.pages.length > 1) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.tooManyPhotos') });
    } else if (movedCount > 0) {
      useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.movedPhotos', { count: addedIds.length }) });
    } else {
      useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.addedPhotos', { count: addedIds.length }) });
    }
  },

  rotatePageLayout(pageIndex: number): void {
    const { pages, albumSize, pageMargin, slotGap } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page || !albumSize) return;
    if (!isGooglePhotosPage(page)) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.onlySmartLayoutSupportSwitch') });
      return;
    }

    const photoMap = getPhotoMap();

    const currentPhotoIds = page.placements
      .map((pl) => pl.photoId).filter((id): id is string => id != null);
    const currentPhotos = currentPhotoIds
      .map((id) => photoMap.get(id)).filter((p): p is Photo => p != null);
    if (currentPhotos.length === 0) return;

    const currentRotation = page.perPageRotation ?? 0;
    const newRotation = ((currentRotation + 90) % 360) as 0 | 90 | 180 | 270;

    const isSideways = newRotation === 90 || newRotation === 270;
    const basePageW = isSideways ? albumSize.height : albumSize.width;
    const basePageH = isSideways ? albumSize.width : albumSize.height;
    const baseContentW = basePageW - pageMargin.left - pageMargin.right;
    const baseContentH = basePageH - pageMargin.top - pageMargin.bottom;
    if (baseContentW <= 0 || baseContentH <= 0) return;

    const layoutResult = layoutSinglePage(currentPhotos, {
      pageWidth: basePageW, pageHeight: basePageH,
      margin: pageMargin, gap: slotGap,
      density: 'auto', layoutRhythm: 'auto', dateGrouping: 'continuous',
    });

    const migrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
    const baseRegen = buildRegenPageData(layoutResult.pages[0].photos, migrator);

    const result = refitPageWithRotation(
      layoutResult.layoutRows[0],
      photoMap,
      baseContentW, baseContentH,
      pageMargin.left, pageMargin.top,
      slotGap,
      0, 0,
      newRotation,
      basePageW, basePageH,
      albumSize.width, albumSize.height,
      pageMargin,
      (layoutResult.tierPatterns[0] as TierPattern | undefined) ?? 'hero-first',
    );

    const MM = 2;
    const slotOverrides: Record<string, SlotOverride> = {};
    const mmLayout: AlbumPage['googlePhotosMmLayout'] = [];
    result.photos.forEach((pr, i) => {
      const pl = baseRegen.placements[i];
      if (!pl) return;
      slotOverrides[pl.slotId] = {
        x: Math.round(pr.x * MM),
        y: Math.round(pr.y * MM),
        width: Math.round(pr.width * MM),
        height: Math.round(pr.height * MM),
      };
      mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
    });

    const baseOverrides = baseRegen.slotOverrides;
    const remappedPlacements = baseRegen.placements.map((pl) => {
      const newOv = slotOverrides[pl.slotId];
      const oldOv = baseOverrides[pl.slotId];
      const photo = photoMap.get(pl.photoId ?? '');
      if (!photo || !oldOv || !newOv || photo.width <= 0 || photo.height <= 0) return pl;
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

      return { ...pl, panX: newPan.panX, panY: newPan.panY, panScale: ps };
    });

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      // 保留 extraSlots 中用户添加的空槽位的 placement
      const extraSlotPlacements = (page.extraSlots ?? [])
        .filter((es) => !remappedPlacements.some((p) => p.slotId === es.id))
        .map((es) => ({ slotId: es.id, photoId: null as string | null }));
      np[pageIndex] = {
        ...page,
        placements: [...remappedPlacements, ...extraSlotPlacements],
        slotOverrides,
        googlePhotosMmLayout: mmLayout,
        googlePhotosBaseMmLayout: layoutResult.pages[0].photos,
        googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
        googlePhotosInternalRows: layoutResult.internalRows[0] || [],
        googlePhotosLayoutRows: layoutResult.layoutRows[0],
        googlePhotosBaseLayoutRows: layoutResult.layoutRows[0],
        googlePhotosBasePageSize: { width: basePageW, height: basePageH },
        perPageBiasX: 0,
        perPageBiasY: 0,
        perPageRotation: newRotation,
      };
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
    useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.rotated') });
  },

  shufflePageLayout(pageIndex: number): void {
    const { pages, albumSize, pageMargin, slotGap } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page || !albumSize) return;
    if (!isGooglePhotosPage(page)) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.onlySmartLayoutSupportSwitch') });
      return;
    }

    const photoMap = getPhotoMap();
    const currentPhotoIds = page.placements
      .map((pl) => pl.photoId)
      .filter((id): id is string => id != null);
    const currentPhotos = currentPhotoIds
      .map((id) => photoMap.get(id))
      .filter((p): p is Photo => p != null);
    if (currentPhotos.length === 0) return;

    const densities: Array<'large' | 'sparse' | 'balanced' | 'compact'> = ['large', 'sparse', 'balanced', 'compact'];
    const rhythms: Array<'auto' | 'uniform' | 'subtle' | 'moderate' | 'rich'> = ['auto', 'uniform', 'subtle', 'moderate', 'rich'];
    const newDensity = densities[Math.floor(Math.random() * densities.length)];
    const newRhythm = rhythms[Math.floor(Math.random() * rhythms.length)];

    const shuffledPhotos = [...currentPhotos].sort(() => Math.random() - 0.5);
    const seed = Math.floor(Math.random() * 10000);

    const result = layoutSinglePage(shuffledPhotos, {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density: newDensity,
      layoutRhythm: newRhythm,
      dateGrouping: 'continuous',
    }, seed);
    if (result.pages.length === 0) return;

    const migrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
    const regen = buildRegenPageData(result.pages[0].photos, migrator);

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      // 保留 extraSlots 中用户添加的空槽位的 placement
      const extraSlotPlacements = (page.extraSlots ?? [])
        .filter((es) => !regen.placements.some((p) => p.slotId === es.id))
        .map((es) => ({ slotId: es.id, photoId: null as string | null }));
      np[pageIndex] = {
        ...page,
        placements: [...regen.placements, ...extraSlotPlacements],
        slotOverrides: regen.slotOverrides,
        googlePhotosMmLayout: regen.mmLayout,
        googlePhotosBaseMmLayout: regen.mmLayout,
        googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
        googlePhotosInternalRows: result.internalRows[0] || [],
        googlePhotosLayoutRows: result.layoutRows[0] || [],
        googlePhotosBaseLayoutRows: result.layoutRows[0] || [],
        googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
        perPageBiasX: 0,
        perPageBiasY: 0,
        perPageRotation: 0,
        perPageRhythm: newRhythm,
      };
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
    useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.layoutShuffled') });
  },

  convertPageToGooglePhotos(pageIndex: number): boolean {
    const { pages, albumSize, pageMargin, slotGap } = useEditorStore.getState();
    const page = pages[pageIndex];
    if (!page || !albumSize) return false;

    if (isGooglePhotosPage(page)) return true;

    const photoMap = getPhotoMap();

    const currentPhotoIds = page.placements
      .map((pl) => pl.photoId)
      .filter((id): id is string => id != null);

    if (currentPhotoIds.length === 0) {
      useUIStore.getState().addToast({ type: 'info', message: i18n.t('services.pageLayout.noPhotosToConvert') });
      return false;
    }

    const currentPhotos = currentPhotoIds
      .map((id) => photoMap.get(id))
      .filter((p): p is Photo => p != null);

    const result = layoutSinglePage(currentPhotos, {
      pageWidth: albumSize.width,
      pageHeight: albumSize.height,
      margin: pageMargin,
      gap: slotGap,
      density: 'auto',
      layoutRhythm: 'auto',
      dateGrouping: 'continuous',
    });

    if (result.pages.length === 0) {
      useUIStore.getState().addToast({ type: 'warning', message: i18n.t('services.pageLayout.convertFailed') });
      return false;
    }

    const migrator = makePlacementMigrator(page.placements, page.slotOverrides ?? {}, photoMap);
    const regen = buildRegenPageData(result.pages[0].photos, migrator);

    useEditorStore.setState((s) => {
      const np = [...s.pages];
      np[pageIndex] = {
        ...page,
        templateId: GOOGLE_PHOTOS_TEMPLATE_ID,
        placements: regen.placements,
        slotOverrides: regen.slotOverrides,
        googlePhotosMmLayout: regen.mmLayout,
        googlePhotosBaseMmLayout: regen.mmLayout,
        googlePhotosMmConfig: { margin: { ...pageMargin }, gap: slotGap },
        googlePhotosInternalRows: result.internalRows[0] || [],
        googlePhotosLayoutRows: result.layoutRows[0] || [],
        googlePhotosBaseLayoutRows: result.layoutRows[0] || [],
        googlePhotosBasePageSize: { width: albumSize.width, height: albumSize.height },
        perPageBiasX: 0,
        perPageBiasY: 0,
        perPageRotation: 0,
      };
      return { pages: np, selectedSlotId: null };
    });
    pushSnapshot(useEditorStore.getState().pages, useEditorStore.getState().selectedSlotId);
    useUIStore.getState().addToast({ type: 'success', message: i18n.t('services.pageLayout.converted') });
    return true;
  },
};

/**
 * 保留兼容的 slot 操作（不跨域，仍由 store 直接实现）。
 * 这里仅导出类型帮助函数，供服务内部使用。
 */
export { TEMPLATES };
