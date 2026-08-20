/**
 * coverScale — 封面/封底跨尺寸适配几何测试
 *
 * 防护目标：封面模板跨尺寸适配是"四端同源"的原始输入，
 * 任何一端改错会同时影响画布/导出/缩略图/预览的封面视觉。
 * 断言贴边/居中/百分比三类锚点语义与拉伸/等比两种尺寸策略。
 */
import { describe, it, expect } from 'vitest';
import { isMaskShape, coverSlotSize, coverElementSize, coverAnchorPosition } from './coverScale';

const EPS = 1e-6;

describe('coverSlotSize（槽位逐轴适配）', () => {
  it('全幅槽(100×100) 两边都拉伸铺满', () => {
    const r = coverSlotSize({ width: 100, height: 100 }, 2, 3);
    expect(r.width).toBeCloseTo(200, EPS);
    expect(r.height).toBeCloseTo(300, EPS);
  });

  it('恋恋故事式(48×100) 高度拉伸全高、宽度等比', () => {
    const r = coverSlotSize({ width: 48, height: 100 }, 2, 3);
    // 宽非全幅 → 等比 min(2,3)=2；高全幅 → 拉伸到 ky
    expect(r.width).toBeCloseTo(96, EPS);
    expect(r.height).toBeCloseTo(300, EPS);
  });

  it('多图式(37×58 / 60×46) 两边都不全幅 → 等比保持比例', () => {
    const r0 = coverSlotSize({ width: 37, height: 58 }, 2, 2.5);
    expect(r0.width).toBeCloseTo(37 * 2, EPS);
    expect(r0.height).toBeCloseTo(58 * 2, EPS);
    const r1 = coverSlotSize({ width: 60, height: 46 }, 2, 2.5);
    expect(r1.width).toBeCloseTo(60 * 2, EPS);
    expect(r1.height).toBeCloseTo(46 * 2, EPS);
  });

  it('等比缩放不改变宽高比', () => {
    const r = coverSlotSize({ width: 37, height: 58 }, 2, 3);
    expect(r.width / r.height).toBeCloseTo(37 / 58, 6);
  });
});

describe('coverElementSize（区域拉伸 vs 图形等比）', () => {
  it('区域/背景型：按轴拉伸铺满', () => {
    const r = coverElementSize(true, 40, 30, 2, 2.5);
    expect(r.width).toBeCloseTo(80, EPS);
    expect(r.height).toBeCloseTo(75, EPS);
  });

  it('图形/局部型：等比缩放，保持宽高比', () => {
    const r = coverElementSize(false, 40, 30, 2, 2.5);
    expect(r.width).toBeCloseTo(80, EPS); // min(2,2.5)=2
    expect(r.height).toBeCloseTo(60, EPS);
    expect(r.width / r.height).toBeCloseTo(40 / 30, 6);
  });
});

describe('coverAnchorPosition（锚点感知定位）', () => {
  const pageW = 210;
  const pageH = 280;

  it('贴左元素保持贴左', () => {
    const r = coverAnchorPosition({ x: 0, y: 10, width: 5, height: 5 }, pageW, pageH, 20, 20);
    expect(r.x).toBeCloseTo(0, EPS);
    expect(r.y).toBeCloseTo((10 / 100) * pageH, EPS); // 非贴顶/贴底，走百分比
  });

  it('贴右元素保持贴右', () => {
    const r = coverAnchorPosition({ x: 95, y: 10, width: 5, height: 5 }, pageW, pageH, 20, 20);
    expect(r.x).toBeCloseTo(pageW - 20, EPS);
  });

  it('贴顶/贴底保持贴边', () => {
    const top = coverAnchorPosition({ x: 10, y: 0, width: 5, height: 5 }, pageW, pageH, 20, 20);
    expect(top.y).toBeCloseTo(0, EPS);
    const bottom = coverAnchorPosition({ x: 10, y: 95, width: 5, height: 5 }, pageW, pageH, 20, 20);
    expect(bottom.y).toBeCloseTo(pageH - 20, EPS);
  });

  it('居中元素（中心≈50%）保持居中', () => {
    const r = coverAnchorPosition({ x: 25, y: 25, width: 50, height: 50 }, pageW, pageH, 105, 140);
    expect(r.x).toBeCloseTo(pageW / 2 - 105 / 2, EPS);
    expect(r.y).toBeCloseTo(pageH / 2 - 140 / 2, EPS);
  });

  it('其余元素按百分比定位', () => {
    const r = coverAnchorPosition({ x: 10, y: 20, width: 5, height: 5 }, pageW, pageH, 8, 8);
    expect(r.x).toBeCloseTo((10 / 100) * pageW, EPS);
    expect(r.y).toBeCloseTo((20 / 100) * pageH, EPS);
  });
});

describe('isMaskShape', () => {
  it('含 mask 视为蒙版（区域/背景型）', () => {
    expect(isMaskShape('mask')).toBe(true);
    expect(isMaskShape('deco-mask-1')).toBe(true);
    expect(isMaskShape('shape-1')).toBe(false);
    expect(isMaskShape(undefined)).toBe(false);
  });
});