/* ═══════════════════════════════════════
   Google Photos 智能编排引擎 V2
   ──────────────────────────────────────
   核心思路：先分配后生成。
   1. 照片评分 + 日期分组
   2. buildPageSpecs：按页面类型拆分照片，精确控制每页数量
   3. 每页独立生成行（按类型分配行高 tier）
   4. fillPage 拉伸填满安全区，零留白

   10 种页面类型 + 对应照片数上限：
   hero      : 1-3  photos, hero + standard  rows
   panorama  : 1   photo,  1 hero row (full-width)
   focus     : 2-4  photos, hero + standard  rows
   contrast  : 2-3  photos, hero + detail    rows
   diary     : 2-4  photos, standard only (relaxed)
   standard  : 3-6  photos, standard only
   dynamic   : 3-5  photos, hero + standard + detail
   highlight : 2-4  photos, hero + detail    rows
   rhythm    : 3-6  photos, hero ↔ standard alternating
   mosaic    : 4-7  photos, standard + detail rows
   ═══════════════════════════════════════ */

import type { Photo, PageMarginSettings } from '../types';

/* ═══════════════════════════════════════
   类型定义
   ═══════════════════════════════════════ */

export type GooglePhotosDensity = 'auto' | 'large' | 'sparse' | 'balanced' | 'compact';
export type GooglePhotosLayoutRhythm = 'auto' | 'uniform' | 'subtle' | 'moderate' | 'rich';
export type GooglePhotosDateGrouping = 'strict' | 'moderate' | 'continuous';

export type PageOverride = {
  density?: GooglePhotosDensity;
  rhythm?: GooglePhotosLayoutRhythm;
  seed?: number;
  tierPattern?: TierPattern;
  biasX?: number;
  biasY?: number;
};

export type GooglePhotosConfig = {
  pageWidth: number;
  pageHeight: number;
  margin: PageMarginSettings;
  gap: number;
  density: GooglePhotosDensity;
  /** 排版变化：auto=智能 / uniform=整齐统一 / subtle=轻微变化 / moderate=适中节奏 / rich=丰富多变。默认 auto */
  layoutRhythm?: GooglePhotosLayoutRhythm;
  /** 日期分组：strict=严格按日，moderate=适度分组，continuous=连续排列。默认 strict */
  dateGrouping?: GooglePhotosDateGrouping;
  dateGapDays?: number;
  balanceRows?: boolean;
  tailPageTemplateFallback?: boolean;
  /** 单页排版覆盖：pageIndex → { rhythm, seed, tierPattern, biasX, biasY } */
  pageOverrides?: Map<number, PageOverride>;
  /**
   * P0-2/P0-1/P0-4 集成：照片内容信息缓存（含人脸检测焦点 + 主色 + 饱和度）。
   * 评分系统用它启用人脸维度（faceCount 加分）；
   * 跨页规划用它做色彩冲突检测（isColorConflict）；
   * 多版本择优用它评估色彩冲突扣分。
   * SmartLayoutView 预计算后传入；缺失时回退到原行为（人脸维度 0 分，色彩冲突不检测）。
   */
  contentInfoCache?: Map<string, import('./content-aware').PhotoContentInfo>;
  /**
   * P1-2 跨页叙事节奏配置：将相册按时间分 4 段，每段用不同 pattern 池。
   * 默认 [0.2, 0.3, 0.2, 0.3] = 开场 20% / 发展 30% / 高潮 20% / 收尾 30%。
   * 设为 [1, 0, 0, 0] 关闭叙事节奏（全部走开场 pattern 池）。
   * 设为 [0, 0, 1, 0] 关闭叙事节奏（全部走高潮 pattern 池）。
   */
  narrativeRhythm?: [number, number, number, number];
};

export type PhotoRect = {
  photoId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GooglePhotosPage = { photos: PhotoRect[] };

export type GooglePhotosLayoutResult = {
  pages: GooglePhotosPage[];
  /** 每页对应的行结构（photoId 分组 + 原始行高），供间距变更时重排 */
  internalRows: Array<{ photoIds: string[]; rowHeight: number }[]>;
  /** 原始布局行（含 SpanGroup），供边距变更时保持竖图跨行结构 */
  layoutRows: Array<Array<{
    type?: 'span';
    portraitPhotoId?: string;
    portraitTotalHeight?: number;
    photoIds?: string[];
    subRows?: Array<{ photoIds: string[]; rowHeight: number; tier?: RowTier }>;
    rowHeight?: number;
    side?: 'left' | 'right';
    tier?: RowTier;
  }>>;
  /** 每页实际使用的 tierPattern，供预览展示与旧页重排兼容 */
  tierPatterns: TierPattern[];
  totalPhotos: number;
  totalPages: number;
};

/* ── 内部类型 ── */

type PhotoScore = { photo: Photo; score: number };

export type RowTier = 'hero' | 'standard' | 'detail';

interface JustifiedRow {
  photos: Photo[];
  rowHeight: number;
  tier: RowTier;
}

/** 竖图跨行布局：一张竖图占据 2 行高度，横图分布在剩余宽度中的子行 */
interface SpanGroup {
  type: 'span';
  portraitPhoto: Photo;
  portraitTotalHeight: number;  // 竖图总高度 = rowH1 + gap + rowH2
  subRows: { photos: Photo[]; rowHeight: number; tier: RowTier }[];  // 子行（含 tier，供 layoutRows 暴露）
  side: 'left' | 'right';      // 竖图在左/右，交替避免视觉疲劳
  tier: RowTier;               // 竖图所在原始行的 tier（供视觉权重比较）
}

/** 行高模式池：在原有 8 种基础上扩展为 19 种，覆盖更多几何节奏 */
export type TierPattern =
  | 'hero-first'     // 首行大图领衔
  | 'highlight'      // 首行大图+其余detail（主配）
  | 'alternate'      // hero↔standard 交替弹跳
  | 'cascade'        // hero→standard→detail 倒梯逐行缩小
  | 'diamond'        // standard→hero→standard→detail→standard 菱形
  | 'all-hero'       // 全部hero（仅高分照片触发）
  | 'center-focus'   // 中间行hero，上下standard（居中焦点）
  | 'tail-hero'      // 前standard→末行hero（压轴）
  | 'opening'        // 首行 hero，其余 detail（开场冲击）
  | 'closing'        // 末行 hero，前面 standard/detail（压轴）
  | 'hero-tail'      // 首行+末行双 hero
  | 'double-hero'    // 两个 hero 行夹 standard
  | 'wave'           // hero/standard 波浪交替
  | 'valley'         // standard/hero/standard 山谷焦点
  | 'mosaic'         // 全部 detail/standard，密集网格
  | 'filmstrip'      // 单行全景条（横图专属）
  | 'panorama-hero'  // 一张超宽图独占全宽 hero 行
  | 'magazine'       // hero 行 + 下方多列小图
  | 'bold'           // 连续两个 hero 行，强视觉冲击
  | 'asymmetric';    // 不规则 hero/detail/standard 组合

/** 每页参数化布局：由照片内容驱动，组合数远超100种 */
interface LayoutParams {
  rows: number;
  tierPattern: TierPattern;
  allowSpan: boolean;  // 是否允许竖图跨行
}

interface PageSpec {
  layout: LayoutParams;
  photos: Photo[];
  scoredPhotos: PhotoScore[];
}

/* ═══════════════════════════════════════
   常量
   ═══════════════════════════════════════ */

const MAX_ASPECT = 2.8;
const MIN_ASPECT = 0.35;
const DEFAULT_DATE_GAP_DAYS = 1;

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
function getHeroPlacement(pattern: TierPattern): 'first' | 'last' | 'center' | 'first-and-last' | 'first-and-second' | 'none' {
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
function patternRowConstraints(pattern: TierPattern): { min: number; max?: number } {
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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function getDateKey(photo: Photo): string {
  const d = new Date(photo.date);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/* ═══════════════════════════════════════
   1. 照片评分（7 维度，满分 14；≥10=杰出，7-9=优秀，4-6=良好，0-3=普通）
   ═══════════════════════════════════════ */

/**
 * 评分系统：决定哪些照片适合做 hero（视觉冲击 + 内容重要）。
 * 维度：分辨率(0-3) + 内容丰富度(0-3) + 日期新鲜度(0-2) + 人脸(0-2) + 清晰度(0-2) + 唯一日期(0-1) + 高分加成(0-1)
 *
 * P0-2 集成：启用人脸维度（从 contentInfoCache 读取 faceCount）。
 *   - ≥3 人合影：+2 分（重要社交时刻）
 *   - 1-2 人：+1 分（人像）
 *   - 0 人或 contentInfo 缺失：0 分
 * P1-1 集成：启用清晰度维度（从 photo.clarityScore 读取，导入时预计算）。
 *   - clarityScore ≥ 0.7：+2 分（清晰）
 *   - 0.4-0.7：+1 分（一般）
 *   - <0.4：0 分（模糊，不应做 hero）
 */
function scorePhotos(photos: Photo[], contentInfoCache?: Map<string, import('./content-aware').PhotoContentInfo>): PhotoScore[] {
  if (photos.length === 0) return [];
  const dates = photos.map((p) => new Date(p.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = maxDate - minDate || 1;

  // 统计每日照片数（用于唯一日期判定）
  const dayCounts = new Map<string, number>();
  for (const p of photos) {
    const key = getDateKey(p);
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  }

  return photos.map((p) => {
    let score = 0;

    // 分辨率 0-3：<2MP=0 / 2-4MP=1 / 4-8MP=2 / ≥8MP=3
    const mp = (p.width * p.height) / 1_000_000;
    if (mp >= 8) score += 3;
    else if (mp >= 4) score += 2;
    else if (mp >= 2) score += 1;

    // P0-3 修正：原代码横图 3 分 / 方图 1 分 / 竖图 0 分，对竖图用户（iPhone 默认）极不友好。
    // 改为"内容丰富度"维度：评估照片是否适合做 hero（视觉冲击），与方向解耦。
    //   全景图（≥2.0）：3 分，适合横幅 hero
    //   极端竖图（<0.5）：3 分，适合竖幅 hero
    //   常规横图/竖图/方图：1 分，都可做 standard
    const aspect = p.width > 0 && p.height > 0 ? p.width / p.height : 1;
    if (aspect >= 2.0 || aspect < 0.5) score += 3;
    else if (aspect >= 0.5 && aspect <= 2.0) score += 1;

    // 日期新鲜度 0-2：前30%=0 / 中40%=1 / 后30%=2
    const freshness = (new Date(p.date).getTime() - minDate) / dateRange;
    if (freshness >= 0.7) score += 2;
    else if (freshness >= 0.3) score += 1;

    // P0-2 人脸检测 0-2：从 contentInfoCache 读取 faceCount
    //   ≥3 人合影：+2（重要社交时刻，应做 hero）
    //   1-2 人：+1（人像）
    //   0 人或 contentInfo 缺失：0
    const contentInfo = contentInfoCache?.get(p.id);
    if (contentInfo?.hasFaces && contentInfo.faceCount >= 3) score += 2;
    else if (contentInfo?.hasFaces && contentInfo.faceCount >= 1) score += 1;

    // P1-1 清晰度 0-2：优先从 photo.clarityScore（导入时预计算）读取，
    //   缺失时回退到 contentInfoCache.clarityScore（SmartLayoutView 懒计算）。
    //   ≥0.7：+2（清晰） / 0.4-0.7：+1（一般） / <0.4：0（模糊，不应做 hero）
    const clarity = typeof p.clarityScore === 'number'
      ? p.clarityScore
      : contentInfoCache?.get(p.id)?.clarityScore;
    if (typeof clarity === 'number') {
      if (clarity >= 0.7) score += 2;
      else if (clarity >= 0.4) score += 1;
    }

    // 唯一日期 0-1：当日仅此1张=1
    if ((dayCounts.get(getDateKey(p)) || 0) === 1) score += 1;

    return { photo: p, score };
  });
}

/* ═══════════════════════════════════════
   2. 日期分组
   ═══════════════════════════════════════ */

function groupByDate(
  scored: PhotoScore[],
  dateGapDays: number,
  dateGrouping: GooglePhotosDateGrouping,
): PhotoScore[][] {
  const sorted = [...scored].sort(
    (a, b) => new Date(a.photo.date).getTime() - new Date(b.photo.date).getTime(),
  );
  if (sorted.length === 0) return [];

  // continuous: 不按日期分组，合并小批量（每 10-15 张为一批）
  if (dateGrouping === 'continuous') {
    const batchSize = 12;
    const groups: PhotoScore[][] = [];
    for (let i = 0; i < sorted.length; i += batchSize) {
      groups.push(sorted.slice(i, i + batchSize));
    }
    return groups;
  }

  const groups: PhotoScore[][] = [];
  let current: PhotoScore[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(current[current.length - 1].photo.date, sorted[i].photo.date) >= dateGapDays) {
      groups.push(current);
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  groups.push(current);

  // strict: 不合并小组，保持严格日期边界
  if (dateGrouping === 'strict') return groups;

  // moderate: 合并小分组（1-3张与相邻组合并）
  return mergeSmallGroups(groups);
}

function mergeSmallGroups(groups: PhotoScore[][]): PhotoScore[][] {
  const result: PhotoScore[][] = [];
  let buffer: PhotoScore[] = [];

  for (const group of groups) {
    if (group.length <= 3) {
      buffer.push(...group);
      if (buffer.length >= 4) {
        result.push(buffer);
        buffer = [];
      }
    } else {
      if (buffer.length > 0) {
        result.push([...buffer, ...group]);
        buffer = [];
      } else {
        result.push(group);
      }
    }
  }
  if (buffer.length > 0) {
    if (result.length > 0) {
      result[result.length - 1].push(...buffer);
    } else {
      result.push(buffer);
    }
  }
  return result;
}

/* ═══════════════════════════════════════
   3. buildPageSpecs — 核心：按类型拆分页面
   ═══════════════════════════════════════ */

/**
 * P1-2 叙事节奏：根据相册进度（0-1）选择不同 pattern 池。
 * 4 段叙事：开场 / 发展 / 高潮 / 收尾，每段对应不同视觉特征。
 * - 开场（0-20%）：opening / hero-first / bold — 强冲击开场，吸引注意
 * - 发展（20-50%）：alternate / cascade / magazine — 节奏变化，叙事推进
 * - 高潮（50-70%）：all-hero / double-hero / panorama-hero — 大图震撼，情感峰值
 * - 收尾（70-100%）：closing / tail-hero / valley — 柔和收束，余韵悠长
 */
function getNarrativePool(progress: number): TierPattern[] {
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

/** 根据照片数和参数计算目标布局参数 */
function computeLayoutParams(
  photos: Photo[],
  config: GooglePhotosConfig,
  scoredPhotos: PhotoScore[],
  pageIdx?: number,
  recentPatterns?: Set<TierPattern>,
  albumProgress?: number,  // P1-2 叙事节奏：当前页在相册中的进度（0-1）
): LayoutParams {
  const photoCount = photos.length;

  // 单页覆盖：从统一的 pageOverrides 读取（取消选中后数据仍保留）
  const pageOverride = pageIdx != null ? config.pageOverrides?.get(pageIdx) : undefined;
  const density = pageOverride?.density ?? config.density ?? 'auto';
  const rhythm = pageOverride?.rhythm ?? config.layoutRhythm ?? 'auto';
  const seed = pageOverride?.seed;

  // 平均宽高比 → 驱动布局倾向
  const avgAspect = photoCount > 0
    ? photos.reduce((s, p) => s + (p.width > 0 && p.height > 0 ? p.width / p.height : 1), 0) / photoCount
    : 1.5;
  // density 影响行数：large→照片更大/行数更多，compact→照片更小/行数更少
  const densityDivisor = (() => {
    switch (density) {
      case 'large': return 1.2;
      case 'sparse': return 1.4;
      case 'balanced': return 1.8;
      case 'compact': return 2.2;
      default: return avgAspect < 0.85 ? 1.2 : avgAspect > 1.15 ? 1.8 : 1.5;
    }
  })();
  let rows = Math.max(1, Math.ceil(photoCount / densityDivisor));

  const allowSpan = true;  // 始终开放跨行检测，由 heroIds 内部筛选候选项

  const hasOutstanding = scoredPhotos.some(s => s.score >= 8);

  // 3 图页面：33% 分 3 行（可跨行），67% 分 2 行（上2下1/上1下2）
  // 3 图页面：横图为主或竖图为主时强制 3 行（每行 1 张，给跨行创造机会）；其他情况 33% 分 3 行，67% 分 2 行
  if (photoCount === 3 && rows === 2) {
    const allLandscape = photos.every(p => p.width > 0 && p.height > 0 && p.width / p.height >= 0.85);
    const allPortrait = photos.every(p => p.width > 0 && p.height > 0 && p.width / p.height < 0.85);
    if (allLandscape || allPortrait || avgAspect > 1.15 || avgAspect < 0.85) {
      rows = 3;
    } else if (photos[0].id.charCodeAt(1) % 3 === 0) {
      rows = 3;
    }
  }

  const lockedTierPattern = pageOverride?.tierPattern;
  // P1-2 叙事节奏：rhythm='auto' 且未锁定 pattern 时，用叙事池驱动选择
  // 若叙事节奏配置全为 0（关闭），则回退到原 selectTierPattern 逻辑
  const narrativeEnabled = config.narrativeRhythm
    ? config.narrativeRhythm.some(v => v > 0)
    : true; // 默认启用
  const useNarrative = narrativeEnabled && rhythm === 'auto' && !lockedTierPattern && albumProgress !== undefined;
  const tierPattern = lockedTierPattern ?? (
    useNarrative
      ? selectTierPatternWithNarrative(photoCount, rows, hasOutstanding, seed, photos, recentPatterns, albumProgress)
      : selectTierPattern(photoCount, rows, hasOutstanding, rhythm, seed, photos, recentPatterns)
  );

  return { rows, tierPattern, allowSpan };
}

/**
 * P1-2 叙事节奏驱动的 pattern 选择：
 * 先用叙事池限定候选，再走原 selectTierPattern 的内容驱动分支细化。
 * 叙事池是"软约束"——若内容驱动分支选出的 pattern 不在叙事池中，
 * 仍接受内容驱动结果（避免"开场段全是竖图却强制 opening"的不合理情况）。
 */
function selectTierPatternWithNarrative(
  N: number,
  rows: number,
  hasOutstanding: boolean,
  seed: number | undefined,
  photos: Photo[],
  recentPatterns: Set<TierPattern> | undefined,
  albumProgress: number,
): TierPattern {
  // 先走原内容驱动选择
  const contentDriven = selectTierPattern(N, rows, hasOutstanding, 'auto', seed, photos, recentPatterns);
  // 拿到当前叙事段位的候选池
  const narrativePool = getNarrativePool(albumProgress);
  // 若内容驱动结果已在叙事池中，直接采用
  if (narrativePool.includes(contentDriven)) return contentDriven;
  // 否则用叙事池过滤行数兼容的 pattern，从中选一个未用过的
  const filtered = filterPatternsByRows(narrativePool, rows);
  if (filtered.length > 0) {
    const idx = seed !== undefined ? Math.abs(seed % 100) : N;
    return pickFromPool(filtered, idx, recentPatterns);
  }
  // 叙事池过滤后为空（行数不兼容），回退内容驱动结果
  return contentDriven;
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

function filterPatternsByRows(pool: TierPattern[], rows: number): TierPattern[] {
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
function pickFromPool(pool: TierPattern[], idx: number, recentPatterns?: Set<TierPattern>): TierPattern {
  if (pool.length === 0) return 'hero-first';
  if (!recentPatterns || recentPatterns.size === 0 || pool.length === 1) return pool[idx % pool.length];
  // 优先选最近没用过的
  const fresh = pool.filter(p => !recentPatterns.has(p));
  const usePool = fresh.length > 0 ? fresh : pool;
  return usePool[idx % usePool.length];
}

/** P0-2: LRU 窗口管理：标记一个模式已用，超出窗口时淘汰最早的 */
const RECENT_PATTERNS_MAX = 5;
function markPatternUsed(recentPatterns: Set<TierPattern>, pattern: TierPattern): void {
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

function selectTierPattern(
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

function buildPageSpecs(scored: PhotoScore[], config: GooglePhotosConfig): PageSpec[] {
  const dateGrouping = config.dateGrouping ?? 'strict';
  const density = config.density;
  const dateGapDays = config.dateGapDays ?? DEFAULT_DATE_GAP_DAYS;
  const dateGroups = groupByDate(scored, dateGapDays, dateGrouping);
  const specs: PageSpec[] = [];
  // 跨页避免模式重复：随着页面生成逐步记录已用模式
  const recentPatterns = new Set<TierPattern>();

  // P1-2 叙事节奏：用照片总数估测相册进度（每页生成时计算）
  // 估测公式：已处理照片数 / 总照片数
  const totalPhotos = scored.length;
  let processedPhotos = 0;
  const computeProgress = () => totalPhotos > 0 ? processedPhotos / totalPhotos : 0;

  // 密度 → 每页基准照片数
  const perPageBase = (d: GooglePhotosDensity): number => {
    switch (d) {
      case 'auto': return 4; // auto 在循环内按组动态调整
      case 'large': return 3;
      case 'sparse': return 4;
      case 'balanced': return 5;
      case 'compact': return 6;
    }
  };

  const smallGroupLimit = (d: GooglePhotosDensity): number => {
    switch (d) { case 'large': return 4; case 'sparse': return 5; case 'balanced': return 4; case 'compact': return 3; case 'auto': return 4; }
  };

  const tailLimit = (d: GooglePhotosDensity): number => {
    switch (d) { case 'large': return 3; case 'sparse': return 4; case 'balanced': return 3; case 'compact': return 2; case 'auto': return 3; }
  };

  for (const group of dateGroups) {
    const N = group.length;
    if (N === 0) continue;

    // auto 密度：根据内容动态决定每页照片数
    const perPage = density === 'auto' ? autoPerPage(group) : perPageBase(density);

    // 小组直接单页
    if (N <= smallGroupLimit(density)) {
      const photos = group.map(s => s.photo);
      const progress = computeProgress();
      const layout = computeLayoutParams(photos, config, group, specs.length, recentPatterns, progress);
      markPatternUsed(recentPatterns, layout.tierPattern);
      specs.push({ layout, photos, scoredPhotos: group });
      processedPhotos += N;
      continue;
    }

    let idx = 0;
    const firstCount = Math.min(density === 'large' ? 2 : perPage - 1, N);
    const firstPhotos = group.slice(idx, idx + firstCount).map(s => s.photo);
    const firstProgress = computeProgress();
    const firstLayout = computeLayoutParams(firstPhotos, config, group.slice(idx, idx + firstCount), specs.length, recentPatterns, firstProgress);
    markPatternUsed(recentPatterns, firstLayout.tierPattern);
    specs.push({ layout: firstLayout, photos: firstPhotos, scoredPhotos: group.slice(idx, idx + firstCount) });
    processedPhotos += firstCount;
    idx += firstCount;

    while (idx < N) {
      const rem = N - idx;
      const tl = tailLimit(density);
      if (rem <= Math.max(2, tl)) {
        const tailPhotos = group.slice(idx).map(s => s.photo);
        const tailProgress = computeProgress();
        const tailLayout = computeLayoutParams(tailPhotos, config, group.slice(idx), specs.length, recentPatterns, tailProgress);
        markPatternUsed(recentPatterns, tailLayout.tierPattern);
        specs.push({ layout: tailLayout, photos: tailPhotos, scoredPhotos: group.slice(idx) });
        processedPhotos += rem;
        break;
      }

      // auto 模式：每页动态调整
      // P0-1 修复：原代码 `Math.max(2, rem - 2)` 是空语句（计算结果未赋值）
      // 原意是当剩余照片减去本页后只剩 1 张时，缩小本页容量把那 1 张并入，避免尾页只有 1 张
      let count = density === 'auto' ? autoPageCount(group.slice(idx), rem) : Math.min(perPage, rem);
      if (rem - count <= 1 && count >= 3) count = Math.max(2, rem - 2);
      const pagePhotos = group.slice(idx, idx + count).map(s => s.photo);
      const pageProgress = computeProgress();
      const pageLayout = computeLayoutParams(pagePhotos, config, group.slice(idx, idx + count), specs.length, recentPatterns, pageProgress);
      markPatternUsed(recentPatterns, pageLayout.tierPattern);
      specs.push({ layout: pageLayout, photos: pagePhotos, scoredPhotos: group.slice(idx, idx + count) });
      processedPhotos += count;
      idx += count;
    }
  }

  // P1-3: 尾页照片过少时（≤2 张），合并到上一页避免视觉单薄。
  // 在 buildPageSpecs 返回前对 specs 做后处理。
  if (specs.length >= 2) {
    const last = specs[specs.length - 1];
    const minTailPhotos = 3; // 尾页少于 3 张视为单薄
    if (last.photos.length < minTailPhotos) {
      const prev = specs[specs.length - 2];
      // 合并到上一页：照片 + 评分数据
      prev.photos = [...prev.photos, ...last.photos];
      prev.scoredPhotos = [...prev.scoredPhotos, ...last.scoredPhotos];
      // 上一页照片数变多，重新计算 LayoutParams（可能切到不同 tierPattern）
      // 但保留原 rhythm/density/seed，避免引入新的随机性
      const prevOverride = config.pageOverrides?.get(specs.length - 2);
      const prevConfig: GooglePhotosConfig = {
        ...config,
        pageOverrides: new Map([[0, prevOverride ?? {}]]),
      };
      // 合并后该页已是相册末尾，progress 设为 0.95（收尾段）
      prev.layout = computeLayoutParams(prev.photos, prevConfig, prev.scoredPhotos, 0, recentPatterns, 0.95);
      specs.pop();
    }
  }

  return specs;
}

/** P1-1: 跨页节奏规划——避免连续多页 hero 位置重复导致视觉单调。
 *
 *  规则 1：连续 2 页 heroPlacement 相同时，把当前页的 tierPattern 替换为
 *         一个 heroPlacement 不同的等价 pattern（行数约束兼容）。
 *  规则 2（P0-1 集成）：连续 2 页 hero 照片主色冲突（饱和度高 + 色相接近）时，
 *         切换 pattern 减少色彩面积，避免视觉疲劳。
 *  注意：仅替换 spec.layout.tierPattern，不重新分配照片，避免破坏时间顺序。
 */
function planCrossPageRhythm(
  specs: PageSpec[],
  contentInfoCache?: Map<string, import('./content-aware').PhotoContentInfo>,
): PageSpec[] {
  if (specs.length <= 1) return specs;

  // 同一 heroPlacement 类别的 pattern 池（用于切换）
  const placementCategories: Record<string, TierPattern[]> = {
    first: ['tail-hero', 'center-focus', 'valley', 'closing'],
    last: ['hero-first', 'opening', 'center-focus', 'valley'],
    center: ['hero-first', 'tail-hero', 'opening', 'closing', 'bold'],
    'first-and-last': ['center-focus', 'valley', 'cascade', 'alternate'],
    'first-and-second': ['tail-hero', 'closing', 'center-focus', 'valley'],
    none: ['hero-first', 'tail-hero', 'center-focus', 'opening'],
  };

  // P0-1 集成：从 spec.scoredPhotos 找 hero 照片的 contentInfo（取最高分照片）
  // 缺失 contentInfo 时返回 undefined，isColorConflict 会返回 false（不触发切换）
  const getHeroContentInfo = (spec: PageSpec): import('./content-aware').PhotoContentInfo | undefined => {
    if (!contentInfoCache || spec.scoredPhotos.length === 0) return undefined;
    const bestScore = Math.max(...spec.scoredPhotos.map(s => s.score));
    const heroScored = spec.scoredPhotos.find(s => s.score === bestScore);
    return heroScored ? contentInfoCache.get(heroScored.photo.id) : undefined;
  };

  let lastPlacement = getHeroPlacement(specs[0].layout.tierPattern);
  let lastHeroColor = getHeroContentInfo(specs[0]);
  let sameCount = 0;

  for (let i = 1; i < specs.length; i++) {
    const spec = specs[i];
    const currentPlacement = getHeroPlacement(spec.layout.tierPattern);
    const currentHeroColor = getHeroContentInfo(spec);

    // P0-1 色彩冲突检测：连续 2 页 hero 主色冲突时强制切换 pattern
    const colorConflict = lastHeroColor && currentHeroColor
      ? isColorConflictRef(lastHeroColor, currentHeroColor)
      : false;

    if (currentPlacement === lastPlacement) {
      sameCount++;
      if (sameCount >= 1 && (currentPlacement !== 'none' || colorConflict)) {
        // 连续 2 页同位置 或 色彩冲突，尝试切换
        const altPool = placementCategories[currentPlacement] ?? placementCategories.none;
        const rows = spec.layout.rows;
        // 找一个行数兼容且 heroPlacement 不同的 pattern
        for (const alt of altPool) {
          const c = patternRowConstraints(alt);
          if (rows < c.min || (c.max !== undefined && rows > c.max)) continue;
          if (getHeroPlacement(alt) === currentPlacement) continue;
          spec.layout.tierPattern = alt;
          break;
        }
        // 重置计数（无论是否成功切换，都给一页缓冲）
        sameCount = 0;
        lastPlacement = getHeroPlacement(spec.layout.tierPattern);
        lastHeroColor = getHeroContentInfo(spec);
      }
    } else {
      // P0-1：即使 placement 不同，若色彩冲突也尝试切换（hero 行更小 = 色彩面积更小）
      if (colorConflict) {
        const altPool = placementCategories[currentPlacement] ?? placementCategories.none;
        const rows = spec.layout.rows;
        for (const alt of altPool) {
          const c = patternRowConstraints(alt);
          if (rows < c.min || (c.max !== undefined && rows > c.max)) continue;
          // 色彩冲突时优先选 hero 行更少的 pattern（standard 主导，减少色彩面积）
          const altHeroPlacement = getHeroPlacement(alt);
          if (altHeroPlacement === 'none') {
            spec.layout.tierPattern = alt;
            break;
          }
        }
      }
      sameCount = 0;
      lastPlacement = currentPlacement;
      lastHeroColor = currentHeroColor;
    }
  }

  return specs;
}

/** P0-1 集成：包装 isColorConflict 避免循环依赖（content-aware 不应被 layout 反向引用） */
function isColorConflictRef(
  a: import('./content-aware').PhotoContentInfo,
  b: import('./content-aware').PhotoContentInfo,
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

/** 智能密度：根据内容质量+宽高比+位置决定每页照片数 */
function autoPerPage(scored: PhotoScore[]): number {
  const N = scored.length;
  const photos = scored.map(s => s.photo);
  const avgAspect = N > 0 ? photos.reduce((s, p) => s + (p.width > 0 && p.height > 0 ? p.width / p.height : 1), 0) / N : 1.5;
  const hasOutstanding = scored.some(s => s.score >= 8);

  if (hasOutstanding && N <= 4) return 3;       // 杰出照片 → 2-3张/页
  if (avgAspect < 0.85 && N >= 3) return 4;     // 竖图为主 → 3-4张/页
  if (avgAspect > 1.15 && N >= 8) return 6;     // 横图大量 → 5-6张/页
  return 5;                                       // 默认 4-5张/页
}

/** auto 模式下每页动态照片数 */
function autoPageCount(group: PhotoScore[], remaining: number): number {
  const perPage = autoPerPage(group);
  // 日期组首页少放
  if (remaining === group.length) return Math.min(perPage - 1, remaining);
  return Math.min(perPage, remaining);
}

/* ═══════════════════════════════════════
   4. 每页精确行生成
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
 */
function computeRowForGroup(
  photos: Photo[],
  contentWidth: number,
  gap: number,
  tier: RowTier,
  pattern: TierPattern,
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
  const mul = getTierMultiplier(pattern, tier);
  return { photos, rowHeight: baseH * mul, tier };
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

function generateRowsForSpec(spec: PageSpec, contentWidth: number, gap: number): JustifiedRow[] {
  const { layout, photos, scoredPhotos } = spec;
  if (photos.length === 0) return [];

  // 3图页面 50% 概率交替 上多下少 / 上少下多
  const reversePattern = photos.length === 3
    && photos.reduce((s, p) => s + p.id.charCodeAt(p.id.length - 1), 0) % 2 === 1;
  let groups = splitIntoGroups(photos, layout.rows, reversePattern);
  // 3图页面且预期3行但分组只给了2行：强制每张独占一行（给跨行创造机会）
  if (photos.length === 3 && layout.rows === 3 && groups.filter(g => g.length > 0).length === 2) {
    const all = groups.flat();
    groups = [[all[0]], [all[1]], [all[2]]];
  }

  // 按模式把高光照片入位到 hero 行
  groups = placeHeroesIntoGroups(groups, scoredPhotos, layout.tierPattern);

  const tiers = autoTier(layout.tierPattern, groups.length);

  return groups
    .filter(g => g.length > 0)
    .map((group, i) => computeRowForGroup(group, contentWidth, gap, tiers[i] || 'standard', layout.tierPattern));
}

/* ═══════════════════════════════════════
   5. 竖图跨行检测
   ═══════════════════════════════════════ */

/** 扫描行列表，将「1 张竖图/英雄横图 + 下一行」合并为跨行 SpanGroup。
 *  pageIdx 用于决定竖图在左/右，保证同一页内稳定且跨页交替。 */
function detectSpanOpportunities(
  rows: JustifiedRow[],
  gap: number,
  heroIds?: Set<string>,
  pageIdx = 0,
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
      // 标准竖图始终跨行；非严格候选 50% 随机；第 1 行非严格候选额外 50% 跳过（给第 2 行跨行机会）
      const randBit1 = p.id.charCodeAt(i) % 2 === 0;
      const skipForRow1 = i === 0 && !isStrictPortrait && p.id.charCodeAt(2) % 2 === 0;
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
          // 左右交替：由页码 + 当前页内已生成 span 数共同决定，稳定且避免连续同侧
          const side: 'left' | 'right' = ((pageIdx + spanCount) % 2 === 0) ? 'left' : 'right';
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

/* ═══════════════════════════════════════
   6. 页面填充（拉伸填满安全区）
   ═══════════════════════════════════════ */

export function fillPage(
  pageRows: (JustifiedRow | SpanGroup)[],
  contentWidth: number,
  contentHeight: number,
  marginLeft: number,
  marginTop: number,
  gap: number,
  biasX = 0,
  biasY = 0,
  pattern: TierPattern = 'hero-first',
): GooglePhotosPage {
  const photos: PhotoRect[] = [];
  if (pageRows.length === 0) return { photos };

  // 计算等效行数 + 总高度（Y bias 在此前置，确保比例关系不受 scaleFactor 和末端校准干扰）
  let totalRowH = 0;
  const rowCount = pageRows.length;
  // 存储每行在 Y bias 后的高度，供第二遍定位使用
  const biasedHeights: number[] = [];
  let rowIdx = 0;
  for (const item of pageRows) {
    let h: number;
    if ('type' in item && item.type === 'span') {
      h = item.portraitTotalHeight;
    } else {
      h = (item as JustifiedRow).rowHeight;
    }
    // Y bias 前置：基于行位置进行高度压缩/扩展
    if (biasY !== 0) {
      const nY = biasY / 10;
      // rowCount=1 时 t=0，bias 不影响高度（单行填满全页，无需重分配）
      const t = rowCount > 1 ? 1 - 2 * rowIdx / (rowCount - 1) : 0;
      h *= clamp(1.0 - nY * t, 0.08, 3.0);
    }
    biasedHeights.push(h);
    totalRowH += h;
    rowIdx++;
  }
  // ── 行高度比保护：最矮行 ≥ 最高行的 1/8，防止极端 bias 导致某行不可见 ──
  if (biasedHeights.length > 1) {
    const maxBH = Math.max(...biasedHeights);
    const minRatio = 0.125; // 最大比值 8:1
    for (let i = 0; i < biasedHeights.length; i++) {
      if (biasedHeights[i] < maxBH * minRatio) {
        biasedHeights[i] = maxBH * minRatio;
      }
    }
    totalRowH = biasedHeights.reduce((s, v) => s + v, 0);
  }
  const fixedGaps = (rowCount - 1) * gap;
  const scaleFactor = totalRowH > 0 ? (contentHeight - fixedGaps) / totalRowH : 1;
  let y = marginTop;
  rowIdx = 0;

  for (const item of pageRows) {
    if ('type' in item && item.type === 'span') {
      const s = item as SpanGroup;
      const rawTotalH = biasedHeights[rowIdx] * scaleFactor;
      const a = s.portraitPhoto.width > 0 && s.portraitPhoto.height > 0
        ? clamp(s.portraitPhoto.width / s.portraitPhoto.height, MIN_ASPECT, MAX_ASPECT) : 0.75;

      // ── 权重：每个子行用 computeRowForGroup 计算占比，按比例分配 rawTotalH ──
      const trialW = contentWidth * 0.4;
      const weights: number[] = [];
      for (const sr of s.subRows) {
        if (sr.photos.length === 0) { weights.push(0); continue; }
        const r = computeRowForGroup(sr.photos, trialW, gap, 'standard', pattern);
        weights.push(Math.max(0.01, r.rowHeight));
      }
      const wSum = weights.reduce((sum, w) => sum + w, 0);

      // 竖图宽度按原始比例计算，clamp 到 [10%, 75%] CW（放宽范围以承载 X bias 视觉变化）；
      // 关键：portraitPh 始终等于 rawTotalH，保证 scaleFactor 的拉伸效果不被破坏，填满安全区无底部留白
      // 竖图 slot 为 pw × portraitPh，照片 cover-fit 进去（竖图会裁切左右，但比例不变形）
      let pw = a * rawTotalH;
      const portraitPh = rawTotalH;
      const minPW = contentWidth * 0.10;
      const maxPW = contentWidth * 0.75;
      if (pw < minPW) pw = minPW;
      if (pw > maxPW) pw = maxPW;
      // ── 三者联动 ①：竖图宽度直接响应 X bias，作为子行宽度变化的主导信号 ──
      // 竖图在左：正 nX → 竖图变宽；竖图在右：正 nX → 竖图变窄（子行相对变宽）
      if (biasX !== 0) {
        const nX = biasX / 10;
        const direction = s.side === 'left' ? 1 : -1;
        const factor = clamp(1.0 + nX * direction * 0.6, 0.45, 1.6);
        pw *= factor;
        if (pw < minPW) pw = minPW;
        if (pw > maxPW) pw = maxPW;
      }
      // 三者联动 ②：rw 随 pw 反向变化（自动），子行总宽度跟随竖图联动
      const rw = contentWidth - pw - gap;

      // 子行按权重比例分配高度（与竖图等高，保持对齐）
      const activeCount = weights.filter(w => w > 0).length;
      const subGaps = activeCount > 1 ? (activeCount - 1) * gap : 0;
      const subTotalH = Math.max(1, portraitPh - subGaps);
      const subHeights = weights.map(w => w > 0 ? (w / wSum) * subTotalH : 0);

      // Y bias：SpanGroup 单页布局只有一行，无法通过行高分配生效；
      // 因此对右侧子行做上下压：上压时上方子行变矮、下方子行变高。
      if (biasY !== 0 && activeCount > 1) {
        const nY = biasY / 10;
        for (let si = 0; si < subHeights.length; si++) {
          if (subHeights[si] <= 0) continue;
          const t = (2 * si - (activeCount - 1)) / (activeCount - 1);
          subHeights[si] *= clamp(1.0 + nY * t, 0.15, 3.0);
        }
        // 归一化，保持子行总高度不变
        const newSum = subHeights.reduce((s, v) => s + v, 0);
        if (newSum > 0) {
          const norm = subTotalH / newSum;
          for (let i = 0; i < subHeights.length; i++) subHeights[i] *= norm;
        }
        // 行高度比保护：最矮子行 ≥ 最高子行的 1/8
        const activeHeights = subHeights.filter(h => h > 0);
        if (activeHeights.length > 1) {
          const maxSH = Math.max(...activeHeights);
          const minSubRatio = 0.125;
          for (let i = 0; i < subHeights.length; i++) {
            if (subHeights[i] > 0 && subHeights[i] < maxSH * minSubRatio) {
              subHeights[i] = maxSH * minSubRatio;
            }
          }
          const finalSum = subHeights.reduce((s, v) => s + v, 0);
          if (finalSum > 0) {
            const norm2 = subTotalH / finalSum;
            for (let i = 0; i < subHeights.length; i++) subHeights[i] *= norm2;
          }
        }
      }

      const isLeft = s.side === 'left';
      const portraitX = isLeft ? marginLeft : marginLeft + rw + gap;
      const subBaseX = isLeft ? marginLeft + pw + gap : marginLeft;

      photos.push({ photoId: s.portraitPhoto.id, x: portraitX, y, width: pw, height: portraitPh });

      let sy = y;
      for (let si = 0; si < s.subRows.length; si++) {
        const sr = s.subRows[si];
        const sh = subHeights[si];
        if (sr.photos.length === 0 || sh <= 0) continue;

        let stw = 0; const sws: number[] = [];
        const sn = sr.photos.length;
        for (let spi = 0; spi < sn; spi++) {
          const sp = sr.photos[spi];
          const sa = sp.width > 0 && sp.height > 0 ? clamp(sp.width / sp.height, MIN_ASPECT, MAX_ASPECT) : 1;
          let w = sa * sh;
          // ── 三者联动 ③：子行内部分布同步响应 X bias，但权重弱化 ──
          // 避免与"竖图宽度变化"叠加过强导致子行内 2 张图被过度拉宽/压窄
          if (biasX !== 0 && sn > 1) {
            const nX = biasX / 10;
            const t = (2 * spi - (sn - 1)) / (sn - 1);
            w *= clamp(1.0 - nX * t * 0.4, 0.3, 2.0);
          }
          sws.push(w); stw += w;
        }
        const sg = (sn - 1) * gap;
        const sf = stw > 0 ? (rw - sg) / stw : 1;
        let sx = subBaseX;
        for (let pi = 0; pi < sn; pi++) {
          const fw = sws[pi] * sf;
          photos.push({ photoId: sr.photos[pi].id, x: sx, y: sy, width: fw, height: sh });
          sx += fw + gap;
        }
        sy += sh + gap;
      }
      y += portraitPh + (rowIdx < rowCount - 1 ? gap : 0);
      rowIdx++;
    } else {
      const row = item as JustifiedRow;
      const fh = biasedHeights[rowIdx] * scaleFactor;
      let tw = 0; const ws: number[] = [];
      const n = row.photos.length;
      for (let pi = 0; pi < n; pi++) {
        const p = row.photos[pi];
        const a = p.width > 0 && p.height > 0 ? clamp(p.width / p.height, MIN_ASPECT, MAX_ASPECT) : 1;
        let w = a * fh;
        // X bias：同行内宽度分布（n≥2 同行多张，n=1 单独处理）
        if (biasX !== 0 && n > 1) {
          const nX = biasX / 10;
          const t = (2 * pi - (n - 1)) / (n - 1);
          w *= clamp(1.0 - nX * t, 0.15, 3.0);
        }
        ws.push(w); tw += w;
      }
      const gh = (n - 1) * gap;
      const wsScale = tw > 0 ? (contentWidth - gh) / tw : 1;
      let x = marginLeft;
      for (let pi = 0; pi < n; pi++) {
        const fw = ws[pi] * wsScale;
        photos.push({ photoId: row.photos[pi].id, x, y, width: fw, height: fh });
        x += fw + gap;
      }
      y += fh + (rowIdx < rowCount - 1 ? gap : 0);
      rowIdx++;
    }
  }

  // ── 末端校准（安全间距保护）：X 按行均匀分配+坐标重算，Y 仅底部拉伸，重叠检测回退 ──
  {
    const maxSafeX = marginLeft + contentWidth;
    const maxSafeY = marginTop + contentHeight;
    const eps = 0.05;

    // 保存原始尺寸（重叠检测时用于回退）
    const orig = photos.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height }));

    // ── X 方向：仅修正微小浮点间隙(<0.5mm)，保持原有 x 坐标和偏压效果 ──
    const rows = new Map<number, PhotoRect[]>();
    for (const p of photos) {
      let matched = false;
      for (const [ry, arr] of rows) {
        if (Math.abs(p.y - ry) < 1) { arr.push(p); matched = true; break; }
      }
      if (!matched) rows.set(p.y, [p]);
    }
    for (const [, rowPhs] of rows) {
      let maxRX = 0, totalW = 0;
      for (const p of rowPhs) {
        if (p.x + p.width > maxRX) maxRX = p.x + p.width;
        totalW += p.width;
      }
      const gx = maxSafeX - maxRX;
      // 仅修正微小浮点间隙，保留 X bias 产生的压缩/留白效果
      if (Math.abs(gx) > eps && Math.abs(gx) < 0.5 && totalW > 0) {
        for (const p of rowPhs) p.width += gx * (p.width / totalW);
      }
    }

    // ── Y 方向：仅拉伸底部槽位高度，y 坐标不变（保证不侵入上方行）──
    // 排除跨行竖图（高度≈contentHeight 的 slot），避免误判为底部照片导致与子行重叠回退
    let maxY = 0;
    for (const p of photos) {
      if (p.y + p.height > maxY) maxY = p.y + p.height;
    }
    const gy = maxSafeY - maxY;
    if (Math.abs(gy) > eps) {
      const bottom = photos.filter(p =>
        Math.abs(p.y + p.height - maxY) < eps
        && p.height < contentHeight - eps  // 排除跨行全高 slot
      );
      // 底部缺口直接加到每一张底部照片高度上（它们共享同一个底部边缘）
      for (const p of bottom) p.height += gy;
      // 如果没有符合条件的底部照片（全是跨行全高 slot），直接拉伸最后一个 slot
      if (bottom.length === 0 && photos.length > 0) {
        const last = photos[photos.length - 1];
        last.height += gy;
      }
    }

    // ── 顶部校准：拉伸顶部槽位，填充顶部留白 ──
    let minY = Infinity;
    for (const p of photos) {
      if (p.y < minY) minY = p.y;
    }
    const gyTop = minY - marginTop;
    if (Math.abs(gyTop) > eps) {
      const top = photos.filter(p => Math.abs(p.y - minY) < eps);
      for (const p of top) {
        p.y = marginTop;
        p.height += gyTop;
      }
    }

    // ── 重叠检测：校准后检查任意两个槽位是否重叠，重叠则回退 ──
    for (let i = 0; i < photos.length; i++) {
      for (let j = i + 1; j < photos.length; j++) {
        const a = photos[i], b = photos[j];
        const yOverlap = a.y < b.y + b.height - eps && b.y < a.y + a.height - eps;
        const xOverlap = a.x < b.x + b.width - eps && b.x < a.x + a.width - eps;
        if (yOverlap && xOverlap) {
          // 回退重叠的槽位到原始尺寸
          photos[i].x = orig[i].x; photos[i].y = orig[i].y;
          photos[i].width = orig[i].width; photos[i].height = orig[i].height;
          photos[j].x = orig[j].x; photos[j].y = orig[j].y;
          photos[j].width = orig[j].width; photos[j].height = orig[j].height;
        }
      }
    }
  }

  return { photos };
}

/* ═══════════════════════════════════════
   单页重排（边距/间距/偏压变更时保持行结构）
   ═══════════════════════════════════════ */

/** 用已保存的 layoutRows 元数据重建行结构，用新的几何参数重新 fillPage */
export function refitPage(
  rowsMeta: Array<{
    type?: 'span'; portraitPhotoId?: string; portraitTotalHeight?: number;
    photoIds?: string[]; subRows?: Array<{ photoIds: string[]; rowHeight: number; tier?: RowTier }>;
    rowHeight?: number; side?: 'left' | 'right'; tier?: RowTier;
  }>,
  photoMap: Map<string, Photo>,
  contentWidth: number, contentHeight: number,
  marginLeft: number, marginTop: number, gap: number,
  biasX: number, biasY: number,
  pattern: TierPattern = 'hero-first',
): GooglePhotosPage {
  const pageRows: (JustifiedRow | SpanGroup)[] = [];
  for (const m of rowsMeta) {
    if (m.type === 'span' && m.portraitPhotoId != null) {
      const portraitPhoto = photoMap.get(m.portraitPhotoId);
      if (!portraitPhoto) continue;
      const subRows = (m.subRows || []).map(sr => {
        const photos = (sr.photoIds || []).map(id => photoMap.get(id)).filter((p): p is Photo => p != null);
        const tier = sr.tier ?? 'standard';
        const row = computeRowForGroup(photos, contentWidth * 0.4, gap, tier, pattern);
        return { photos, rowHeight: row.rowHeight || sr.rowHeight, tier };
      }).filter(sr => sr.photos.length > 0);
      if (subRows.length === 0) continue;
      const totalH = (m.portraitTotalHeight || 0) || portraitPhoto.width > 0 && portraitPhoto.height > 0
        ? (contentWidth / clamp(portraitPhoto.width / portraitPhoto.height, 0.5, 2)) : contentWidth * 0.3;
      pageRows.push({
        type: 'span', portraitPhoto,
        portraitTotalHeight: totalH,
        subRows,
        side: m.side ?? 'left',
        tier: m.tier ?? 'standard',
      });
    } else if ((m.photoIds || []).length > 0) {
      const photos = (m.photoIds || []).map(id => photoMap.get(id)).filter((p): p is Photo => p != null);
      if (photos.length > 0) {
        pageRows.push(computeRowForGroup(photos, contentWidth, gap, m.tier ?? 'standard', pattern));
      }
    }
  }
  return fillPage(pageRows, contentWidth, contentHeight, marginLeft, marginTop, gap, biasX, biasY, pattern);
}

/** 将 mm 坐标矩形从 base 页面坐标系按内容区中心旋转 90° 整数倍，映射到 target 页面坐标系 */
function rotateMmRect(
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

/** 基于基准行结构做偏压填充，再按当前旋转角度从 base 页面坐标系映射到 target 页面坐标系 */
export function refitPageWithRotation(
  rowsMeta: Array<{
    type?: 'span'; portraitPhotoId?: string; portraitTotalHeight?: number;
    photoIds?: string[]; subRows?: Array<{ photoIds: string[]; rowHeight: number; tier?: RowTier }>;
    rowHeight?: number; side?: 'left' | 'right'; tier?: RowTier;
  }>,
  photoMap: Map<string, Photo>,
  baseContentWidth: number, baseContentHeight: number,
  marginLeft: number, marginTop: number, gap: number,
  biasX: number, biasY: number,
  rotation: 0 | 90 | 180 | 270,
  basePageWidth: number, basePageHeight: number,
  targetPageWidth: number, targetPageHeight: number,
  pageMargin: PageMarginSettings,
  pattern: TierPattern = 'hero-first',
): GooglePhotosPage {
  const basePage = refitPage(rowsMeta, photoMap, baseContentWidth, baseContentHeight, marginLeft, marginTop, gap, biasX, biasY, pattern);
  if (rotation === 0) return basePage;
  return {
    photos: basePage.photos.map((p) => ({
      ...p,
      ...rotateMmRect(p.x, p.y, p.width, p.height, basePageWidth, basePageHeight, targetPageWidth, targetPageHeight, pageMargin, rotation),
    })),
  };
}

/* ═══════════════════════════════════════
   主入口
   ═══════════════════════════════════════ */

export function googlePhotosLayout(
  photos: Photo[],
  config: GooglePhotosConfig,
): GooglePhotosLayoutResult {
  const { pageWidth, pageHeight, margin, gap } = config;

  const contentWidth = pageWidth - margin.left - margin.right;
  const contentHeight = pageHeight - margin.top - margin.bottom;

  if (contentWidth <= 0 || contentHeight <= 0 || photos.length === 0) {
    return { pages: [], internalRows: [], layoutRows: [], tierPatterns: [], totalPhotos: 0, totalPages: 0 };
  }

  // 1. 评分（P0-2 集成：传入 contentInfoCache 启用人脸维度）
  const scored = scorePhotos(photos, config.contentInfoCache);

  // 2. 构建页面规格（按类型拆分照片，精确控制每页数量）
  let pageSpecs = buildPageSpecs(scored, config);

  // P1-1: 跨页节奏规划——避免连续多页 hero 位置重复
  // P0-1 集成：传入 contentInfoCache 启用色彩冲突检测
  pageSpecs = planCrossPageRhythm(pageSpecs, config.contentInfoCache);

  // 3. 每页独立生成行 + 竖图跨行检测 + 填充
  const internalRows: Array<{ photoIds: string[]; rowHeight: number }[]> = [];
  const layoutRows: GooglePhotosLayoutResult['layoutRows'] = [];
  const tierPatterns: TierPattern[] = [];
  const pages = pageSpecs.map((spec, specIdx) => {
    const rows = generateRowsForSpec(spec, contentWidth, gap);
    const bestScore = Math.max(...spec.scoredPhotos.map(s => s.score));
    const heroIds = new Set(spec.scoredPhotos.filter(s => s.score >= bestScore).map(s => s.photo.id));
    const spanned = spec.layout.allowSpan ? detectSpanOpportunities(rows, gap, heroIds, specIdx) : rows;
    const flatIds: { photoIds: string[]; rowHeight: number }[] = [];
    const lr: typeof layoutRows[number] = [];
    for (const item of spanned) {
      if ('type' in item && item.type === 'span') {
        const s = item as SpanGroup;
        flatIds.push({ photoIds: [s.portraitPhoto.id], rowHeight: s.portraitTotalHeight });
        for (const sr of s.subRows) {
          flatIds.push({ photoIds: sr.photos.map((p: Photo) => p.id), rowHeight: sr.rowHeight });
        }
        lr.push({
          type: 'span', portraitPhotoId: s.portraitPhoto.id,
          portraitTotalHeight: s.portraitTotalHeight,
          subRows: s.subRows.map(sr => ({ photoIds: sr.photos.map(p => p.id), rowHeight: sr.rowHeight, tier: sr.tier })),
          side: s.side,
          tier: s.tier,
        });
      } else {
        const r = item as JustifiedRow;
        flatIds.push({ photoIds: r.photos.map((p) => p.id), rowHeight: r.rowHeight });
        lr.push({ photoIds: r.photos.map(p => p.id), rowHeight: r.rowHeight, tier: r.tier });
      }
    }
    internalRows.push(flatIds);
    layoutRows.push(lr);
    tierPatterns.push(spec.layout.tierPattern);
    // 单页偏压覆盖：仅从 pageOverrides 读取，无条目则 0（其他页不受影响）
    const pageOverride = config.pageOverrides?.get(specIdx);
    const bx = pageOverride?.biasX ?? 0;
    const by = pageOverride?.biasY ?? 0;
    return fillPage(spanned, contentWidth, contentHeight, margin.left, margin.top, gap, bx, by, spec.layout.tierPattern);
  });

  return {
    pages,
    internalRows,
    layoutRows,
    tierPatterns,
    totalPhotos: photos.length,
    totalPages: pages.length,
  };
}

/** 多版本生成 + 美学择优
 * ──────────────────────────────────────────────────
 * P2-1: 跑 N 个 seed 生成多个版本，用启发式评分挑出 Top-K 给用户挑选。
 * 评分维度：
 *   1. 模式多样性（不同 pattern 数量越多越好）
 *   2. 跨页 hero 位置变化（连续相同 heroPlacement 扣分）
 *   3. 每页照片数分布合理性（避免极端单页 1 张或 8 张）
 *
 * 用法：UI 调用 generateMultipleLayouts(photos, config, 5) 拿 5 个版本，
 *      展示 3 个预览给用户挑选，用户选定后写回 editorStore。
 */
export function generateMultipleLayouts(
  photos: Photo[],
  config: GooglePhotosConfig,
  versionCount = 5,
  topK = 3,
): Array<{ result: GooglePhotosLayoutResult; score: number; seed: number }> {
  const versions: Array<{ result: GooglePhotosLayoutResult; score: number; seed: number }> = [];

  // 第一遍：用基线 config 获取页数，用于后续为每页注入不同 seed
  const baseline = googlePhotosLayout(photos, config);
  const pageCount = baseline.totalPages;

  for (let i = 0; i < versionCount; i++) {
    const seed = i * 37 + 11; // 不同的 seed 产生不同模式选择
    // 为每页注入 seed，影响 selectTierPattern 的 idx（产生版本差异）
    const pageOverrides = new Map<number, PageOverride>();
    for (let p = 0; p < pageCount; p++) {
      pageOverrides.set(p, { seed: seed + p * 7 });
    }
    const versionedConfig: GooglePhotosConfig = { ...config, pageOverrides };
    const result = i === 0 ? baseline : googlePhotosLayout(photos, versionedConfig);
    const score = evaluateLayoutQuality(result, photos, config.contentInfoCache);
    versions.push({ result, score, seed });
    // P0-fix: 仅在已生成 >= topK 个版本时才允许提前结束，避免结果数组不足 topK 条
    //   导致调用方 SmartLayoutView 默认 selectedPreviewIndex=1 越界崩溃
    if (versions.length >= topK && score >= 95) break;
  }

  // 按 score 降序，取 Top-K
  versions.sort((a, b) => b.score - a.score);
  return versions.slice(0, topK);
}

/**
 * 启发式评估排版质量：分数越高表示视觉变化越丰富、节奏越好。
 * P0-4 扩展：在原有 4 维度基础上新增 4 维度，总分上限提升至 ~180。
 *
 * 原有维度（1-4）：
 *   1. 模式多样性（上限 +30）
 *   2. 跨页 hero 位置连续重复扣分（-8/次）
 *   3. 每页照片数分布合理性（+2 / -3）
 *   4. 总页数合理性（+10）
 *
 * P0-4 新增维度（5-8）：
 *   5. 行高方差：奖励中等变异系数（CV∈[0.2,0.7] +15），过低=单调，过高=混乱
 *   6. hero 平均分：每页最高分照片的均分（归一化到 0-20），越高=hero 选择越好
 *   7. 色彩冲突：相邻页 hero 主色冲突每次扣 5（上限 -15）
 *   8. 跨行利用率：使用 SpanGroup 的页数占比（+3/页，上限 +15）
 */
function evaluateLayoutQuality(
  result: GooglePhotosLayoutResult,
  photos: Photo[],
  contentInfoCache?: Map<string, import('./content-aware').PhotoContentInfo>,
): number {
  let score = 0;
  const { pages, tierPatterns, internalRows, layoutRows } = result;

  // 1. 模式多样性：不同 pattern 数量（越多越好，上限 +30）
  const uniquePatterns = new Set(tierPatterns).size;
  score += Math.min(uniquePatterns * 5, 30);

  // 2. 跨页 hero 位置变化（连续相同扣分）
  let consecutiveSameCount = 0;
  let lastPlacement: string | null = null;
  for (const pattern of tierPatterns) {
    const placement = getHeroPlacement(pattern);
    if (placement === lastPlacement && placement !== 'none') {
      consecutiveSameCount++;
    } else {
      consecutiveSameCount = 0;
    }
    lastPlacement = placement;
  }
  score -= consecutiveSameCount * 8; // 每次连续相同扣 8 分

  // 3. 每页照片数分布合理性（每页 3-6 张为佳）
  for (const page of pages) {
    const n = page.photos.length;
    if (n >= 3 && n <= 6) score += 2;
    else if (n === 1 || n >= 8) score -= 3; // 极端单页扣分
  }

  // 4. 总页数合理性（避免单页塞太多）
  if (pages.length > 0) {
    const avgPhotosPerPage = pages.reduce((s, p) => s + p.photos.length, 0) / pages.length;
    if (avgPhotosPerPage >= 4 && avgPhotosPerPage <= 5) score += 10;
  }

  // 5. P0-4 行高方差：奖励中等变异系数（CV∈[0.2,0.7]），过低=单调，过高=混乱
  //    从 internalRows 收集所有行高，计算变异系数 CV = std/mean
  const allRowHeights: number[] = [];
  for (const rows of internalRows) {
    for (const r of rows) allRowHeights.push(r.rowHeight);
  }
  if (allRowHeights.length >= 2) {
    const mean = allRowHeights.reduce((s, h) => s + h, 0) / allRowHeights.length;
    if (mean > 0) {
      const variance = allRowHeights.reduce((s, h) => s + (h - mean) ** 2, 0) / allRowHeights.length;
      const cv = Math.sqrt(variance) / mean; // 变异系数
      if (cv >= 0.2 && cv <= 0.7) score += 15; // 节奏感好
      else if (cv > 0.1 && cv < 0.8) score += 8; // 接近理想
    }
  }

  // 6 & 7. P0-4 hero 平均分 + 色彩冲突：共用一次评分计算
  //    重算全量评分（与 scorePhotos 一致），构建 scoreMap，供两维度复用
  if (photos.length > 0 && pages.length > 0) {
    const scored = scorePhotos(photos, contentInfoCache);
    const scoreMap = new Map<string, number>();
    for (const s of scored) scoreMap.set(s.photo.id, s.score);

    // 6. hero 平均分：每页最高分照片的均分，归一化到 0-20
    let heroScoreSum = 0;
    let heroCount = 0;
    for (const page of pages) {
      if (page.photos.length === 0) continue;
      const pageMax = Math.max(...page.photos.map((pr) => scoreMap.get(pr.photoId) ?? 0));
      heroScoreSum += pageMax;
      heroCount++;
    }
    if (heroCount > 0) {
      const avgHeroScore = heroScoreSum / heroCount; // 0-14（评分满分）
      score += Math.round((avgHeroScore / 14) * 20); // 归一化到 0-20
    }

    // 7. 色彩冲突：相邻页 hero 主色冲突每次扣 5（上限 -15）
    if (contentInfoCache && pages.length >= 2) {
      // hero = 每页评分最高的照片
      const getHeroColor = (page: typeof pages[number]): import('./content-aware').PhotoContentInfo | undefined => {
        if (page.photos.length === 0) return undefined;
        let bestScore = -1;
        let heroId: string | null = null;
        for (const pr of page.photos) {
          const sc = scoreMap.get(pr.photoId) ?? 0;
          if (sc > bestScore) { bestScore = sc; heroId = pr.photoId; }
        }
        return heroId ? contentInfoCache.get(heroId) : undefined;
      };
      let conflicts = 0;
      let lastColor = getHeroColor(pages[0]);
      for (let i = 1; i < pages.length; i++) {
        const curColor = getHeroColor(pages[i]);
        if (lastColor && curColor && isColorConflictRef(lastColor, curColor)) {
          conflicts++;
        }
        lastColor = curColor;
      }
      score -= Math.min(conflicts * 5, 15);
    }
  }

  // 8. P0-4 跨行利用率：使用 SpanGroup（竖图跨行）的页数占比，+3/页，上限 +15
  if (layoutRows.length > 0) {
    let spanPageCount = 0;
    for (const pageRows of layoutRows) {
      if (pageRows.some(r => r.type === 'span')) spanPageCount++;
    }
    score += Math.min(spanPageCount * 3, 15);
  }

  return Math.max(0, score);
}

/**
 * 单页排版：把所有照片塞进一页，跳过 buildPageSpecs 的多页分页逻辑。
 * 用于编辑器中给单个 GP 页面增删照片后的重排，确保不因分页启发式拆分照片。
 * 完整复用 scorePhotos → computeLayoutParams → generateRowsForSpec → detectSpanOpportunities → fillPage 管线。
 */
export function layoutSinglePage(
  photos: Photo[],
  config: GooglePhotosConfig,
  seed?: number,
): GooglePhotosLayoutResult {
  const { pageWidth, pageHeight, margin, gap } = config;

  const contentWidth = pageWidth - margin.left - margin.right;
  const contentHeight = pageHeight - margin.top - margin.bottom;

  if (contentWidth <= 0 || contentHeight <= 0 || photos.length === 0) {
    return { pages: [], internalRows: [], layoutRows: [], tierPatterns: [], totalPhotos: 0, totalPages: 0 };
  }

  // 1. 评分（P0-2 集成：传入 contentInfoCache 启用人脸维度）
  const scored = scorePhotos(photos, config.contentInfoCache);

  // 2. 构造单个 PageSpec（所有照片一页，不分页）
  // 通过 pageOverrides 传入 seed，让 computeLayoutParams 内的 tier pattern 选择更多变
  const pageOverrides = new Map<number, PageOverride>(config.pageOverrides);
  const baseOverride = pageOverrides.get(0) ?? {};
  if (seed !== undefined) baseOverride.seed = seed;
  pageOverrides.set(0, baseOverride);
  const singleConfig: GooglePhotosConfig = { ...config, pageOverrides };
  const layout = computeLayoutParams(photos, singleConfig, scored, 0);
  const spec: PageSpec = { layout, photos, scoredPhotos: scored };

  // 3. 行生成 + 跨行检测 + 填充（与 googlePhotosLayout 单页逻辑完全一致）
  const rows = generateRowsForSpec(spec, contentWidth, gap);
  const bestScore = scored.length > 0 ? Math.max(...scored.map(s => s.score)) : 0;
  const heroIds = new Set(scored.filter(s => s.score >= bestScore).map(s => s.photo.id));
  const spanned = spec.layout.allowSpan ? detectSpanOpportunities(rows, gap, heroIds, 0) : rows;

  // 序列化 internalRows + layoutRows（与 googlePhotosLayout 对齐）
  const flatIds: { photoIds: string[]; rowHeight: number }[] = [];
  const lr: GooglePhotosLayoutResult['layoutRows'][number] = [];
  for (const item of spanned) {
    if ('type' in item && item.type === 'span') {
      const s = item as SpanGroup;
      flatIds.push({ photoIds: [s.portraitPhoto.id], rowHeight: s.portraitTotalHeight });
      for (const sr of s.subRows) {
        flatIds.push({ photoIds: sr.photos.map((p: Photo) => p.id), rowHeight: sr.rowHeight });
      }
      lr.push({
        type: 'span', portraitPhotoId: s.portraitPhoto.id,
        portraitTotalHeight: s.portraitTotalHeight,
        subRows: s.subRows.map(sr => ({ photoIds: sr.photos.map(p => p.id), rowHeight: sr.rowHeight, tier: sr.tier })),
        side: s.side,
        tier: s.tier,
      });
    } else {
      const r = item as JustifiedRow;
      flatIds.push({ photoIds: r.photos.map((p) => p.id), rowHeight: r.rowHeight });
      lr.push({ photoIds: r.photos.map(p => p.id), rowHeight: r.rowHeight, tier: r.tier });
    }
  }

  // 单页偏压：从 pageOverrides 的 pageIdx=0 读取
  const pageOverride = pageOverrides.get(0);
  const bx = pageOverride?.biasX ?? 0;
  const by = pageOverride?.biasY ?? 0;
  const page = fillPage(spanned, contentWidth, contentHeight, margin.left, margin.top, gap, bx, by, spec.layout.tierPattern);

  return {
    pages: [page],
    internalRows: [flatIds],
    layoutRows: [lr],
    tierPatterns: [spec.layout.tierPattern],
    totalPhotos: photos.length,
    totalPages: 1,
  };
}
