/**
 * 轻量并发限制器（信号量/队列）
 *
 * P2：把"一次性触发的批量异步重活"（如对大量照片跑 face-api 人脸检测）限制在
 * 少量并发内排队执行，避免同时 N 个重任务挤爆内存 / 卡死主线程。
 *
 * 语义：
 * - `createConcurrencyLimiter(limit)` 返回 `withLimit(fn)`；
 * - 同时最多 `limit` 个 fn 在执行，其余入队，先完成补位；
 * - 结果与传入的 Promise 完全一致（仅调度时机变化，不改变抛错/成功语义）。
 */
export type ConcurrencyLimiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
  if (!Number.isFinite(limit) || limit <= 0) limit = 1;
  let active = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      const start = queue.shift()!;
      active++;
      start();
    }
  };

  return function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        fn().then(
          (v) => { active--; pump(); resolve(v); },
          (e) => { active--; pump(); reject(e); },
        );
      };
      queue.push(start);
      pump();
    });
  };
}