import { describe, it, expect, vi } from 'vitest';
import { LRUCache } from './lruCache';

describe('LRUCache', () => {
  it('容量为 1 时正常存取', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    cache.set('b', 2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('set 超容时淘汰最久未访问的条目并返回被淘汰的 key', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    const evicted = cache.set('d', 4);
    expect(evicted).toBe('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('get 会更新访问顺序，被 get 过的条目不会被优先淘汰', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 访问 a，使其变为最近使用
    expect(cache.get('a')).toBe(1);
    // 现在 b 是最久未访问
    const evicted = cache.set('d', 4);
    expect(evicted).toBe('b');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('set 已存在的 key 不淘汰，仅更新值与访问顺序', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(2, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    // 更新 a（不超容，不应淘汰）
    const evicted = cache.set('a', 10);
    expect(evicted).toBeUndefined();
    expect(onEvict).not.toHaveBeenCalled();
    expect(cache.get('a')).toBe(10);
    // a 已变为最近使用，下次应淘汰 b
    const evicted2 = cache.set('c', 3);
    expect(evicted2).toBe('b');
  });

  it('has 不更新访问顺序', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.has('a')).toBe(true);
    // a 仍是最久未访问，应被淘汰
    const evicted = cache.set('c', 3);
    expect(evicted).toBe('a');
  });

  it('onEvict 回调在淘汰时被调用', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(2, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // 淘汰 a
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('a', 1);
  });

  it('onEvict 抛错不影响缓存正常工作', () => {
    const onEvict = vi.fn(() => {
      throw new Error('evict error');
    });
    const cache = new LRUCache<string, number>(2, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    // 淘汰 a 时 onEvict 抛错，但 b 应仍能写入
    cache.set('c', 3);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('delete 不触发 onEvict', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(2, onEvict);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(onEvict).not.toHaveBeenCalled();
    expect(cache.delete('not-exist')).toBe(false);
  });

  it('evict 主动淘汰并触发 onEvict', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(2, onEvict);
    cache.set('a', 1);
    expect(cache.evict('a')).toBe(true);
    expect(onEvict).toHaveBeenCalledWith('a', 1);
    expect(cache.evict('not-exist')).toBe(false);
  });

  it('clear 触发所有条目的 onEvict', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(3, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    expect(onEvict).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(0);
  });

  it('setCapacity 缩容时立即淘汰多余条目', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, number>(5, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    cache.set('e', 5);
    cache.setCapacity(2);
    expect(cache.size).toBe(2);
    // a/b/c 应被淘汰，d/e 保留
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('e')).toBe(true);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it('trimTo 淘汰最旧的条目', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    cache.set('e', 5);
    cache.trimTo(3);
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('e')).toBe(true);
  });

  it('构造时 capacity < 1 抛错', () => {
    expect(() => new LRUCache<string, number>(0)).toThrow();
    expect(() => new LRUCache<string, number>(-1)).toThrow();
  });

  it('keys 按访问顺序返回（最旧在前）', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // a 变为最新
    const keys = Array.from(cache.keys());
    expect(keys).toEqual(['b', 'c', 'a']);
  });
});
