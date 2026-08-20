/**
 * thumbnailCore.buildPhotoPlacementPlan — 照片槽位渲染计划测试
 *
 * 阶段 1 目标：把画布/导出/缩略图/预览共用的"照片摆放"核心判定抽成纯函数并测死。
 * 断言：槽位坐标/照片 cover-fit 不露白/渲染层级(z)/渲染顺序(slotOrder)。
 */
import { describe, it, expect } from 'vitest';
import { buildPhotoPlacementPlan, type PhotoPlanItem } from './thumbnailCore';
import type { AlbumPage, Photo, PhotoPlacement } from '../types';

const EPS = 1e-6;

function makePhoto(id: string, w: number, h: number): Photo {
  return { id, name: id, src: '', width: w, height: h } as unknown as Photo;
}

function makePlacement(slotId: string, photoId: string, extra: Partial<PhotoPlacement> = {}): PhotoPlacement {
  return { slotId, photoId, rotation: 0, ...extra } as PhotoPlacement;
}

function makePage(overrides: Partial<AlbumPage>): AlbumPage {
  return {
    id: 'p',
    albumId: 'a',
    pageKind: 'normal',
    templateId: '',
    width: 210,
    height: 280,
    orientation: 'landscape',
    color: '#FFFFFF',
    placements: [],
    ...overrides,
  } as unknown as AlbumPage;
}

/* ── 基础：覆盖槽位、不产生不合法项 ── */
describe('buildPhotoPlacementPlan', () => {
  it('按 slotOrder 排序，返回槽位坐标与层级', () => {
    const page = makePage({
      slotOrder: ['a', 'b'],
      slotOverrides: {
        a: { x: 0, y: 0, width: 100, height: 100 },
        b: { x: 200, y: 0, width: 100, height: 100 },
      },
      slotZIndices: { a: 5, b: 3 },
      placements: [
        makePlacement('b', 'p1'),
        makePlacement('a', 'p2'),
      ],
    });
    const photos = [makePhoto('p1', 4000, 3000), makePhoto('p2', 3000, 4000)];
    const plan = buildPhotoPlacementPlan(page, photos, 420, 560);

    // 渲染顺序优先 slotOrder：a 在前
    expect(plan.map((i) => i.slot.width)).toEqual([100, 100]);
    expect(plan.map((i) => i.slot.x)).toEqual([0, 200]);
    expect(plan[0].photoId).toBe('p2'); // slotOrder a 先
    expect(plan[1].photoId).toBe('p1');
    // 层级取 slotZIndices
    expect(plan.map((i) => i.z)).toEqual([5, 3]);
  });

  it('照片 cover-fit 铺满槽位（不露白）', () => {
    const page = makePage({
      slotOrder: ['a'],
      slotOverrides: { a: { x: 10, y: 10, width: 100, height: 100 } },
      placements: [makePlacement('a', 'p1')],
    });
    const plan = buildPhotoPlacementPlan(page, [makePhoto('p1', 4000, 3000)], 420, 560);
    expect(plan).toHaveLength(1);
    const item: PhotoPlanItem = plan[0];
    // 覆盖槽位四个方向（draw 区域 >= 槽位，负偏移向内扩展）
    expect(item.params!.drawX).toBeLessThanOrEqual(EPS);
    expect(item.params!.drawX + item.params!.drawW).toBeGreaterThanOrEqual(100 - EPS);
    expect(item.params!.drawY).toBeLessThanOrEqual(EPS);
    expect(item.params!.drawY + item.params!.drawH).toBeGreaterThanOrEqual(100 - EPS);
  });

  it('照片引用不存在 / 零尺寸照片时被排除', () => {
    const page = makePage({
      slotOrder: ['a', 'b', 'c'],
      slotOverrides: {
        a: { x: 0, y: 0, width: 100, height: 100 },
        b: { x: 0, y: 0, width: 100, height: 100 },
        c: { x: 0, y: 0, width: 100, height: 100 },
      },
      placements: [
        makePlacement('a', 'ghost'),  // 照片不存在
        makePlacement('b', 'p1'),
        makePlacement('c', 'p0'),     // 零尺寸照片
      ],
    });
    const plan = buildPhotoPlacementPlan(page, [makePhoto('p1', 4000, 3000), makePhoto('p0', 0, 0)], 420, 560);
    expect(plan.map((i) => i.photoId)).toEqual(['p1']);
  });

  it('无 slotOrder 时仍返回全部有效照片，z 默认 0（顺序由模板/虚拟模板决定，此处只锁集合）', () => {
    const page = makePage({
      placements: [makePlacement('b', 'p1'), makePlacement('a', 'p2')],
      slotOverrides: {
        a: { x: 0, y: 0, width: 100, height: 100 },
        b: { x: 0, y: 0, width: 100, height: 100 },
      },
    });
    const plan = buildPhotoPlacementPlan(page, [makePhoto('p1', 4000, 3000), makePhoto('p2', 3000, 4000)], 420, 560);
    // 有效照片全部出现、无遗漏
    expect(new Set(plan.map((i) => i.photoId))).toEqual(new Set(['p1', 'p2']));
    expect(plan.every((i) => i.z === 0)).toBe(true);
  });

  it('空 placement / 空照片返回空计划', () => {
    expect(buildPhotoPlacementPlan(makePage({}), [], 420, 560)).toEqual([]);
  });
});