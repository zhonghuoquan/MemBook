/**
 * 三级哈希去重引擎
 *
 * 优化策略（移植自 Python 脚本 2-清理重复文件.py）：
 * 1. 按文件大小分组 → 大小不同必不重复，直接排除
 * 2. 文件头 (前 4KB) 哈希预筛 → 快速排除大部分不重复的
 * 3. 全量 SHA256 → 最终精确判定
 *
 * 支持两种输入：
 * - File / Blob 对象（库内模式）
 * - 文件路径字符串（Tauri 桌面端模式，通过 plugin-fs 读取）
 */

import type { PhotoFileInfo, DedupeGroup, DedupeResult, ToolProgress } from './types';
import { logger } from '../utils/logger';

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

// ── 保留优先级评分 ────────────────────────────────────────

/**
 * 为去重组中的每个文件计算"保留优先级"分数
 * 分越高越应该保留（与 Python 脚本逻辑对齐）
 *
 * 规则：
 * 1. 在 "MemBook照片整理/" 目录下 → +3
 * 2. 有 EXIF 日期 → +2
 * 3. 文件名不含副本标记 ((1), _copy 等) → +1
 * 4. 路径深度较浅 → +1
 */
function computeKeepScore(file: PhotoFileInfo): number {
  let score = 0;

  const path = file.relativePath || file.path || file.name;

  // 规则1: 在 MemBook照片整理 目录下
  if (path.includes('MemBook照片整理') || path.includes('Photos') || path.includes('photos')) {
    score += 3;
  }

  // 规则2: 有 EXIF 日期
  if (file.dateTaken) {
    score += 2;
  }

  // 规则3: 非副本命名
  const name = file.name.toLowerCase();
  const copyPatterns = ['(1)', '(2)', '_copy', '副本', ' copy', '-copy', '_1.', '-1.'];
  const isCopy = copyPatterns.some((p) => name.includes(p));
  if (!isCopy) {
    score += 1;
  }

  // 规则4: 路径深度浅（层级少更可能是原始位置）
  const depth = path.split(/[/\\]/).length;
  if (depth <= 3) score += 1;

  return score;
}

// ── 核心去重流程 ─────────────────────────────────────────

export interface DedupeOptions {
  /** 进度回调 */
  onProgress?: (progress: ToolProgress) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 执行三级哈希去重
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

  // Phase 1: 按文件大小分组
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

  if (candidates.length === 0) {
    return { totalGroups: 0, totalFiles: 0, duplicateCount: 0, freedBytes: 0, groups: [] };
  }

  // Phase 2: 文件头哈希预筛
  onProgress?.({ phase: 'head-hash', current: 0, total: candidates.length, message: '计算文件头哈希...' });
  const headHashGroups = new Map<string, PhotoFileInfo[]>();

  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const p = candidates[i];
    try {
      const { data } = await readPhotoData(p, HEAD_SIZE);
      const headHash = await sha256(data);
      const group = headHashGroups.get(headHash) ?? [];
      group.push(p);
      headHashGroups.set(headHash, group);
    } catch (err) {
      logger.warn(`[dedupe] 无法读取文件头 ${p.name}:`, err);
      // 读不了的单独一组（不会被判重复）
      headHashGroups.set(`unreadable-${p.id}`, [p]);
    }
    onProgress?.({
      phase: 'head-hash',
      current: i + 1,
      total: candidates.length,
      message: `文件头哈希 ${i + 1}/${candidates.length}`,
    });
  }

  const headCandidates = [...headHashGroups.values()].filter((g) => g.length > 1).flat();
  onProgress?.({
    phase: 'head-hash',
    current: candidates.length,
    total: candidates.length,
    message: `头部预筛完成：${headCandidates.length} 个候选进入全量哈希`,
  });

  if (headCandidates.length === 0) {
    return { totalGroups: 0, totalFiles: 0, duplicateCount: 0, freedBytes: 0, groups: [] };
  }

  // Phase 3: 全量 SHA256
  onProgress?.({ phase: 'full-hash', current: 0, total: headCandidates.length, message: '计算完整 SHA256 哈希...' });
  const fullHashGroups = new Map<string, PhotoFileInfo[]>();

  for (let i = 0; i < headCandidates.length; i++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const p = headCandidates[i];
    try {
      const { data } = await readPhotoData(p);
      const fullHash = await sha256(data);
      const group = fullHashGroups.get(fullHash) ?? [];
      group.push(p);
      fullHashGroups.set(fullHash, group);
    } catch (err) {
      logger.warn(`[dedupe] 全量哈希失败 ${p.name}:`, err);
    }
    onProgress?.({
      phase: 'full-hash',
      current: i + 1,
      total: headCandidates.length,
      message: `全量哈希 ${i + 1}/${headCandidates.length}`,
    });
  }

  // 构建最终结果
  const groups: DedupeGroup[] = [];
  let totalDuplicates = 0;
  let freedBytes = 0;

  for (const [hashFull, files] of fullHashGroups) {
    if (files.length < 2) continue;

    // 找到保留优先级最高的文件
    let bestIdx = 0;
    let bestScore = -1;
    for (let j = 0; j < files.length; j++) {
      const s = computeKeepScore(files[j]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = j;
      }
    }

    groups.push({
      groupId: `group-${groups.length + 1}`,
      hashShort: hashFull.slice(0, 16),
      hashFull,
      files,
      keepIndex: bestIdx,
      fileSize: files[0].size,
    });

    totalDuplicates += files.length - 1; // 每组保留 1 个，其余算重复
    freedBytes += files[0].size * (files.length - 1);
  }

  const totalFilesInGroups = groups.reduce((sum, g) => sum + g.files.length, 0);

  onProgress?.({
    phase: 'done',
    current: 1,
    total: 1,
    message: `发现 ${groups.length} 组重复，共 ${totalDuplicates} 个重复文件`,
  });

  return {
    totalGroups: groups.length,
    totalFiles: totalFilesInGroups,
    duplicateCount: totalDuplicates,
    freedBytes,
    groups,
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
