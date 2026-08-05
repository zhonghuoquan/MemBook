import { compressImageToPreviewAndOriginal, compressImageToPreviewOnly, compressImageToThumbPreviewOriginal, compressImageToThumbAndPreview, MAX_PREVIEW_WIDTH } from './image-compressor';
import { savePhotoBlobs } from '../handle-store';
import { logger } from '../../utils/logger';
import { LRUCache } from '../../utils/lruCache';

export interface ImportPhotoResult {
  previewBlobId: string;
  originalBlobId?: string;
  /** P1-1 LOD：缩略图 blob ID（256px），可能为空（旧数据或压缩失败回退） */
  thumbBlobId?: string;
  previewWidth: number;
  previewHeight: number;
  originalWidth: number;
  originalHeight: number;
  previewUrl: string;
}

export interface ImportPhotoOptions {
  /** 只生成并存储预览图，不存高清原图（用于 Tauri 桌面端引用原文件路径） */
  onlyPreview?: boolean;
  /** 已知的原图尺寸，避免重复读取 */
  originalWidth?: number;
  originalHeight?: number;
  /** P1-1 LOD：是否生成 thumb 缩略图档（默认 true）。
   * 旧调用方可设为 false 保持原行为。 */
  withThumb?: boolean;
}

/** 压缩图片并存入 IndexedDB，同时生成预览图和高清原图。
 *  P1-1 LOD：withThumb=true（默认）时额外生成 256px thumb 档。 */
export async function importPhotoToDB(file: File, options: ImportPhotoOptions = {}): Promise<ImportPhotoResult> {
  const { onlyPreview = false, originalWidth, originalHeight, withThumb = true } = options;

  // ── P1-1 LOD 三级体系分支 ──
  if (withThumb) {
    let thumbBlob: Blob | undefined;
    let previewBlob: Blob;
    let previewW: number, previewH: number;
    let originalW: number, originalH: number;
    let originalBlob: Blob | undefined;

    if (onlyPreview && originalWidth != null && originalHeight != null) {
      // Tauri direct 模式：thumb + preview，不存原图
      const result = await compressImageToThumbAndPreview(file, originalWidth, originalHeight);
      thumbBlob = result.thumb.blob;
      previewBlob = result.preview.blob;
      previewW = result.preview.width;
      previewH = result.preview.height;
      originalW = result.originalWidth;
      originalH = result.originalHeight;
    } else {
      // 完整导入：thumb + preview + original
      const result = await compressImageToThumbPreviewOriginal(file);
      thumbBlob = result.thumb.blob;
      previewBlob = result.preview.blob;
      previewW = result.preview.width;
      previewH = result.preview.height;
      originalBlob = result.original.blob;
      originalW = result.original.width;
      originalH = result.original.height;
    }

    if (!previewBlob || previewBlob.size <= 0) {
      throw new Error('预览图压缩结果为空，无法保存照片');
    }

    const previewBlobId = `photo-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const thumbBlobId = thumbBlob && thumbBlob.size > 0
      ? `photo-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : undefined;
    const originalBlobId = originalBlob && originalBlob.size > 0
      ? `photo-original-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : undefined;

    const blobs: { id: string; blob: Blob }[] = [{ id: previewBlobId, blob: previewBlob }];
    if (thumbBlobId) blobs.push({ id: thumbBlobId, blob: thumbBlob! });
    if (originalBlobId) blobs.push({ id: originalBlobId, blob: originalBlob! });
    await savePhotoBlobs(blobs);

    // P0-2: 注册到 blobUrlCache，受 LRU 200 条管理，避免 300+ 张 preview URL 全部常驻泄漏
    const _previewUrl = URL.createObjectURL(previewBlob);
    registerBlobUrl(previewBlobId, _previewUrl);
    return {
      previewBlobId,
      thumbBlobId,
      originalBlobId,
      previewWidth: previewW,
      previewHeight: previewH,
      originalWidth: originalW,
      originalHeight: originalH,
      previewUrl: _previewUrl,
    };
  }

  // ── 旧路径（withThumb=false）：保持原行为，向后兼容 ──
  let preview: { blob: Blob; width: number; height: number };
  let original: { blob: Blob; width: number; height: number } | { width: number; height: number };

  if (onlyPreview && originalWidth != null && originalHeight != null) {
    preview = await compressImageToPreviewOnly(file);
    original = { width: originalWidth, height: originalHeight };
  } else {
    const result = await compressImageToPreviewAndOriginal(file);
    preview = result.preview;
    original = result.original;
  }

  const previewBlobId = `photo-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const originalBlobId = `photo-original-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!preview.blob || preview.blob.size <= 0) {
    throw new Error('预览图压缩结果为空，无法保存照片');
  }
  const blobs: { id: string; blob: Blob }[] = [{ id: previewBlobId, blob: preview.blob }];
  if (!onlyPreview) {
    const originalBlob = (original as { blob: Blob }).blob;
    if (!originalBlob || originalBlob.size <= 0) {
      throw new Error('高清原图压缩结果为空，无法保存照片');
    }
    blobs.push({ id: originalBlobId, blob: originalBlob });
  }
  await savePhotoBlobs(blobs);

  // P0-2: 旧路径也注册到 blobUrlCache，统一受 LRU 管理
  const _previewUrl = URL.createObjectURL(preview.blob);
  registerBlobUrl(previewBlobId, _previewUrl);
  return {
    previewBlobId,
    originalBlobId: onlyPreview ? undefined : originalBlobId,
    previewWidth: preview.width,
    previewHeight: preview.height,
    originalWidth: original.width,
    originalHeight: original.height,
    previewUrl: _previewUrl,
  };
}

/**
 * P0-fix: direct 模式 Phase 1 一次性生成 thumb(256px) + preview(1200px)。
 *   替代旧的"Phase 1 只生成 thumb + Phase 2 后台生成 preview"两阶段方案。
 *
 * 优势：
 *   - 原文件只解码一次（旧方案 P2 会二次 readFile 原文件，冗余 IO + 内存峰值）
 *   - 导入完成后 photo.src 直接是 preview blob URL，无需 asset:// 临时阶段
 *   - 消除 P2 后台任务，简化流程
 *   - 项目加载时直接用 previewBlobId，不再读原文件
 *
 * 代价：Phase 1 每张图解码原图（5000x3000），比仅生成 thumb 慢 2-3x，
 *   但总耗时低于"Phase 1 + P2 后台"总和，且无内存峰值。
 */
export async function importPhotoThumbAndPreview(
  file: File,
  originalWidth?: number,
  originalHeight?: number,
): Promise<{
  thumbBlobId: string;
  previewBlobId: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  originalWidth: number;
  originalHeight: number;
}> {
  const result = await compressImageToThumbAndPreview(file, originalWidth, originalHeight);
  if (!result.thumb.blob || result.thumb.blob.size <= 0) {
    throw new Error('thumb 压缩结果为空');
  }
  if (!result.preview.blob || result.preview.blob.size <= 0) {
    throw new Error('preview 压缩结果为空');
  }
  const thumbBlobId = `photo-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const previewBlobId = `photo-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await savePhotoBlobs([
    { id: thumbBlobId, blob: result.thumb.blob },
    { id: previewBlobId, blob: result.preview.blob },
  ]);
  // 注册 preview blob URL 到 LRU 缓存，受 refCount 管理
  const previewUrl = URL.createObjectURL(result.preview.blob);
  registerBlobUrl(previewBlobId, previewUrl);
  return {
    thumbBlobId,
    previewBlobId,
    previewUrl,
    previewWidth: result.preview.width,
    previewHeight: result.preview.height,
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
  };
}

/**
 * P2: 为 direct 模式照片后台生成 preview(1200px) 并存入 IndexedDB。
 * 导入完成后后台异步调用，生成后更新 photo.previewBlobId 和 photo.src。
 * 失败时静默忽略（photo.src 仍指向 asset:// 原文件，编辑器画布仍可用）。
 */
export async function generatePreviewForDirectPhoto(
  file: File,
  _originalWidth?: number,
  _originalHeight?: number,
): Promise<{
  previewBlobId: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
} | null> {
  try {
    const { compressImageToPreviewOnly } = await import('./image-compressor');
    const preview = await compressImageToPreviewOnly(file);
    if (!preview.blob || preview.blob.size <= 0) return null;
    const previewBlobId = `photo-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await savePhotoBlobs([{ id: previewBlobId, blob: preview.blob }]);
    const _previewUrl = URL.createObjectURL(preview.blob);
    registerBlobUrl(previewBlobId, _previewUrl);
    return {
      previewBlobId,
      previewUrl: _previewUrl,
      previewWidth: preview.width,
      previewHeight: preview.height,
    };
  } catch (err) {
    logger.warn('[import-store] generatePreviewForDirectPhoto 失败:', err);
    return null;
  }
}

/** blob URL 缓存：避免同一 blob 被反复读取和创建 URL，减少内存泄漏。
 *  改造为 LRU 缓存：限制 200 个条目，避免导入上千张照片时 blob URL 无限累积。
 *
 *  P2-4：引用计数 + 延迟回收
 *  - 每个 blobId 对应一个 BlobUrlEntry { url, refCount }
 *  - readPhotoFromDB：缓存查找/创建，不改变 refCount（向后兼容）
 *    LRU 淘汰时延迟 60s 回收，避免 <img> 仍引用时 URL 被 revoke 导致图片裂图
 *  - acquirePhotoUrl/releasePhotoUrl：显式引用计数 API，供组件管理生命周期
 *    acquire 后 URL 被 pin 住（refCount > 0），LRU 淘汰不会回收
 *  - 强制失效（invalidateBlobUrlCache / revokeAllBlobUrls）：无视 refCount 立即回收
 */
interface BlobUrlEntry {
  url: string;
  refCount: number;
}

/**
 * P0-fix: 容量从 30 提升到 200。
 *   30 太小：相册超过 30 张照片时，handleOpenProject 批量 readPhotoFromDB 创建的
 *   refCount=0 blob URL 会被 LRU 淘汰，10s 后被 revoke。第一页的照片最先加载→最先淘汰，
 *   导致编辑器首屏第一页照片偶现空白（acquirePhotoUrl 来 pin 之前 URL 已被 revoke）。
 *   200 条与注释中一直声称的容量一致，覆盖大多数相册规模。
 *   内存影响：200 条 × ~300KB preview blob ≈ 60MB，可接受。
 */
const BLOB_URL_CACHE_CAPACITY = 200;
/** LRU 淘汰后延迟回收的宽限期（ms）：覆盖 React 重渲染、虚拟滚动回收等短暂窗口
 *  P0-fix: 60s → 10s。导入 500 张照片时，440 条被 LRU 淘汰的 blob URL 在 60s 内常驻
 *  ~132MB，用户感知"导入完成后内存不释放"。10s 宽限期足够覆盖 React 重渲染，且快速释放。 */
const REVOCATION_DELAY_MS = 10_000;

/** 全局注册表：跟踪所有活跃的 blob URL（包括已从 LRU 淘汰但 refCount > 0 的） */
const blobUrlRegistry = new Map<string, BlobUrlEntry>();
/** 延迟回收队列：refCount=0 且被 LRU 淘汰的条目，等待宽限期后回收 */
const pendingRevocation = new Map<string, { url: string; timer: ReturnType<typeof setTimeout> }>();

function revokeUrl(url: string): void {
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
}

/**
 * P0-2: 将已创建的 blob URL 注册到 blobUrlCache，使其受 LRU 管理。
 * 用于 importPhotoToDB 返回的 previewUrl：之前裸 createObjectURL 不进缓存，永不回收，
 * 导致 300+ 张照片的 preview blob URL 全部常驻（~90MB 泄漏）。
 * 注册后受 LRU 200 条管理，超容量时延迟 60s 回收。
 */
function registerBlobUrl(blobId: string, url: string): void {
  // 已存在则 touch LRU（不覆盖 refCount）
  const existing = blobUrlRegistry.get(blobId);
  if (existing) {
    // P2: 重复注册时新 URL 未使用，立即 revoke 避免泄漏
    if (existing.url !== url) {
      revokeUrl(url);
    }
    blobUrlCache.set(blobId, existing);
    return;
  }
  const entry: BlobUrlEntry = { url, refCount: 0 };
  blobUrlRegistry.set(blobId, entry);
  blobUrlCache.set(blobId, entry);
}

/** LRU 淘汰回调：refCount > 0 时不回收（entry 保留在 registry），refCount=0 时延迟回收 */
function evictBlobUrl(blobId: string, entry: BlobUrlEntry) {
  if (entry.refCount > 0) {
    // 仍有消费者引用：仅从 LRU 移除，URL 保持有效，等 releasePhotoUrl 时回收
    return;
  }
  // refCount=0：延迟回收，给 readPhotoFromDB 调用方宽限期
  const timer = setTimeout(() => {
    revokeUrl(entry.url);
    pendingRevocation.delete(blobId);
    blobUrlRegistry.delete(blobId);
  }, REVOCATION_DELAY_MS);
  pendingRevocation.set(blobId, { url: entry.url, timer });
}

const blobUrlCache = new LRUCache<string, BlobUrlEntry>(BLOB_URL_CACHE_CAPACITY, evictBlobUrl);

/** 取消延迟回收（readPhotoFromDB / acquirePhotoUrl 命中时调用） */
function cancelPendingRevocation(blobId: string): void {
  const pending = pendingRevocation.get(blobId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRevocation.delete(blobId);
  }
}

/** 强制刷新指定 blobId 的缓存 URL（导出重试时若怀疑缓存失效可调用） */
export function invalidateBlobUrlCache(blobId: string): void {
  cancelPendingRevocation(blobId);
  const entry = blobUrlRegistry.get(blobId);
  if (entry) {
    revokeUrl(entry.url);
    blobUrlRegistry.delete(blobId);
  }
  blobUrlCache.delete(blobId);
}

/** 从 IndexedDB 读取已导入的图片（带缓存，避免重复创建 blob URL）
 *  P2-4：不改变 refCount，LRU 淘汰时延迟 60s 回收，宽限期内重读可复活 */
export async function readPhotoFromDB(blobId: string): Promise<string | null> {
  // 1. 检查延迟回收队列：宽限期内复活
  const pending = pendingRevocation.get(blobId);
  if (pending) {
    cancelPendingRevocation(blobId);
    const entry: BlobUrlEntry = { url: pending.url, refCount: 0 };
    blobUrlRegistry.set(blobId, entry);
    blobUrlCache.set(blobId, entry);
    return entry.url;
  }
  // 2. 检查 LRU 缓存
  const cached = blobUrlCache.get(blobId);
  if (cached) return cached.url;
  // 3. 检查全局注册表（LRU 已淘汰但 refCount > 0 的条目）
  const registryEntry = blobUrlRegistry.get(blobId);
  if (registryEntry) {
    blobUrlCache.set(blobId, registryEntry);
    return registryEntry.url;
  }
  // 4. 未命中：从 IndexedDB 加载
  try {
    const { getPhotoBlob } = await import('../handle-store');
    const blob = await getPhotoBlob(blobId);
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      const entry: BlobUrlEntry = { url, refCount: 0 };
      blobUrlRegistry.set(blobId, entry);
      blobUrlCache.set(blobId, entry);
      return url;
    }
    logger.warn(`[storage] readPhotoFromDB blob 为空或不存在: blobId=${blobId}`);
  } catch {
    logger.warn(`[storage] readPhotoFromDB 失败: blobId=${blobId}`);
  }
  return null;
}

/**
 * P2-4：显式获取 blob URL 引用（refCount++）。
 * 供需要精确管理 URL 生命周期的组件使用（如 usePhotoSrc：mount 时 acquire，unmount 时 release）。
 * acquire 后 URL 被 pin 住，LRU 淘汰不会回收，直到 release 将 refCount 降为 0。
 */
export async function acquirePhotoUrl(blobId: string): Promise<string | null> {
  // 取消延迟回收（如果有）
  cancelPendingRevocation(blobId);
  // 检查注册表（含 LRU 已淘汰但仍在 registry 的条目）
  const existing = blobUrlRegistry.get(blobId);
  if (existing) {
    existing.refCount++;
    blobUrlCache.set(blobId, existing); // touch LRU
    return existing.url;
  }
  // 未命中：从 IndexedDB 加载
  try {
    const { getPhotoBlob } = await import('../handle-store');
    const blob = await getPhotoBlob(blobId);
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      const entry: BlobUrlEntry = { url, refCount: 1 };
      blobUrlRegistry.set(blobId, entry);
      blobUrlCache.set(blobId, entry);
      return url;
    }
    logger.warn(`[storage] acquirePhotoUrl blob 为空或不存在: blobId=${blobId}`);
  } catch {
    logger.warn(`[storage] acquirePhotoUrl 失败: blobId=${blobId}`);
  }
  return null;
}

/**
 * P2-4：释放 blob URL 引用（refCount--）。
 * refCount 降为 0 时延迟回收 URL（与 evictBlobUrl 一致的宽限期策略）。
 * 与 acquirePhotoUrl 配对使用。
 *
 * P0-fix: 之前 refCount=0 时立即 revoke URL，但此时可能仍有 in-flight fetch
 *   （如 CanvasPhotoRenderer 的 loadCachedImage 正在 fetch(src) 读取 blob 字节）。
 *   立即 revoke 会导致 fetch 失败 → ERR_FILE_NOT_FOUND → 图片空白 + 重试风暴。
 *   改为延迟 REVOCATION_DELAY_MS 后回收，给 in-flight 请求宽限期完成读取。
 *   宽限期内若再次 acquire/readPhotoFromDB 会取消回收并复活 URL。
 */
export function releasePhotoUrl(blobId: string): void {
  const entry = blobUrlRegistry.get(blobId);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount <= 0) {
    // 无消费者引用：延迟回收（与 evictBlobUrl 一致），给 in-flight fetch 宽限期
    cancelPendingRevocation(blobId);
    const timer = setTimeout(() => {
      revokeUrl(entry.url);
      pendingRevocation.delete(blobId);
      blobUrlRegistry.delete(blobId);
      blobUrlCache.delete(blobId);
    }, REVOCATION_DELAY_MS);
    pendingRevocation.set(blobId, { url: entry.url, timer });
  }
}

/** 释放指定 blobId 对应的缓存 URL（用于清理内存） */
export function revokeBlobUrl(blobId: string): void {
  invalidateBlobUrlCache(blobId);
}

/**
 * P0-fix: 检查指定的 blob: URL 是否仍然有效（未 revoke）。
 * 用于 usePhotoSrc 判断 photo.src（可能在某处被赋值的 blob URL）是否仍可用。
 *
 * blob URL 失效场景：
 *   1. LRU 缓存淘汰后超过 REVOCATION_DELAY_MS 宽限期被 revoke
 *   2. releasePhotoUrl 将 refCount 降为 0 后立即 revoke
 *   3. revokeAllBlobUrls / revokeBlobUrl 主动 revoke
 *
 * @param url 待检查的 URL
 * @returns true 表示 URL 仍在 registry 或 pendingRevocation 中，仍可加载
 */
export function isBlobUrlAlive(url: string): boolean {
  if (!url || !url.startsWith('blob:')) {
    // 非 blob URL（asset:// / http）无法判断，乐观返回 true
    return true;
  }
  // 检查 registry
  for (const entry of blobUrlRegistry.values()) {
    if (entry.url === url) return true;
  }
  // 检查延迟回收队列（宽限期内仍可用）
  for (const { url: pendingUrl } of pendingRevocation.values()) {
    if (pendingUrl === url) return true;
  }
  return false;
}

/** 清理所有缓存的 blob URL（用于项目切换或组件卸载） */
export function revokeAllBlobUrls(): void {
  // 清理延迟回收队列
  for (const { timer } of pendingRevocation.values()) {
    clearTimeout(timer);
  }
  pendingRevocation.clear();
  // 回收所有注册表中的 URL
  for (const entry of blobUrlRegistry.values()) {
    revokeUrl(entry.url);
  }
  blobUrlRegistry.clear();
  blobUrlCache.clear();
}

export { MAX_PREVIEW_WIDTH };
