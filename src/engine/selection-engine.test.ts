/**
 * 框选 + 组合缩放引擎测试
 *
 * 核心断言：
 *   1. hitTestMarquee：完全包含判定（含反向拖拽）
 *   2. computeBBox：多槽位包围盒
 *   3. computeScaledSlots：缩放比例、最小尺寸、页面边界约束
 *   4. computeMovedSlots：整体平移
 */
import { describe, it, expect } from 'vitest';
import {
  hitTestMarquee,
  computeBBox,
  computeScaledSlots,
  computeMovedSlots,
  isUniformScale,
  type SlotRect,
} from './selection-engine';

const slot = (id: string, x: number, y: number, width: number, height: number): SlotRect =>
  ({ id, x, y, width, height });

describe('hitTestMarquee', () => {
  const s = slot('a', 100, 100, 50, 50);

  it('完全包含时命中', () => {
    expect(hitTestMarquee({ x1: 50, y1: 50, x2: 200, y2: 200 }, s)).toBe(true);
  });

  it('部分相交不算命中（完全包含语义）', () => {
    expect(hitTestMarquee({ x1: 120, y1: 120, x2: 300, y2: 300 }, s)).toBe(false);
  });

  it('反向拖拽（右下→左上）同样正确', () => {
    expect(hitTestMarquee({ x1: 200, y1: 200, x2: 50, y2: 50 }, s)).toBe(true);
  });

  it('边缘恰好贴合算命中', () => {
    expect(hitTestMarquee({ x1: 100, y1: 100, x2: 150, y2: 150 }, s)).toBe(true);
  });
});

describe('computeBBox', () => {
  it('空数组返回 null', () => {
    expect(computeBBox([], 400, 400)).toBeNull();
  });

  it('多槽位包围盒与中心点', () => {
    const bbox = computeBBox([
      slot('a', 10, 20, 30, 40),
      slot('b', 100, 50, 20, 20),
    ], 400, 400)!;
    expect(bbox.minX).toBe(10);
    expect(bbox.minY).toBe(20);
    expect(bbox.maxX).toBe(120);
    expect(bbox.maxY).toBe(70);
    expect(bbox.width).toBe(110);
    expect(bbox.height).toBe(50);
    expect(bbox.centerX).toBeCloseTo(65);
    expect(bbox.centerY).toBeCloseTo(45);
  });
});

describe('computeScaledSlots', () => {
  const slots = [slot('a', 100, 100, 100, 100), slot('b', 200, 200, 100, 100)];
  const bbox = computeBBox(slots, 800, 800)!;

  it('拖 se 角放大 2 倍：尺寸翻倍、原点（nw）固定', () => {
    const result = computeScaledSlots(slots, bbox, 'se', 700, 700, 800, 800)!;
    // bbox 原 200x200，鼠标到 (700,700) → scale 3
    expect(result[0].width).toBeCloseTo(300);
    expect(result[0].height).toBeCloseTo(300);
    expect(result[0].x).toBeCloseTo(100); // nw 原点不动
    expect(result[0].y).toBeCloseTo(100);
  });

  it('拖 e 边只改宽度，高度不变', () => {
    const result = computeScaledSlots(slots, bbox, 'e', 400, 123, 800, 800)!;
    // oldDX = bbox.width = 200，newDX = 400-100 = 300 → scaleX = 1.5
    expect(result[0].width).toBeCloseTo(150);
    expect(result[0].height).toBeCloseTo(100);
  });

  it('小于最小尺寸时钳制到 minSize', () => {
    const result = computeScaledSlots(slots, bbox, 'se', 101, 101, 800, 800, 30)!;
    // 极度缩小 → 钳制到 30
    expect(result[0].width).toBe(30);
    expect(result[0].height).toBe(30);
  });

  it('缩放结果不超出页面右/下边界', () => {
    const nearEdge = [slot('a', 700, 700, 50, 50)];
    const ebbox = computeBBox(nearEdge, 800, 800)!;
    const result = computeScaledSlots(nearEdge, ebbox, 'se', 1000, 1000, 800, 800, 10)!;
    expect(result[0].x + result[0].width).toBeLessThanOrEqual(800);
    expect(result[0].y + result[0].height).toBeLessThanOrEqual(800);
  });
});

describe('computeMovedSlots', () => {
  it('整体平移保持尺寸', () => {
    const result = computeMovedSlots([slot('a', 10, 20, 30, 40)], 5, -7);
    expect(result[0]).toEqual({ id: 'a', x: 15, y: 13, width: 30, height: 40 });
  });
});

describe('isUniformScale', () => {
  it('角点为等比，边点为非等比', () => {
    expect(isUniformScale('nw')).toBe(true);
    expect(isUniformScale('se')).toBe(true);
    expect(isUniformScale('e')).toBe(false);
    expect(isUniformScale('n')).toBe(false);
  });
});
