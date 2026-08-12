/**
 * 照片去重引擎（hash.ts）单元测试
 *
 * 覆盖纯逻辑/纯函数部分：
 *  - formatBytes 字节格式化
 *  - deduplicatePhotos 在无重复候选时的快速返回路径（无需真实图片读取）
 */
import { describe, it, expect } from 'vitest';
import { deduplicatePhotos, formatBytes } from './hash';
import type { PhotoFileInfo } from './types';

function photo(id: string, size: number): PhotoFileInfo {
  return {
    id,
    name: `${id}.jpg`,
    size,
    ext: '.jpg',
    mimeType: 'image/jpeg',
  };
}

describe('formatBytes', () => {
  it('0 字节返回 "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('小于 1KB 返回字节', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('KB 级别', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('MB 级别', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });

  it('GB 级别', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('负值/非法不崩溃', () => {
    // 负数：Math.log 返回 NaN，i=NaN，最终返回某个格式，不应抛异常
    expect(() => formatBytes(-100)).not.toThrow();
  });
});

describe('deduplicatePhotos', () => {
  it('空列表直接返回空结果', async () => {
    const res = await deduplicatePhotos([]);
    expect(res.totalGroups).toBe(0);
    expect(res.groups).toEqual([]);
    expect(res.duplicateCount).toBe(0);
  });

  it('所有照片大小唯一（无候选）时返回空结果', async () => {
    // 每张照片大小都不同 → 无重复候选
    const photos = [photo('p1', 100), photo('p2', 200), photo('p3', 300)];
    const res = await deduplicatePhotos(photos, { enableVisual: false });
    expect(res.totalGroups).toBe(0);
    expect(res.totalFiles).toBe(0);
    expect(res.duplicateCount).toBe(0);
    expect(res.freedBytes).toBe(0);
    expect(res.groups).toEqual([]);
  });

  it('所有照片大小不同时 no candidate 快速返回结构完整', async () => {
    const photos = [photo('p1', 100), photo('p2', 200), photo('p3', 300)];
    const res = await deduplicatePhotos(photos, { enableVisual: false });
    expect(res.totalGroups).toBe(0);
    expect(res.groups).toEqual([]);
    expect(res.duplicateCount).toBe(0);
  });
});
