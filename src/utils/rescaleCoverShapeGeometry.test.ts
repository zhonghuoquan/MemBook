/**
 * rescaleCoverShapeGeometry — 封面/封底形状跨尺寸缩放（中心点语义）测试
 *
 * 防护目标：通知存储/画布改尺寸（setAlbumSize）时，封面形状靠右/靠底/角落会因
 * “把中心点误当左上角”而往左上偏移。断言新尺寸下中心点坐标与真实贴边/居中语义一致。
 */
import { describe, it, expect } from 'vitest';
import { rescaleCoverShapeGeometry } from './coverScale';

const EPS = 1e-6;
const OLD = { width: 210, height: 280 };
const NEW = { width: 280, height: 350 };

describe('rescaleCoverShapeGeometry（封面形状跨尺寸缩放，中心点语义）', () => {
  it('靠右形状：中心保持距右缘半个元素，不应往左偏移', () => {
    // 旧：右贴边形状，中心 x=190，宽 40（右缘=210）
    const r = rescaleCoverShapeGeometry(
      { x: 190, y: 140, width: 40, height: 40 },
      OLD, NEW, 0,
    );
    // 等比 k=min(kx,ky)=min(1.333,1.25)=1.25 → 50
    expect(r.width).toBeCloseTo(50, EPS);
    expect(r.height).toBeCloseTo(50, EPS);
    // 新页宽 280，中心应为 280 - 50/2 = 255（旧实现会错误地给 230）
    expect(r.x).toBeCloseTo(255, EPS);
    expect(r.y).toBeCloseTo(175, EPS);
  });

  it('右下角形状：同时保持贴右与贴底，不应往左上偏移', () => {
    const r = rescaleCoverShapeGeometry(
      { x: 190, y: 260, width: 40, height: 40 },
      OLD, NEW, 0,
    );
    // 右贴边 → 中心 x=255；右下角 → 中心 y=350-25=325（旧实现会错误地给 300）
    expect(r.x).toBeCloseTo(255, EPS);
    expect(r.y).toBeCloseTo(325, EPS);
  });

  it('居中形状：换宽高比后仍保持页面居中', () => {
    const r = rescaleCoverShapeGeometry(
      { x: 105, y: 140, width: 40, height: 40 },
      OLD, NEW, 0,
    );
    expect(r.x).toBeCloseTo(140, EPS); // 280/2
    expect(r.y).toBeCloseTo(175, EPS); // 350/2
  });

  it('蒙版（id 含 mask）：按轴拉伸铺满整个页面', () => {
    const r = rescaleCoverShapeGeometry(
      { id: 'cover-mask-dark', x: 105, y: 140, width: 210, height: 280 },
      OLD, NEW, 0,
    );
    expect(r.width).toBeCloseTo(280, EPS);
    expect(r.height).toBeCloseTo(350, EPS);
    expect(r.x).toBeCloseTo(140, EPS); // 中心点 280/2
    expect(r.y).toBeCloseTo(175, EPS); // 350/2
  });

  it('贴左形状：中心保持距左缘半个元素', () => {
    const r = rescaleCoverShapeGeometry(
      { x: 20, y: 140, width: 40, height: 40 },
      OLD, NEW, 0,
    );
    expect(r.x).toBeCloseTo(25, EPS); // 中心 = 0 + 50/2
    expect(r.y).toBeCloseTo(175, EPS);
  });
});