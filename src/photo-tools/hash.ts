/**
 * 四级去重引擎（SHA256 精确匹配 + pHash 视觉相似匹配）
 *
 * 优化策略（在原三级哈希基础上新增 Phase 4 感知哈希层）：
 * 1. 按文件大小分组 → 大小不同必不重复，直接排除（精确匹配快路径）
 * 2. 文件头 (前 4KB) 哈希预筛 → 快速排除大部分不重复的
 * 3. 全量 SHA256 → 精确判定（字节级完全相同）
 * 4. 感知哈希 (pHash) → 视觉相似判定（识别 EXIF 差异/重新压缩/缩略图差异）
 *
 * Phase 4 解决的问题：
 *   两张照片视觉内容一模一样，但因 EXIF 元数据被剥离/重新写入、
 *   JPEG 重新编码、嵌入缩略图不同等原因导致字节流不同，
 *   SHA256 无法识别为重复。pHash 基于频域特征，对这些差异鲁棒。
 *
 * 业界参考：Google Photos / Apple Photos 均采用感知哈希 + 特征点匹配
 *   的混合方案。本实现采用标准 pHash（DCT + 中位数二值化），
 *   对常见重复场景（IM 传输后保存、批量压缩）足够鲁棒。
 *
 * 支持两种输入：
 * - File / Blob 对象（库内模式）
 * - 文件路径字符串（Tauri 桌面端模式，通过 plugin-fs 读取）
 */

import type { PhotoFileInfo, DedupeGroup, DedupeResult, ToolProgress } from './types';
import { logger } from '../utils/logger';
import { computePHash, hammingDistance, DEFAULT_PHASH_THRESHOLD } from './perceptual-hash';

/** 头部预筛读取字节数 (4KB) */
const HEAD_SIZE = 4096;

/**
 * 读取 ArrayBuffer 的指定范围
 */
function sliceBuffer(buf: ArrayBuffer, start: number, length: number): ArrayBuffer {
  return buf.slice(start, Math.min(start + length, buf.byteLength));
}

/**
 * 计算 SHA256 哈希（使用 Web Crypto API，纯前端可用）
 */
async function sha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 从 File/Blob 读取数据
 */
export async function readFromFile(file: File | Blob, length?: number): Promise<ArrayBuffer> {
  const slice = length ? file.slice(0, length) : file;
  return slice.arrayBuffer();
}

/**
 * 从文件路径读取数据（Tauri 端）
 */
async function readFromPath(filePath: string, length?: number): Promise<ArrayBuffer> {
  // 动态导入 Tauri FS API
  const { readFile: tauriReadFile } = await import('@tauri-apps/plugin-fs');
  const buffer = await tauriReadFile(filePath);
  if (length) {
    return buffer.buffer.slice(0, length);
  }
  return buffer.buffer;
}

/**
 * 读取文件数据的统一入口
 */
async function readPhotoData(
  photo: PhotoFileInfo,
  length?: number,
): Promise<{ data: ArrayBuffer; fullSize: number }> {
  if (photo.path) {
    // Tauri 文件路径模式
    const buf = await readFromPath(photo.path, length);
    return { data: buf, fullSize: photo.size };
  }
  // 库内模式：通过 blobId 从 IndexedDB 读取原图数据
  if (photo.blobId) {
    try {
      const { readPhotoFromDB } = await import('../engine/storage/import-store');
      const url = await readPhotoFromDB(photo.blobId);
      if (url) {
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        return { data: length ? sliceBuffer(buf, 0, length) : buf, fullSize: buf.byteLength };
      }
    } catch {
      // blobId 读取失败，继续尝试其他方式
    }
  }
  // Web 文件夹模式：通过 blob URL 读取
  if (photo.thumbUrl) {
    try {
      const resp = await fetch(photo.thumbUrl);
      const buf = await resp.arrayBuffer();
      return { data: length ? sliceBuffer(buf, 0, length) : buf, fullSize: buf.byteLength };
    } catch {
      // fetch 失败时返回空
    }
  }
  throw new Error(`无法读取照片数据: ${photo.id}`);
}

// ── 并发读取辅助 ─────────────────────────────────────────

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
async function mapWithConcurrency<T, R>(
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

// ── 保留优先级评分 ────────────────────────────────────────

/** 副本命名标记（用于识别非原始文件） */
const COPY_PATTERNS = ['(1)', '(2)', '(3)', '(4)', '(5)', '_copy', ' copy', '-copy', '_1.', '-1.', '_2.', '-2.', '副本', '拷贝', '修改'];

/**
 * 为去重组中的每个文件计算"保留优先级"分数
 * 分越高越应该保留。
 *
 * 优先级规则（用户需求：优先删除不带拍摄日期的照片，即优先保留带日期的）：
 * 1. 有 EXIF 拍摄日期 → +5（强优先保留，含拍摄元信息的更可能是原始文件）
 * 2. 无 EXIF 拍摄日期 → -3（强优先删除，缺失拍摄信息的可能是衍生文件）
 * 3. 在 "MemBook照片整理/" 目录下 → +3（已整理过的文件更可能是用户精选保留）
 * 4. 文件名不含副本标记 ((1), _copy, 副本 等) → +2（原始命名更可信）
 * 5. 文件名含副本标记 → -2（衍生文件优先删除）
 * 6. 路径深度较浅 → +1（层级少更可能是原始位置）
 * 7. 文件较大（visual 组内可能不同大小）→ +1（高分辨率/低压缩更接近原始）
 * 8. 有 GPS 信息 → +1（完整元数据的更可能是原始文件）
 */
function computeKeepScore(file: PhotoFileInfo, groupMaxSize?: number): number {
  let score = 0;

  const path = file.relativePath || file.path || file.name;

  // 规则1-2: EXIF 拍摄日期（用户核心需求：优先保留带日期的，删除不带日期的）
  if (file.dateTaken) {
    score += 5;
  } else {
    score -= 3;
  }

  // 规则3: 在 MemBook照片整理 目录下
  if (path.includes('MemBook照片整理') || path.includes('Photos') || path.includes('photos')) {
    score += 3;
  }

  // 规则4-5: 副本命名判定
  const name = file.name.toLowerCase();
  const isCopy = COPY_PATTERNS.some((p) => name.includes(p));
  if (!isCopy) {
    score += 2;
  } else {
    score -= 2;
  }

  // 规则6: 路径深度浅（层级少更可能是原始位置）
  const depth = path.split(/[/\\]/).length;
  if (depth <= 3) score += 1;

  // 规则7: 文件较大（visual 组内可能不同大小，大文件更接近原始）
  if (groupMaxSize && file.size > 0) {
    if (file.size >= groupMaxSize * 0.95) score += 1;
  }

  // 规则8: 有 GPS 信息（完整元数据更可能是原始文件）
  if (file.gpsLon !== undefined && file.gpsLat !== undefined) {
    score += 1;
  }

  return score;
}

// ── 核心去重流程 ─────────────────────────────────────────

export interface DedupeOptions {
  /** 进度回调 */
  onProgress?: (progress: ToolProgress) => void;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 是否启用感知哈希（视觉相似匹配），默认 true。
   *  关闭可加速纯字节级去重场景（如已确认无衍生文件）。 */
  enableVisual?: boolean;
  /** pHash 汉明距离阈值，≤ 该值视为视觉重复。默认 5。
   *  0 = 要求 pHash 完全相同；10 = 允许轻微裁剪/旋转。 */
  phashThreshold?: number;
}

/**
 * 执行四级去重（SHA256 精确匹配 + pHash 视觉相似匹配）
 *
 * @param photos - 已扫描的照片列表
 * @param options - 配置选项
 * @returns 去重结果
 */
export async function deduplicatePhotos(
  photos: PhotoFileInfo[],
  options: DedupeOptions = {},
): Promise<DedupeResult> {
  const { onProgress, signal } = options;
  const enableVisual = options.enableVisual !== false;
  const phashThreshold = options.phashThreshold ?? DEFAULT_PHASH_THRESHOLD;

  // ══ Phase 1: 按文件大小分组（精确匹配快路径） ══
  onProgress?.({ phase: 'size-grouping', current: 0, total: photos.length, message: '按文件大小分组...' });
  const sizeGroups = new Map<number, PhotoFileInfo[]>();
  for (const p of photos) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const group = sizeGroups.get(p.size) ?? [];
    group.push(p);
    sizeGroups.set(p.size, group);
  }

  // 排除只有 1 个文件的组（不可能重复）
  const candidateGroups = [...sizeGroups.values()].filter((g) => g.length > 1);
  const candidates = candidateGroups.flat();

  onProgress?.({
    phase: 'size-grouping',
    current: photos.length,
    total: photos.length,
    message: `大小分组完成：${candidates.length} 个候选文件需进一步检查`,
  });

  // 记录所有已在精确组中的文件 ID（Phase 4 跳过这些）
  const exactMatchedIds = new Set<string>();

  if (candidates.length === 0) {
    // 无精确候选，但仍可能存在视觉重复，跳过 Phase 2-3 直接进入 Phase 4
    if (!enableVisual) {
      return { totalGroups: 0, totalFiles: 0, duplicateCount: 0, freedBytes: 0, groups: [], exactGroups: 0, visualGroups: 0 };
    }
    const visualResult = await runVisualPhase(photos, new Set<string>(), phashThreshold, onProgress, signal, new Map());
    return {
      totalGroups: visualResult.groups.length,
      totalFiles: visualResult.groups.reduce((s, g) => s + g.files.length, 0),
      duplicateCount: visualResult.duplicateCount,
      freedBytes: visualResult.freedBytes,
      groups: visualResult.groups,
      exactGroups: 0,
      visualGroups: visualResult.groups.length,
    };
  }

  // ══ Phase 2: 文件头哈希预筛（并发读取） ══
  onProgress?.({ phase: 'head-hash', current: 0, total: candidates.length, message: '计算文件头哈希...' });
  const headHashGroups = new Map<string, PhotoFileInfo[]>();

  await mapWithConcurrency(
    candidates,
    async (p) => {
      try {
        const { data } = await readPhotoData(p, HEAD_SIZE);
        const headHash = await sha256(data);
        const group = headHashGroups.get(headHash) ?? [];
        group.push(p);
        headHashGroups.set(headHash, group);
      } catch (err) {
        logger.warn(`[dedupe] 无法读取文件头 ${p.name}:`, err);
        headHashGroups.set(`unreadable-${p.id}`, [p]);
      }
    },
    8,
    (done, total) => {
      onProgress?.({
        phase: 'head-hash',
        current: done,
        total,
        message: `文件头哈希 ${done}/${total}`,
      });
    },
    signal,
  );

  const headCandidates = [...headHashGroups.values()].filter((g) => g.length > 1).flat();
  onProgress?.({
    phase: 'head-hash',
    current: candidates.length,
    total: candidates.length,
    message: `头部预筛完成：${headCandidates.length} 个候选进入全量哈希`,
  });

  if (headCandidates.length === 0) {
    // 无精确匹配候选
    if (!enableVisual) {
      return { totalGroups: 0, totalFiles: 0, duplicateCount: 0, freedBytes: 0, groups: [], exactGroups: 0, visualGroups: 0 };
    }
    const visualResult = await runVisualPhase(photos, exactMatchedIds, phashThreshold, onProgress, signal, new Map());
    return {
      totalGroups: visualResult.groups.length,
      totalFiles: visualResult.groups.reduce((s, g) => s + g.files.length, 0),
      duplicateCount: visualResult.duplicateCount,
      freedBytes: visualResult.freedBytes,
      groups: visualResult.groups,
      exactGroups: 0,
      visualGroups: visualResult.groups.length,
    };
  }

  // ══ Phase 3: 全量 SHA256（精确匹配，并发读取 + 缓存数据供 Phase 4 复用） ══
  onProgress?.({ phase: 'full-hash', current: 0, total: headCandidates.length, message: '计算完整 SHA256 哈希...' });
  const fullHashGroups = new Map<string, PhotoFileInfo[]>();
  // 缓存 Phase 3 读取的完整文件数据，供 Phase 4 pHash 复用，避免重复读取
  const fullDataCache = new Map<string, ArrayBuffer>();

  await mapWithConcurrency(
    headCandidates,
    async (p) => {
      try {
        const { data } = await readPhotoData(p);
        fullDataCache.set(p.id, data);
        const fullHash = await sha256(data);
        const group = fullHashGroups.get(fullHash) ?? [];
        group.push(p);
        fullHashGroups.set(fullHash, group);
      } catch (err) {
        logger.warn(`[dedupe] 全量哈希失败 ${p.name}:`, err);
      }
    },
    8,
    (done, total) => {
      onProgress?.({
        phase: 'full-hash',
        current: done,
        total,
        message: `全量哈希 ${done}/${total}`,
      });
    },
    signal,
  );

  // 构建精确匹配组
  const exactGroups: DedupeGroup[] = [];
  let exactDuplicateCount = 0;
  let exactFreedBytes = 0;

  for (const [hashFull, files] of fullHashGroups) {
    if (files.length < 2) continue;

    const maxSize = Math.max(...files.map((f) => f.size));
    // 找到保留优先级最高的文件
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < files.length; j++) {
      const s = computeKeepScore(files[j], maxSize);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = j;
      }
    }

    exactGroups.push({
      groupId: `exact-${exactGroups.length + 1}`,
      hashShort: hashFull.slice(0, 16),
      hashFull,
      files,
      keepIndex: bestIdx,
      fileSize: files[0].size,
      similarity: 'exact',
      distance: 0,
    });

    // 标记已匹配文件，Phase 4 跳过
    for (const f of files) exactMatchedIds.add(f.id);

    exactDuplicateCount += files.length - 1;
    exactFreedBytes += files[0].size * (files.length - 1);
  }

  // ══ Phase 4: 感知哈希（视觉相似匹配） ══
  let visualGroups: DedupeGroup[] = [];
  let visualDuplicateCount = 0;
  let visualFreedBytes = 0;

  if (enableVisual) {
    const visualResult = await runVisualPhase(
      photos,
      exactMatchedIds,
      phashThreshold,
      onProgress,
      signal,
      fullDataCache,
    );
    visualGroups = visualResult.groups ?? [];
    visualDuplicateCount = visualResult.duplicateCount ?? 0;
    visualFreedBytes = visualResult.freedBytes ?? 0;
  }

  // 合并结果
  const allGroups = [...exactGroups, ...visualGroups];
  const totalFilesInGroups = allGroups.reduce((sum, g) => sum + g.files.length, 0);

  onProgress?.({
    phase: 'done',
    current: 1,
    total: 1,
    message: `发现 ${exactGroups.length} 组精确重复 + ${visualGroups.length} 组视觉相似，共 ${exactDuplicateCount + visualDuplicateCount} 个重复文件`,
  });

  return {
    totalGroups: allGroups.length,
    totalFiles: totalFilesInGroups,
    duplicateCount: exactDuplicateCount + visualDuplicateCount,
    freedBytes: exactFreedBytes + visualFreedBytes,
    groups: allGroups,
    exactGroups: exactGroups.length,
    visualGroups: visualGroups.length,
  };
}

/**
 * Phase 4: 感知哈希视觉相似匹配
 *
 * 对未在精确匹配阶段命中的文件计算 pHash，按汉明距离分组。
 * 使用并查集（Union-Find）处理传递性相似：A≈B, B≈C → A,B,C 同组。
 *
 * 性能优化：
 * 1. 并发读取文件（8 worker），复用 Phase 3 缓存的完整文件数据避免重复读取
 * 2. LSH（Locality-Sensitive Hashing）加速桶间比较：
 *    将 64 位 pHash 拆分为 (threshold+1) 个子串，鸽巢原理保证：
 *    若两 hash 汉明距离 ≤ threshold，至少一个子串完全相同。
 *    仅对共享某子串的 hash 对计算汉明距离，将 O(M²) 降至近线性。
 *    数学上保证零假阴性（不会漏掉任何真实重复对）。
 *
 * @param allPhotos 全部照片
 * @param excludedIds 已在精确组中的文件 ID（跳过，避免重复判定）
 * @param threshold 汉明距离阈值
 * @param fullDataCache Phase 3 缓存的完整文件数据（photoId → ArrayBuffer），避免重复读取
 */
async function runVisualPhase(
  allPhotos: PhotoFileInfo[],
  excludedIds: Set<string>,
  threshold: number,
  onProgress?: (p: ToolProgress) => void,
  signal?: AbortSignal,
  fullDataCache?: Map<string, ArrayBuffer>,
): Promise<{ groups: DedupeGroup[]; duplicateCount: number; freedBytes: number }> {
  // 候选文件：未在精确组中的
  const candidates = allPhotos.filter((p) => !excludedIds.has(p.id));

  if (candidates.length < 2) {
    onProgress?.({ phase: 'phash', current: 0, total: 0, message: '无视觉相似候选' });
    return { groups: [], duplicateCount: 0, freedBytes: 0 };
  }

  // ── 计算每个候选文件的 pHash（并发，复用 Phase 3 缓存数据） ──
  onProgress?.({ phase: 'phash', current: 0, total: candidates.length, message: '计算感知哈希 (pHash)...' });
  const phashMap = new Map<string, string>(); // photoId → pHash

  await mapWithConcurrency(
    candidates,
    async (p) => {
      try {
        // 优先使用 Phase 3 缓存的完整数据，避免重复读取
        let data: ArrayBuffer | null = fullDataCache?.get(p.id) ?? null;
        if (!data) {
          const result = await readPhotoData(p);
          data = result.data;
        }
        const phash = await computePHash(data);
        if (phash) {
          phashMap.set(p.id, phash);
        }
      } catch (err) {
        logger.warn(`[dedupe] pHash 计算失败 ${p.name}:`, err);
      }
    },
    8,
    (done, total) => {
      onProgress?.({
        phase: 'phash',
        current: done,
        total,
        message: `感知哈希 ${done}/${total}`,
      });
    },
    signal,
  );

  // 按 pHash 分桶：完全相同的 pHash（距离 0）直接同组
  const phashBuckets = new Map<string, PhotoFileInfo[]>();
  for (const p of candidates) {
    const phash = phashMap.get(p.id);
    if (!phash) continue;
    const bucket = phashBuckets.get(phash) ?? [];
    bucket.push(p);
    phashBuckets.set(phash, bucket);
  }

  const uniqueHashes = [...phashBuckets.keys()];
  const photoById = new Map<string, PhotoFileInfo>();
  for (const p of candidates) {
    if (phashMap.has(p.id)) photoById.set(p.id, p);
  }

  // 并查集：每个 photoId 初始自成一派
  const parent = new Map<string, string>();
  for (const id of photoById.keys()) parent.set(id, id);
  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // 先合并 pHash 完全相同的桶
  for (const [, bucketPhotos] of phashBuckets) {
    for (let i = 1; i < bucketPhotos.length; i++) {
      union(bucketPhotos[0].id, bucketPhotos[i].id);
    }
  }

  // ── LSH 加速桶间比较（零假阴性保证） ──
  // 将 16 字符 hex pHash 拆分为 (threshold+1) 个子串
  // 鸽巢原理：若两 hash 差异位数 ≤ threshold，至少一个子串完全相同
  // 仅对共享某子串的 hash 对计算汉明距离，O(M²) → 近 O(M·k)
  const numLshChunks = Math.min(threshold + 1, 16);
  const useLsh = numLshChunks >= 2 && uniqueHashes.length > 1;

  if (useLsh) {
    // 计算各 LSH chunk 的边界 [start, end)
    const chunkLen = Math.floor(16 / numLshChunks);
    const remainder = 16 % numLshChunks;
    const chunkBoundaries: Array<[number, number]> = [];
    let pos = 0;
    for (let i = 0; i < numLshChunks; i++) {
      const size = chunkLen + (i < remainder ? 1 : 0);
      if (size > 0) {
        chunkBoundaries.push([pos, pos + size]);
        pos += size;
      }
    }

    // 为每个 chunk 索引建倒排表 Map<chunkKey, hashIndex[]>
    const lshIndexes: Array<Map<string, number[]>> = chunkBoundaries.map(() => new Map());
    for (let idx = 0; idx < uniqueHashes.length; idx++) {
      const h = uniqueHashes[idx];
      for (let c = 0; c < chunkBoundaries.length; c++) {
        const [start, end] = chunkBoundaries[c];
        const key = h.slice(start, end);
        const map = lshIndexes[c];
        const arr = map.get(key) ?? [];
        arr.push(idx);
        map.set(key, arr);
      }
    }

    // 遍历每个 hash，通过 LSH 找候选对，仅对候选对计算汉明距离
    const compared = new Set<string>(); // "minIdx,maxIdx" 去重
    for (let idx = 0; idx < uniqueHashes.length; idx++) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const h = uniqueHashes[idx];
      for (let c = 0; c < chunkBoundaries.length; c++) {
        const [start, end] = chunkBoundaries[c];
        const key = h.slice(start, end);
        const arr = lshIndexes[c].get(key);
        if (!arr) continue;
        for (const otherIdx of arr) {
          if (otherIdx <= idx) continue;
          const pairKey = `${idx},${otherIdx}`;
          if (compared.has(pairKey)) continue;
          compared.add(pairKey);
          const dist = hammingDistance(h, uniqueHashes[otherIdx]);
          if (dist <= threshold) {
            union(
              phashBuckets.get(uniqueHashes[idx])![0].id,
              phashBuckets.get(uniqueHashes[otherIdx])![0].id,
            );
          }
        }
      }
      // 定期报告进度（避免比对阶段 UI 假死）
      if ((idx + 1) % 50 === 0 || idx === uniqueHashes.length - 1) {
        onProgress?.({
          phase: 'phash',
          current: idx + 1,
          total: uniqueHashes.length,
          message: `相似度比对 ${idx + 1}/${uniqueHashes.length}（LSH 候选 ${compared.size} 对）`,
        });
      }
    }
  } else {
    // Fallback: O(M²) 全比较（threshold 过大或候选过少时）
    const bucketList = uniqueHashes.map((h) => ({ hash: h, photos: phashBuckets.get(h)! }));
    for (let i = 0; i < bucketList.length; i++) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      for (let j = i + 1; j < bucketList.length; j++) {
        const dist = hammingDistance(bucketList[i].hash, bucketList[j].hash);
        if (dist <= threshold) {
          union(bucketList[i].photos[0].id, bucketList[j].photos[0].id);
        }
      }
      if ((i + 1) % 50 === 0 || i === bucketList.length - 1) {
        onProgress?.({
          phase: 'phash',
          current: i + 1,
          total: bucketList.length,
          message: `相似度比对 ${i + 1}/${bucketList.length}`,
        });
      }
    }
  }

  // 按并查集根节点收集组
  const ufGroups = new Map<string, string[]>();
  for (const id of photoById.keys()) {
    const root = find(id);
    const group = ufGroups.get(root) ?? [];
    group.push(id);
    ufGroups.set(root, group);
  }

  // 构建视觉重复组（仅保留 ≥ 2 个文件的组）
  const visualGroups: DedupeGroup[] = [];
  let visualDuplicateCount = 0;
  let visualFreedBytes = 0;

  for (const [, ids] of ufGroups) {
    if (ids.length < 2) continue;

    const files = ids.map((id) => photoById.get(id)!);

    // 计算组内最大距离用于展示
    let maxDist = 0;
    if (files.length >= 2) {
      const baseHash = phashMap.get(files[0].id)!;
      for (let i = 1; i < files.length; i++) {
        const h = phashMap.get(files[i].id)!;
        const d = hammingDistance(baseHash, h);
        if (d > maxDist) maxDist = d;
      }
    }

    const maxSize = Math.max(...files.map((f) => f.size));
    // 找到保留优先级最高的文件
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < files.length; j++) {
      const s = computeKeepScore(files[j], maxSize);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = j;
      }
    }

    // 用首个文件的 pHash 作为组标识
    const representativeHash = phashMap.get(files[0].id) || '';

    visualGroups.push({
      groupId: `visual-${visualGroups.length + 1}`,
      hashShort: representativeHash.slice(0, 16),
      hashFull: representativeHash,
      files,
      keepIndex: bestIdx,
      fileSize: files[0].size,
      similarity: 'visual',
      distance: maxDist,
    });

    // 视觉组的释放空间按各文件实际大小计算（组内大小可能不同）
    for (let i = 0; i < files.length; i++) {
      if (i !== bestIdx) {
        visualFreedBytes += files[i].size;
      }
    }
    visualDuplicateCount += files.length - 1;
  }

  onProgress?.({
    phase: 'phash-done',
    current: candidates.length,
    total: candidates.length,
    message: `视觉相似匹配完成：${visualGroups.length} 组视觉重复`,
  });

  return {
    groups: visualGroups,
    duplicateCount: visualDuplicateCount,
    freedBytes: visualFreedBytes,
  };
}

/**
 * 格式化字节大小为人类可读字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
