/**
 * sharedRender — 画布/导出/缩略图/预览共享的纯几何逻辑测试
 *
 * 防护目标：这是"四端同源"的几何原始输入，
 * 照片覆盖不露白、页面预览适配、文字断行、槽位坐标任何一处回归
 * 都会同时破坏编辑器与导出一致性。
 */
import { describe, it, expect } from 'vitest';
import {
  calcCoverFit,
  calcCoverFitWithRotation,
  calcPagePreviewFit,
  wrapTextLines,
  getSlotRect,
  calcPhotoRenderParams,
  getTextureBaseColor,
  isDarkBackground,
  resolveSpineLogoColor,
} from './sharedRender';
import type { AlbumPage, Photo, PhotoPlacement } from '../types';

const EPS = 1e-6;

/* ── calcCoverFit / calcCoverFitWithRotation ── */
describe('calcCoverFitWithRotation（旋转后全覆盖）', () => {
  const cases: [number, number, number, number, number][] = [
    [4000, 3000, 200, 150, 0],
    [4000, 3000, 200, 150, 90],
    [3000, 4000, 200, 150, 45],
    [4000, 3000, 150, 150, 30],
  ];
  for (const [iw, ih, cw, ch, rot] of cases) {
    it(`${iw}×${ih} → ${cw}×${ch} @${rot}° 可见边界覆盖槽位`, () => {
      const r = calcCoverFitWithRotation(iw, ih, cw, ch, rot);
      expect(r.boundingW).toBeGreaterThanOrEqual(cw - EPS);
      expect(r.boundingH).toBeGreaterThanOrEqual(ch - EPS);
      expect(r.scale).toBeGreaterThan(0);
      expect(r.imgW / iw).toBeCloseTo(r.scale, 6);
    });
  }

  it('calcCoverFit 按较大缩放比铺满', () => {
    const r = calcCoverFit(4000, 3000, 150, 150);
    expect(r.width).toBeCloseTo(200, EPS);
    expect(r.height).toBeCloseTo(150, EPS);
  });
});

/* ── calcPagePreviewFit ── */
describe('calcPagePreviewFit（保比例居中适配）', () => {
  it('容器更扁时按高度填满、水平居中', () => {
    // 页面 210×280（mm×2=420×560，aspect≈0.75）；容器 1000×800（aspect 1.25 > 0.75）
    const r = calcPagePreviewFit({ width: 210, height: 280 }, 1000, 800, 2);
    expect(r.renderH).toBeCloseTo(800, EPS);
    expect(r.renderW).toBeCloseTo(600, EPS);
    expect(r.offsetX).toBeCloseTo(200, EPS); // 水平居中
    expect(r.offsetY).toBeCloseTo(0, EPS);
    expect(r.scale).toBeCloseTo(r.renderW / r.pageW, EPS);
  });

  it('容器更高时按宽度填满、垂直居中', () => {
    const r = calcPagePreviewFit({ width: 210, height: 280 }, 600, 1000, 2);
    expect(r.renderW).toBeCloseTo(600, EPS);
    expect(r.renderH).toBeCloseTo(800, EPS);
    expect(r.offsetX).toBeCloseTo(0, EPS);
    expect(r.offsetY).toBeCloseTo(100, EPS); // 垂直居中
  });

  it('保持页面宽高比（不变形）', () => {
    const r = calcPagePreviewFit({ width: 210, height: 280 }, 999, 777, 2);
    expect(r.renderW / r.renderH).toBeCloseTo(210 / 280, 6);
  });
});

/* ── wrapTextLines ── */
describe('wrapTextLines（与 DOM 文字层同源断行）', () => {
  // 假 ctx：每字符宽 1 单位，letterSpacing 影响另算
  const fakeCtx = { measureText: (s: string) => ({ width: s.length }) };

  it('无空格长英文不强制断行（word-break:normal）', () => {
    expect(wrapTextLines(fakeCtx, 'abcdefgh', 4)).toEqual(['abcdefgh']);
  });

  it('英文按空格分词整体断行', () => {
    expect(wrapTextLines(fakeCtx, 'hello world', 5)).toEqual(['hello', 'world']);
  });

  it('CJK 逐字可断行', () => {
    expect(wrapTextLines(fakeCtx, '甲乙丙丁', 2)).toEqual(['甲乙', '丙丁']);
  });

  it('显式换行保留空行', () => {
    expect(wrapTextLines(fakeCtx, 'ab\n\ncd', 10)).toEqual(['ab', '', 'cd']);
  });

  it('letterSpacing 计入每字符宽度（CJK 逐字）', () => {
    // 每字符 1 + letterSpacing 1 = 2；content 4 → 每行 2 个 CJK 字符
    expect(wrapTextLines(fakeCtx, '甲乙丙丁', 4, 1)).toEqual(['甲乙', '丙丁']);
  });
});

/* ── getSlotRect ── */
describe('getSlotRect（槽位坐标）', () => {
  it('有 slotOverrides 时直接返回覆盖值（不经模板）', () => {
    const page = { slotOverrides: { 's1': { x: 10, y: 20, width: 30, height: 40 } } } as unknown as AlbumPage;
    const r = getSlotRect('s1', page, 420, 560);
    expect(r).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('未知槽位且无覆盖时返回 null', () => {
    const page = {} as AlbumPage;
    expect(getSlotRect('ghost', page, 420, 560)).toBeNull();
  });
});

/* ── calcPhotoRenderParams ── */
describe('calcPhotoRenderParams（照片渲染参数/不露白）', () => {
  const photo = { id: 'p1', width: 4000, height: 3000 } as Photo;

  it('旋转 0° 铺满方形槽位，draw 覆盖槽位', () => {
    const placement = { panX: 0, panY: 0, panScale: 1, rotation: 0 } as PhotoPlacement;
    const r = calcPhotoRenderParams(photo, placement, 150, 150)!;
    expect(r).not.toBeNull();
    // 4000×3000 填 150 方槽 → cover-fit scale=0.05 → 200×150，居中 px=-25
    expect(r.drawW).toBeCloseTo(200, 3);
    expect(r.drawH).toBeCloseTo(150, 3);
    expect(r.drawX).toBeLessThanOrEqual(EPS);
    expect(r.drawX + r.drawW).toBeGreaterThanOrEqual(150 - EPS);
    expect(r.drawY).toBeLessThanOrEqual(EPS);
    expect(r.drawY + r.drawH).toBeGreaterThanOrEqual(150 - EPS);
  });

  it('无 pan、无旋转时默认居中且不读全局缓存（传 contentInfo）', () => {
    const placement = { rotation: 0 } as PhotoPlacement;
    // 传集中在中心的主体，等价于默认居中
    const info = { focusX: 0.5, focusY: 0.5, dominantColor: [0, 0, 0] as [number, number, number], saturation: 0, hasFaces: false, faceCount: 0, clarityScore: 0, source: 'sync' as const };
    const r = calcPhotoRenderParams(photo, placement, 150, 150, info)!;
    expect(r!.drawX).toBeCloseTo((150 - r!.drawW) / 2, 3);
  });

  it('零尺寸照片返回 null', () => {
    const p = { id: 'p0', width: 0, height: 0 } as Photo;
    expect(calcPhotoRenderParams(p, { rotation: 0 } as PhotoPlacement, 100, 100)).toBeNull();
  });
});

/* ── getTextureBaseColor ── */
describe('getTextureBaseColor（纹理底色回退）', () => {
  it('已知纹理返回基准色，未知回退白', () => {
    expect(getTextureBaseColor('texture-kraft')).toBe('#C4A882');
    expect(getTextureBaseColor('texture-unknown')).toBe('#FFFFFF');
  });
});

/* ── isDarkBackground ── */
describe('isDarkBackground（亮度感知加权）', () => {
  it('深色返回 true、浅色返回 false', () => {
    expect(isDarkBackground('#000000')).toBe(true);
    expect(isDarkBackground('#1E293B')).toBe(true);
    expect(isDarkBackground('#FFFFFF')).toBe(false);
    expect(isDarkBackground('#F5F0E8')).toBe(false);
  });
});

/* ── resolveSpineLogoColor（画布/导出共享取色） ── */
describe('resolveSpineLogoColor（书脊 logo 颜色）', () => {
  it('用户自定义优先', () => {
    expect(resolveSpineLogoColor('#FFFFFF', '#FF0000')).toBe('#FF0000');
    expect(resolveSpineLogoColor('#000000', '#00FF00')).toBe('#00FF00');
  });
  it('未自定义时按书脊底色深浅自动黑/白', () => {
    expect(resolveSpineLogoColor('#000000', undefined)).toBe('#FFFFFF');   // 深底 → 白
    expect(resolveSpineLogoColor('#FFFFFF', undefined)).toBe('#000000');   // 浅底 → 黑
  });
  it('未给底色时回退白底 → 黑 logo', () => {
    expect(resolveSpineLogoColor(undefined, undefined)).toBe('#000000');
  });
});