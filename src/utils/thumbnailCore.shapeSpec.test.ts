/**
 * thumbnailCore.buildShapePaintSpec — 形状画刷/变换 spec 测试
 *
 * 阶段 1 继续：把形状的填充/描边/渐变/尺寸下限/透明度解析抽成纯函数并测死，
 * 画布/导出/缩略图/预览共用同一套形状画刷判定。
 */
import { describe, it, expect } from 'vitest';
import { buildShapePaintSpec } from './thumbnailCore';
import { MM_TO_PX } from './sharedRender';
import { MIN_SHAPE_SIZE_MM, MIN_STROKE_WIDTH } from '../components/editor/canvas/constants';
import type { ShapeElement } from '../types';

const MIN_PX = MIN_SHAPE_SIZE_MM * MM_TO_PX; // 4

function sh(overrides: Partial<ShapeElement>): ShapeElement {
  return {
    type: 'rectangle', x: 0, y: 0, width: 10, height: 8,
    ...overrides,
  } as unknown as ShapeElement;
}

describe('buildShapePaintSpec — 尺寸/变换', () => {
  it('位置按 mm×2 换算，透明度/旋转透传', () => {
    const s = buildShapePaintSpec(sh({ x: 5, y: 3, rotation: 45, opacity: 0.6 }));
    expect(s.x).toBeCloseTo(10, 6);
    expect(s.y).toBeCloseTo(6, 6);
    expect(s.rotation).toBe(45);
    expect(s.opacity).toBeCloseTo(0.6, 6);
  });

  it('透明度缺省为 1；尺寸下限 MIN_SHAPE_SIZE_MM', () => {
    const s = buildShapePaintSpec(sh({}));
    expect(s.opacity).toBe(1);
    expect(s.pw).toBeCloseTo(20, 6);
    // 极小尺寸被抬到下限
    const tiny = buildShapePaintSpec(sh({ width: 0.5, height: 0.3 }));
    expect(tiny.pw).toBeCloseTo(MIN_PX, 6);
    expect(tiny.ph).toBeCloseTo(MIN_PX, 6);
  });

  it('描边宽下限 MIN_STROKE_WIDTH', () => {
    expect(buildShapePaintSpec(sh({ strokeWidth: 0 })).lineWidth).toBeCloseTo(MIN_STROKE_WIDTH, 6);
    expect(buildShapePaintSpec(sh({ strokeWidth: 5 })).lineWidth).toBe(5);
  });
});

describe('buildShapePaintSpec — 填充/描边', () => {
  it('纯色填充 + 纯色描边', () => {
    const s = buildShapePaintSpec(sh({ fill: '#FF0000', stroke: '#00FF00', strokeWidth: 2 }));
    expect(s.fill).toEqual({ kind: 'solid', color: '#FF0000' });
    expect(s.stroke).toEqual({ kind: 'solid', color: '#00FF00' });
    expect(s.lineWidth).toBe(2);
  });

  it('线性渐变：端点由 linearGradientEndpoints 求得，半透明 stop 解析为 rgba', () => {
    const s = buildShapePaintSpec(sh({
      fill: '#000',
      gradientType: 'linear',
      gradientAngle: 90,
      gradient: [
        { offset: 0, color: '#000000', alpha: 0.5 },
        { offset: 1, color: '#FFFFFF' },
      ],
    }));
    expect(s.fill!.kind).toBe('linear');
    const g = s.fill as { kind: 'linear'; start: { x: number; y: number }; end: { x: number; y: number }; stops: (string | number)[] };
    expect(Number.isFinite(g.start.x) && Number.isFinite(g.end.x)).toBe(true);
    // stops = [offset,color,...]，offset 交替 0/1
    expect(g.stops[0]).toBe(0);
    expect(typeof g.stops[1]).toBe('string');
    expect((g.stops[1] as string)).toMatch(/^rgba\(/);
    expect(g.stops[2]).toBe(1);
    expect(g.stops[3]).toBe('#FFFFFF');
  });

  it('径向渐变：start/end 为原点，radius = min(pw,ph)/2', () => {
    const s = buildShapePaintSpec(sh({
      fill: '#000',
      gradientType: 'radial',
      gradient: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }],
    }));
    expect(s.fill!.kind).toBe('radial');
    const g = s.fill as { kind: 'radial'; start: { x: number; y: number }; end: { x: number; y: number }; radius: number };
    expect(g.start).toEqual({ x: 0, y: 0 });
    expect(g.end).toEqual({ x: 0, y: 0 });
    expect(g.radius).toBeCloseTo(Math.min(s.pw, s.ph) / 2, 6);
  });

  it('无填充 / 无描边时为 null', () => {
    const s = buildShapePaintSpec(sh({}));
    expect(s.fill).toBeNull();
    expect(s.stroke).toBeNull();
  });

  it('描边渐变：线性 + stop 解析', () => {
    const s = buildShapePaintSpec(sh({
      stroke: '#000',
      strokeGradient: [{ offset: 0, color: '#111111', alpha: 0.4 }, { offset: 1, color: '#222222' }],
      strokeGradientAngle: 0,
    }));
    expect(s.stroke!.kind).toBe('linear');
    const g = s.stroke as { kind: 'linear'; stops: (string | number)[] };
    expect(typeof g.stops[1]).toBe('string');
    expect(g.stops[1]).toMatch(/^rgba\(/);
  });
});