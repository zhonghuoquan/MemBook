/**
 * exportGeometry — 导出/打印几何纯函数测试
 *
 * 阶段：导出/打印链路加固。锁定导出关键路径的确定性数学：
 * 页面导出宽度（封面书脊/出血）、画布像素尺寸（DPI/出血/书脊）、照片降采样阈值。
 */
import { describe, it, expect } from 'vitest';
import {
  pageExportWidthMm,
  calcExportCanvasSize,
  calcExportMaxDim,
  pxPerMmAt,
} from './exportGeometry';
import type { AlbumPage } from '../types';

const PAGE = { w: 210, h: 280 };

function pageOf(templateId: string, spineWidth?: number): AlbumPage {
  return { id: 'p', albumId: 'a', templateId, spineWidth } as unknown as AlbumPage;
}

describe('pxPerMmAt', () => {
  it('可按 DPI 换算每毫米像素（300dpi）', () => {
    expect(pxPerMmAt(300)).toBeCloseTo(300 / 25.4, 6);
    expect(pxPerMmAt(72)).toBeCloseTo(72 / 25.4, 6);
  });
});

describe('pageExportWidthMm — 导出页面物理宽度（含书脊/出血）', () => {
  it('封面页：逻辑宽 + 设计书脊 + 两侧出血', () => {
    expect(pageExportWidthMm(pageOf('cover-a', 18), PAGE, 3)).toBe(210 + 18 + 6);
  });
  it('封面页无书脊时不加', () => {
    expect(pageExportWidthMm(pageOf('cover-a'), PAGE, 0)).toBe(210);
  });
  it('封底页：不加书脊（书脊仅封面显示）', () => {
    expect(pageExportWidthMm(pageOf('backcover-a', 18), PAGE, 3)).toBe(210 + 6);
  });
  it('普通页：仅出血两侧扩展', () => {
    expect(pageExportWidthMm(pageOf('content'), PAGE, 3)).toBe(210 + 6);
  });
  it('页面缺失时按页面宽 + 出血兜底', () => {
    expect(pageExportWidthMm(undefined, PAGE, 3)).toBe(210 + 6);
  });
});

describe('calcExportCanvasSize — 画布尺寸（DPI/出血/封面书脊）', () => {
  it('无出血无书脊：逻辑坐标 ×2，像素坐标按 DPI', () => {
    const g = calcExportCanvasSize(PAGE, { dpi: 300 });
    expect(g.logicalW).toBe(420);
    expect(g.logicalH).toBe(560);
    expect(g.canvasW).toBe(Math.round(210 * pxPerMmAt(300)));
    expect(g.canvasH).toBe(Math.round(280 * pxPerMmAt(300)));
    expect(g.pxPerMM).toBeCloseTo(pxPerMmAt(300), 6);
  });
  it('封面书脊：逻辑宽与像素宽都等比 +，高度不变', () => {
    const g = calcExportCanvasSize(PAGE, { spineMm: 18, dpi: 300 });
    expect(g.logicalW).toBe((210 + 18) * 2);
    expect(g.logicalH).toBe(560);
    expect(g.canvasW).toBe(Math.round((210 + 18) * pxPerMmAt(300)));
    expect(g.canvasH).toBe(Math.round(280 * pxPerMmAt(300)));
  });
  it('出血：像素四周各扩展 bleed，逻辑尺寸不变', () => {
    const g = calcExportCanvasSize(PAGE, { bleed: 3, dpi: 300 });
    expect(g.logicalW).toBe(420); // 出血不影响逻辑坐标
    expect(g.canvasW).toBe(Math.round((210 + 3 * 2) * pxPerMmAt(300)));
    expect(g.canvasH).toBe(Math.round((280 + 3 * 2) * pxPerMmAt(300)));
  });
});

describe('calcExportMaxDim — 照片降采样阈值', () => {
  it('按页面最长边 × dpi 像素 × 2', () => {
    // 竖版：最长边 280mm
    const expected = 280 * pxPerMmAt(300) * 2;
    expect(calcExportMaxDim(PAGE, 300)).toBeCloseTo(expected, 6);
  });
  it('长边更大的横版取其最长边', () => {
    const landscape = { w: 280, h: 210 };
    const expected = 280 * pxPerMmAt(300) * 2;
    expect(calcExportMaxDim(landscape, 300)).toBeCloseTo(expected, 6);
  });
});