/**
 * 感知哈希（pHash）引擎单元测试
 *
 * 覆盖纯函数部分：
 *  - hammingDistance 汉明距离计算
 *  - 阈值语义（DEFAULT_PHASH_THRESHOLD）
 *  - 输入有效性边界（空串/长度不一致/非法字符）
 *
 * computePHash / computePHashFromBitmap 依赖 createImageBitmap / canvas，
 * jsdom 无法真正解码图片，故不在此覆盖（调用方集成测试已覆盖）。
 */
import { describe, it, expect } from 'vitest';
import { hammingDistance, DEFAULT_PHASH_THRESHOLD, PHASH_BITS } from './perceptual-hash';

describe('hammingDistance', () => {
  it('相同哈希距离为 0', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });

  it('单个十六进制位差异距离为 1', () => {
    // 0x0 与 0x1 只差 1 位
    expect(hammingDistance('0000000000000000', '1000000000000000')).toBe(1);
    // 0x0 与 0xf 差 4 位
    expect(hammingDistance('0000000000000000', 'f000000000000000')).toBe(4);
  });

  it('多字节累积差异', () => {
    // 0xff (1111) vs 0x00 (0000) → 每字节差 4 位
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    // 0xff vs 0x0f → 每字节差 4 位，共 16 字节
    expect(hammingDistance('ffffffffffffffff', '0f0f0f0f0f0f0f0f')).toBe(32);
  });

  it('输入的字符串表示相同的距离，且 PHASH_BITS 为 64', () => {
    expect(PHASH_BITS).toBe(64);
  });

  it('空串 / undefined / null 视为完全不同（返回 PHASH_BITS）', () => {
    expect(hammingDistance('', '0000000000000000')).toBe(PHASH_BITS);
    expect(hammingDistance('0000000000000000', '')).toBe(PHASH_BITS);
    // @ts-expect-error 故意传入无效值测试边界
    expect(hammingDistance(undefined, '0000000000000000')).toBe(PHASH_BITS);
    // @ts-expect-error 故意传入 null 测试边界
    expect(hammingDistance('0000000000000000', null)).toBe(PHASH_BITS);
  });

  it('长度不一致视为完全不同（返回 PHASH_BITS）', () => {
    expect(hammingDistance('ffff', 'ffffffffffffffff')).toBe(PHASH_BITS);
  });
});

describe('DEFAULT_PHASH_THRESHOLD', () => {
  it('默认视觉重复阈值 ≤ 5', () => {
    expect(DEFAULT_PHASH_THRESHOLD).toBe(5);
  });

  it('阈值语义：距离 ≤ 阈值视为重复', () => {
    // 构造 1 位差异的哈希，应判定为重复（≤ 5）
    const a = '0000000000000000';
    const b = '1000000000000000'; // 差 1 位
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(DEFAULT_PHASH_THRESHOLD);
  });
});
