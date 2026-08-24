/**
 * 感知哈希 Worker 池
 *
 * 为 findSimilarPhotos / deduplicatePhotos 提供主线程外计算 pHash 的能力，
 * 避免上万张照片分析时主线程被解码/DCT 长任务阻塞。自动回退：
 * - Worker 创建失败 / 崩溃 → 全部回退主线程（computePHash）
 * - 单条消息因 Worker 异常未回 → 该条回退主线程
 *
 * 安全说明：buffer 通过 postMessage 结构化克隆传递（不 transfer），
 * 调用方原始 ArrayBuffer 不被 detach，因此即便 Worker 崩溃、回退主线程
 * 重算也仍然有可用数据。
 */

import { computePHash } from './perceptual-hash';
import { logger } from '../utils/logger';

const MAX_WORKERS = 3;

interface PendingTask {
  id: number;
  resolve: (phash: string | null) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface WorkerSlot {
  worker: Worker;
  broken: boolean;
  pending: Map<number, PendingTask>;
}

class PhashWorkerPool {
  private slots: WorkerSlot[] = [];
  private fallbackMain = false;
  private requestId = 0;
  private nextSlot = 0;

  /** 当前可用（未损坏）的 Worker 槽位 */
  private usableSlots(): WorkerSlot[] {
    return this.slots.filter((s) => !s.broken);
  }

  /** 惰性初始化 Worker 池；失败返回空数组（调用方回退主线程） */
  private ensureWorkers(): void {
    if (this.slots.length > 0 || this.fallbackMain) return;
    // 浏览器/Node 环境都可能无 Worker 构造能力；显式捕获
    if (typeof Worker === 'undefined') {
      this.fallbackMain = true;
      return;
    }
    const count = Math.min(
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 2,
      MAX_WORKERS,
    );
    let created = 0;
    for (let i = 0; i < count; i++) {
      try {
        const worker = new Worker(new URL('./perceptual-hash.worker.ts', import.meta.url), { type: 'module' });
        const slot: WorkerSlot = { worker, broken: false, pending: new Map() };
        this.attach(worker, slot);
        this.slots.push(slot);
        created++;
      } catch (err) {
        logger.warn('[phashPool] Worker 创建失败:', err);
      }
    }
    if (created === 0) {
      this.fallbackMain = true;
      logger.warn('[phashPool] 无可用 Worker，回退主线程计算 pHash');
    }
  }

  private attach(worker: Worker, slot: WorkerSlot): void {
    worker.addEventListener('message', (e: MessageEvent<{ id: number; phash: string | null }>) => {
      const task = slot.pending.get(e.data.id);
      if (!task) return;
      slot.pending.delete(e.data.id);
      if (task.timer) clearTimeout(task.timer);
      task.resolve(e.data.phash);
    });
    worker.addEventListener('error', (e) => {
      logger.error('[phashPool] Worker 崩溃，回退主线程:', e.message || e);
      // 打断该 Worker 所有排队任务，交由调用方单条回退主线程
      for (const [, task] of slot.pending) {
        if (task.timer) clearTimeout(task.timer);
        task.reject(new Error('phash worker crashed'));
      }
      slot.pending.clear();
      slot.broken = true;
      worker.terminate();
      const usable = this.slots.filter((s) => !s.broken);
      if (usable.length === 0) this.fallbackMain = true;
    });
  }

  /** 计算单个 buffer 的 pHash；Worker 不可用/失败时回退主线程 */
  async compute(data: ArrayBuffer): Promise<string | null> {
    this.ensureWorkers();
    const usable = this.usableSlots();
    if (this.fallbackMain || usable.length === 0) {
      return computePHash(data);
    }

    // 轮询分配一个可用槽位
    const slot = usable[this.nextSlot % usable.length];
    this.nextSlot++;

    return new Promise<string | null>((resolve, reject) => {
      const id = this.requestId++;
      const task: PendingTask = {
        id,
        resolve,
        reject,
        timer: undefined,
      };
      // 超时保护：Worker 无响应（异常挂起）时单条回退主线程
      task.timer = setTimeout(() => {
        slot.pending.delete(id);
        logger.warn('[phashPool] Worker 单条计算超时，回退主线程');
        void computePHash(data).then(resolve).catch(() => resolve(null));
      }, 30_000);
      slot.pending.set(id, task);
      slot.worker.postMessage({ id, data }); // 结构化克隆，不 detach data
    }).catch(async () => {
      // Worker 异常（崩溃打断）时单条回退主线程
      return computePHash(data);
    });
  }

  /** 终止所有 Worker，释放内存（用于项目/工具退出） */
  dispose(): void {
    for (const slot of this.slots) {
      trying: {
        try { slot.worker.terminate(); } catch { break trying; }
      }
    }
    this.slots = [];
    this.fallbackMain = false;
  }
}

let singleton: PhashWorkerPool | null = null;

/** 取 pHash Worker 池（惰性单例） */
export function getPhashPool(): PhashWorkerPool {
  if (!singleton) singleton = new PhashWorkerPool();
  return singleton;
}

/** 便捷入口：以 Worker 池（优先）/ 主线程（回退）计算 pHash */
export async function computePHashSafe(data: ArrayBuffer): Promise<string | null> {
  return getPhashPool().compute(data);
}