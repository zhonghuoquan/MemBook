/**
 * Google Photos 智能编排引擎 — 守恒性与布局约束测试
 *
 * 核心断言：
 *   1. 照片数守恒：所有输入照片恰好出现一次（无遗漏、无重复）
 *   2. 安全区约束：所有照片矩形不超出页面安全区
 *   3. 零留白：fillPage 拉伸后，每页内容底边贴近安全区底边
 *   4. 矩形不重叠：同页照片两两不相交
 */
import { describe, it, expect } from 'vitest';
import { googlePhotosLayout, generateMultipleLayouts } from './google-photos-layout';
import type { GooglePhotosConfig, RowTier } from './google-photos-layout';
import type { Photo } from '../types';

/* ── 测试夹具 ── */

let seq = 0;
function makePhoto(w: number, h: number, dateDay: string): Photo {
  seq += 1;
  return {
    id: `photo-${seq}`,
    src: '',
    name: `photo${seq}`,
    date: `2024-05-${dateDay}T10:00:00.000Z`,
    width: w,
    height: h,
    orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square',
  };
}

/** 混合横/竖/方图的一组照片，跨 3 天 */
function makePhotos(count: number): Photo[] {
  const shapes: [number, number][] = [
    [4000, 3000], // 横图
    [3000, 4000], // 竖图
    [3000, 3000], // 方图
    [4608, 2592], // 宽横图
  ];
  const days = ['01', '01', '02', '02', '03'];
  return Array.from({ length: count }, (_, i) => {
    const [w, h] = shapes[i % shapes.length];
    return makePhoto(w, h, days[i % days.length]);
  });
}

function makeConfig(overrides: Partial<GooglePhotosConfig> = {}): GooglePhotosConfig {
  return {
    pageWidth: 210,
    pageHeight: 280,
    margin: { top: 15, bottom: 15, left: 15, right: 15 },
    gap: 5,
    density: 'balanced',
    ...overrides,
  };
}

const EPS = 0.51; // 几何断言容差（mm）

/* ── 用例 ── */

describe('googlePhotosLayout', () => {
  it('空输入返回空结果', () => {
    const result = googlePhotosLayout([], makeConfig());
    expect(result.pages).toHaveLength(0);
    expect(result.totalPhotos).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('照片数守恒：所有输入照片恰好出现一次', () => {
    for (const count of [1, 3, 7, 15, 30, 60]) {
      const photos = makePhotos(count);
      const result = googlePhotosLayout(photos, makeConfig());

      const placedIds = result.pages.flatMap((p) => p.photos.map((pr) => pr.photoId));
      // 总数守恒
      expect(placedIds).toHaveLength(count);
      // 无重复
      expect(new Set(placedIds).size).toBe(count);
      // 集合一致
      expect(new Set(placedIds)).toEqual(new Set(photos.map((p) => p.id)));
    }
  });

  it('所有照片矩形都在页面安全区内', () => {
    const config = makeConfig();
    const photos = makePhotos(40);
    const result = googlePhotosLayout(photos, config);

    const { left, right, top, bottom } = config.margin;
    const safeRight = config.pageWidth - right;
    const safeBottom = config.pageHeight - bottom;

    for (const page of result.pages) {
      for (const r of page.photos) {
        expect(r.x).toBeGreaterThanOrEqual(left - EPS);
        expect(r.y).toBeGreaterThanOrEqual(top - EPS);
        expect(r.x + r.width).toBeLessThanOrEqual(safeRight + EPS);
        expect(r.y + r.height).toBeLessThanOrEqual(safeBottom + EPS);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    }
  });

  it('零留白：每页内容底边贴近安全区底边（fillPage 拉伸）', () => {
    const config = makeConfig();
    const photos = makePhotos(40);
    const result = googlePhotosLayout(photos, config);
    const safeBottom = config.pageHeight - config.margin.bottom;

    // 页数 > 1 时，至少前 N-1 页必须是填满的
    const filledPages = result.pages.slice(0, Math.max(1, result.pages.length - 1));
    for (const page of filledPages) {
      const contentBottom = Math.max(...page.photos.map((r) => r.y + r.height));
      expect(contentBottom).toBeGreaterThanOrEqual(safeBottom - 2);
    }
  });

  it('同页照片矩形两两不重叠', () => {
    const photos = makePhotos(30);
    const result = googlePhotosLayout(photos, makeConfig());

    for (const page of result.pages) {
      const rects = page.photos;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          const overlap = overlapX > EPS && overlapY > EPS;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('密度档位均不产生溢出或丢片', () => {
    const photos = makePhotos(25);
    for (const density of ['large', 'sparse', 'balanced', 'compact'] as const) {
      const config = makeConfig({ density });
      const result = googlePhotosLayout(photos, config);
      const placedIds = result.pages.flatMap((p) => p.photos.map((pr) => pr.photoId));
      expect(new Set(placedIds).size).toBe(25);

      const safeBottom = config.pageHeight - config.margin.bottom;
      const safeRight = config.pageWidth - config.margin.right;
      for (const page of result.pages) {
        for (const r of page.photos) {
          expect(r.x + r.width).toBeLessThanOrEqual(safeRight + EPS);
          expect(r.y + r.height).toBeLessThanOrEqual(safeBottom + EPS);
        }
      }
    }
  });

  it('非法配置（内容区 <= 0）返回空结果', () => {
    const photos = makePhotos(5);
    const result = googlePhotosLayout(
      photos,
      makeConfig({ margin: { top: 0, bottom: 0, left: 200, right: 200 } }),
    );
    expect(result.pages).toHaveLength(0);
  });
});

/* ════════════════════════════════════════════════════════════
   P0+P1 优化后新增测试：视觉质量 / 边界场景 / 微调参数 / 跨页节奏
   ════════════════════════════════════════════════════════════ */

describe('P0+P1 优化：视觉质量与节奏', () => {
  it('连续 3 页不应使用相同 tierPattern', () => {
    // 用足够多照片触发多页
    const photos = makePhotos(60);
    const result = googlePhotosLayout(photos, makeConfig({ layoutRhythm: 'auto' }));
    expect(result.totalPages).toBeGreaterThan(3);

    let consecutive = 1;
    let maxConsecutive = 1;
    for (let i = 1; i < result.tierPatterns.length; i++) {
      if (result.tierPatterns[i] === result.tierPatterns[i - 1]) {
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else {
        consecutive = 1;
      }
    }
    // recentPatterns LRU 窗口 + planCrossPageRhythm 应保证连续相同 ≤ 2
    expect(maxConsecutive).toBeLessThanOrEqual(2);
  });

  it('hero 行的行高应大于 standard 行（视觉权重正确）', () => {
    // 使用全横图 + 同日，生成多行大页。
    // 比较策略：
    //   1. 展开所有行（包括 SpanGroup 的 subRows，它们的 tier/rowHeight 是原始信息）
    //   2. 仅比较多照片行（photos >= 2）——单张照片行受 MAX_SINGLE_RATIO 上限约束，
    //      aspect 被压缩到 0.6×aspectSum 导致行高被人为放大，不能反映 tier 倍率差异
    const photos: Photo[] = Array.from({ length: 15 }, () =>
      makePhoto(4000, 3000, '01'),
    );
    const result = googlePhotosLayout(photos, makeConfig());
    let foundHeroVsNonHero = false;
    for (const pageRows of result.layoutRows) {
      // 展开所有行：top-level 非 span 行 + span group 的 subRows
      const allRows: { tier?: RowTier; rowHeight?: number; photos: number }[] = [];
      for (const r of pageRows) {
        if (r.type === 'span') {
          // SpanGroup 本身的 portraitTotalHeight 是 2-3 行累加，不参与比较
          // 但 subRows 的 rowHeight/tier 是原始 JustifiedRow 信息，可单独比较
          for (const sr of r.subRows ?? []) {
            allRows.push({
              tier: sr.tier,
              rowHeight: sr.rowHeight,
              photos: sr.photoIds?.length ?? 0,
            });
          }
        } else {
          allRows.push({
            tier: r.tier,
            rowHeight: r.rowHeight,
            photos: r.photoIds?.length ?? 0,
          });
        }
      }
      // 仅比较多照片行（避免单张照片的 MAX_SINGLE_RATIO 上限干扰 tier 倍率比较）
      const heroRows = allRows.filter(r => r.tier === 'hero' && r.rowHeight && r.photos >= 2);
      const nonHeroRows = allRows.filter(r => r.tier !== 'hero' && r.rowHeight && r.photos >= 2);
      if (heroRows.length > 0 && nonHeroRows.length > 0) {
        const maxHero = Math.max(...heroRows.map(r => r.rowHeight!));
        const maxNonHero = Math.max(...nonHeroRows.map(r => r.rowHeight!));
        // hero 行应 ≥ 非 hero 行（standard/detail），倍率 ≥ 1.2
        expect(maxHero).toBeGreaterThanOrEqual(maxNonHero * 1.2);
        foundHeroVsNonHero = true;
      }
    }
    // 至少一页有 hero / 非 hero 行高区分
    expect(foundHeroVsNonHero).toBe(true);
  });

  it('recentPatterns LRU 窗口：N 页后模式仍能复用', () => {
    // 30 页规模，验证 recentPatterns 不会"全部用过"导致 fresh 永远空
    const photos = makePhotos(150);
    const result = googlePhotosLayout(photos, makeConfig());
    expect(result.totalPages).toBeGreaterThan(10);
    // 不同 pattern 数应 ≥ 3（如果都一样说明去重完全失效）
    const uniquePatterns = new Set(result.tierPatterns).size;
    expect(uniquePatterns).toBeGreaterThanOrEqual(3);
  });
});

describe('P0+P1 优化：边界场景', () => {
  it('尾页照片数 ≥ 3（剩余照片智能合并）', () => {
    // balanced perPage=5，60 张理论上每页 5 张最后正好，但用奇数张测试合并
    const photos = makePhotos(17);
    const result = googlePhotosLayout(photos, makeConfig({ density: 'balanced' }));
    if (result.pages.length >= 2) {
      const lastPage = result.pages[result.pages.length - 1];
      // 尾页 ≥ 3 张（P1-3 合并机制）
      expect(lastPage.photos.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('N=6 balanced 不应产生 1 张尾页', () => {
    const photos = makePhotos(6);
    const result = googlePhotosLayout(photos, makeConfig({ density: 'balanced' }));
    if (result.pages.length >= 2) {
      const lastPage = result.pages[result.pages.length - 1];
      expect(lastPage.photos.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('全竖图应选择竖图友好 pattern', () => {
    // 全竖图：评分应给极端竖图 3 分，能进 hero 候选
    const photos: Photo[] = Array.from({ length: 8 }, (_, i) =>
      makePhoto(3000, 4000, `0${(i % 9) + 1}`),
    );
    const result = googlePhotosLayout(photos, makeConfig());
    expect(result.totalPhotos).toBe(8);
    // 不应崩溃，且每页都有照片
    for (const page of result.pages) {
      expect(page.photos.length).toBeGreaterThan(0);
    }
  });

  it('含全景图应能正常排版', () => {
    // 全景图 aspect ≥ 2.0
    const photos: Photo[] = [
      makePhoto(8000, 3000, '01'), // aspect 2.67 全景
      makePhoto(4000, 3000, '01'), // 横图
      makePhoto(3000, 4000, '01'), // 竖图
      makePhoto(4000, 3000, '01'),
      makePhoto(3000, 3000, '01'),
    ];
    const result = googlePhotosLayout(photos, makeConfig());
    expect(result.totalPhotos).toBe(5);
    // 安全区内
    const config = makeConfig();
    for (const page of result.pages) {
      for (const r of page.photos) {
        expect(r.x).toBeGreaterThanOrEqual(config.margin.left - EPS);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    }
  });

  it('单张照片能正常排版（不崩溃）', () => {
    const photos = [makePhoto(4000, 3000, '01')];
    const result = googlePhotosLayout(photos, makeConfig());
    expect(result.totalPhotos).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.pages[0].photos).toHaveLength(1);
  });
});

describe('P0+P1 优化：微调参数', () => {
  it('biasX 极端值不破坏布局', () => {
    const photos = makePhotos(15);
    const pageOverrides = new Map([[0, { biasX: 10 }]]);
    const result = googlePhotosLayout(
      photos,
      makeConfig({ pageOverrides }),
    );
    expect(result.totalPhotos).toBe(15);
    // 安全区仍约束
    const config = makeConfig({ pageOverrides });
    for (const page of result.pages) {
      for (const r of page.photos) {
        expect(r.x).toBeGreaterThanOrEqual(config.margin.left - EPS);
        expect(r.x + r.width).toBeLessThanOrEqual(config.pageWidth - config.margin.right + EPS);
      }
    }
  });

  it('biasY 极端值不破坏布局', () => {
    const photos = makePhotos(15);
    const pageOverrides = new Map([[0, { biasY: -10 }]]);
    const result = googlePhotosLayout(
      photos,
      makeConfig({ pageOverrides }),
    );
    expect(result.totalPhotos).toBe(15);
    const config = makeConfig({ pageOverrides });
    for (const page of result.pages) {
      for (const r of page.photos) {
        expect(r.y).toBeGreaterThanOrEqual(config.margin.top - EPS);
        expect(r.y + r.height).toBeLessThanOrEqual(config.pageHeight - config.margin.bottom + EPS);
      }
    }
  });

  it('手动锁定 tierPattern 应被尊重', () => {
    const photos = makePhotos(5);
    const pageOverrides = new Map([[0, { tierPattern: 'mosaic' as const }]]);
    const result = googlePhotosLayout(
      photos,
      makeConfig({ pageOverrides }),
    );
    expect(result.tierPatterns[0]).toBe('mosaic');
  });
});

describe('P0+P1 优化：评分公平性', () => {
  it('竖图照片也能成为 hero 候选（评分不为 0）', () => {
    // 内部测试：竖图评分不再永远是 0
    // 这里通过全竖图排版验证不会出现"全是 standard"的退化情况
    const photos: Photo[] = Array.from({ length: 10 }, (_, i) =>
      makePhoto(3000, 4000, `0${(i % 9) + 1}`),
    );
    const result = googlePhotosLayout(photos, makeConfig());
    // 应至少有 1 页包含 hero 行（不全为 standard/detail）
    let hasHeroRow = false;
    for (const pageRows of result.layoutRows) {
      if (pageRows.some(r => r.tier === 'hero')) {
        hasHeroRow = true;
        break;
      }
    }
    expect(hasHeroRow).toBe(true);
  });
});

describe('P2-1 多版本生成', () => {
  it('generateMultipleLayouts 返回 Top-K 版本', () => {
    const photos = makePhotos(30);
    const versions = generateMultipleLayouts(photos, makeConfig(), 3, 2);
    expect(versions.length).toBeLessThanOrEqual(2);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    // 按 score 降序
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].score).toBeLessThanOrEqual(versions[i - 1].score);
    }
  });
});
