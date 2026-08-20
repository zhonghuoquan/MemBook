/**
 * photoGeometry 重排平移重拟合测试
 *
 * 背景（P2 修复）：重排照片时若把绝对 panX/panY 原样搬到宽高比不同的槽位会露白。
 * refitPlacementPan 换槽时按新槽尺寸重拟合并夹紧 pan，确保照片仍铺满新槽位。
 * 这里用「重拟结果仍在 computePhotoBounds（可行 pan 范围）内」作为「不露白」的判定。
 */

import { describe, it, expect } from 'vitest';
import {
  refitPlacementPan,
  computePhotoBounds,
  calcCoverFitWithRotation,
} from './photoGeometry';

describe('refitPlacementPan：无平移编辑', () => {
  it('panX/panY/panScale 全空时返回空对象（调用方回退居中）', () => {
    const r = refitPlacementPan(3000, 2000, 400, 300, 200, 300, { rotation: 90 });
    expect(r).toEqual({});
  });
});

describe('refitPlacementPan：宽槽 -> 窄槽（露白场景）', () => {
  const photoW = 3000;
  const photoH = 2000;

  it('横向照片从 400x300 换到 200x300：新槽比照片宽更窄，只能居中（无露白）', () => {
    const r = refitPlacementPan(photoW, photoH, 400, 300, 200, 300, {
      panX: -25, panY: 0, panScale: 1, rotation: 0,
    });
    expect(r.panScale).toBe(1);
    // 200 宽槽，照片 cover-fit 后面宽 450，只能居中：panX = (200-450)/2 = -125
    expect(r.panX).toBeCloseTo(-125, 0);
    expect(r.panY).toBeCloseTo(0, 0);
  });

  it('重拟后的 pan 始终在目标槽的可行范围内（覆盖四角、不露白）', () => {
    const scenarios: Array<{ oldW: number; oldH: number; newW: number; newH: number; rot: number; ps: number }> = [
      { oldW: 400, oldH: 300, newW: 200, newH: 300, rot: 0, ps: 1 },
      { oldW: 300, oldH: 200, newW: 260, newH: 340, rot: 90, ps: 1.2 },
      { oldW: 320, oldH: 260, newW: 300, newH: 260, rot: 45, ps: 1 },
      { oldW: 400, oldH: 280, newW: 240, newH: 360, rot: 30, ps: 1.5 },
    ];
    for (const s of scenarios) {
      // 旧槽内一个合法（居中）平移作为输入
      const oldCF = calcCoverFitWithRotation(photoW, photoH, s.oldW, s.oldH, s.rot);
      const oldPanX = (s.oldW - oldCF.boundingW * s.ps) / 2;
      const oldPanY = (s.oldH - oldCF.boundingH * s.ps) / 2;
      const r = refitPlacementPan(photoW, photoH, s.oldW, s.oldH, s.newW, s.newH, {
        panX: oldPanX, panY: oldPanY, panScale: s.ps, rotation: s.rot,
      });
      const bounds = computePhotoBounds(photoW, photoH, s.newW, s.newH, s.rot, s.ps);
      expect(r.panX).toBeGreaterThanOrEqual(bounds.minX - 0.01);
      expect(r.panX).toBeLessThanOrEqual(bounds.maxX + 0.01);
      expect(r.panY).toBeGreaterThanOrEqual(bounds.minY - 0.01);
      expect(r.panY).toBeLessThanOrEqual(bounds.maxY + 0.01);
    }
  });
});

describe('refitPlacementPan：保留缩放', () => {
  it('panScale > 1 被保留', () => {
    const r = refitPlacementPan(3000, 2000, 400, 300, 260, 340, {
      panX: 0, panY: 0, panScale: 1.4, rotation: 90,
    });
    expect(r.panScale).toBe(1.4);
  });

  it('照片尺寸非法时回退居中（返回空对象）', () => {
    expect(refitPlacementPan(0, 2000, 400, 300, 260, 340, { panX: 0, panY: 0, panScale: 1 })).toEqual({});
  });
});