/**
 * types 基础层不变量冒烟测试
 *
 * 背景：P1 把 src/types/index.ts 拆成了 7 个领域文件 + barrel。本测试是拆分的"安全网"：
 * 锁定基础层不变量——模板库未截断、封面/封底判定、尺寸预设、水印默认值、形状/便签常量都完好。
 * 纯粹只读断言，不导入任何 store / DOM。数据被搬丢或索引被误改时立即失败。
 */
import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  SIZE_PRESETS,
  ALBUM_SIZES,
  ALBUM_TYPES,
  SHAPE_TYPES,
  STICKY_COLORS,
  BRUSH_STYLE_MAP,
  COVER_TEMPLATE_PREFIX,
  BACK_COVER_TEMPLATE_PREFIX,
  isCoverPage,
  isBackCoverPage,
  isCoverOrBackCoverPage,
  resolveTemplate,
  GOOGLE_PHOTOS_TEMPLATE_ID,
  findTemplateById,
  normalizeSlotCornerRadius,
  DEFAULT_WATERMARK_SETTINGS,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_SHAPE_STYLE,
} from '../types';

describe('types 基础层不变量', () => {
  it('TEMPLATES 模板库未截断：非空、id 唯一、含封面/封底模板', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // 无重复 id
    expect(TEMPLATES.every((t) => t.id)).toBe(true);
    // 库足够大（原为约 1400 行的大数组），且封面/封底模板都在
    expect(TEMPLATES.length).toBeGreaterThan(50);
    expect(TEMPLATES.some((t) => t.id.startsWith(COVER_TEMPLATE_PREFIX))).toBe(true);
    expect(TEMPLATES.some((t) => t.id.startsWith(BACK_COVER_TEMPLATE_PREFIX))).toBe(true);
  });

  it('封面/封底判定按前缀，普通页不误判', () => {
    expect(isCoverPage({ templateId: `${COVER_TEMPLATE_PREFIX}xx` })).toBe(true);
    expect(isBackCoverPage({ templateId: `${BACK_COVER_TEMPLATE_PREFIX}xx` })).toBe(true);
    expect(isCoverOrBackCoverPage({ templateId: `${COVER_TEMPLATE_PREFIX}xx` })).toBe(true);
    expect(isCoverOrBackCoverPage({ templateId: `${BACK_COVER_TEMPLATE_PREFIX}xx` })).toBe(true);
    expect(isCoverOrBackCoverPage({ templateId: 'content' })).toBe(false);
    expect(isCoverPage({ templateId: 'content' })).toBe(false);
  });

  it('resolveTemplate 按 id 命中；带 slotOverrides 的空 id 走 Google Photos 虚拟模板', () => {
    const known = TEMPLATES[0].id;
    expect(resolveTemplate({ templateId: known })?.id).toBe(known);
    // 有 slotOverrides 的空 templateId → 虚拟模板；无 overrides 则为 undefined（不崩）
    const virtual = resolveTemplate({ templateId: '', slotOverrides: { a: { x: 0, y: 0, width: 100, height: 100 } } });
    expect(virtual?.id).toBe('__google_photos__');
    expect(virtual?.slots.map((s) => s.id)).toEqual(['a']);
    expect(resolveTemplate({ templateId: '' })).toBeUndefined();
    // GP 页被「删空」后 slotOverrides 被清为 {}，仍须返回有效空虚拟模板（避免模板塌陷为 undefined）
    const emptiedGp = resolveTemplate({ templateId: GOOGLE_PHOTOS_TEMPLATE_ID, slotOverrides: {} });
    expect(emptiedGp?.id).toBe(GOOGLE_PHOTOS_TEMPLATE_ID);
    expect(emptiedGp?.slots).toEqual([]);
  });

  it('findTemplateById 命中/未命中', () => {
    expect(findTemplateById(TEMPLATES[0].id)?.id).toBe(TEMPLATES[0].id);
    expect(findTemplateById('__no_such_template__')).toBeUndefined();
  });

  it('normalizeSlotCornerRadius 归一化', () => {
    expect(normalizeSlotCornerRadius(undefined)).toBe(2);
    expect(normalizeSlotCornerRadius(4)).toBe(4);
    const avg = normalizeSlotCornerRadius([6, 10, 14, 18] as never);
    expect(avg).toBe((6 + 10 + 14 + 18) / 4);
  });

  it('尺寸与类型预设非空且结构正确', () => {
    expect(SIZE_PRESETS.length).toBeGreaterThan(0);
    expect(ALBUM_SIZES.length).toBeGreaterThan(0);
    expect(ALBUM_TYPES.length).toBeGreaterThan(0);
    expect(SIZE_PRESETS.every((s) => s.width > 0 && s.height > 0)).toBe(true);
  });

  it('形状/颜色/笔刷常量完好', () => {
    expect(SHAPE_TYPES.length).toBeGreaterThan(0);
    for (const t of ['rectangle', 'circle', 'triangle', 'line'] as const) {
      expect(SHAPE_TYPES).toContain(t);
    }
    expect(STICKY_COLORS.length).toBeGreaterThan(0);
    expect(Object.keys(BRUSH_STYLE_MAP).length).toBeGreaterThan(0);
    expect(DEFAULT_TEXT_LINE_HEIGHT).toBeGreaterThan(0);
    expect(DEFAULT_SHAPE_STYLE).toBeTruthy();
  });

  it('水印默认设置形状正确', () => {
    expect(DEFAULT_WATERMARK_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_WATERMARK_SETTINGS.showDate).toBe(true);
    expect(DEFAULT_WATERMARK_SETTINGS.showLocation).toBe(true);
    expect(['coarse', 'standard', 'detailed']).toContain(DEFAULT_WATERMARK_SETTINGS.locationGranularity);
  });
});