/**
 * thumbnailCore.buildTextLayout — 文字排版 spec 测试
 *
 * 阶段 1 继续：把"文字排版（横排断行/对齐/垂直对齐 + 竖排逐字定位）"抽成纯函数并测死，
 * 画布/导出/缩略图/预览共用同一套文字定位判定。
 */
import { describe, it, expect } from 'vitest';
import { buildTextLayout } from './thumbnailCore';
import type { PageTextElement } from '../types';

const EPS = 1e-6;

/** fake 测宽：每字符宽 1 */
const measure = (s: string) => s.length;

function te(overrides: Partial<PageTextElement>): PageTextElement {
  return {
    x: 0, y: 0, width: 100, height: 50, fontSize: 12,
    text: '', align: 'left', verticalAlign: 'center', lineHeight: 1.2,
    ...overrides,
  } as unknown as PageTextElement;
}

describe('buildTextLayout — 横排', () => {
  it('居中水平对齐时锚点在盒宽中点', () => {
    // tx=20(×2), tw=200；x = tx + tw/2 = 120
    const writes = buildTextLayout(te({ x: 10, y: 20, width: 100, height: 50, text: 'hi', align: 'center' }), measure);
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toBe('hi');
    expect(writes[0].x).toBeCloseTo(120, EPS);
    expect(writes[0].textAlign).toBe('center');
  });

  it('垂直居中时 y 落在内容区中线', () => {
    // ty=0, th=100, pad=4；单行 lineHeight=14.4 → y = 4 + (100-8-14.4)/2 = 42.8
    const writes = buildTextLayout(te({ height: 50, text: 'hello' }), measure);
    expect(writes[0].y).toBeCloseTo(42.8, EPS);
  });

  it('内容超高时分行且 y 递增', () => {
    // 盒宽 4mm→8px，contentW=8-8=0 → 每个 CJK 字符单独一行
    const writes = buildTextLayout(te({ width: 4, height: 60, text: '甲乙丙丁', verticalAlign: 'top' }), measure);
    expect(writes.map((w) => w.text)).toEqual(['甲', '乙', '丙', '丁']);
    // 垂直对齐 top → 首行 y = ty + pad = 4
    expect(writes[0].y).toBeCloseTo(4, EPS);
    // 行距 = 12×1.2 = 14.4
    expect(writes[1].y - writes[0].y).toBeCloseTo(14.4, EPS);
  });
});

describe('buildTextLayout — 竖排', () => {
  it('逐字竖向排列，垂直居中对齐', () => {
    // fs=10, th=80, x=0,y=0,width=20(→tw=40)
    const writes = buildTextLayout(te({
      x: 0, y: 0, width: 20, height: 40, fontSize: 10,
      isVertical: true, text: 'AB',
    }), measure);
    // 两个字符在同一列 (x 相同)，y 随 stepY(=10) 递增
    expect(writes.map((w) => w.text)).toEqual(['A', 'B']);
    expect(writes[0].x).toBeCloseTo(writes[1].x, EPS);
    expect(writes[0].y).toBeCloseTo(30, EPS); // 垂直居中：(contentH-blockH)/2 + top
    expect(writes[1].y - writes[0].y).toBeCloseTo(10, EPS);
  });

  it('显式换行开启新列（\n）', () => {
    const writes = buildTextLayout(te({
      width: 40, height: 40, fontSize: 10, isVertical: true, text: 'A\nB',
    }), measure);
    expect(writes[0].text).toBe('A');
    expect(writes[1].text).toBe('B');
    // 换行列 x 左移 stepX；y 都回到顶(经垂直对齐后不同列 y 相同)
    expect(writes[0].x).toBeGreaterThan(writes[1].x);
    expect(writes[0].y).toBeCloseTo(writes[1].y, EPS);
  });

  it('竖排右对齐：块右缘贴盒内容右缘（2026-08-19 修复多减 fs 的左移 bug）', () => {
    // tx=0, tw=40, pad=4, fs=10 → 内容右缘 = tx+tw-pad = 36；列 x = 36 - fs = 26
    const writes = buildTextLayout(te({
      x: 0, y: 0, width: 20, height: 40, fontSize: 10,
      isVertical: true, text: 'AB', align: 'right',
    }), measure);
    expect(writes[0].x).toBeCloseTo(26, EPS);
    expect(writes[1].x).toBeCloseTo(26, EPS);
    // 右对齐应比居中对齐更靠右（居中 x=15）
    const centered = buildTextLayout(te({
      x: 0, y: 0, width: 20, height: 40, fontSize: 10,
      isVertical: true, text: 'AB', align: 'center',
    }), measure);
    expect(writes[0].x).toBeGreaterThan(centered[0].x);
  });
});