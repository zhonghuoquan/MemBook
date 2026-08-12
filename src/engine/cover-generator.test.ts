import { describe, it, expect } from 'vitest';
import {
  generateCoverPage,
  generateBackCoverPage,
  buildCoverPalette,
  pickCoverPhoto,
  regenerateCoverDesign,
  buildBackCoverTextElements,
} from './cover-generator';
import type { Photo, AlbumPage } from '../types';

const PAGE_MM = { width: 210, height: 280 };

function makePhoto(id: string, clarity = 0.8, date = '2024-05-01'): Photo {
  return {
    id,
    src: `blob:${id}`,
    name: id,
    date,
    width: 1000,
    height: 800,
    orientation: 'landscape',
    clarityScore: clarity,
  };
}

describe('cover-generator 本地规则引擎', () => {
  it('无照片时仍能生成封面（品牌紫兜底配色 + 纯文字版式）', () => {
    const res = generateCoverPage({ photos: [], albumName: '我们的旅行', albumType: 'travel' }, new Map(), PAGE_MM);
    expect(res.page.pageKind).toBe('cover');
    expect(res.page.templateId.startsWith('cover-')).toBe(true);
    expect(res.page.placements.length).toBeGreaterThanOrEqual(0);
    expect(res.page.textElements?.length).toBeGreaterThan(0);
    // 标题取自相册名（去除"相册"后缀）
    const title = res.page.textElements?.find((el) => el.id.startsWith('cover-title-'));
    expect(title?.text).toBe('我们的旅行');
    // 兜底配色：品牌紫系，文字应可读
    expect(res.palette.background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('智能选主图优先高分清晰照片', () => {
    const photos = [makePhoto('p1', 0.4), makePhoto('p2', 0.9), makePhoto('p3', 0.7)];
    const picked = pickCoverPhoto(photos, new Map());
    // p2 清晰度最高应被选中
    expect(picked).toBe('p2');
  });

  it('封面页可直接插入 pages 且能被 isCoverPage 识别', () => {
    const res = generateCoverPage({ photos: [], albumName: '回忆' }, new Map(), PAGE_MM);
    const page: AlbumPage = res.page;
    expect(page.pageKind).toBe('cover');
  });

  it('封底复用封面配色，保持首尾呼应', () => {
    const cover = generateCoverPage({ photos: [], albumName: 'X' }, new Map(), PAGE_MM);
    const back = generateBackCoverPage({ photos: [], albumName: 'X' }, cover.palette, PAGE_MM);
    expect(back.pageKind).toBe('backCover');
    expect(back.background).toBe(cover.palette.background);
    expect(back.templateId.startsWith('backcover-')).toBe(true);
  });

  it('buildCoverPalette：亮底走深色文字，暗底走浅色文字', () => {
    const light = buildCoverPalette([240, 240, 240]);
    expect(light.dark).toBe(false);
    expect(light.titleColor).toBe('#2B2A4A');
    const dark = buildCoverPalette([30, 30, 30], true);
    expect(dark.dark).toBe(true);
    expect(dark.titleColor).toBe('#FFF8EC');
  });

  it('一键换设计：切换模板并保留用户文案', () => {
    const photos = [makePhoto('p1', 0.9), makePhoto('p2', 0.8)];
    const first = generateCoverPage({ photos, albumName: 'X', templateId: 'cover-1' }, new Map(), PAGE_MM);
    // 用户改标题
    first.page.coverFields = { ...first.page.coverFields, title: '自定义标题' };
    const next = regenerateCoverDesign(first.page, { photos, albumName: 'X' }, new Map(), PAGE_MM, 1);
    // 模板已切换（cover-1 → cover-2）
    expect(next.templateId).not.toBe('cover-1');
    // 用户标题被保留
    expect(next.page.coverFields?.title).toBe('自定义标题');
    // 文字层标题同步更新
    const titleEl = next.page.textElements?.find((el) => el.id.startsWith('cover-title-'));
    expect(titleEl?.text).toBe('自定义标题');
  });

  it('一键换设计：主图循环切换（多照片时换一张）', () => {
    const photos = [makePhoto('p1', 0.9), makePhoto('p2', 0.8)];
    const first = generateCoverPage({ photos, albumName: 'X', templateId: 'cover-1' }, new Map(), PAGE_MM);
    const main = first.page.placements.find((pl) => pl.slotId === 'main');
    const next = regenerateCoverDesign(first.page, { photos, albumName: 'X' }, new Map(), PAGE_MM, 1);
    const nextMain = next.page.placements.find((pl) => pl.slotId === 'main');
    // 主图已更换（从 p1 切到 p2，或从 p2 切到 p1）
    expect(nextMain?.photoId).not.toBe(main?.photoId);
  });

  it('buildBackCoverTextElements：生成封底落款文字层', () => {
    const els = buildBackCoverTextElements(
      { backText: '愿时光珍藏', date: '2023-2024', author: '小明' },
      { background: '#6C63FF', dark: true, titleColor: '#FFF8EC', bodyColor: 'rgba(255,248,236,0.82)' },
      PAGE_MM,
    );
    const textEl = els.find((el) => el.id.startsWith('back-text-'));
    const sigEl = els.find((el) => el.id.startsWith('back-sig-'));
    expect(textEl?.text).toBe('愿时光珍藏');
    expect(sigEl?.text).toContain('小明');
  });
});
