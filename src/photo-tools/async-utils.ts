/**
 * 异步工具函数（photo-tools 共用）
 */

/**
 * 让出主线程：通过 setTimeout 排队到下一个宏任务，
 * 让浏览器有机会处理 UI 事件与渲染，避免长任务卡死界面。
 *
 * 大批量任务（上万张照片分析）应分批处理，每批之间调用本函数。
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 并发执行异步任务（工作池模式）
 *
 * 维持固定数量的 worker 同时处理 items，避免逐个 await 造成的串行 IO。
 * 适用于文件读取等 IO 密集型场景（Tauri readFile / fetch 等）。
 *
 * @param items 待处理项
 * @param fn 单项处理函数（返回 Promise）
 * @param concurrency 并发数（默认 8）
 * @param onProgress 进度回调（已完成数, 总数）
 * @param signal 中止信号
 * @returns 结果数组（顺序与 items 一致）
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];
  const results: R[] = new Array(total);
  let nextIndex = 0;
  let doneCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const idx = nextIndex++;
      if (idx >= total) break;
      results[idx] = await fn(items[idx], idx);
      doneCount++;
      onProgress?.(doneCount, total);
    }
  }

  const workerCount = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * 分批执行并让出主线程
 *
 * 将 items 切成 chunkSize 大小的批次依次交给 runner 处理，
 * 每批之间通过 yieldToMain 让出主线程，保证上万张照片等大批量
 * 任务处理时 UI 保持响应（浏览器可渲染/处理输入事件）。
 *
 * @param items 待处理项
 * @param chunkSize 每批数量
 * @param runner 单批处理器（接收本批切片与批次序号）
 * @param signal 中止信号（中止时抛 AbortError）
 */
export async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  runner: (chunk: T[], chunkIndex: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const chunk = items.slice(i, Math.min(i + chunkSize, items.length));
    await runner(chunk, i / chunkSize);
    // 本批不是最后一批时让出主线程（避免无谓的最后一跳延迟）
    if (i + chunkSize < items.length) await yieldToMain();
  }
}
