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
import { googlePhotosLayout, generateMultipleLayouts, layoutSinglePage } from './google-photos-layout';
import type { GooglePhotosConfig, RowTier, TierPattern } from './google-photos-layout';
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

describe('一键成册·布局多元化（seed 驱动）', () => {
  /** 用指定 seed 跑单页排版（通过 pageOverrides 注入第 0 页 seed） */
  function layoutWithSeed(photos: Photo[], seed: number) {
    const overrides = new Map([[0, { seed }]]);
    return googlePhotosLayout(photos, makeConfig({ pageOverrides: overrides }));
  }

  it('确定性：同一 seed 的两次排版结构完全一致', () => {
    const photos = makePhotos(8);
    const a = layoutWithSeed(photos, 42);
    const b = layoutWithSeed(photos, 42);
    expect(a.internalRows).toEqual(b.internalRows);
    expect(a.layoutRows).toEqual(b.layoutRows);
  });

  it('不同 seed 能产出结构差异（换方案有肉眼可见变化）', () => {
    const photos = makePhotos(8);
    const sigs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const r = layoutWithSeed(photos, s * 13 + 5);
      sigs.add(JSON.stringify(r.internalRows));
    }
    // 多 seed 至少产出 >1 种行结构，而不是永远同一套
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('2 图布局既有「并排」也有「叠放」，不再单调', () => {
    const landscape2 = [makePhoto(4000, 3000, '01'), makePhoto(4608, 2592, '01')];
    let saw1Row = false; // 并排=单行
    let saw2Rows = false; // 叠放=两行
    for (let s = 0; s < 40; s++) {
      const r = layoutWithSeed(landscape2, s * 17 + 3);
      const rows = r.internalRows[0] || [];
      if (rows.length === 1) saw1Row = true;
      if (rows.length === 2) saw2Rows = true;
    }
    expect(saw1Row).toBe(true);
    expect(saw2Rows).toBe(true);
  });

  it('3 图布局骨架>1 种：不只上2下1/上1下2', () => {
    const landscape3 = [
      makePhoto(4000, 3000, '01'),
      makePhoto(4608, 2592, '01'),
      makePhoto(4000, 3000, '01'),
    ];
    const sigs = new Set<string>();
    for (let s = 0; s < 60; s++) {
      const r = layoutWithSeed(landscape3, s * 29 + 7);
      sigs.add(JSON.stringify(r.internalRows[0]?.map(x => x.photoIds)));
    }
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('3 图首张竖图 → 触发竖图跨行（一大一小错落）', () => {
    const leadingPortrait = [
      makePhoto(3000, 4000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
    ];
    const r = layoutWithSeed(leadingPortrait, 99);
    // 首张竖图被独立为首行后，跨行检测应合并成 span
    expect(r.layoutRows[0]?.some(row => row.type === 'span')).toBe(true);
  });

  it('3 竖图多 seed 能产出不同版式（跨行主图/左右侧有变化，换版式不再单一）', () => {
    const three = [
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
    ];
    const sigs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const r = layoutWithSeed(three, s * 17 + 5);
      const span = r.layoutRows[0]?.find(x => x.type === 'span');
      // 记录「跨行主图 id + 左右侧」的组合签名；换 seed 应翻出不同主图/左右
      const key = span && span.type === 'span' && span.portraitPhotoId
        ? `${span.portraitPhotoId}|${span.side ?? '?'}`
        : `plain:${JSON.stringify(r.internalRows[0]?.map(x => x.photoIds))}`;
      sigs.add(key);
      // 守恒：3 张都在、不重复
      const ids = r.pages[0].photos.map(p => p.photoId);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    }
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('真实路径 layoutSinglePage：全竖 3 张随机切换能翻出多种骨架（修复 2026-08-27）', () => {
    const three = [
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
    ];
    const densities: GooglePhotosConfig['density'][] = ['large', 'sparse', 'balanced', 'compact'];
    // 骨架签名用「照片矩形宽度分布」而非「行内照片数」：全竖图无论「3 根等宽并列」还是
    // 「1 根大竖 + 2 根小竖叠排」，行内照片数都是 1，`photoIds.length` 恒为 [1,1,1] 无法区分。
    const skeletonSig = (r: ReturnType<typeof layoutSinglePage>): string =>
      [...r.pages[0].photos].map(p => Math.round(p.width)).sort((a, b) => a - b).join(',');
    const skeletons = new Set<string>();
    for (let s = 0; s < 80; s++) {
      const d = densities[s % densities.length];
      const r = layoutSinglePage(three, makeConfig({ density: d }), s * 31 + 7);
      skeletons.add(skeletonSig(r));
      const ids = r.pages[0].photos.map(p => p.photoId);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    }
    // 修复前全竖 3 张恒被捏成 1 种（大竖+2 叠），随机切换无变化；修复后应翻出「横排 3」等宽分布
    // 与「大竖+2 叠」宽窄分布两种以上骨架。
    expect(skeletons.size).toBeGreaterThan(1);
  });

  it('真实路径 layoutSinglePage：全竖 4 张随机切换能翻出多种行数骨架（修复 2026-08-27）', () => {
    const four = [
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
      makePhoto(3000, 4000, '01'),
    ];
    // 模拟随机切换：4 种密度 × seed 迭代，统计行结构签名（含 span）
    const densities: GooglePhotosConfig['density'][] = ['large', 'sparse', 'balanced', 'compact'];
    const skeletonSig = (r: ReturnType<typeof layoutSinglePage>): string =>
      [...r.pages[0].photos].map(p => Math.round(p.width)).sort((a, b) => a - b).join(',');
    const skeletons = new Set<string>();
    for (let s = 0; s < 80; s++) {
      const d = densities[s % densities.length];
      const r = layoutSinglePage(four, makeConfig({ density: d }), s * 31 + 7);
      skeletons.add(skeletonSig(r));
      // 守恒：4 张都在且不重复
      const ids = r.pages[0].photos.map(p => p.photoId);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    }
    // 修复前全竖 4 张被密度锁死为 1 种骨架；修复后应翻出 2+2 方格 / 1+3 条带 / 1+1+2 等多种骨架
    expect(skeletons.size).toBeGreaterThan(1);
  });
});

describe('一键成册·4图骨架与跨页强弱节奏', () => {
  function layoutWithSeed(photos: Photo[], seed: number) {
    const overrides = new Map([[0, { seed }]]);
    return googlePhotosLayout(photos, makeConfig({ pageOverrides: overrides }));
  }

  it('4 图布局存在多结构骨架（对称/hero/错落），不只纯方向切行', () => {
    const four = [
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
    ];
    const sigs = new Set<string>();
    for (let s = 0; s < 60; s++) {
      const r = layoutWithSeed(four, s * 29 + 7);
      sigs.add(JSON.stringify(r.internalRows[0]?.map(x => x.photoIds)));
    }
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('4 图骨架不丢片、不重复（守恒，覆盖多种随机种子）', () => {
    const four = [
      makePhoto(4000, 3000, '01'),
      makePhoto(3000, 4000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(3000, 4000, '01'),
    ];
    for (let s = 0; s < 30; s++) {
      const r = layoutWithSeed(four, s * 7 + 1);
      const ids = r.pages[0].photos.map(p => p.photoId);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    }
  });

  it('跨页 hero 相位强弱交替：整册有强相页也有缓相页，且连续同侧不超过 2 页', () => {
    const photos = makePhotos(60);
    const result = googlePhotosLayout(photos, makeConfig());
    const phases = result.heroPhases;
    expect(phases.length).toBe(result.totalPages);
    const strong = phases.filter(p => p > 1).length;
    const calm = phases.filter(p => p < 1).length;
    // 同时出现强相（大图震撼）与缓相（细节舒缓），避免"每页 hero 都一个重量"
    expect(strong).toBeGreaterThan(0);
    expect(calm).toBeGreaterThan(0);
    // 交替质量：连续同侧（同为强或同为缓）不超过 2 页，防机械单调
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < phases.length; i++) {
      if ((phases[i] >= 1) === (phases[i - 1] >= 1)) {
        run++;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 1;
      }
    }
    expect(maxRun).toBeLessThanOrEqual(2);
    // 平均相位差：强弱起伏肉眼可辨（相邻页平均差 ≥ 0.1）
    const swing = phases.slice(1).reduce((s, p, i) => s + Math.abs(p - phases[i]), 0);
    const avgSwing = swing / (phases.length - 1);
    expect(avgSwing).toBeGreaterThanOrEqual(0.1);
  });

  it('末行竖图保护：3/4 图页面普通行末尾不出现单张竖图（span 子行除外）', () => {
    // 4 图：前 3 横 + 末竖。竖图独占普通末行无法跨行（无下一行可合并），
    // fillPage 归一化后会被拉宽成横带 → 保护须把它并入前一行；
    // span 跨行的竖图子行是既有跨行机制的正常产物，不在此约束内。
    const four = [
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(4000, 3000, '01'),
      makePhoto(3000, 4000, '01'),
    ];
    for (let s = 0; s < 30; s++) {
      const r = layoutWithSeed(four, s * 11 + 3);
      const rows = r.layoutRows[0] ?? [];
      if (rows.length > 0) {
        const lastItem = rows[rows.length - 1];
        const isSpan = 'type' in lastItem && lastItem.type === 'span';
        if (!isSpan && lastItem.photoIds && lastItem.photoIds.length === 1) {
          // 普通行末尾单张 = 只能是横图才安全；输入末张是竖图 → 不该出现
          expect(lastItem.photoIds[0]).not.toBe(four[3].id);
        }
      }
      // 守恒：4 张都在
      const ids = r.pages[0].photos.map(p => p.photoId);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    }
  });
});

/* ════════════════════════════════════════════════════════════
   2026-08-22：三大问题块（≥5图行数抖动 / auto密度疏密曲线 / 叙事节奏优先）
   ════════════════════════════════════════════════════════════ */
describe('一键成册·2026-08-22 布局多元化三块', () => {
  function layoutWithSeed(photos: Photo[], seed: number) {
    const overrides = new Map([[0, { seed }]]);
    return googlePhotosLayout(photos, makeConfig({ pageOverrides: overrides }));
  }

  it('≥5 图：seed 驱动行数抖动，同方向大页也能翻出疏密不同骨架', () => {
    // 5 张全竖图、同日，合并为单页（5 张）。行数 = ceil(5/1.8)±1 抖动 → 2/3/4 行，
    // 换 seed 应翻出行数不同、骨架不同的版式，不再"永远同一套"。
    const five = Array.from({ length: 5 }, () => makePhoto(3000, 4000, '01'));
    const rowCounts = new Set<number>();
    const sigs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const r = layoutWithSeed(five, s * 31 + 9);
      rowCounts.add(r.internalRows[0]?.length ?? 0);
      sigs.add(JSON.stringify(r.internalRows[0]?.map(x => x.photoIds)));
    }
    // 守恒：5 张都在、不重复
    const r0 = layoutWithSeed(five, 9);
    const ids = r0.pages[0]?.photos.map(p => p.photoId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(rowCounts.size).toBeGreaterThan(1);
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('auto 密度：页级疏密曲线让整册每页照片数起伏，不再整册恒定', () => {
    // 同一日大量照片 + auto 密度 → 首页少放 + 后续 ±1 起伏；断言出现 ≥2 种每页张数
    // 且无单图页（曲线已防孤立尾页）。
    const photos = Array.from({ length: 40 }, () => makePhoto(4000, 3000, '01'));
    const result = googlePhotosLayout(photos, makeConfig({ density: 'auto' }));
    const counts = result.pages.map(p => p.photos.length);
    // 守恒
    const placed = result.pages.flatMap(p => p.photos.map(pr => pr.photoId));
    expect(new Set(placed).size).toBe(40);
    expect(result.totalPhotos).toBe(40);
    // 疏密起伏
    expect(counts.length).toBeGreaterThan(1);
    expect(new Set(counts).size).toBeGreaterThan(1);
    // 尾页/单页不单薄
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(2);
  });

  it('auto 密度曲线随方案 seed 起伏：同一批照片换方案翻出不同疏密分页', () => {
    // 首页固定 = 内容基线-1（少放的开场，确定性），但后续页随 seed 在 ±1 间摆动。
    // 因此整册「每页张数序列」应随 seed 变化——换方案时密度节奏不同，而非恒定一种。
    const photos = Array.from({ length: 30 }, () => makePhoto(3000, 4000, '01'));
    const sequences = new Set<string>();
    for (let s = 0; s < 20; s++) {
      // auto 密度 + 每页注入 seed（换方案），疏密曲线随 seed 起伏
      const overrides = new Map([[0, { seed: s * 13 + 3 }]]);
      const r = googlePhotosLayout(photos, makeConfig({ density: 'auto', pageOverrides: overrides }));
      // 守恒：不丢片
      const placed = r.pages.flatMap(p => p.photos.map(pr => pr.photoId));
      expect(new Set(placed).size).toBe(30);
      sequences.add(JSON.stringify(r.pages.map(p => p.photos.length)));
    }
    expect(sequences.size).toBeGreaterThan(1);
  });

  it('叙事节奏优先：开场段 pattern 取自开场池（内容驱动仅兜底）', () => {
    // 全竖图 + 连续分组 + auto 节奏：内容驱动（竖图池）不含 opening/bold/hero-tail，
    // 叙事优先会从开场池里选 → 首帧 pattern 必 ∈ 开场池，证明非内容驱动短路。
    const photos = Array.from({ length: 96 }, () => makePhoto(3000, 4000, '01'));
    const result = googlePhotosLayout(
      photos,
      makeConfig({ layoutRhythm: 'auto', dateGrouping: 'continuous' }),
    );
    expect(result.totalPages).toBeGreaterThan(2);
    const openingPool = new Set<TierPattern>(['opening', 'hero-first', 'bold', 'hero-tail']);
    const firstPattern = result.tierPatterns[0];
    expect(openingPool.has(firstPattern)).toBe(true);
  });
});
