/**
 * thumbnailCore — spec 不变快照测试（照片 / 文字 / 形状）
 *
 * 阶段 2 目标：把画布/导出/缩略图/预览共用的三个确定性子集函数
 *   buildPhotoPlacementPlan / buildTextLayout / buildShapePaintSpec
 * 的"规格快照"冻结在测试里。任一端的重构若悄悄改变布局判定，快照 diff 即会暴露，
 * 防止四端同源被某一端静默破坏。
 *
 * 要点：
 * - 全部为纯函数输入，无 ctx / 图片 / store 依赖。
 * - 快照使用 toMatchInlineSnapshot，Vitest 首次运行自动写入并在此后逐次比对。
 * - measure 回调用确定性伪测量（s.length * 8），确保跨平台稳定。
 */
import { describe, it, expect } from 'vitest';
import { buildPhotoPlacementPlan, buildTextLayout, buildShapePaintSpec } from './thumbnailCore';
import type { AlbumPage, Photo, PhotoPlacement, PageTextElement, ShapeElement } from '../types';

const measure = (s: string): number => s.length * 8;

function makePhoto(id: string, w: number, h: number): Photo {
  return { id, name: id, src: '', width: w, height: h } as unknown as Photo;
}

function makePlacement(slotId: string, photoId: string): PhotoPlacement {
  return { slotId, photoId, rotation: 0 } as PhotoPlacement;
}

function makePage(overrides: Partial<AlbumPage>): AlbumPage {
  return {
    id: 'snapshot-page',
    albumId: 'a',
    pageKind: 'normal',
    templateId: '',
    width: 210,
    height: 280,
    orientation: 'landscape',
    color: '#FFFFFF',
    placements: [],
    ...overrides,
  } as unknown as AlbumPage;
}

/* 代表性元素：照片槽位 / 横排文字 / 竖排文字 / 纯色形状 / 渐变填充形状 / 渐变描边形状 */
const photoPage = makePage({
  slotOrder: ['a'],
  slotOverrides: { a: { x: 10, y: 10, width: 100, height: 100 } },
  placements: [makePlacement('a', 'p1')],
});
const photos = [makePhoto('p1', 4000, 4000)];

const textH: PageTextElement = {
  id: 't-h', type: 'text', zIndex: 1, x: 20, y: 30, width: 120, height: 48,
  fontSize: 16, fontFamily: 'sans-serif', color: '#333333',
  text: 'hello world', align: 'left', verticalAlign: 'top',
  lineHeight: 1.2, letterSpacing: 0,
} as unknown as PageTextElement;

const textV: PageTextElement = {
  ...textH, id: 't-v', isVertical: true, width: 60, height: 120,
  text: 'AB\nCD', align: 'center', verticalAlign: 'center',
} as unknown as PageTextElement;

const shapeSolid: ShapeElement = {
  id: 's-solid', type: 'rectangle', x: 50, y: 60, width: 40, height: 30,
  rotation: 15, opacity: 0.8, fill: '#FF0000', stroke: '#000000', strokeWidth: 2,
} as unknown as ShapeElement;

const shapeGrad: ShapeElement = {
  id: 's-grad', type: 'circle', x: 80, y: 90, width: 50, height: 50,
  gradientType: 'linear', gradientAngle: 45,
  gradient: [
    { offset: 0, color: '#FF0000' },
    { offset: 1, color: '#0000FF', alpha: 0.5 },
  ],
} as unknown as ShapeElement;

const shapeStrokeGrad: ShapeElement = {
  id: 's-stroke', type: 'pentagon', x: 10, y: 10, width: 30, height: 30,
  strokeGradientAngle: 135,
  strokeGradient: [
    { offset: 0, color: '#00FF00' },
    { offset: 1, color: '#FF00FF' },
  ],
} as unknown as ShapeElement;

describe('四端同源 spec 不变快照', () => {
  it('照片布局：确定性子集保持不变（槽位坐标/cover-fit/层级）', () => {
    const plan = buildPhotoPlacementPlan(photoPage, photos, 420, 560);
    expect(plan).toHaveLength(1);
    expect(plan[0].photoId).toBe('p1');
    // 层级缺省 0
    expect(plan[0].z).toBe(0);
    // cover-fit：正方形照片在正方形槽位，铺满不露白，偏移 0
    expect(plan[0].slot).toEqual({ x: 10, y: 10, width: 100, height: 100 });
    expect(plan[0].params!.drawX).toBeCloseTo(0, 6);
    expect(plan[0].params!.drawY).toBeCloseTo(0, 6);
    expect(plan[0].params!.drawW).toBeCloseTo(100, 6);
    expect(plan[0].params!.drawH).toBeCloseTo(100, 6);
    expect(plan[0].params!.drawX + plan[0].params!.drawW).toBeGreaterThanOrEqual(99.9999);
    expect(plan[0].params!.drawY + plan[0].params!.drawH).toBeGreaterThanOrEqual(99.9999);
  });

  it('文字排版：横排 + 竖排确定性子集保持不变（toMatchInlineSnapshot 冻结）', () => {
    const h = buildTextLayout(textH, measure).map((w) => ({ ...w }));
    const v = buildTextLayout(textV, measure).map((w) => ({ ...w }));
    expect({ horizontal: h, vertical: v }).toMatchInlineSnapshot(`
      {
        "horizontal": [
          {
            "text": "hello world",
            "textAlign": "left",
            "x": 44,
            "y": 64,
          },
        ],
        "vertical": [
          {
            "text": "A",
            "textAlign": "left",
            "x": 101.6,
            "y": 164,
          },
          {
            "text": "B",
            "textAlign": "left",
            "x": 101.6,
            "y": 180,
          },
          {
            "text": "C",
            "textAlign": "left",
            "x": 82.39999999999999,
            "y": 164,
          },
          {
            "text": "D",
            "textAlign": "left",
            "x": 82.39999999999999,
            "y": 180,
          },
        ],
      }
    `);
  });

  it('形状画刷：纯色 / 渐变填充 / 渐变描边确定性子集保持不变（toMatchInlineSnapshot 冻结）', () => {
    const solid = buildShapePaintSpec(shapeSolid);
    const grad = buildShapePaintSpec(shapeGrad);
    const stroke = buildShapePaintSpec(shapeStrokeGrad);
    expect({ solid, grad, stroke }).toMatchInlineSnapshot(`
      {
        "grad": {
          "fill": {
            "end": {
              "x": 50.00000000000001,
              "y": 50,
            },
            "kind": "linear",
            "radius": 0,
            "start": {
              "x": -50.00000000000001,
              "y": -50,
            },
            "stops": [
              0,
              "#FF0000",
              1,
              "rgba(0, 0, 255, 0.5)",
            ],
          },
          "lineWidth": 0.1,
          "opacity": 1,
          "ph": 100,
          "pw": 100,
          "rotation": 0,
          "stroke": null,
          "x": 160,
          "y": 180,
        },
        "solid": {
          "fill": {
            "color": "#FF0000",
            "kind": "solid",
          },
          "lineWidth": 2,
          "opacity": 0.8,
          "ph": 60,
          "pw": 80,
          "rotation": 15,
          "stroke": {
            "color": "#000000",
            "kind": "solid",
          },
          "x": 100,
          "y": 120,
        },
        "stroke": {
          "fill": null,
          "lineWidth": 0.1,
          "opacity": 1,
          "ph": 60,
          "pw": 60,
          "rotation": 0,
          "stroke": {
            "end": {
              "x": -30,
              "y": 30.000000000000004,
            },
            "kind": "linear",
            "radius": 0,
            "start": {
              "x": 30,
              "y": -30.000000000000004,
            },
            "stops": [
              0,
              "#00FF00",
              1,
              "#FF00FF",
            ],
          },
          "x": 20,
          "y": 20,
        },
      }
    `);
  });
});