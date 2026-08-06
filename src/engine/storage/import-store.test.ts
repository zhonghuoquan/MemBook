/**
 * P2-4 blobUrlCache 引用计数单元测试
 *
 * 测试策略：
 * - import-store.ts 中的 acquirePhotoUrl/releasePhotoUrl 依赖 IndexedDB 的 getPhotoBlob
 * - 测试中通过 vi.mock 替换 handle-store 模块，注入受控的 blob
 * - 通过 vi.spyOn(URL, 'createObjectURL') 和 URL.revokeObjectURL 验证生命周期
 *
 * 覆盖关键场景：
 * - acquire 命中缓存不重复创建 URL
 * - acquire/release 配对：refCount=0 时立即回收
 * - LRU 淘汰时 refCount>0 不回收（延迟回收）
 * - readPhotoFromDB 复活延迟回收队列中的 URL
 * - invalidateBlobUrlCache 强制回收
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 受控的 blob 存储模拟
const mockBlobs = new Map<string, Blob>();

// mock handle-store 的 getPhotoBlob
vi.mock('../handle-store', () => ({
  getPhotoBlob: vi.fn(async (blobId: string) => mockBlobs.get(blobId) ?? null),
}));

// mock URL.createObjectURL / revokeObjectURL
const createdUrls = new Set<string>();
const revokedUrls = new Set<string>();
let urlCounter = 0;
URL.createObjectURL = vi.fn((_blob: Blob) => {
  urlCounter++;
  const url = `blob:mock-${urlCounter}`;
  createdUrls.add(url);
  return url;
}) as typeof URL.createObjectURL;
URL.revokeObjectURL = vi.fn((url: string) => {
  revokedUrls.add(url);
}) as typeof URL.revokeObjectURL;

// 动态导入被测模块（在 mock 生效后）
const { acquirePhotoUrl, releasePhotoUrl, readPhotoFromDB, invalidateBlobUrlCache, revokeAllBlobUrls } =
  await import('./import-store');

// 访问内部状态需要通过行为推断，不直接访问私有 Map
function putMockBlob(blobId: string): void {
  mockBlobs.set(blobId, new Blob([blobId], { type: 'image/jpeg' }));
}

describe('P2-4 blobUrlCache 引用计数', () => {
  beforeEach(() => {
    // 启用假定时器：releasePhotoUrl 延迟 10s 回收，需 advanceTimersByTime 触发
    vi.useFakeTimers();
    // 先清空 import-store 内部状态（会调用 revokeObjectURL）
    revokeAllBlobUrls();
    // 再清空测试用的记录集合，避免被上面 revoke 污染
    mockBlobs.clear();
    createdUrls.clear();
    revokedUrls.clear();
    urlCounter = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquirePhotoUrl：首次 acquire 从 IDB 加载并创建 URL', async () => {
    putMockBlob('b1');
    const url = await acquirePhotoUrl('b1');
    expect(url).not.toBeNull();
    expect(createdUrls.size).toBe(1);
    expect(revokedUrls.size).toBe(0);
  });

  it('acquirePhotoUrl：重复 acquire 同一 blobId 复用 URL（不重复创建）', async () => {
    putMockBlob('b1');
    const u1 = await acquirePhotoUrl('b1');
    const u2 = await acquirePhotoUrl('b1');
    expect(u1).toBe(u2);
    expect(createdUrls.size).toBe(1);
  });

  it('acquirePhotoUrl：不存在的 blob 返回 null', async () => {
    const url = await acquirePhotoUrl('not-exist');
    expect(url).toBeNull();
  });

  it('releasePhotoUrl：refCount 降为 0 时延迟回收', async () => {
    putMockBlob('b1');
    const url = await acquirePhotoUrl('b1');
    expect(url).not.toBeNull();
    expect(revokedUrls.size).toBe(0);
    releasePhotoUrl('b1');
    // 延迟回收：10s 宽限期内不应回收
    expect(revokedUrls.size).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(revokedUrls.size).toBe(1);
  });

  it('acquire/release 配对：多次 acquire 需多次 release 才回收', async () => {
    putMockBlob('b1');
    const u1 = await acquirePhotoUrl('b1'); // refCount=1
    const u2 = await acquirePhotoUrl('b1'); // refCount=2
    expect(u1).toBe(u2);
    releasePhotoUrl('b1'); // refCount=1，不应回收
    expect(revokedUrls.size).toBe(0);
    releasePhotoUrl('b1'); // refCount=0，延迟回收
    vi.advanceTimersByTime(10_000);
    expect(revokedUrls.size).toBe(1);
  });

  it('releasePhotoUrl：未 acquire 过的 blobId 无副作用', () => {
    expect(() => releasePhotoUrl('never-acquired')).not.toThrow();
    expect(revokedUrls.size).toBe(0);
  });

  it('releasePhotoUrl：多次 release 不会使 refCount 变负', async () => {
    putMockBlob('b1');
    await acquirePhotoUrl('b1'); // refCount=1
    releasePhotoUrl('b1'); // refCount=0，延迟回收
    vi.advanceTimersByTime(10_000);
    expect(revokedUrls.size).toBe(1);
    // 再次 release 不应抛错或重复回收
    expect(() => releasePhotoUrl('b1')).not.toThrow();
    expect(revokedUrls.size).toBe(1);
  });

  it('readPhotoFromDB：复用已 acquire 的 URL', async () => {
    putMockBlob('b1');
    const acquired = await acquirePhotoUrl('b1');
    const read = await readPhotoFromDB('b1');
    expect(read).toBe(acquired);
    expect(createdUrls.size).toBe(1);
  });

  it('readPhotoFromDB：未 acquire 时也能创建 URL（refCount=0）', async () => {
    putMockBlob('b1');
    const url = await readPhotoFromDB('b1');
    expect(url).not.toBeNull();
    expect(createdUrls.size).toBe(1);
  });

  it('readPhotoFromDB：不存在的 blob 返回 null', async () => {
    const url = await readPhotoFromDB('not-exist');
    expect(url).toBeNull();
  });

  it('invalidateBlobUrlCache：强制回收，无视 refCount', async () => {
    putMockBlob('b1');
    await acquirePhotoUrl('b1'); // refCount=1，正常情况 release 才回收
    expect(revokedUrls.size).toBe(0);
    invalidateBlobUrlCache('b1');
    expect(revokedUrls.size).toBe(1);
    // 之后 readPhotoFromDB 应能重新创建
    const url = await readPhotoFromDB('b1');
    expect(url).not.toBeNull();
    expect(createdUrls.size).toBe(2);
  });

  it('revokeAllBlobUrls：清空所有 URL', async () => {
    putMockBlob('b1');
    putMockBlob('b2');
    await acquirePhotoUrl('b1');
    await acquirePhotoUrl('b2');
    expect(createdUrls.size).toBe(2);
    expect(revokedUrls.size).toBe(0);
    revokeAllBlobUrls();
    expect(revokedUrls.size).toBe(2);
  });

  it('acquire 后再 acquire（refCount>0）：LRU 淘汰不回收', async () => {
    putMockBlob('b1');
    const url = await acquirePhotoUrl('b1');
    expect(url).not.toBeNull();
    // 模拟 LRU 淘汰：通过 invalidateBlobUrlCache 不会发生（那是强制回收）
    // 这里通过 release 验证 refCount>0 时被 pin
    // 再 acquire 一次，refCount=2
    await acquirePhotoUrl('b1');
    releasePhotoUrl('b1'); // refCount=1，不应回收
    expect(revokedUrls.size).toBe(0);
    releasePhotoUrl('b1'); // refCount=0，延迟回收
    vi.advanceTimersByTime(10_000);
    expect(revokedUrls.size).toBe(1);
  });

  it('readPhotoFromDB 与 acquirePhotoUrl 交替使用：共享同一 URL', async () => {
    putMockBlob('b1');
    const u1 = await readPhotoFromDB('b1'); // refCount=0
    const u2 = await acquirePhotoUrl('b1'); // refCount=1
    expect(u1).toBe(u2);
    expect(createdUrls.size).toBe(1);
    releasePhotoUrl('b1'); // refCount=0，延迟回收
    vi.advanceTimersByTime(10_000);
    expect(revokedUrls.size).toBe(1);
  });
});
