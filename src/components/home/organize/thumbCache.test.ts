/**
 * thumbCache — 缩略图缓存生命周期测试
 *
 * P2：缓存生命周期与泄漏审计。锁定两处修复：
 *   1. evictFromCache 同时命中普通 `${photoId}:` 与人脸 `face:${photoId}:` 前缀，
 *      照片删除时不再漏回收人脸缩略图 URL（此前只清普通前缀，人脸条目泄漏）。
 *   2. HEIC 转换缓存有界（上限 HEIC_CACHE_LIMIT，淘汰最旧），避免大 HEIC 相册浏览时无限增长。
 * 说明：真实缩略图生成依赖 DOM canvas + createImageBitmap，不在 jsdom 单测范围内，
 *      故这里只测纯逻辑判定与有界性。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isPhotoCacheKey, setHeicConvertedCache, getHeicConvertedCacheSize, clearThumbCache } from './thumbCache';

describe('isPhotoCacheKey — 照片缓存 key 归属判定', () => {
  it('命中普通 `${photoId}:` 前缀', () => {
    expect(isPhotoCacheKey('p1', 'p1:full')).toBe(true);
    expect(isPhotoCacheKey('p1', 'p1:small')).toBe(true);
    expect(isPhotoCacheKey('p1', 'p1:medium')).toBe(true);
  });

  it('命中人脸 `face:${photoId}:` 前缀（本次修复的核心）', () => {
    expect(isPhotoCacheKey('p1', 'face:p1:0.125:0.25:0.3:0.4:256')).toBe(true);
    expect(isPhotoCacheKey('p1', 'face:p1:0.000:0.000:1.000:1.000:128')).toBe(true);
  });

  it('不误伤其他照片（含前缀相似 id）', () => {
    expect(isPhotoCacheKey('p1', 'p2:full')).toBe(false);
    expect(isPhotoCacheKey('p1', 'face:p2:0.1:0.1:0.1:0.1:256')).toBe(false);
    // 边界：p1 不能命中 p11
    expect(isPhotoCacheKey('p1', 'p11:full')).toBe(false);
  });
});

describe('HEIC 转换缓存有界', () => {
  beforeEach(() => {
    clearThumbCache(); // 清空 heicConvertedCache，保证用例互不影响
  });

  it('超过上限时淘汰最旧条目，size 恒 ≤ 上限', () => {
    for (let i = 0; i < 120; i++) setHeicConvertedCache(`h${i}`, new Blob());
    expect(getHeicConvertedCacheSize()).toBe(100);
  });

  it('clearThumbCache 彻底清空 HEIC 缓存', () => {
    setHeicConvertedCache('h1', new Blob());
    setHeicConvertedCache('h2', new Blob());
    expect(getHeicConvertedCacheSize()).toBe(2);
    clearThumbCache();
    expect(getHeicConvertedCacheSize()).toBe(0);
  });
});