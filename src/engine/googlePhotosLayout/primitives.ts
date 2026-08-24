import type { Photo, PageMarginSettings } from '../../types';
import type { RowTier, TierPattern, JustifiedRow, PhotoScore, SpanGroup, GooglePhotosLayoutRhythm, PageSpec } from './types';

/* ═══════════════════════════════════════
   常量
   ═══════════════════════════════════════ */

export const MAX_ASPECT = 2.8;
export const MIN_ASPECT = 0.35;

/** P0-2: LRU 窗口管理：标记一个模式已用，超出窗口时淘汰最早的 */
const RECENT_PATTERNS_MAX = 5;

/* ═══════════════════════════════════════
   模式元数据与方向分析
   ═══════════════════════════════════════ */

/** 照片方向分布统计 */
function analyzePhotoOrientations(photos: Photo[]) {
  let landscape = 0, portrait = 0, square = 0, panorama = 0;
  let totalAspect = 0;
  for (const p of photos) {
    const a = p.width > 0 && p.height > 0 ? p.width / p.height : 1;
    totalAspect += a;
    if (a >= 2.0) panorama++;
    else if (a >= 1.15) landscape++;
    else if (a < 0.85) portrait++;
    else square++;
  }
  const avgAspect = photos.length > 0 ? totalAspect / photos.length : 1.5;
  const majority = landscape >= portrait ? 'landscape' : 'portrait';
  return { landscape, portrait, square, panorama, avgAspect, majority, count: photos.length };
}

/** 模式特定的 tier 倍率：让不同模式的行高比例拉开 */
function getTierMultiplier(pattern: TierPattern, tier: RowTier): number {
  switch (pattern) {
    case 'highlight': return tier === 'hero' ? 2.0 : tier === 'detail' ? 0.45 : 0.85;
    case 'opening': return tier === 'hero' ? 2.0 : tier === 'detail' ? 0.45 : 0.9;
    case 'panorama-hero': return tier === 'hero' ? 2.0 : tier === 'detail' ? 0.45 : 0.9;
    case 'magazine': return tier === 'hero' ? 1.9 : tier === 'detail' ? 0.45 : 0.85;
    case 'closing': return tier === 'hero' ? 1.9 : tier === 'detail' ? 0.5 : 1.0;
    case 'double-hero': return tier === 'hero' ? 1.8 : tier === 'detail' ? 0.45 : 0.85;
    case 'bold': return tier === 'hero' ? 1.9 : 0.85;
    case 'hero-first': return tier === 'hero' ? 1.8 : tier === 'detail' ? 0.55 : 1.0;
    case 'tail-hero': return tier === 'hero' ? 1.8 : tier === 'detail' ? 0.55 : 1.0;
    case 'hero-tail': return tier === 'hero' ? 1.8 : tier === 'detail' ? 0.5 : 0.9;
    case 'cascade': return tier === 'hero' ? 1.8 : tier === 'detail' ? 0.5 : 1.0;
    case 'diamond': return tier === 'hero' ? 1.7 : tier === 'detail' ? 0.45 : 0.9;
    case 'center-focus': return tier === 'hero' ? 1.7 : tier === 'detail' ? 0.5 : 0.9;
    case 'valley': return tier === 'hero' ? 1.7 : tier === 'detail' ? 0.5 : 0.85;
    case 'wave': return tier === 'hero' ? 1.7 : 0.8;
    case 'filmstrip': return tier === 'hero' ? 1.6 : 0.8;
    case 'all-hero': return 1.6;
    case 'mosaic': return tier === 'hero' ? 1.1 : tier === 'detail' ? 0.45 : 0.75;
    case 'asymmetric': return tier === 'hero' ? 1.7 : tier === 'detail' ? 0.4 : 1.1;
    default: return tier === 'hero' ? 1.5 : tier === 'detail' ? 0.7 : 1.0;
  }
}

/** 哪些模式需要把高光照片固定到特定行 */
export function getHeroPlacement(pattern: TierPattern): 'first' | 'last' | 'center' | 'first-and-last' | 'first-and-second' | 'none' {
  switch (pattern) {
    case 'hero-first':
    case 'highlight':
    case 'opening':
    case 'panorama-hero':
    case 'magazine':
    case 'filmstrip':
      return 'first';
    case 'tail-hero':
    case 'closing':
      return 'last';
    case 'center-focus':
    case 'valley':
      return 'center';
    case 'hero-tail':
    case 'double-hero':
      return 'first-and-last';
    case 'bold':
      return 'first-and-second';
    default:
      return 'none';
  }
}

/** 模式的最低/最高行数要求（部分模式需要至少 2 行） */
export function patternRowConstraints(pattern: TierPattern): { min: number; max?: number } {
  switch (pattern) {
    case 'double-hero':
    case 'hero-tail':
    case 'bold':
      return { min: 2 };
    case 'diamond':
    case 'cascade':
    case 'valley':
    case 'magazine':
      return { min: 2 };
    case 'center-focus':
      return { min: 2 };
    case 'filmstrip':
    case 'panorama-hero':
      return { min: 1, max: 3 }; // 超宽图模式，行数太多失去电影条感
    case 'all-hero':
      return { min: 1, max: 3 };
    default:
      return { min: 1 };
  }
}

/* ═══════════════════════════════════════
   工具函数
   ═══════════════════════════════════════ */

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/* ── 确定性伪随机（mulberry32）──
 * 用于布局“抖动”决策（行分组分布、左右交替、跨行触发等），
 * 取代依赖 photo.id charCodeAt 的伪随机——它只能在 0/1/2 几种值里打转，
 * 是 2 图/3 图布局雷同的一大诱因。同一 seed 保证可复现，不同 seed 拉开差异。 */
export function mulberry32(seed: number): () => number {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由 seed + salt 派生一个确定性 0-1 随机数 */
export function seededRand(seed: number, salt: number): number {
  return mulberry32((Math.floor(seed) * 2654435761 + salt) >>> 0)();
}

/** 由 seed + salt 派生确定性布尔（默认 50% 概率） */
export function seededBool(seed: number, salt: number, prob = 0.5): boolean {
  return seededRand(seed, salt) < prob;
}

/** 从 (seed:salt) 派生 [0,n) 的确定性整数 */
export function seededPick(seed: number, salt: number, n: number): number {
  if (n <= 0) return 0;
  return Math.floor(seededRand(seed, salt + n) * n) % n;
}

/** 归一化照片宽高比 */
function aspectOf(p: Photo): number {
  return p.width > 0 && p.height > 0 ? clamp(p.width / p.height, MIN_ASPECT, MAX_ASPECT) : 1;
}

/** 页面布局 seed：优先用显式 seed；缺失时按页面照片内容派生（最简单——避免 layout 永远完全雷同） */
export function derivePageSeed(photos: Photo[], layoutSeed: number | undefined, pageIdx: number): number {
  if (layoutSeed !== undefined) return Math.floor(layoutSeed) >>> 0;
  let s = (1 + pageIdx * 131 + 7) >>> 0;
  for (const p of photos) {
    for (let i = 0; i < p.id.length; i++) s = ((s * 31 + p.id.charCodeAt(i)) | 0) >>> 0;
  }
  return s || 1;
}

export function getDateKey(photo: Photo): string {
  const d = new Date(photo.date);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/* ═══════════════════════════════════════
   P1-2 叙事节奏 pattern 池
   ═══════════════════════════════════════ */

/**
 * P1-2 叙事节奏：根据相册进度（0-1）选择不同 pattern 池。
 * 4 段叙事：开场 / 发展 / 高潮 / 收尾，每段对应不同视觉特征。
 * - 开场（0-20%）：opening / hero-first / bold — 强冲击开场，吸引注意
 * - 发展（20-50%）：alternate / cascade / magazine — 节奏变化，叙事推进
 * - 高潮（50-70%）：all-hero / double-hero / panorama-hero — 大图震撼，情感峰值
 * - 收尾（70-100%）：closing / tail-hero / valley — 柔和收束，余韵悠长
 */
export function getNarrativePool(progress: number): TierPattern[] {
  if (progress < 0.2) {
    // 开场：强冲击
    return ['opening', 'hero-first', 'bold', 'hero-tail'];
  } else if (progress < 0.5) {
    // 发展：节奏变化
    return ['alternate', 'cascade', 'magazine', 'highlight', 'diamond'];
  } else if (progress < 0.7) {
    // 高潮：大图震撼
    return ['all-hero', 'double-hero', 'panorama-hero', 'center-focus', 'bold'];
  } else {
    // 收尾：柔和收束
    return ['closing', 'tail-hero', 'valley', 'cascade'];
  }
}

function getRhythmPool(rhythm: GooglePhotosLayoutRhythm, N: number): TierPattern[] {
  switch (rhythm) {
    case 'uniform':
      return ['hero-first', 'alternate'];
    case 'subtle':
      return ['hero-first', 'alternate', 'center-focus', 'valley', 'tail-hero'];
    case 'moderate':
      return [
        'hero-first', 'alternate', 'cascade', 'diamond',
        'center-focus', 'tail-hero', 'highlight', 'magazine',
      ];
    case 'rich':
      return N <= 2
        ? ['all-hero', 'opening', 'double-hero', 'bold', 'panorama-hero', 'filmstrip']
        : N <= 4
          ? [
              'hero-first', 'opening', 'highlight', 'tail-hero', 'closing',
              'center-focus', 'valley', 'cascade', 'diamond', 'magazine', 'hero-tail',
            ]
          : [
              'alternate', 'cascade', 'diamond', 'tail-hero', 'highlight',
              'hero-first', 'mosaic', 'double-hero', 'bold', 'magazine',
              'hero-tail', 'asymmetric', 'closing',
            ];
    default:
      return [];
  }
}

export function filterPatternsByRows(pool: TierPattern[], rows: number): TierPattern[] {
  return pool.filter(p => {
    const c = patternRowConstraints(p);
    return rows >= c.min && (c.max === undefined || rows <= c.max);
  });
}

/** 从候选池中挑选一个模式，优先避免与最近使用过的模式重复
 *  P0-2 修复：原 recentPatterns 是无界 Set，N 页后所有模式都被标记为"用过"，
 *  导致 fresh 永远为空，跨页去重完全失效。
 *  改为有限窗口：只记录最近 RECENT_PATTERNS_MAX 个模式，旧模式自动出窗，可再次使用。
 */
export function pickFromPool(pool: TierPattern[], idx: number, recentPatterns?: Set<TierPattern>): TierPattern {
  if (pool.length === 0) return 'hero-first';
  if (!recentPatterns || recentPatterns.size === 0 || pool.length === 1) return pool[idx % pool.length];
  // 优先选最近没用过的
  const fresh = pool.filter(p => !recentPatterns.has(p));
  const usePool = fresh.length > 0 ? fresh : pool;
  return usePool[idx % usePool.length];
}

export function markPatternUsed(recentPatterns: Set<TierPattern>, pattern: TierPattern): void {
  if (recentPatterns.has(pattern)) {
    recentPatterns.delete(pattern);
  }
  recentPatterns.add(pattern);
  while (recentPatterns.size > RECENT_PATTERNS_MAX) {
    const first = recentPatterns.values().next().value;
    if (first === undefined) break;
    recentPatterns.delete(first);
  }
}

export function selectTierPattern(
  N: number,
  rows: number,
  hasOutstanding: boolean,
  rhythm: GooglePhotosLayoutRhythm,
  seed: number | undefined,
  photos: Photo[],
  recentPatterns?: Set<TierPattern>,
): TierPattern {
  const idx = seed !== undefined ? Math.abs(seed % 100) : N;
  const { portrait, landscape, panorama, count } = analyzePhotoOrientations(photos);
  const portraitRatio = count > 0 ? portrait / count : 0;
  const landscapeRatio = count > 0 ? landscape / count : 0;
  const hasPanorama = panorama > 0;

  // ── 手动节奏：从对应池子里选，并过滤行数不符的 ──
  if (rhythm !== 'auto') {
    const pool = filterPatternsByRows(getRhythmPool(rhythm, N), rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  // ── 智能模式：内容驱动 ──
  if (N === 1) {
    const pool = filterPatternsByRows(['all-hero', 'panorama-hero', 'filmstrip', 'opening'], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  if (hasPanorama && N <= 3) {
    const pool = filterPatternsByRows(['panorama-hero', 'filmstrip', 'all-hero', 'hero-first', 'opening'], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  if (hasOutstanding && N <= 2) {
    const pool = filterPatternsByRows(['all-hero', 'panorama-hero', 'opening', 'double-hero', 'bold'], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  if (hasOutstanding && N <= 4) {
    const pool = filterPatternsByRows([
      'hero-first', 'opening', 'magazine', 'double-hero', 'bold', 'panorama-hero',
    ], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  if (portraitRatio >= 0.5) {
    const pool = filterPatternsByRows([
      'hero-first', 'tail-hero', 'cascade', 'valley', 'center-focus', 'diamond', 'closing',
    ], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  if (landscapeRatio >= 0.6) {
    const pool = filterPatternsByRows([
      'highlight', 'double-hero', 'magazine', 'filmstrip', 'panorama-hero',
      'hero-tail', 'alternate', 'bold',
    ], rows);
    return pickFromPool(pool, idx, recentPatterns);
  }

  const pool = filterPatternsByRows(
    N >= 6
      ? [
          'alternate', 'cascade', 'diamond', 'tail-hero', 'highlight',
          'hero-first', 'mosaic', 'bold', 'magazine', 'hero-tail', 'asymmetric', 'closing',
        ]
      : [
          'alternate', 'hero-first', 'cascade', 'center-focus', 'tail-hero',
          'closing', 'opening', 'magazine', 'valley', 'diamond', 'highlight',
        ],
    rows,
  );
  return pickFromPool(pool, idx, recentPatterns);
}

/** 19 种 tier 模式 → 每行的 RowTier 数组 */
function autoTier(tierPattern: TierPattern, rowCount: number): RowTier[] {
  const tiers: RowTier[] = new Array(rowCount).fill('standard');

  switch (tierPattern) {
    case 'hero-first':
      tiers[0] = 'hero';
      break;
    case 'highlight':
      tiers[0] = 'hero';
      for (let i = 1; i < rowCount; i++) tiers[i] = 'detail';
      break;
    case 'alternate':
      for (let i = 0; i < rowCount; i += 2) tiers[i] = 'hero';
      break;
    case 'cascade':
      if (rowCount >= 1) tiers[0] = 'hero';
      if (rowCount >= 3) for (let i = rowCount - 1; i >= Math.ceil(rowCount * 0.6); i--) tiers[i] = 'detail';
      break;
    case 'diamond':
      if (rowCount >= 3) tiers[Math.floor(rowCount / 2)] = 'hero';
      if (rowCount >= 4) for (let i = rowCount - 1; i >= Math.ceil(rowCount * 0.7); i--) tiers[i] = 'detail';
      break;
    case 'all-hero':
      for (let i = 0; i < rowCount; i++) tiers[i] = 'hero';
      break;
    case 'center-focus':
      if (rowCount >= 2) tiers[Math.floor(rowCount / 2)] = 'hero';
      break;
    case 'tail-hero':
      tiers[rowCount - 1] = 'hero';
      break;
    case 'opening':
      tiers[0] = 'hero';
      for (let i = 1; i < rowCount; i++) tiers[i] = 'detail';
      break;
    case 'closing': {
      tiers[rowCount - 1] = 'hero';
      const mid = Math.floor(rowCount / 2);
      if (rowCount >= 3) tiers[mid] = 'standard';
      for (let i = 0; i < rowCount; i++) {
        if (tiers[i] === 'standard') continue;
        if (i !== rowCount - 1) tiers[i] = 'detail';
      }
      break;
    }
    case 'hero-tail':
      if (rowCount >= 1) tiers[0] = 'hero';
      if (rowCount >= 2) tiers[rowCount - 1] = 'hero';
      if (rowCount >= 3) for (let i = 1; i < rowCount - 1; i++) tiers[i] = 'detail';
      break;
    case 'double-hero':
      if (rowCount >= 1) tiers[0] = 'hero';
      if (rowCount >= 2) tiers[rowCount - 1] = 'hero';
      if (rowCount >= 3) for (let i = 1; i < rowCount - 1; i++) tiers[i] = 'standard';
      break;
    case 'wave':
      for (let i = 0; i < rowCount; i += 2) tiers[i] = 'hero';
      for (let i = 1; i < rowCount; i += 2) tiers[i] = 'standard';
      break;
    case 'valley': {
      const mid = Math.floor((rowCount - 1) / 2);
      tiers[mid] = 'hero';
      for (let i = 0; i < rowCount; i++) {
        if (i !== mid && tiers[i] !== 'hero') tiers[i] = 'standard';
      }
      break;
    }
    case 'mosaic':
      for (let i = 0; i < rowCount; i++) tiers[i] = i % 3 === 0 ? 'standard' : 'detail';
      break;
    case 'filmstrip':
    case 'panorama-hero':
      tiers[0] = 'hero';
      for (let i = 1; i < rowCount; i++) tiers[i] = 'standard';
      break;
    case 'magazine':
      tiers[0] = 'hero';
      if (rowCount >= 3) tiers[rowCount - 1] = 'detail';
      for (let i = 1; i < rowCount - 1; i++) tiers[i] = 'standard';
      break;
    case 'bold':
      if (rowCount >= 1) tiers[0] = 'hero';
      if (rowCount >= 2) tiers[1] = 'hero';
      for (let i = 2; i < rowCount; i++) tiers[i] = 'standard';
      break;
    case 'asymmetric': {
      if (rowCount >= 1) tiers[0] = 'hero';
      const tail = Math.max(1, Math.floor(rowCount / 3));
      for (let i = rowCount - tail; i < rowCount; i++) tiers[i] = 'detail';
      for (let i = 1; i < rowCount - tail; i++) tiers[i] = 'standard';
      break;
    }
  }
  return tiers;
}

/** P0-1 集成：包装 isColorConflict 避免循环依赖（content-aware 不应被 layout 反向引用） */
export function isColorConflictRef(
  a: import('../content-aware').PhotoContentInfo,
  b: import('../content-aware').PhotoContentInfo,
): boolean {
  if (a.saturation < 0.4 || b.saturation < 0.4) return false;
  const [h1] = rgbToHslRef(...a.dominantColor);
  const [h2] = rgbToHslRef(...b.dominantColor);
  const hueDiff = Math.abs(h1 - h2);
  return hueDiff < 25 || hueDiff > 335;
}

function rgbToHslRef(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  const s = max === min ? 0 : l > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
  if (max !== min) {
    switch (max) {
      case r: h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / (max - min) + 2) * 60; break;
      case b: h = ((r - g) / (max - min) + 4) * 60; break;
    }
  }
  return [h, s, l];
}

/* ═══════════════════════════════════════
   每页精确行生成
   ═══════════════════════════════════════ */

/** 方向感知分组：竖图优先成组（1-2张），横图再成组（2-4张）。reversePattern 交替 上多下少 / 上少下多 */
function splitIntoGroups(photos: Photo[], groupCount: number, reversePattern = false): Photo[][] {
  if (groupCount <= 0) return [photos];
  if (groupCount >= photos.length) return photos.map((p) => [p]);

  // 分离横竖
  const portraits = photos.filter(p => p.width > 0 && p.height > 0 && p.width / p.height < 0.85);
  const landscapes = photos.filter(p => !portraits.includes(p));

  const groups: Photo[][] = [];

  // 竖图：每 1-2 张一组，保留跨行机会也保留普通布局
  let pi = 0;
  while (pi < portraits.length && groups.length < groupCount) {
    const take = portraits.length - pi === 1 ? 1 : Math.min(2, portraits.length - pi);
    groups.push(portraits.slice(pi, pi + take));
    pi += take;
  }

  // 横图：均匀分配到剩余行，reversePattern 控制大组在前还是后
  const remainingGroups = groupCount - groups.length;
  if (remainingGroups > 0 && landscapes.length > 0) {
    const base = Math.floor(landscapes.length / remainingGroups);
    const rem = landscapes.length % remainingGroups;
    let li = 0;
    for (let i = 0; i < remainingGroups; i++) {
      const idx = reversePattern ? (remainingGroups - 1 - i) : i;
      const size = base + (idx < rem ? 1 : 0);
      if (size > 0) {
        groups.push(landscapes.slice(li, li + size));
        li += size;
      }
    }
    // 剩余横图追加到最后行
    if (li < landscapes.length) {
      const last = groups[groups.length - 1];
      if (last) last.push(...landscapes.slice(li));
    }
  }

  // 保证至少 groupCount 组
  while (groups.length < groupCount) groups.push([]);

  // ── 兑底：保证所有照片都进组，不能丢 ──
  // 场景：竖图优先占满 groupCount 后，横图没有剩余组可分，会被静默丢弃
  // 修复：检查未进组的照片，塞到最后一个非空组；避免「随机切换」多次后照片逐浙减少
  const assigned = new Set<string>();
  for (const g of groups) for (const p of g) assigned.add(p.id);
  const missing = photos.filter(p => !assigned.has(p.id));
  if (missing.length > 0) {
    // 找到最后一个非空组，把 missing 加进去
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].length > 0) {
        groups[i].push(...missing);
        missing.length = 0;
        break;
      }
    }
    // 如果全空，新建一组
    if (missing.length > 0) groups.push(missing);
  }

  return groups.slice(0, groupCount);
}

/** 为一组照片计算 justified 行高（tier 倍率由当前模式决定，拉开视觉差异）
 *
 *  P1-2 优化：引入"行内视觉权重"概念——单张照片宽度不超过行宽 60%，
 *  避免一张全景图（aspect≥2.0）把整行高度拉得太矮。
 *  做法：先按经典 justified 算法算出 baseH，再检测超占比照片，
 *  把它的有效 aspect 收缩到 (行宽×0.6/行高) 上限。
 *
 *  布局增强（2026-08-21·一键成册视觉效果）：在 tier 基础倍率之上叠加"内容/层次浮动因子"，
 *  让行高差异不依赖写死的固定表，而是随照片画面特征与行位置动态变化：
 *  - hero 行更高（基础 1.8）之上，若照片清晰（clarityScore）则进一步放大；
 *  - standard 行基本稳定，detail 行略收窄，形成 大图更突出、小图更收敛 的层次感；
 *  - 浮动因子是"少即强、多即弱"的确定性压缩（0.75×base..1.25×base），保证不破坏测试
 *    的"hero 行 ≥ 非 hero 行 ×1.2"守恒关系与实践"行高秩序"。
 */
function tierContentMultiplier(
  photos: Photo[],
  baseMultiplier: number,
  tier: RowTier,
): number {
  if (photos.length === 0) return baseMultiplier;

  // 内容信号：照片清晰度均值（缺失按 0.6 中值处理）。清晰 → 该行作为焦点更可信 → 放大。
  let claritySum = 0;
  let clarityN = 0;
  for (const p of photos) {
    if (typeof p.clarityScore === 'number') { claritySum += p.clarityScore; clarityN++; }
  }
  const avgClarity = clarityN > 0 ? claritySum / clarityN : 0.6;

  // 内容信号：照片方向跨度（行内既有超宽又有竖图 → 视觉张力强，稍放大）
  let aspectMin = Infinity, aspectMax = -Infinity;
  for (const p of photos) {
    const a = p.width > 0 && p.height > 0 ? p.width / p.height : 1;
    if (a < aspectMin) aspectMin = a;
    if (a > aspectMax) aspectMax = a;
  }
  const aspectSpan = photos.length > 1 ? aspectMax / aspectMin : 1;

  // 内容信号：行内照片数。单张 = 视觉焦点，放大；多张 = 堆叠信息，收敛。
  const photoCountFactor = photos.length === 1 ? 1.08 : photos.length >= 3 ? 0.94 : 1.0;

  // 按 tier 施加不同的内容敏感度（加深 hero/detail 强弱对比，但不破坏“hero ≥ standard×1.2”秩序）
  let m = baseMultiplier;
  if (tier === 'hero') {
    // hero：清晰 + 大跨度都让它更"跳"出来
    m *= clamp(1 + (avgClarity - 0.6) * 0.4, 0.75, 1.28);
    m *= clamp(1 + (aspectSpan - 1) * 0.06, 0.9, 1.1);
  } else if (tier === 'detail') {
    // detail：清晰越高越收敛（作为背景衬托 hero），反之保持
    m *= clamp(1 - (avgClarity - 0.6) * 0.3, 0.78, 1.15);
  } else {
    // standard：稳定为主，轻微随清晰度上抬
    m *= clamp(1 + (avgClarity - 0.6) * 0.15, 0.9, 1.08);
  }
  m *= photoCountFactor;

  // 收敛到既拉开层次又不破坏秩序的合理区间：绝不把 hero 压到低于 standard
  return clamp(m, 0.5, 2.6);
}

export function computeRowForGroup(
  photos: Photo[],
  contentWidth: number,
  gap: number,
  tier: RowTier,
  pattern: TierPattern,
  heroPhase = 1,
): JustifiedRow {
  if (photos.length === 0) return { photos: [], rowHeight: 0, tier };
  const MAX_SINGLE_RATIO = 0.6; // 单张照片宽度上限：行宽的 60%

  // 先算行宽上限下的"单张最大 aspect"
  // 占比 = (aspect × rowHeight) / contentWidth ≤ MAX_SINGLE_RATIO
  // 在 justified 算法里：rowHeight = (contentWidth - gaps) / aspectSum
  // 占比 = aspect / aspectSum，所以限制 aspect ≤ MAX_SINGLE_RATIO × aspectSum
  const totalGaps = (photos.length - 1) * gap;
  const usableW = totalGaps < contentWidth ? contentWidth - totalGaps : contentWidth;

  let aspectSum = 0;
  const rawAspects: number[] = [];
  for (const p of photos) {
    const a = p.width > 0 && p.height > 0 ? clamp(p.width / p.height, MIN_ASPECT, MAX_ASPECT) : 1;
    rawAspects.push(a);
    aspectSum += a;
  }

  // 收缩超占比照片：占 aspectSum > 60% 的，收缩到 60% aspectSum
  const cap = MAX_SINGLE_RATIO * aspectSum;
  let adjusted = false;
  const adjustedAspects = rawAspects.map(a => {
    if (a > cap) {
      adjusted = true;
      return cap;
    }
    return a;
  });
  if (adjusted) {
    aspectSum = adjustedAspects.reduce((s, v) => s + v, 0);
  }

  const baseH = aspectSum > 0 ? usableW / aspectSum : usableW;
  // 布局增强：tier 基础倍率 + 内容浮动因子，拉开视觉层次
  const baseMultiplier = getTierMultiplier(pattern, tier);
  const mul = tierContentMultiplier(photos, baseMultiplier, tier);
  // 跨页强弱节奏：仅 hero 行乘页面相位系数（>1 强相 / <1 缓相 / =1 中性）。
  // fillPage 是整页等比归一化，hero 相对 standard 的高度差会原样保留。
  const phase = tier === 'hero' && heroPhase !== 1 ? heroPhase : 1;
  return { photos, rowHeight: baseH * mul * phase, tier };
}

/** 按模式要求，把高分照片「入位」到 hero 行，保证首/中/末等视觉焦点由最佳照片占据
 *
 *  P0-4 修正：原实现会把高分照片从原行移到 hero 行，破坏页内时间顺序（同页照片按时间排列被重排）。
 *  新策略：保留时间顺序，仅当 hero 行恰好有非高分照片时才"换 tier"——
 *    即：把 hero 照片所在行升级为 hero tier（autoTier 在下一步会按 pattern 重新生成，
 *    这里只负责把"应该做 hero 但被分到 standard 的行"标记出来）。
 *  简化做法：若 hero 行中已有非高分照片，与 hero 照片原行做整行交换（保持每组照片仍是连续时段）。
 *  这样视觉上仍是"hero 行的照片就是高分照片"，但页内时间顺序保持完整。
 */
function placeHeroesIntoGroups(
  groups: Photo[][],
  scoredPhotos: PhotoScore[],
  tierPattern: TierPattern,
): Photo[][] {
  const tiers = autoTier(tierPattern, groups.length);
  const heroIndices: number[] = [];
  tiers.forEach((t, i) => { if (t === 'hero') heroIndices.push(i); });
  if (heroIndices.length === 0) return groups;

  const placement = getHeroPlacement(tierPattern);
  const sortedScores = [...scoredPhotos].sort((a, b) => b.score - a.score);
  const heroPhotos = sortedScores.slice(0, heroIndices.length).map(s => s.photo);
  if (heroPhotos.length === 0) return groups;

  // 根据 placement 语义，确定 hero 行索引的分配顺序
  let orderedHeroIndices: number[] = [];
  switch (placement) {
    case 'first': orderedHeroIndices = [heroIndices[0]]; break;
    case 'last': orderedHeroIndices = [heroIndices[heroIndices.length - 1]]; break;
    case 'center': orderedHeroIndices = [heroIndices[Math.floor(heroIndices.length / 2)]]; break;
    case 'first-and-last':
      orderedHeroIndices = heroIndices.length >= 2 ? [heroIndices[0], heroIndices[heroIndices.length - 1]] : [heroIndices[0]];
      break;
    case 'first-and-second':
      orderedHeroIndices = heroIndices.length >= 2 ? [heroIndices[0], heroIndices[1]] : [heroIndices[0]];
      break;
    default: orderedHeroIndices = heroIndices;
  }
  orderedHeroIndices = orderedHeroIndices.slice(0, heroPhotos.length);

  // P0-4 新策略：行级交换，不破坏照片在 groups 中的相对顺序
  // hero 照片应进入的目标行：把 hero 照片所在行与目标 hero 行整体互换，
  // 这样页内照片仍是连续时段，时间叙事不乱。
  for (let i = 0; i < orderedHeroIndices.length; i++) {
    const targetIdx = orderedHeroIndices[i];
    const hero = heroPhotos[i];
    if (!hero) continue;

    // 找到 hero 当前所在的行
    let heroRowIdx = -1;
    for (let g = 0; g < groups.length; g++) {
      if (groups[g].some(p => p.id === hero.id)) {
        heroRowIdx = g;
        break;
      }
    }
    if (heroRowIdx < 0 || heroRowIdx === targetIdx) continue;

    // 行级互换：整组照片互换位置，页内仍是连续时段
    const tmp = groups[targetIdx];
    groups[targetIdx] = groups[heroRowIdx];
    groups[heroRowIdx] = tmp;
  }

  return groups;
}

/** 2/3 图小页台型骨架：用 seed + 内容挑选多种结构，打破“上2下1 / 上1下2”单一化。
 *  返回按行划分的照片分组（组间即行间），由上层 autoTier/computeRowForGroup 转成行。 */
function buildSmallSkeleton(photos: Photo[], seed: number): Photo[][] {
  const N = photos.length;
  if (N === 1) return [photos]; // 单张独占整页，无需再拆
  const a0 = aspectOf(photos[0]);
  const a1 = N > 1 ? aspectOf(photos[1]) : 1;
  const a2 = N > 2 ? aspectOf(photos[2]) : 1;

  // ── 2 图：并排(1行) / 叠放(2行) 二选一 ──
  if (N === 2) {
    const onePortrait = (a0 < 0.85) !== (a1 < 0.85);
    const bothLandscape = a0 >= 1.15 && a1 >= 1.15;
    // 全横图 → 更倾向并排成一条横带；混方向各半；含竖图 → 偏叠放（一张占满更舒展）
    const sideBySide = seededBool(seed, 21, bothLandscape ? 0.72 : onePortrait ? 0.45 : 0.55);
    return sideBySide ? [[photos[0], photos[1]]] : [[photos[0]], [photos[1]]];
  }

  // ── 3 图 ──
  // 3 张全竖图：跨行主图用 seed 在 3 张里选（其余两张堆叠），配合跨行 side 的 seed 抖动
  // 可产出「大图左/右 + 堆叠」「主图各异」等多种组合；不再固定首张做主图，换版式才有变化。
  const allPortrait = a0 < 0.85 && a1 < 0.85 && a2 < 0.85;
  if (allPortrait) {
    const lead = seededPick(seed, 43, 3);
    const rest = [0, 1, 2].filter(j => j !== lead);
    return [[photos[lead]], [photos[rest[0]]], [photos[rest[1]]]];
  }
  // 首张竖图（后两张含横/方）：拆为独立首行，交给跨行检测做「竖图跨行 + 堆叠」错落
  if (a0 < 0.85) {
    return [[photos[0]], [photos[1]], [photos[2]]];
  }
  const allLandscape = a0 >= 1.15 && a1 >= 1.15 && a2 >= 1.15;
  const pick = seededPick(seed, 31, 3); // 0/1/2
  if (allLandscape) {
    // 全横图：上2下1 / 上1下2 / 三行叠放（三行叠放可继续触发跨行，形成电影条感受）
    if (pick === 0) return [[photos[0], photos[1]], [photos[2]]];
    if (pick === 1) return [[photos[0]], [photos[1], photos[2]]];
    return [[photos[0]], [photos[1]], [photos[2]]];
  }
  // 混合方向：上2下1 / 上1下2 交替（用 seed 决定，而非永远竖图在上）
  return pick <= 1 ? [[photos[0], photos[1]], [photos[2]]] : [[photos[0]], [photos[1], photos[2]]];
}

/** 4 图页面台型骨架：用 seed + 内容挑选多种结构，摆脱"纯按方向切行"的雷同。
 *  2+2 对称格 / 单 hero+3 / 3+尾 / 错落(1+2+1) / 竖图独立跨行 等。 */
function buildFourSkeleton(photos: Photo[], seed: number): Photo[][] {
  const a0 = aspectOf(photos[0]);
  const a1 = aspectOf(photos[1]);
  const a2 = aspectOf(photos[2]);
  const a3 = aspectOf(photos[3]);
  // 方图：接近 1 的宽高比，适合对称铺
  const portraitCount = [a0, a1, a2, a3].filter(a => a < 0.85).length;
  const allSquareish = [a0, a1, a2, a3].every(a => a >= 0.85 && a <= 1.15);
  const pick = seededPick(seed, 131, 6); // 0..5

  // 竖图很多：竖图各自独立成行（利于触发跨行 + 错落），横/方合为一排
  if (portraitCount >= 3) {
    return [[photos[0]], [photos[1]], [photos[2], photos[3]]];
  }
  // 全方图：对称 2+2 更稳重，偶尔转 单hero+3 打破单调
  if (allSquareish) {
    return pick === 3
      ? [[photos[0]], [photos[1], photos[2], photos[3]]]
      : [[photos[0], photos[1]], [photos[2], photos[3]]];
  }
  switch (pick) {
    case 0: return [[photos[0], photos[1]], [photos[2], photos[3]]];      // 2+2
    case 1: return [[photos[0]], [photos[1], photos[2], photos[3]]];      // 单hero+3
    case 2: return [[photos[0], photos[1], photos[2]], [photos[3]]];      // 3+尾
    case 4: return [[photos[0]], [photos[1], photos[2]], [photos[3]]];    // 错落
    default: // 33-50% 走跨行友好：竖图独立首行，其余按 2/2 或 3 分布
      if (a0 < 0.85) return [[photos[0]], [photos[1], photos[2]], [photos[3]]];
      return [[photos[0], photos[1]], [photos[2]], [photos[3]]];          // 2+1+1(竖/横跨行机会)
  }
}

export function generateRowsForSpec(spec: PageSpec, contentWidth: number, gap: number, pageIdx = 0): JustifiedRow[] {
  const { layout, photos, scoredPhotos } = spec;
  if (photos.length === 0) return [];

  const seed = derivePageSeed(photos, layout.seed, pageIdx);
  // 2/3 图：走多种「小页台型」骨架，避免每页都落在 上2下1 / 上1下2；
  // 4 图：多结构骨架（对称/hero/错落/跨行）摆脱"纯方向切行"；
  // ≥5 图：方向感知分组 + seed 决定上下多/少。真实 seed 取代 charCodeAt 伪随机。
  let groups = photos.length === 4
    ? buildFourSkeleton(photos, seed)
    : photos.length <= 3
      ? buildSmallSkeleton(photos, seed)
      : splitIntoGroups(photos, layout.rows, seededBool(seed, 91, 0.5));

  // 3图页面且预期3行但骨架没给够3行：强制每张独占一行（给跨行创造机会）
  if (photos.length === 3 && layout.rows >= 3 && groups.filter(g => g.length > 0).length < 3) {
    const all = groups.flat();
    groups = [[all[0]], [all[1]], [all[2]]];
  }

  // 按模式把高光照片入位到 hero 行
  groups = placeHeroesIntoGroups(groups, scoredPhotos, layout.tierPattern);

  // ── 末行竖图保护（须在 hero 行交换之后：行交换会把竖图行换到末尾）：
  // 多行骨架里竖图独占末行无法跨行（没有下一行可合并），fillPage 归一化后会被
  // 拉宽成横带（0.75 的竖图最多裁掉约一半高度，主体可能被切）→ 并入前一行。
  // 仅处理 ≥3 图页面；2 图叠放骨架的多样性语义优先（且 2 行摊薄后裁切可接受）。
  if (photos.length >= 3 && groups.length >= 2) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.length === 1 && aspectOf(lastGroup[0]) < 0.85) {
      groups[groups.length - 2] = [...groups[groups.length - 2], ...lastGroup];
      groups.pop();
    }
  }

  const tiers = autoTier(layout.tierPattern, groups.length);

  return groups
    .filter(g => g.length > 0)
    .map((group, i) => computeRowForGroup(group, contentWidth, gap, tiers[i] || 'standard', layout.tierPattern, layout.heroPhase ?? 1));
}

/* ═══════════════════════════════════════
   竖图跨行检测
   ═══════════════════════════════════════ */

/** 扫描行列表，将「1 张竖图/英雄横图 + 下一行」合并为跨行 SpanGroup。
 *  pageIdx 用于决定竖图在左/右，保证同一页内稳定且跨页交替。
 *  seed 驱动「非严格候选是否跨行」「首行是否让位给第二行」等抖动决策。 */
export function detectSpanOpportunities(
  rows: JustifiedRow[],
  gap: number,
  heroIds?: Set<string>,
  pageIdx = 0,
  seed = 0,
): (JustifiedRow | SpanGroup)[] {
  const result: (JustifiedRow | SpanGroup)[] = [];
  let i = 0;
  let spanCount = 0;

  while (i < rows.length) {
    const row = rows[i];
    const nextRow = rows[i + 1];

    // 条件：当前行恰好 1 张照片、下一行存在、照片是竖图或本页最高分横图
    if (row.photos.length === 1 && nextRow) {
      const p = row.photos[0];
      const aspect = p.width > 0 && p.height > 0 ? p.width / p.height : 1;
      const isStrictPortrait = aspect < 0.80;   // iPhone 3:4 (0.75) 等标准竖图，始终跨行
      const isPanorama = aspect >= 2.0;         // 超宽全景图不适合跨行，独占一行更舒展
      const isCandidate = !isPanorama && aspect < 1.8 && (isStrictPortrait || (heroIds != null && heroIds.has(p.id)));
      // 标准竖图始终跨行；非严格候选按 seed 抖动；第 1 行非严格候选额外有概率让位给第 2 行
      const randBit1 = seededBool(seed, 50 + i, 0.5);
      const skipForRow1 = i === 0 && !isStrictPortrait && seededBool(seed, 121, 0.5);
      const isSpanCandidate = isStrictPortrait || (isCandidate && randBit1 && !skipForRow1);

      if (isSpanCandidate) {
        const nextLandscapes = nextRow.photos.filter(
          np => np.width > 0 && np.height > 0 && np.width / np.height >= 0.85,
        );
        const nextPortraits = nextRow.photos.filter(
          np => np.width > 0 && np.height > 0 && np.width / np.height < 0.85,
        );

        // Row1 的横图+竖图各作为一个子行（保留 tier 用于视觉权重比较）
        const subRows: { photos: Photo[]; rowHeight: number; tier: RowTier }[] = [];
        if (nextLandscapes.length > 0) {
          subRows.push({ photos: nextLandscapes, rowHeight: nextRow.rowHeight, tier: nextRow.tier });
        }
        if (nextPortraits.length > 0) {
          subRows.push({ photos: nextPortraits, rowHeight: nextRow.rowHeight, tier: nextRow.tier });
        }

        if (subRows.length > 0) {
          let totalH = row.rowHeight + gap + nextRow.rowHeight;
          let skipRows = 2;
          // 跨行时第 3 行存在则一并合并，形成紧凑 3 图跨行
          const nextNextRow = rows[i + 2];
          if (nextNextRow) {
            totalH += gap + nextNextRow.rowHeight;
            subRows.push({ photos: nextNextRow.photos, rowHeight: nextNextRow.rowHeight, tier: nextNextRow.tier });
            skipRows = 3;
          }
          // 注意：子行保持时间顺序（Row1→Row2→Row3），不做视觉权重重排。
          // 相册是叙事媒介，右侧堆叠区按时间自上而下阅读本身就是 Z 字序；
          // 按行高重排会把时间上更晚的照片翻到上面，用户会感知"顺序乱了"。
          // 左右交替：seed + 页码 + 页内 span 数共同决定——不同 seed 能翻面（单页也可左右互换），
          // 同时保留跨页交替的大趋势，避免连续同侧。旧实现仅用页码，单页时恒左，换版式无变化。
          const side: 'left' | 'right' = seededBool(seed, 160 + spanCount * 17 + pageIdx, 0.5) ? 'left' : 'right';
          spanCount++;

          result.push({
            type: 'span',
            portraitPhoto: p,
            portraitTotalHeight: totalH,
            subRows,
            side,
            tier: row.tier,
          });

          i += skipRows;
          continue;
        }
      }
    }

    result.push(row);
    i++;
  }

  return result;
}

/** 将 mm 坐标矩形从 base 页面坐标系按内容区中心旋转 90° 整数倍，映射到 target 页面坐标系 */
export function rotateMmRect(
  mx: number, my: number, mw: number, mh: number,
  basePageW: number, basePageH: number,
  targetPageW: number, targetPageH: number,
  margin: PageMarginSettings,
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number; width: number; height: number } {
  if (rotation === 0) return { x: mx, y: my, width: mw, height: mh };
  const baseCW = basePageW - margin.left - margin.right;
  const baseCH = basePageH - margin.top - margin.bottom;
  const targetCW = targetPageW - margin.left - margin.right;
  const targetCH = targetPageH - margin.top - margin.bottom;
  if (baseCW <= 0 || baseCH <= 0 || targetCW <= 0 || targetCH <= 0) return { x: mx, y: my, width: mw, height: mh };

  // 归一化到 base 内容区
  const nx = (mx - margin.left) / baseCW;
  const ny = (my - margin.top) / baseCH;
  const nw = mw / baseCW;
  const nh = mh / baseCH;

  // 旋转归一化坐标
  let rx = nx, ry = ny, rw = nw, rh = nh;
  switch (rotation) {
    case 90:  rx = 1 - ny - nh; ry = nx;       rw = nh; rh = nw; break;
    case 180: rx = 1 - nx - nw; ry = 1 - ny - nh;               break;
    case 270: rx = ny;          ry = 1 - nx - nw; rw = nh; rh = nw; break;
  }

  // 映射到 target 内容区
  return {
    x: margin.left + rx * targetCW,
    y: margin.top + ry * targetCH,
    width: rw * targetCW,
    height: rh * targetCH,
  };
}