/**
 * shapeGeometry — 多边形形状最外边缘贴合控制盒测试
 *
 * 防护目标：画布/导出/缩略图三端共用同一多边形几何，
 * 形状最外顶点必须恰好落在控制盒 pw×ph 四边，保证控制手柄与形状边缘对齐。
 */
import { describe, it, expect } from 'vitest';
import { getShapePolygonPoints } from './shapeGeometry';
import type { Pt } from './shapeGeometry';

const EPS = 1e-6;

function box(pts: Pt[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** 断言形状最外边缘恰好贴合控制盒（±eps） */
function expectFits(pts: Pt[], pw: number, ph: number) {
  const b = box(pts);
  expect(b.minX).toBeCloseTo(-pw / 2, 6);
  expect(b.maxX).toBeCloseTo(pw / 2, 6);
  expect(b.minY).toBeCloseTo(-ph / 2, 6);
  expect(b.maxY).toBeCloseTo(ph / 2, 6);
  void EPS;
}

describe('getShapePolygonPoints：控制盒贴合', () => {
  const cases: { type: Parameters<typeof getShapePolygonPoints>[0]; pw: number; ph: number }[] = [
    { type: 'triangle', pw: 200, ph: 200 },
    { type: 'diamond', pw: 200, ph: 100 },
    { type: 'pentagon', pw: 200, ph: 200 },
    { type: 'hexagon', pw: 200, ph: 120 },
    { type: 'star', pw: 200, ph: 200 },
    { type: 'parallelogram', pw: 200, ph: 100 },
    { type: 'trapezoid', pw: 200, ph: 100 },
  ];

  for (const c of cases) {
    it(`${c.type} ${c.pw}×${c.ph} 四边贴合控制盒`, () => {
      expectFits(getShapePolygonPoints(c.type, c.pw, c.ph), c.pw, c.ph);
    });
  }

  it('切角矩形（单角切）最外边缘同样贴合控制盒', () => {
    const pts = getShapePolygonPoints('cutCornerRect', 200, 120, 0.25);
    expectFits(pts, 200, 120);
    // cutCornerRect 固定 5 个顶点（左上角一个切点拆分出 2 个）
    expect(pts).toHaveLength(5);
  });

  it('对角切矩形固定 6 个顶点，最外边缘贴合控制盒', () => {
    const pts = getShapePolygonPoints('cutDiagonalRect', 200, 120, 0.25);
    expectFits(pts, 200, 120);
    expect(pts).toHaveLength(6);
  });
});

describe('getShapePolygonPoints：对称形状中心居中', () => {
  it('菱形关于中心对称', () => {
    const r = getShapePolygonPoints('diamond', 200, 120);
    const xs = r.map((p) => p.x);
    const ys = r.map((p) => p.y);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0, 6);
    expect(ys.reduce((a, b) => a + b, 0) / ys.length).toBeCloseTo(0, 6);
  });

  it('正六边形顶点数为 6', () => {
    expect(getShapePolygonPoints('hexagon', 200, 120)).toHaveLength(6);
  });
});