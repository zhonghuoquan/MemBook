import type { Photo, PageMarginSettings } from '../../types';

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
  contentInfoCache?: Map<string, import('../content-aware').PhotoContentInfo>;
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

/* ── 内部类型（跨子模块共享，需导出；但不经 index 复导出到对外 API）── */

export type PhotoScore = { photo: Photo; score: number };

export type RowTier = 'hero' | 'standard' | 'detail';

export interface JustifiedRow {
  photos: Photo[];
  rowHeight: number;
  tier: RowTier;
}

/** 竖图跨行布局：一张竖图占据 2 行高度，横图分布在剩余宽度中的子行 */
export interface SpanGroup {
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
export interface LayoutParams {
  rows: number;
  tierPattern: TierPattern;
  allowSpan: boolean;  // 是否允许竖图跨行
}

export interface PageSpec {
  layout: LayoutParams;
  photos: Photo[];
  scoredPhotos: PhotoScore[];
}