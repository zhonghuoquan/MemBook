/**
 * content-aware 纯函数测试
 *
 * P2-1：内容感知的焦点数学（computeSmartObjectPosition）——
 * 它是 analyzePhotoWithFaces 分析结果的纯输出，锁住"焦点对齐槽位中心 + 不露白 clamp"契约。
 * 注：人脸/能量分析本体依赖 DOM canvas 与 face-api，不在 jsdom 单测范围内。
 */
import { describe, it, expect } from 'vitest';
import { computeSmartObjectPosition, isColorConflict, DEFAULT_CONTENT_INFO } from './content-aware';

describe('computeSmartObjectPosition', () => {
  it('无 contentInfo 时居中', () => {
    // 200×100 图进 100×100 槽：scale=1，imgW=200,imgH=100
    const { offsetX, offsetY } = computeSmartObjectPosition(200, 100, 100, 100, undefined);
    expect(offsetX).toBe((100 - 200) / 2); // -50
    expect(offsetY).toBe(0);
  });

  it('焦点(0.5,0.5) 与居中一致', () => {
    const c = computeSmartObjectPosition(200, 100, 100, 100, { ...DEFAULT_CONTENT_INFO, focusX: 0.5, focusY: 0.5 });
    expect(c.offsetX).toBeCloseTo(100 / 2 - 0.5 * 200, 6); // -50
  });

  it('焦点贴边被 clamp 到不露白范围', () => {
    // focusX=1（最右）：offsetX=50-200=-150，clamp 到 minX=100-200=-100
    const right = computeSmartObjectPosition(200, 100, 100, 100, { ...DEFAULT_CONTENT_INFO, focusX: 1, focusY: 0.5 });
    expect(right.offsetX).toBe(100 - 200); // -100, 不露白
    // focusX=0（最左）：offsetX=50，clamp 到 maxX=0
    const left = computeSmartObjectPosition(200, 100, 100, 100, { ...DEFAULT_CONTENT_INFO, focusX: 0, focusY: 0.5 });
    expect(left.offsetX).toBe(0);
  });
});

describe('isColorConflict', () => {
  it('任一缺失或饱和度低 → 不冲突', () => {
    expect(isColorConflict(undefined, DEFAULT_CONTENT_INFO)).toBe(false);
    expect(isColorConflict(DEFAULT_CONTENT_INFO, undefined)).toBe(false);
    expect(isColorConflict({ ...DEFAULT_CONTENT_INFO, saturation: 0.1 }, { ...DEFAULT_CONTENT_INFO, saturation: 0.5 })).toBe(false);
  });
});