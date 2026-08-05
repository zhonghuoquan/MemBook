/**
 * editorStore/helpers — 纯函数单元测试
 *
 * 核心断言：
 * 1. calcSlotPixelSize：无 override 时按百分比计算，有 override 时用 override 值
 * 2. buildRegenPageData：正确生成 placements/slotOverrides/mmLayout 三元组
 * 3. calcSlotPixelSize 边界：slot.width=100 时占满画布宽度
 */
import { describe, it, expect } from 'vitest';
import { calcSlotPixelSize, buildRegenPageData } from './helpers';
import type { SlotLayout, SlotOverride, PhotoPlacement } from '../../types';

const EPS = 1e-6;

function makeSlot(overrides: Partial<SlotLayout> = {}): SlotLayout {
  return { id: 's1', x: 0, y: 0, width: 50, height: 50, ...overrides };
}

describe('calcSlotPixelSize', () => {
  it('无 override 时按模板百分比计算', () => {
    const slot = makeSlot({ width: 50, height: 30 });
    const result = calcSlotPixelSize(slot, undefined, 400, 560);
    expect(result.width).toBeCloseTo(200, EPS);  // 50% * 400
    expect(result.height).toBeCloseTo(168, EPS);  // 30% * 560
  });

  it('有 override 时直接使用 override 像素值', () => {
    const slot = makeSlot({ width: 50, height: 50 });
    const overrides: Record<string, SlotOverride> = {
      s1: { x: 10, y: 20, width: 150, height: 200 },
    };
    const result = calcSlotPixelSize(slot, overrides, 400, 560);
    expect(result.width).toBe(150);
    expect(result.height).toBe(200);
  });

  it('slot.width=100 时占满画布宽度', () => {
    const slot = makeSlot({ width: 100, height: 100 });
    const result = calcSlotPixelSize(slot, undefined, 420, 560);
    expect(result.width).toBeCloseTo(420, EPS);
    expect(result.height).toBeCloseTo(560, EPS);
  });

  it('不同 slotId 的 override 不互相干扰', () => {
    const slot = makeSlot({ id: 's2', width: 40, height: 40 });
    const overrides: Record<string, SlotOverride> = {
      s1: { x: 0, y: 0, width: 999, height: 999 },
    };
    const result = calcSlotPixelSize(slot, overrides, 400, 560);
    expect(result.width).toBeCloseTo(160, EPS);  // 40% * 400
    expect(result.height).toBeCloseTo(224, EPS);  // 40% * 560
  });
});

describe('buildRegenPageData', () => {
  it('正确生成 placements + slotOverrides + mmLayout', () => {
    const gpPhotos = [
      { photoId: 'p1', x: 0, y: 0, width: 100, height: 100 },
      { photoId: 'p2', x: 100, y: 0, width: 50, height: 100 },
    ];

    const migrator = (photoId: string, slotId: string): PhotoPlacement => ({
      slotId, photoId,
    });

    const result = buildRegenPageData(gpPhotos, migrator);

    expect(result.placements).toHaveLength(2);
    expect(result.placements[0].slotId).toBe('gp-0');
    expect(result.placements[0].photoId).toBe('p1');
    expect(result.placements[1].slotId).toBe('gp-1');
    expect(result.placements[1].photoId).toBe('p2');

    // slotOverrides: mm 坐标 × MM(2)
    expect(result.slotOverrides['gp-0']).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(result.slotOverrides['gp-1']).toEqual({ x: 200, y: 0, width: 100, height: 200 });

    // mmLayout: 保留原始 mm 坐标
    expect(result.mmLayout!).toHaveLength(2);
    expect(result.mmLayout![0]).toEqual({ photoId: 'p1', x: 0, y: 0, width: 100, height: 100 });
    expect(result.mmLayout![1]).toEqual({ photoId: 'p2', x: 100, y: 0, width: 50, height: 100 });
  });

  it('空数组返回空三元组', () => {
    const migrator = (): PhotoPlacement => ({ slotId: '', photoId: '' });
    const result = buildRegenPageData([], migrator);
    expect(result.placements).toHaveLength(0);
    expect(result.slotOverrides).toEqual({});
    expect(result.mmLayout).toHaveLength(0);
  });

  it('migrator 迁移编辑属性', () => {
    const gpPhotos = [{ photoId: 'p1', x: 10, y: 20, width: 80, height: 60 }];

    const migrator = (photoId: string, slotId: string): PhotoPlacement => ({
      slotId, photoId, rotation: 90, flipH: true,
      adjustments: { exposure: 10, brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0 },
    });

    const result = buildRegenPageData(gpPhotos, migrator);
    expect(result.placements[0].rotation).toBe(90);
    expect(result.placements[0].flipH).toBe(true);
    expect(result.placements[0].adjustments?.exposure).toBe(10);
  });
});
