/**
 * editorStore/helpers — 纯函数单元测试
 *
 * 核心断言：
 * 1. calcSlotPixelSize：无 override 时按百分比计算，有 override 时用 override 值
 * 2. buildRegenPageData：正确生成 placements/slotOverrides/mmLayout 三元组
 * 3. calcSlotPixelSize 边界：slot.width=100 时占满画布宽度
 */
import { describe, it, expect } from 'vitest';
import { calcSlotPixelSize, buildRegenPageData, fitPageToSafeBox } from './helpers';
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

describe('fitPageToSafeBox', () => {
  // 模拟 Google Photos 页面：210×280mm、四边距 15mm，安全区像素框 [30..390]×[30..530]
  const safeL = 30, safeT = 30, safeR = 390, safeB = 530;

  it('逐张独立取整会越界，整体缩放后任一照片位都不越出安全区', () => {
    // 两图一上一下：mm 布局填满安全区（各高 123mm + gap 4mm）
    const mm = [
      { x: 15, y: 15, width: 90, height: 123 },
      { x: 15, y: 142, width: 90, height: 123 },
    ];
    const px = fitPageToSafeBox(mm, safeL, safeT, safeR, safeB);
    // 所有槽位左上角 ≥ 安全区左上，右下角 ≤ 安全区右下
    for (const r of px) {
      expect(r!.x).toBeGreaterThanOrEqual(safeL);
      expect(r!.y).toBeGreaterThanOrEqual(safeT);
      expect(r!.x + r!.width).toBeLessThanOrEqual(safeR);
      expect(r!.y + r!.height).toBeLessThanOrEqual(safeB);
    }
    // 未填满方向不被强行填充：X 方向（bbox 宽 180px ≪ 360px）保持原形状，不被拉大到安全区宽
    expect(px[0]!.width).toBeLessThan(safeR - safeL);
  });

  it('双轴填满时，贴右/贴下槽位精确锚定到安全线（右缘=safeR、下缘=safeB），消除向下取整的内缩', () => {
    // 双行双列填满安全区（内容区 180×250mm，每格 88×123mm + gap 4mm）
    const mm = [
      { x: 15, y: 15, width: 88, height: 123 },
      { x: 107, y: 15, width: 88, height: 123 },
      { x: 15, y: 142, width: 88, height: 123 },
      { x: 107, y: 142, width: 88, height: 123 },
    ];
    const px = fitPageToSafeBox(mm, safeL, safeT, safeR, safeB);
    // 右上角槽位（index1）右缘精确贴右安全线
    expect(px[1]!.x + px[1]!.width).toBe(safeR);
    // 左下角槽位（index2）下缘精确贴下安全线
    expect(px[2]!.y + px[2]!.height).toBe(safeB);
    // 右下角槽位（index3）右缘、下缘同时精确贴安全线
    expect(px[3]!.x + px[3]!.width).toBe(safeR);
    expect(px[3]!.y + px[3]!.height).toBe(safeB);
    // 左上角槽位（index0）保持原形状（不贴右/不贴下，宽高按 scale 取整）
    expect(px[0]!.x + px[0]!.width).toBeLessThan(safeR);
    expect(px[0]!.y + px[0]!.height).toBeLessThan(safeB);
    // 所有槽位仍不越界（锚定不破坏硬约束）
    for (const r of px) {
      expect(r!.x).toBeGreaterThanOrEqual(safeL);
      expect(r!.y).toBeGreaterThanOrEqual(safeT);
      expect(r!.x + r!.width).toBeLessThanOrEqual(safeR);
      expect(r!.y + r!.height).toBeLessThanOrEqual(safeB);
    }
  });

  it('两图一上一线的垂直间距约等于 slotGap（4mm → 8px），不再被撑宽', () => {
    const mm = [
      { x: 15, y: 15, width: 90, height: 123 },
      { x: 15, y: 142, width: 90, height: 123 },
    ];
    const px = fitPageToSafeBox(mm, safeL, safeT, safeR, safeB);
    const bottom1 = px[0]!.y + px[0]!.height;
    const gap = px[1]!.y - bottom1;
    expect(gap).toBeGreaterThanOrEqual(7);
    expect(gap).toBeLessThanOrEqual(9);
  });

  it('同一排照片的水平缝隙约等于 slotGap（4mm → 8px），并保持对齐', () => {
    const mm = [
      { x: 15, y: 15, width: 80, height: 100 },
      { x: 99, y: 15, width: 80, height: 100 },
    ];
    const px = fitPageToSafeBox(mm, safeL, safeT, safeR, safeB);
    const gap = px[1]!.x - (px[0]!.x + px[0]!.width);
    expect(gap).toBeGreaterThanOrEqual(7);
    expect(gap).toBeLessThanOrEqual(9);
    expect(px[0]!.y).toBe(px[1]!.y); // 同排上缘对齐
  });
});
