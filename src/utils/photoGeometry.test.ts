/**
 * 照片几何计算 — cover-fit 覆盖与边界约束测试
 *
 * 核心断言：
 *   1. calcCoverFitWithRotation：任意旋转角下 bounding 必须完全覆盖槽位
 *   2. clampPhotoToSlotBounds：钳制后的位置必须使槽位四角不露白
 */
import { describe, it, expect } from 'vitest';
import { calcCoverFitWithRotation, clampPhotoToSlotBounds } from './photoGeometry';

const EPS = 1e-6;

describe('calcCoverFitWithRotation', () => {
  const cases: [number, number, number, number][] = [
    // [imgW, imgH, slotW, slotH]
    [4000, 3000, 200, 150], // 横图 → 横槽
    [3000, 4000, 200, 150], // 竖图 → 横槽
    [4000, 3000, 150, 200], // 横图 → 竖槽
    [3000, 3000, 200, 200], // 方图 → 方槽
    [800, 600, 400, 300],   // 小图需要放大
  ];

  for (const [iw, ih, cw, ch] of cases) {
    for (const rotation of [0, 90, 180, 270]) {
      it(`覆盖：${iw}x${ih} 图 → ${cw}x${ch} 槽 @${rotation}°`, () => {
        const cf = calcCoverFitWithRotation(iw, ih, cw, ch, rotation);
        // 旋转后的可见边界必须完全覆盖槽位（不露白）
        expect(cf.boundingW).toBeGreaterThanOrEqual(cw - EPS);
        expect(cf.boundingH).toBeGreaterThanOrEqual(ch - EPS);
        // 缩放保持宽高比
        expect(cf.imgW / iw).toBeCloseTo(cf.scale, 6);
        expect(cf.imgH / ih).toBeCloseTo(cf.scale, 6);
        expect(cf.scale).toBeGreaterThan(0);
      });
    }
  }

  it('0° 与 180° 结果一致，90° 与 270° 结果一致', () => {
    const cf0 = calcCoverFitWithRotation(4000, 3000, 200, 150, 0);
    const cf180 = calcCoverFitWithRotation(4000, 3000, 200, 150, 180);
    const cf90 = calcCoverFitWithRotation(4000, 3000, 200, 150, 90);
    const cf270 = calcCoverFitWithRotation(4000, 3000, 200, 150, 270);
    expect(cf0.boundingW).toBeCloseTo(cf180.boundingW, 6);
    expect(cf0.boundingH).toBeCloseTo(cf180.boundingH, 6);
    expect(cf90.boundingW).toBeCloseTo(cf270.boundingW, 6);
    expect(cf90.boundingH).toBeCloseTo(cf270.boundingH, 6);
  });

  it('任意角度（45°）同样满足覆盖约束', () => {
    const cf = calcCoverFitWithRotation(4000, 3000, 200, 150, 45);
    expect(cf.boundingW).toBeGreaterThanOrEqual(200 - EPS);
    expect(cf.boundingH).toBeGreaterThanOrEqual(150 - EPS);
  });
});

describe('clampPhotoToSlotBounds', () => {
  it('居中的照片钳制后仍在原位附近（不漂移）', () => {
    const iw = 4000, ih = 3000, sw = 200, sh = 150;
    const cf = calcCoverFitWithRotation(iw, ih, sw, sh, 0);
    const centerX = (sw - cf.boundingW) / 2;
    const centerY = (sh - cf.boundingH) / 2;
    const clamped = clampPhotoToSlotBounds(iw, ih, sw, sh, 0, 1, centerX, centerY);
    expect(clamped.panX).toBeCloseTo(centerX, 3);
    expect(clamped.panY).toBeCloseTo(centerY, 3);
  });

  it('极端偏移被拉回，槽位四角不露白（0°）', () => {
    const iw = 4000, ih = 3000, sw = 200, sh = 150;
    // 把照片挪到极远位置
    const clamped = clampPhotoToSlotBounds(iw, ih, sw, sh, 0, 1, 9999, -9999);
    const cf = calcCoverFitWithRotation(iw, ih, sw, sh, 0);
    // 照片左边缘 ≤ 0，右边缘 ≥ sw（覆盖槽位）
    expect(clamped.panX).toBeLessThanOrEqual(EPS);
    expect(clamped.panX + cf.boundingW).toBeGreaterThanOrEqual(sw - EPS);
    expect(clamped.panY).toBeLessThanOrEqual(EPS);
    expect(clamped.panY + cf.boundingH).toBeGreaterThanOrEqual(sh - EPS);
  });

  it('旋转 90° 后极端偏移仍能保证覆盖', () => {
    const iw = 4000, ih = 3000, sw = 200, sh = 150;
    const rotation = 90;
    const clamped = clampPhotoToSlotBounds(iw, ih, sw, sh, rotation, 1.5, -8888, 7777);
    const cf = calcCoverFitWithRotation(iw, ih, sw, sh, rotation);
    const ps = 1.5;
    const bw = cf.boundingW * ps;
    const bh = cf.boundingH * ps;
    expect(clamped.panX).toBeLessThanOrEqual(EPS);
    expect(clamped.panX + bw).toBeGreaterThanOrEqual(sw - EPS);
    expect(clamped.panY).toBeLessThanOrEqual(EPS);
    expect(clamped.panY + bh).toBeGreaterThanOrEqual(sh - EPS);
  });
});
