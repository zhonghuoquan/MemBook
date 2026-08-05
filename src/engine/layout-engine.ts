/* ═══════════════════════════════════════
   智能编排引擎 (Auto Layout Engine)
   ──────────────────────────────────────
   Phase 1：按日期分组 → 模板匹配 → 同组轮换 → 多页拆分
   Phase 2：方向感知评分 + 确定性模板选取
   ═══════════════════════════════════════ */

import { TEMPLATES } from '../types';
import type { Photo, Template } from '../types';

/* ── 输出类型 ── */

/** 一页的编排结果 */
export type LayoutPage = {
  templateId: string;
  photoIds: string[];   // 按填充顺序排列
};

/** 整体编排方案 */
export type LayoutPlan = {
  pages: LayoutPage[];
  totalPhotos: number;
  totalPages: number;
};

/** 多页拆分方案（供用户预览选择） */
export type SplitPlan = {
  label: string;
  pages: LayoutPage[];
};

/** 编排配置 */
export type LayoutConfig = {
  density: 'sparse' | 'normal' | 'dense';
  coverPage: boolean;
};

/* ── 按槽位数分组的模板池 ── */

const templatePool: Record<number, Template[]> = {};
for (const tpl of TEMPLATES) {
  const count = tpl.slots.length;
  if (!templatePool[count]) templatePool[count] = [];
  templatePool[count].push(tpl);
}

/* ── 确定性哈希 ── */

/** djb2 哈希：同样的输入永远产生同样的输出 */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 基于照片 ID 列表生成确定性种子（已排序，结果可复现） */
function hashPhotoIds(photoIds: string[]): number {
  return hashString([...photoIds].sort().join('|'));
}

/* ── 方向感知评分 ── */

/** 根据槽位宽高比判断槽位方向 */
function slotOrientation(slot: { width: number; height: number }): 'landscape' | 'portrait' | 'square' {
  const ratio = slot.width / slot.height;
  if (ratio > 1.3) return 'landscape';
  if (ratio < 0.77) return 'portrait';
  return 'square';
}

/** 对模板与照片列表进行方向匹配评分。
 *  竖图→竖槽 +1，横图→横槽 +1，方形不参与评分。 */
function scoreTemplateFit(tpl: Template, photos: Photo[]): number {
  const slots = tpl.slots;
  let score = 0;
  for (let i = 0; i < Math.min(slots.length, photos.length); i++) {
    const sOrient = slotOrientation(slots[i]);
    const pOrient = photos[i]?.orientation;
    if (sOrient === 'square' || pOrient === 'square') continue;
    if (sOrient === pOrient) score++;
  }
  return score;
}

/* ── 核心函数 ── */

/** 按日期分组（同一天归一组） */
export function groupByDate(photos: Photo[]): Photo[][] {
  const sorted = [...photos].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const groups: Photo[][] = [];
  let currentGroup: Photo[] = [];
  let currentDate = '';

  for (const photo of sorted) {
    const d = new Date(photo.date);
    const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (dateKey !== currentDate) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [photo];
      currentDate = dateKey;
    } else {
      currentGroup.push(photo);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // 合并小分组（1-2 张的与相邻组合并）
  return mergeSmallGroups(groups);
}

/** 合并仅含1-2张照片的小分组到相邻分组 */
function mergeSmallGroups(groups: Photo[][]): Photo[][] {
  const result: Photo[][] = [];
  let buffer: Photo[] = [];

  for (const group of groups) {
    if (group.length <= 2) {
      buffer.push(...group);
      // 积累到至少 3 张时提交
      if (buffer.length >= 3) {
        result.push(buffer);
        buffer = [];
      }
    } else {
      if (buffer.length > 0) {
        // 前一个缓冲并入当前组
        result.push([...buffer, ...group]);
        buffer = [];
      } else {
        result.push(group);
      }
    }
  }
  if (buffer.length > 0) {
    if (result.length > 0) {
      // 追加到最后一组
      result[result.length - 1].push(...buffer);
    } else {
      result.push(buffer);
    }
  }
  return result;
}

/** 拆分大组（>6 张），返回多种拆分方案 */
export function splitLargeGroup(
  photos: Photo[],
  usedTemplates: string[],
  density: 'sparse' | 'normal' | 'dense' = 'normal'
): SplitPlan[] {
  const n = photos.length;
  const plans: SplitPlan[] = [];

  if (n <= 6) {
    // 单页方案
    const tpl = pickTemplate(n, usedTemplates, photos);
    plans.push({
      label: `1页 (${n}图${tpl ? ' · ' + tpl.name : ''})`,
      pages: [{ templateId: tpl?.id || 'full', photoIds: photos.map((p) => p.id) }],
    });
    return plans;
  }

  // 多页：生成 3 种拆分方案
  const perPage = density === 'sparse' ? 3 : density === 'dense' ? 5 : 4;

  // 方案 A：均衡拆分
  const planA = splitEvenly(photos, perPage, [...usedTemplates]);
  plans.push({ label: `均衡 (${planA.map((p) => p.photoIds.length).join('+')})`, pages: planA });

  // 方案 B：头重脚轻（第一页多点）
  if (n >= 7) {
    const photosCopy = [...photos];
    const firstCount = Math.min(perPage + 1, 6);
    const first = photosCopy.splice(0, firstCount);
    const remaining = photosCopy;
    const planB = [
      { templateId: pickTemplate(first.length, usedTemplates, first)?.id || 'full', photoIds: first.map((p) => p.id) },
      ...splitEvenly(remaining, perPage, [...usedTemplates, '']),
    ];
    plans.push({
      label: `头重 (${planB.map((p) => p.photoIds.length).join('+')})`,
      pages: planB,
    });
  }

  // 方案 C：更多页（每页更少照片）
  if (n >= 9) {
    const planC = splitEvenly(photos, Math.max(3, perPage - 1), [...usedTemplates]);
    plans.push({
      label: `丰富 (${planC.map((p) => p.photoIds.length).join('+')})`,
      pages: planC,
    });
  }

  return plans;
}

/** 将照片均匀分配到多页 */
function splitEvenly(
  photos: Photo[],
  perPage: number,
  usedTemplates: string[]
): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let idx = 0;
  while (idx < photos.length) {
    const count = Math.min(perPage, photos.length - idx);
    const slotCount = pickBestSlotCount(count);
    const pagePhotos = photos.slice(idx, idx + slotCount);
    idx += slotCount;

    const tpl = pickTemplate(slotCount, usedTemplates, pagePhotos);
    if (tpl) usedTemplates.push(tpl.id);
    pages.push({
      templateId: tpl?.id || 'full',
      photoIds: pagePhotos.map((p) => p.id),
    });
  }
  return pages;
}

/** 根据照片数选择最合适的槽位数 */
function pickBestSlotCount(photoCount: number): number {
  if (photoCount <= 1) return 1;
  if (photoCount <= 2) return 2;
  if (photoCount <= 3) return 3;
  if (photoCount <= 4) return 4;
  if (photoCount <= 5) return 5;
  return 6;
}

/** 从模板池中选模板：方向感知评分 + 确定性选取（不再使用 Math.random） */
export function pickTemplate(
  slotCount: number,
  usedTemplates: string[],
  photos?: Photo[],
): Template | null {
  if (slotCount > 6) slotCount = 6;
  const pool = templatePool[slotCount];
  if (!pool || pool.length === 0) {
    // 降级：找槽位更少的模板
    for (let c = slotCount - 1; c >= 1; c--) {
      const fallback = templatePool[c];
      if (fallback && fallback.length > 0) return fallback[0];
    }
    return null;
  }

  // 优先选未用过的模板
  let candidates = pool.filter((t) => !usedTemplates.includes(t.id));
  if (candidates.length === 0) {
    candidates = pool; // 都用过了，全部候选
  }

  if (candidates.length === 1) return candidates[0];

  // 方向感知评分：选出最高分
  if (photos && photos.length > 0) {
    const scored = candidates.map((tpl) => ({
      tpl,
      score: scoreTemplateFit(tpl, photos),
    }));
    const maxScore = Math.max(...scored.map((s) => s.score));
    candidates = scored.filter((s) => s.score === maxScore).map((s) => s.tpl);
  }

  // 确定性选取：基于照片 ID 哈希，结果可复现
  if (photos && photos.length > 0) {
    const seed = hashPhotoIds(photos.map((p) => p.id));
    return candidates[seed % candidates.length];
  }

  // 无照片信息时回退到确定性（基于候选模板 ID 排序）
  const seed = hashString(candidates.map((t) => t.id).sort().join(','));
  return candidates[seed % candidates.length];
}

/** 执行编排：输入选中照片，返回编排方案 */
export function autoLayout(
  photos: Photo[],
  config: LayoutConfig = { density: 'normal', coverPage: false }
): { groups: { dateLabel: string; plans: SplitPlan[] }[]; allPlans: SplitPlan[] } {
  const groups = groupByDate(photos);
  const usedTemplates: string[] = [];
  const allPlans: SplitPlan[] = [];

  const result = groups.map((group) => {
    const d = new Date(group[0].date);
    const dateLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const plans = splitLargeGroup(group, usedTemplates, config.density);
    allPlans.push(...plans);
    return { dateLabel, plans };
  });

  return { groups: result, allPlans };
}
