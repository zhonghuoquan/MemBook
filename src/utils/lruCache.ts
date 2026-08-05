/**
 * LRU (Least Recently Used) 缓存实现。
 *
 * 用于管理图像、Blob URL 等占用大量内存的资源。
 * 当缓存容量达到上限时，淘汰最久未访问的条目，并通过 onEvict 回调
 * 通知调用方执行资源释放（如 revokeObjectURL、释放 HTMLImageElement）。
 *
 * 设计要点：
 * - 基于 Map 的插入顺序天然维护 LRU 顺序（get/set 时重新插入到末尾）
 * - 线程模型：单线程 JS，无需加锁，但需注意异步竞态（set 与 get 之间不要 await）
 * - 容量可动态调整（trimTo），用于内存压力降级
 */

export class LRUCache<K, V> {
  private capacity: number;
  private map = new Map<K, V>();
  /** 淘汰回调：在条目被淘汰时调用，供外部执行资源释放 */
  private onEvict?: (key: K, value: V) => void;

  constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
    if (capacity < 1) throw new Error('LRUCache capacity must be >= 1');
    this.capacity = capacity;
    this.onEvict = onEvict;
  }

  /** 获取当前缓存条目数 */
  get size(): number {
    return this.map.size;
  }

  /** 读取条目，同时更新访问顺序（移到末尾表示最近使用） */
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    // 重新插入到末尾，标记为最近访问
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  /** 检查是否存在（不更新访问顺序） */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * 写入条目。若导致超容，淘汰最久未访问的条目并调用 onEvict。
   * 返回被淘汰的 key（供调用方感知），无淘汰时返回 undefined。
   */
  set(key: K, val: V): K | undefined {
    let evictedKey: K | undefined;
    if (this.map.has(key)) {
      // 已存在：先删除旧条目，再重新插入到末尾
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // 容量已满：淘汰 Map 的第一个 key（最久未访问）
      const oldestKey = this.map.keys().next().value as K;
      const oldestVal = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldestVal !== undefined && this.onEvict) {
        try {
          this.onEvict(oldestKey, oldestVal);
        } catch (err) {
          // 淘汰回调出错不应影响缓存正常工作
          console.warn('[LRUCache] onEvict error:', err);
        }
      }
      evictedKey = oldestKey;
    }
    this.map.set(key, val);
    return evictedKey;
  }

  /** 删除指定条目，不触发 onEvict（视为主动释放） */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** 主动淘汰指定条目，触发 onEvict（用于外部感知淘汰） */
  evict(key: K): boolean {
    const val = this.map.get(key);
    if (val === undefined) return false;
    this.map.delete(key);
    if (this.onEvict) {
      try {
        this.onEvict(key, val);
      } catch (err) {
        console.warn('[LRUCache] onEvict error:', err);
      }
    }
    return true;
  }

  /** 清空全部缓存，触发所有条目的 onEvict */
  clear(): void {
    if (this.onEvict) {
      for (const [key, val] of this.map) {
        try {
          this.onEvict(key, val);
        } catch (err) {
          console.warn('[LRUCache] onEvict error during clear:', err);
        }
      }
    }
    this.map.clear();
  }

  /** 动态调整容量：若新容量小于当前条目数，立即淘汰多余条目 */
  setCapacity(newCapacity: number): void {
    if (newCapacity < 1) throw new Error('capacity must be >= 1');
    this.capacity = newCapacity;
    this.trimTo(newCapacity);
  }

  /** 裁剪到指定数量，淘汰多余的旧条目（用于内存压力降级） */
  trimTo(targetSize: number): void {
    while (this.map.size > targetSize) {
      const oldestKey = this.map.keys().next().value as K;
      const oldestVal = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldestVal !== undefined && this.onEvict) {
        try {
          this.onEvict(oldestKey, oldestVal);
        } catch (err) {
          console.warn('[LRUCache] onEvict error during trim:', err);
        }
      }
    }
  }

  /** 获取所有 keys（按访问顺序，最旧在前） */
  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}
