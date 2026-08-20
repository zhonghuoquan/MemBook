/**
 * watermarkRenderer — 时间水印渲染逻辑纯函数测试
 *
 * 导出/打印链路加固：锁定水印的文本格式化、展示判定、导出位置计算。
 * 注：formatDate 的"具体日期文本"依赖运行时区，故只断言其格式形状，不锁具体日月。
 */
import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatLocation,
  shouldShowWatermark,
  getWatermarkText,
  calcPageSafeArea,
  calcWatermarkPosition,
} from './watermarkRenderer';
import { DEFAULT_WATERMARK_SETTINGS } from '../types';
import type { AlbumPage, Photo, WatermarkSettings, LocationGranularity } from '../types';

function photo(id: string, date: string, location: string | '', dateSource: string): Photo {
  return { id, name: id, src: '', date, location, dateSource } as unknown as Photo;
}

function page(id: string, slotIds: string[], photoIds: string[]): AlbumPage {
  return {
    id, albumId: 'a', templateId: 'content',
    placements: slotIds.map((slotId, i) => ({ slotId, photoId: photoIds[i] })),
  } as unknown as AlbumPage;
}

const PHOTOS: Photo[] = [
  photo('p1', '2026-03-21T10:00:00.000Z', '浙江省-杭州市-西湖区', 'exif'),
  photo('p2', '2026-03-22T09:00:00.000Z', '浙江省-杭州市-西湖区', 'exif'),
  photo('p3', '2026-03-22T15:00:00.000Z', '上海市-浦东新区', 'modified'),
];

const PAGES: AlbumPage[] = [
  page('pg0', ['s1'], ['p1']),
  page('pg1', ['s1', 's2'], ['p2', 'p3']),
  page('pg2', ['s1'], ['p2']),
];

function settings(overrides: Partial<WatermarkSettings> = {}): WatermarkSettings {
  return { ...DEFAULT_WATERMARK_SETTINGS, enabled: true, ...overrides };
}

describe('formatLocation — 地点格式化按精细度', () => {
  it.each<[LocationGranularity, string, string]>([
    ['coarse', '浙江省-杭州市-西湖区-灵隐街道', '杭州'],
    ['standard', '浙江省-杭州市-西湖区', '杭州 - 西湖区'],
    ['detailed', '浙江省-杭州市-西湖区', '浙江省 - 杭州 - 西湖区'],
  ])('%s 层级: %s → %s', (g, loc, expected) => {
    expect(formatLocation(loc, g)).toBe(expected);
  });
  it('直辖市：粗粒度去"市"，详细从市起', () => {
    expect(formatLocation('上海市-浦东新区-陆家嘴街道', 'coarse')).toBe('上海');
    expect(formatLocation('上海市-浦东新区-陆家嘴街道', 'standard')).toBe('上海 - 浦东新区');
    expect(formatLocation('上海市-浦东新区-陆家嘴街道', 'detailed')).toBe('上海 - 浦东新区 - 陆家嘴街道');
  });
  it('空串/无内容返回空",', () => {
    expect(formatLocation('', 'coarse')).toBe('');
    expect(formatLocation('---', 'standard')).toBe('');
  });
});

describe('formatDate — 日期格式化', () => {
  it('合法 ISO 输出 年/月/日 形状', () => {
    expect(formatDate('2026-03-21T10:30:00.000Z')).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/);
  });
  it('非法/空返回空串', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('shouldShowWatermark — 展示判定', () => {
  it('未开启 → 恒 false', () => {
    expect(shouldShowWatermark(0, PAGES, PHOTOS, settings({ enabled: false }))).toBe(false);
  });
  it('页面无有效日期 → false', () => {
    const noPhoto = [page('x', ['s1'], ['not-exist'])];
    expect(shouldShowWatermark(0, noPhoto, PHOTOS, settings())).toBe(false);
  });
  it('首页始终显示', () => {
    expect(shouldShowWatermark(0, PAGES, PHOTOS, settings())).toBe(true);
  });
  it('改档日期且未开 includeModified → 不显示', () => {
    // pg1 最早日期 03-22，其中 p3 标记为 modified → 该日来自修改
    expect(shouldShowWatermark(1, PAGES, PHOTOS, settings({ includeModified: false }))).toBe(false);
  });
  it('开启 includeModified 后正常判定', () => {
    // pg1 index=1：未达每 6 页强制点，与 pg0(03-21 西湖) 日期不同 → 显示
    expect(shouldShowWatermark(1, PAGES, PHOTOS, settings({ includeModified: true }))).toBe(true);
  });
  it('同一天同地点与上一页相同 → 去重不显示', () => {
    // 连续两页均为 p2（03-22 西湖，含 modified 拦截设为开避免被剔除）：index=1 与上一页日期+地点相同 → false
    const same2 = [page('pgA', ['s1'], ['p2']), page('pgB', ['s1'], ['p2'])];
    expect(shouldShowWatermark(1, same2, PHOTOS, settings({ includeModified: true, showLocation: true }))).toBe(false);
  });
  it('每 6 页强制显示（即便与上一页相同）', () => {
    // 构造 6 页同样日期/地点，index=6 应强制显示
    const samePages = Array.from({ length: 7 }, (_, i) => page(`pg${i}`, ['s1'], ['p2']));
    expect(shouldShowWatermark(6, samePages, PHOTOS, settings())).toBe(true);
  });
});

describe('getWatermarkText — 水印文本', () => {
  it('无地点时仅日期（showDate）', () => {
    expect(getWatermarkText(0, PAGES, [photo('p1', '2026-03-21T10:00:00.000Z', '', 'exif')], settings()))
      .toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/);
  });
  it('仅地点（showDate=false）→ 回退首地点', () => {
    const s = settings({ showDate: false, showLocation: true });
    expect(getWatermarkText(0, PAGES, PHOTOS, s)).toBe('杭州 - 西湖区');
  });
  it('同页同天多地点去重合并', () => {
    const s = settings({ showDate: false, showLocation: true });
    // pg1 同日(03-22) 含 p2(西湖) + p3(浦东) → 合并
    expect(getWatermarkText(1, PAGES, PHOTOS, s)).toBe('杭州 - 西湖区, 上海 - 浦东新区');
  });
  it('showLocation=false 且 showDate=false → 空串', () => {
    expect(getWatermarkText(0, PAGES, PHOTOS, settings({ showDate: false, showLocation: false }))).toBe('');
  });
});

describe('calcPageSafeArea / calcWatermarkPosition — 导出水印位置', () => {
  it('安全区按全局边距占页面比例换算到画布像素，水印贴安全区底', () => {
    const safe = calcPageSafeArea({} as AlbumPage, 210, 280, 420, 560, { left: 20, bottom: 20 });
    expect(safe.left).toBe(Math.round((20 / 210) * 420));
    expect(safe.bottom).toBe(Math.round(560 - (20 / 280) * 560));
    const pos = calcWatermarkPosition(safe.left, safe.bottom, 7);
    expect(pos.x).toBe(safe.left);
    expect(pos.y).toBe(safe.bottom + 4);
  });
});