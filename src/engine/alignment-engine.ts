/* ═══════════════════════════════════════
   对齐辅助引擎 (简化版)
   ──────────────────────────────────────
   拖拽/缩放照片位时自动检测对齐关系：
   - 页面边对齐（左/右/上/下边缘）
   - 页面居中对齐（水平/垂直中线）
   - 页面边距对齐（用户设置的 margin 边界）
   - 照片槽边对齐（其他槽位的左/右/上/下边缘）
   - 照片槽居中对齐（其他槽位的水平/垂直中心）

   设计原则：
   - 每个轴只取最近的一个吸附偏移，避免漂移
   - 辅助线去重（相同位置只画一条）
   - 页面级辅助线贯穿整个页面，槽位级辅助线连接两个元素
   ═══════════════════════════════════════ */

/** 引导线类型 */
export type GuideType = 'edge' | 'center' | 'margin';

export type GuideLine = {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;          // x（vertical）或 y（horizontal）坐标
  type: GuideType;           // 引导线类型，用于着色
  label?: string;            // 距离标注文字
  /** 辅助线绘制的起止范围（逻辑坐标），省略时由 Canvas 层决定 */
  rangeStart?: number;
  rangeEnd?: number;
};

export type SnapResult = {
  guides: GuideLine[];
  offsetX: number;
  offsetY: number;
};

export type AlignBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 基础吸附阈值（像素，会按缩放等级调整） */
const BASE_SNAP_THRESHOLD = 6;

/**
 * 根据缩放等级计算自适应阈值。
 * zoom 越大（放大越多），屏幕像素对应的逻辑像素越大，阈值应越小。
 */
function adaptiveThreshold(zoom: number): number {
  if (zoom <= 0) return BASE_SNAP_THRESHOLD;
  return Math.max(3, Math.round(BASE_SNAP_THRESHOLD / zoom));
}

export interface FindSnapOptions {
  /** 当前画布缩放等级，用于自适应阈值 */
  zoom?: number;
  /** 是否禁用吸附（Alt 键按下时为 true）：仍返回引导线，但 offset 为 0 */
  disableSnap?: boolean;
  /** 页面边距（逻辑像素），用于边距对齐 */
  margin?: { left: number; right: number; top: number; bottom: number };
}

/* ═══════════════════════════════════════
   对齐目标点构建
   ═══════════════════════════════════════ */

type SnapTarget = {
  value: number;
  type: GuideType;
  bounds?: AlignBounds;  // 目标元素的 bounds（undefined = 页面级目标）
};

/**
 * 构建 X 轴对齐目标点（垂直辅助线）
 */
function buildXTargets(
  pageWidth: number,
  margin: FindSnapOptions['margin'],
  targets: { id: string; bounds: AlignBounds }[],
): SnapTarget[] {
  const result: SnapTarget[] = [];

  // 页面边
  result.push({ value: 0, type: 'edge' });
  result.push({ value: pageWidth, type: 'edge' });

  // 页面中线（居中对齐）
  result.push({ value: pageWidth / 2, type: 'center' });

  // 页面边距
  if (margin) {
    if (margin.left > 0) result.push({ value: margin.left, type: 'margin' });
    if (margin.right > 0) result.push({ value: pageWidth - margin.right, type: 'margin' });
  }

  // 其他照片槽
  for (const t of targets) {
    result.push({ value: t.bounds.x, type: 'edge', bounds: t.bounds });
    result.push({ value: t.bounds.x + t.bounds.width, type: 'edge', bounds: t.bounds });
    result.push({ value: t.bounds.x + t.bounds.width / 2, type: 'center', bounds: t.bounds });
  }

  return result;
}

/**
 * 构建 Y 轴对齐目标点（水平辅助线）
 */
function buildYTargets(
  pageHeight: number,
  margin: FindSnapOptions['margin'],
  targets: { id: string; bounds: AlignBounds }[],
): SnapTarget[] {
  const result: SnapTarget[] = [];

  // 页面边
  result.push({ value: 0, type: 'edge' });
  result.push({ value: pageHeight, type: 'edge' });

  // 页面中线（居中对齐）
  result.push({ value: pageHeight / 2, type: 'center' });

  // 页面边距
  if (margin) {
    if (margin.top > 0) result.push({ value: margin.top, type: 'margin' });
    if (margin.bottom > 0) result.push({ value: pageHeight - margin.bottom, type: 'margin' });
  }

  // 其他照片槽
  for (const t of targets) {
    result.push({ value: t.bounds.y, type: 'edge', bounds: t.bounds });
    result.push({ value: t.bounds.y + t.bounds.height, type: 'edge', bounds: t.bounds });
    result.push({ value: t.bounds.y + t.bounds.height / 2, type: 'center', bounds: t.bounds });
  }

  return result;
}

/* ═══════════════════════════════════════
   主入口：findSnap
   — 简化版：仅边/中心/边距对齐，无等间距/等尺寸
   — 每轴取最近的一个吸附偏移
   — 辅助线按位置去重
   ═══════════════════════════════════════ */

export function findSnap(
  moving: AlignBounds,
  targets: { id: string; bounds: AlignBounds }[],
  pageWidth: number,
  pageHeight: number,
  options?: FindSnapOptions,
): SnapResult {
  const zoom = options?.zoom ?? 1;
  const disableSnap = options?.disableSnap ?? false;
  const margin = options?.margin;
  const threshold = adaptiveThreshold(zoom);

  // 移动元素的对齐检测点
  const mLeft = moving.x;
  const mRight = moving.x + moving.width;
  const mCenterX = moving.x + moving.width / 2;
  const mTop = moving.y;
  const mBottom = moving.y + moving.height;
  const mCenterY = moving.y + moving.height / 2;

  // 构建目标点
  const xTargets = buildXTargets(pageWidth, margin, targets);
  const yTargets = buildYTargets(pageHeight, margin, targets);

  // 移动元素检测点
  const xMovingPoints = [mLeft, mRight, mCenterX];
  const yMovingPoints = [mTop, mBottom, mCenterY];

  /* ── 辅助线范围计算 ── */
  function computeRange(
    targetBounds: AlignBounds | undefined,
    orientation: 'horizontal' | 'vertical',
  ): { start: number; end: number } {
    if (!targetBounds) {
      // 页面级辅助线：贯穿整个页面
      if (orientation === 'vertical') {
        return { start: 0, end: pageHeight };
      } else {
        return { start: 0, end: pageWidth };
      }
    }
    // 槽位级辅助线：连接移动元素和目标元素
    if (orientation === 'vertical') {
      return {
        start: Math.min(moving.y, targetBounds.y),
        end: Math.max(moving.y + moving.height, targetBounds.y + targetBounds.height),
      };
    } else {
      return {
        start: Math.min(moving.x, targetBounds.x),
        end: Math.max(moving.x + moving.width, targetBounds.x + targetBounds.width),
      };
    }
  }

  /* ── X 轴匹配（垂直辅助线）── */
  const xGuides = new Map<string, GuideLine>();
  let bestOffsetX = 0;
  let bestDistX = Infinity;

  for (const mv of xMovingPoints) {
    for (const xt of xTargets) {
      const dist = Math.abs(xt.value - mv);
      if (dist >= threshold) continue;

      // 记录最近偏移
      if (dist < bestDistX) {
        bestDistX = dist;
        bestOffsetX = xt.value - mv;
      }

      // 生成辅助线（按位置去重，保留先匹配的类型）
      const key = `v-${xt.value.toFixed(2)}`;
      if (!xGuides.has(key)) {
        const range = computeRange(xt.bounds, 'vertical');
        xGuides.set(key, {
          id: key,
          orientation: 'vertical',
          position: xt.value,
          type: xt.type,
          rangeStart: range.start,
          rangeEnd: range.end,
        });
      }
    }
  }

  /* ── Y 轴匹配（水平辅助线）── */
  const yGuides = new Map<string, GuideLine>();
  let bestOffsetY = 0;
  let bestDistY = Infinity;

  for (const mv of yMovingPoints) {
    for (const yt of yTargets) {
      const dist = Math.abs(yt.value - mv);
      if (dist >= threshold) continue;

      // 记录最近偏移
      if (dist < bestDistY) {
        bestDistY = dist;
        bestOffsetY = yt.value - mv;
      }

      // 生成辅助线（按位置去重）
      const key = `h-${yt.value.toFixed(2)}`;
      if (!yGuides.has(key)) {
        const range = computeRange(yt.bounds, 'horizontal');
        yGuides.set(key, {
          id: key,
          orientation: 'horizontal',
          position: yt.value,
          type: yt.type,
          rangeStart: range.start,
          rangeEnd: range.end,
        });
      }
    }
  }

  const allGuides = [...xGuides.values(), ...yGuides.values()];

  return {
    guides: allGuides,
    offsetX: disableSnap ? 0 : bestOffsetX,
    offsetY: disableSnap ? 0 : bestOffsetY,
  };
}
