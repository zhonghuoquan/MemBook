/**
 * concurrency — 并发限制器测试
 *
 * P2-1：验证并发上限、排队补位、异常传播。
 */
import { describe, it, expect } from 'vitest';
import { createConcurrencyLimiter } from './concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createConcurrencyLimiter', () => {
  it('同时并发不超过 limit', async () => {
    const limit = createConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 5 }, () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2); // 确实复用了并发
  });

  it('按入队顺序排队执行，结果一致', async () => {
    const limit = createConcurrencyLimiter(1);
    const order: number[] = [];
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        limit(async () => {
          await tick();
          order.push(i);
          return i * 10;
        }),
      ),
    );
    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]); // 串行 且 按入队顺序
  });

  it('异常传播且不阻塞后续任务', async () => {
    const limit = createConcurrencyLimiter(1);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // 失败后队列仍可继续
    expect(await limit(async () => 42)).toBe(42);
  });

  it('非正 limit 兜底为 1', async () => {
    const limit = createConcurrencyLimiter(0);
    let active = 0; let peak = 0;
    const tasks = Array.from({ length: 3 }, () =>
      limit(async () => { active++; peak = Math.max(peak, active); await tick(); active--; }),
    );
    await Promise.all(tasks);
    expect(peak).toBe(1);
  });
});