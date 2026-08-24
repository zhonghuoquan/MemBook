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

import type { PhotoFileInfo, DedupeGroup, DedupeResult, ToolProgress, SimilarGroup } from './types';
import { logger } from '../utils/logger';
import { hammingDistance, DEFAULT_PHASH_THRESHOLD, PHASH_BITS } from './perceptual-hash';
import { computePHashSafe } from './phash-pool';
import { mapWithConcurrency, yieldToMain } from './async-utils';

/** 头部预筛读取字节数 (4KB) */
const HEAD_SIZE = 4096;

/**
 * 二次质检拆组的单轮扫描上限：限定每轮最多与此数量的候选做距离比较，
 * 避免单组上万张时 O(n²) 卡死，剩余候选转为独立子组。同时约束后续
 * 组内两两距离计算（≤ 限值 + 1）的量级。
 */
const SPLIT_SCAN_LIMIT = 300;

/**
 * 多轮随机桶投影（随机 LSH）参数：
 * pHash 为 64 位。旧实现把 64 位切成多段 4bit 小块 + 鸽巢原理，桶容量 ≈ M/16，
 * 2 万张时候选对退化到 O(M²)=4 亿级，导致内存/时间爆炸而"中途消失无结果"。
 * 本方案：每轮随机抽取 LSH_PROJ_BITS 个 bit 位拼成桶 key（桶容量 ≈ M/2^PROJ_BITS，
 * 缩小成百倍），LSH_ROUNDS 轮多表 + 桶内精确 hamming 验证来补召回（少许漏检、可接受），
 * 单桶候选再用 LSH_SAMPLE_MAX 采样上限，防极端连拍桶把单点拖垮。
 */
const LSH_ROUNDS = 8;
const LSH_PROJ_BITS = 12;
const LSH_SAMPLE_MAX = 64;

/** 确定性伪随机（固定种子，保证同批结果稳定可复现） */
function createDeterministicRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 生成 LSH_ROUNDS×LSH_PROJ_BITS 个投影位下标（0..PHASH_BITS-1） */
function buildProjectionBits(): number[] {
  const rand = createDeterministicRandom(0x5eed);
  const bits: number[] = [];
  for (let i = 0; i < LSH_ROUNDS * LSH_PROJ_BITS; i++) {
    bits.push(Math.floor(rand() * PHASH_BITS));
  }
  return bits;
}

/**
 * 多轮随机桶投影：构建 LSH_ROUNDS 张哈希表，哈希值落入对应桶，返回候选对并回调 compare。
 * 相比旧 4bit 小块 LSH，将候选对从 O(M²) 降至可控量级，并按批让出主线程，避免 2 万张卡死。
 *
 * @param uniqueHashes 去重后的 pHash 十六进制串数组
 * @param compare 对候选对 (i,j) 做精确 hamming 判定并合并
 */
async function runRandomProjectionCompare(
  uniqueHashes: string[],
  compare: (i: number, j: number) => void,
  onBatch?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const COMPARE_BATCH = 200;
  const hashBig: bigint[] = uniqueHashes.map((h) => BigInt(`0x${h}`));
  const projBits = buildProjectionBits();

  // 建表：tables[r] = Map<桶key, hash下标[]>
  const tables: Array<Map<number, number[]>> = [];
  for (let r = 0; r < LSH_ROUNDS; r++) tables.push(new Map());
  for (let idx = 0; idx < hashBig.length; idx++) {
    const hb = hashBig[idx];
    for (let r = 0; r < LSH_ROUNDS; r++) {
      let key = 0;
      const base = r * LSH_PROJ_BITS;
      for (let b = 0; b < LSH_PROJ_BITS; b++) {
        key = (key << 1) | Number((hb >> BigInt(projBits[base + b])) & 1n);
      }
      const arr = tables[r].get(key) ?? [];
      arr.push(idx);
      tables[r].set(key, arr);
    }
  }

  const compared = new Set<string>(); // "minIdx,maxIdx" 去重，多表间避免重复计算
  for (let b0 = 0; b0 < uniqueHashes.length; b0 += COMPARE_BATCH) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const bEnd = Math.min(b0 + COMPARE_BATCH, uniqueHashes.length);
    for (let idx = b0; idx < bEnd; idx++) {
      const hb = hashBig[idx];
      for (let r = 0; r < LSH_ROUNDS; r++) {
        let key = 0;
        const base = r * LSH_PROJ_BITS;
        for (let b = 0; b < LSH_PROJ_BITS; b++) {
          key = (key << 1) | Number((hb >> BigInt(projBits[base + b])) & 1n);
        }
        const arr = tables[r].get(key);
        if (!arr) continue;
        // 单桶采样上限：只与紧随 idx 之后的 LSH_SAMPLE_MAX 个候选比较，
        // 防极端连拍桶把单轮拖垮；跨多轮不同投影互补召回（少许漏检可接受）。
        let considered = 0;
        for (const otherIdx of arr) {
          if (otherIdx <= idx) continue;
          if (considered >= LSH_SAMPLE_MAX) break;
          considered++;
          const pairKey = `${idx},${otherIdx}`;
          if (compared.has(pairKey)) continue;
          compared.add(pairKey);
          compare(idx, otherIdx);
        }
      }
    }
    onBatch?.(bEnd, uniqueHashes.length);
    if (bEnd < uniqueHashes.length) await yieldToMain();
  }
}

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

// 注：mapWithConcurrency 已抽到 async-utils.ts 共享（hash/screenshot/organize 复用）

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
  // 大批量优化：全量读取整张照片字节，内存占用大（单图数 MB × 并发数）。
  // 降低并发数（4）限制峰值内存，避免上万张候选同时驻留内存导致 OOM 卡死；
  // 读取/哈希均为异步 IO（await），主线程可自然让出，UI 保持响应。
  const FULL_HASH_CONCURRENCY = 4;
  onProgress?.({ phase: 'full-hash', current: 0, total: headCandidates.length, message: '计算完整 SHA256 哈希...' });
  const fullHashGroups = new Map<string, PhotoFileInfo[]>();
  // 缓存 Phase 3 读取的完整文件数据，供 Phase 4 pHash 复用，避免重复读取
  // 使用 LRU 限制缓存上限（200 项，约 200MB 假设单图 1MB），防止 OOM
  const FULL_CACHE_MAX = 200;
  const fullDataCache = new Map<string, ArrayBuffer>();
  function setFullDataCache(id: string, data: ArrayBuffer): void {
    if (fullDataCache.size >= FULL_CACHE_MAX) {
      // 淘汰最旧条目
      const firstKey = fullDataCache.keys().next().value;
      if (firstKey !== undefined) fullDataCache.delete(firstKey);
    }
    fullDataCache.set(id, data);
  }

  await mapWithConcurrency(
    headCandidates,
    async (p) => {
      try {
        const { data } = await readPhotoData(p);
        setFullDataCache(p.id, data);
        const fullHash = await sha256(data);
        const group = fullHashGroups.get(fullHash) ?? [];
        group.push(p);
        fullHashGroups.set(fullHash, group);
      } catch (err) {
        logger.warn(`[dedupe] 全量哈希失败 ${p.name}:`, err);
      }
    },
    FULL_HASH_CONCURRENCY,
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

    const maxSize = files.reduce((max, f) => Math.max(max, f.size), -Infinity);
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

  // Phase 4 完成后释放 fullDataCache 内存
  fullDataCache.clear();

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
        const phash = await computePHashSafe(data);
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
    // 多轮随机桶投影：候选对从 O(M²) 降至可控量级（防 2 万张时候选对爆炸"中途消失"）。
    // 鸽巢原理保证被旧 4bit 小块 LSH 覆盖的代表查不遗漏，这里以少量漏检换取速度（去重阈小，召回足）。
    await runRandomProjectionCompare(
      uniqueHashes,
      (i, j) => {
        const dist = hammingDistance(uniqueHashes[i], uniqueHashes[j]);
        if (dist <= threshold) {
          union(
            phashBuckets.get(uniqueHashes[i])![0].id,
            phashBuckets.get(uniqueHashes[j])![0].id,
          );
        }
      },
      (done) =>
        onProgress?.({
          phase: 'phash',
          current: done,
          total: uniqueHashes.length,
          message: `相似度比对 ${done}/${uniqueHashes.length}（LSH 候选）`,
        }),
      signal,
    );
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

    const maxSize = files.reduce((max, f) => Math.max(max, f.size), -Infinity);
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

// ══════════════════════════════════════════════════════════
// 功能5：相似照片聚类（非精确重复，pHash 距离 6-15）
// ══════════════════════════════════════════════════════════

export interface FindSimilarOptions {
  /** 进度回调 */
  onProgress?: (progress: ToolProgress) => void;
  /** 中止信号 */
  signal?: AbortSignal;
  /** pHash 距离下限（> 该值才视为"相似"而非"重复"），默认 6 */
  minDistance?: number;
  /** pHash 距离上限（≤ 该值视为相似），默认 15 */
  maxDistance?: number;
  /** 读取照片数据 */
  readData?: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /**
   * 失败统计回调：单张照片读取/解码失败（无法计算 pHash）时累计，
   * 分析不中断，完成后通过 onFailure(failedCount) 告知调用方。
   */
  onFailure?: (failedCount: number) => void;
}

/**
 * 查找相似照片（非精确重复）
 *
 * 与 deduplicatePhotos 的区别：
 * - deduplicatePhotos 找 pHash 距离 ≤ 5 的视觉重复
 * - findSimilarPhotos 找 pHash 距离 6-15 的相似照片（连拍/同场景）
 *
 * 相似组只展示不自动标记删除，用户手动选择。
 *
 * 算法：
 * 1. 并发计算所有照片的 pHash
 * 2. LSH 加速桶间比对（鸽巢原理，零假阴性）
 * 3. 并查集合并相似组
 * 4. computeKeepScore 选最佳保留项
 */
export async function findSimilarPhotos(
  photos: PhotoFileInfo[],
  options: FindSimilarOptions = {},
): Promise<SimilarGroup[]> {
  const { onProgress, signal, onFailure } = options;
  const minDist = options.minDistance ?? 6;
  const maxDist = options.maxDistance ?? 15;
  const readData = options.readData;

  if (photos.length < 2) return [];
  if (!readData) {
    logger.warn('[findSimilar] 缺少 readData，无法计算 pHash');
    return [];
  }

  // ── 计算所有照片的 pHash ──
  onProgress?.({ phase: 'phash', current: 0, total: photos.length, message: '计算感知哈希...' });
  const phashMap = new Map<string, string>(); // photoId → pHash
  const photoById = new Map<string, PhotoFileInfo>();

  let doneCount = 0;
  let failedCount = 0; // 读取/解码失败的张数（跳过不中断）
  await mapWithConcurrency(
    photos,
    async (p) => {
      if (signal?.aborted) return;
      try {
        const data = await readData(p);
        if (data) {
          const phash = await computePHashSafe(data);
          if (phash) {
            phashMap.set(p.id, phash);
            photoById.set(p.id, p);
          } else {
            failedCount++; // 解码失败，phash 为空 → 视为失败跳过
          }
        } else {
          failedCount++; // 读取失败，无数据 → 视为失败跳过
        }
      } catch (err) {
        failedCount++; // 读取异常 → 视为失败跳过
        logger.warn(`[findSimilar] pHash 计算失败 ${p.name}:`, err);
      }
      doneCount++;
      onProgress?.({ phase: 'phash', current: doneCount, total: photos.length, message: `感知哈希 ${doneCount}/${photos.length}` });
    },
    8,
    undefined,
    signal,
  );

  const uniqueHashes = [...new Set(phashMap.values())];
  const hashToPhotos = new Map<string, PhotoFileInfo[]>();
  for (const p of photos) {
    const h = phashMap.get(p.id);
    if (!h) continue;
    const arr = hashToPhotos.get(h) ?? [];
    arr.push(p);
    hashToPhotos.set(h, arr);
  }

  if (uniqueHashes.length < 2) return [];

  // ── 并查集 ──
  const parent = new Map<string, string>();
  for (const id of photoById.keys()) parent.set(id, id);
  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) { const n = parent.get(cur)!; parent.set(cur, root); cur = n; }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // ── LSH 加速桶间比较 ──
  // 鸽巢原理：若两 hash 差异位数 ≤ maxDist，至少一个子串完全相同
  const numLshChunks = Math.min(maxDist + 1, 16);
  const useLsh = numLshChunks >= 2 && uniqueHashes.length > 1;

  // 大批量比对批大小与进度回调（LSH / O(M²) 回退共用）
  const COMPARE_BATCH = 200;
  const updateCompareProgress = (done: number) => {
    onProgress?.({ phase: 'compare', current: done, total: uniqueHashes.length, message: `相似度比对 ${done}/${uniqueHashes.length}` });
  };

  if (useLsh) {
    // 多轮随机桶投影：解决 2 万张时候选对 O(M²) 爆炸导致"进度条中途消失无结果"。
    // 以少量漏检（少许漏检可接受）换取速度，批间让出主线程保证 UI 响应。
    await runRandomProjectionCompare(
      uniqueHashes,
      (i, j) => {
        const dist = hammingDistance(uniqueHashes[i], uniqueHashes[j]);
        // 相似但不重复：距离在 (minDist, maxDist] 范围内
        if (dist > minDist && dist <= maxDist) {
          const idA = hashToPhotos.get(uniqueHashes[i])![0].id;
          const idB = hashToPhotos.get(uniqueHashes[j])![0].id;
          union(idA, idB);
        }
      },
      (done) => updateCompareProgress(done),
      signal,
    );
  } else {
    // Fallback: O(M²) 全比较（也按批处理让出主线程）
    for (let b0 = 0; b0 < uniqueHashes.length; b0 += COMPARE_BATCH) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const bEnd = Math.min(b0 + COMPARE_BATCH, uniqueHashes.length);
      for (let i = b0; i < bEnd; i++) {
        for (let j = i + 1; j < uniqueHashes.length; j++) {
          const dist = hammingDistance(uniqueHashes[i], uniqueHashes[j]);
          if (dist > minDist && dist <= maxDist) {
            const idA = hashToPhotos.get(uniqueHashes[i])![0].id;
            const idB = hashToPhotos.get(uniqueHashes[j])![0].id;
            union(idA, idB);
          }
        }
      }
      updateCompareProgress(bEnd);
      if (bEnd < uniqueHashes.length) await yieldToMain();
    }
  }

  // ── 收集相似组 ──
  const ufGroups = new Map<string, string[]>();
  for (const id of photoById.keys()) {
    const root = find(id);
    const group = ufGroups.get(root) ?? [];
    group.push(id);
    ufGroups.set(root, group);
  }

  /**
   * 二次质检拆组：并查集通过传递性合并（A≈B、B≈C → A、B、C 同组），
   * 但 A 与 C 的 pHash 距离可能远超 maxDist（链式蔓延）。
   * 对每组按"与基准成员距离 ≤ maxDist"贪心拆分，保证组内任意成员与基准的差异在合理范围。
   *
   * 性能保护：单组上万张（同场景连拍大量聚组）时，朴素实现每轮与剩余全部
   * 两两比会退化 O(n²) 卡死。此处限定每轮最多扫描 SPLIT_SCAN_LIMIT 个候选，
   * 剩余部分转为独立子组，整体复杂度 O(n·limit)，避免极端大组拖垮分析。
   */
  async function splitRunawayGroup(ids: string[]): Promise<string[][]> {
    const remaining = [...ids];
    const result: string[][] = [];
    // 每轮处理 SPARSE_BATCH 个基准后就 yield 让出主线程，避免上万张的逐轮扫描冻结 UI
    let batchDone = 0;
    while (remaining.length > 0) {
      const base = remaining.shift()!;
      const group: string[] = [base];
      const rest: string[] = [];
      // 只与"候选样本"比较：大组时采样前 SPLIT_SCAN_LIMIT 个，其余直接留待下轮
      const scanCount = Math.min(remaining.length, SPLIT_SCAN_LIMIT);
      for (let i = 0; i < scanCount; i++) {
        const id = remaining[i];
        const d = hammingDistance(phashMap.get(base)!, phashMap.get(id)!);
        if (d <= maxDist) group.push(id);
        else rest.push(id);
      }
      for (let i = scanCount; i < remaining.length; i++) {
        rest.push(remaining[i]);
      }
      result.push(group);
      remaining.length = 0;
      for (const id of rest) remaining.push(id);
      batchDone++;
      // 每处理 COMPARE_BATCH 个基准让出一次主线程
      if (batchDone % COMPARE_BATCH === 0 && remaining.length > 0) await yieldToMain();
    }
    return result;
  }

  // 构建相似组（仅保留 ≥ 2 个文件的组）
  const similarGroups: SimilarGroup[] = [];
  let groupCounter = 0;
  for (const [, ids] of ufGroups) {
    if (ids.length < 2) continue;
    // 二次质检：拆掉链式蔓延的组（组内可能出现差异过大的照片）
    for (const subIds of await splitRunawayGroup(ids)) {
      if (subIds.length < 2) continue;
      const groupPhotos = subIds.map((id) => photoById.get(id)!);

      // 计算组内两两距离（直接用 pHash 全量计算，覆盖间接合并的成员对）
      // 超大相似组（同场景连拍上万张）时按行分批计算并让出主线程，避免 O(n²) 同步卡死
      let maxDistInGroup = 0;
      let sumDist = 0;
      let distCount = 0;
      for (let i0 = 0; i0 < subIds.length; i0 += COMPARE_BATCH) {
        const iEnd = Math.min(i0 + COMPARE_BATCH, subIds.length);
        for (let i = i0; i < iEnd; i++) {
          for (let j = i + 1; j < subIds.length; j++) {
            const d = hammingDistance(phashMap.get(subIds[i])!, phashMap.get(subIds[j])!);
            if (d > maxDistInGroup) maxDistInGroup = d;
            sumDist += d;
            distCount++;
          }
        }
        // 非最终行时让出主线程，保持 UI 响应与进度刷新
        if (iEnd < subIds.length) await yieldToMain();
      }

      // 选最佳保留项（复用 computeKeepScore 逻辑）
      let bestIdx = 0;
      let bestScore = -Infinity;
      const maxFileSize = groupPhotos.reduce((max, p) => Math.max(max, p.size), -Infinity);
      for (let i = 0; i < groupPhotos.length; i++) {
        const score = computeKeepScore(groupPhotos[i], maxFileSize);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      similarGroups.push({
        groupId: `similar-${groupCounter++}`,
        files: groupPhotos,
        keepIndex: bestIdx,
        maxDistance: maxDistInGroup,
        avgDistance: distCount > 0 ? sumDist / distCount : 0,
      });
    }
  }

  onProgress?.({ phase: 'done', current: similarGroups.length, total: similarGroups.length, message: `找到 ${similarGroups.length} 组相似照片` });
  if (failedCount > 0) onFailure?.(failedCount);
  return similarGroups;
}
