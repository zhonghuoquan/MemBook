/**
 * 感知哈希（pHash）Web Worker
 *
 * 把大量照片的 GOP(解码 + DCT) 计算从主线程移出，避免上万张分析时主线程
 * 被长任务阻塞造成页面无响应/崩溃。
 *
 * 协议：
 *   主线程 → { id, data: ArrayBuffer }
 *   Worker → { id, phash: string | null }
 */
import { computePHashFromBitmapOffscreen } from './perceptual-hash';

type PhashWorkerScope = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

const scope = self as unknown as PhashWorkerScope;

scope.onmessage = async (e: MessageEvent<{ id: number; data: ArrayBuffer }>) => {
  const { id, data } = e.data;
  let bitmap: ImageBitmap | null = null;
  let phash: string | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([data]));
    phash = await computePHashFromBitmapOffscreen(bitmap);
  } catch (err) {
    // 解码失败等按 null 处理（与主线程 computePHash 语义一致）
    phash = null;
  } finally {
    if (bitmap) {
      try { bitmap.close(); } catch { /* ignore */ }
    }
  }
  scope.postMessage({ id, phash });
};

export {};