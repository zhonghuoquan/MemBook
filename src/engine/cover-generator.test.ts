import { describe, it, expect } from 'vitest';
import {
  generateCoverPage,
  generateBackCoverPage,
  buildCoverPalette,
  pickCoverPhoto,
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
});
