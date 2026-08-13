/* 封面/封底模板库（Mixbook 风格 · 全英文文案 · 含书脊侧边）
 * ──────────────────────────────────────────────────
 * 设计原则：
 *   ① 每款模板自带书脊（左侧 9% 窄条 shape）+ 书脊竖排英文 + 封面正面预设文字/形状/背景；
 *   ② 全英文衬线文案（Georgia），大字距、克制留白，参考 Mixbook 高级感；
 *   ③ slots 与 preset 元素同为百分比坐标（0-100），自适应所有页面尺寸；
 *   ④ 所有元素（照片/文字/形状/书脊）应用后皆为独立可编辑元素，用户可拖动/改色/删改；
 *   ⑤ 占位符仅用于 date（自动填充照片年份区间）；主标题固定英文装饰文案，用户可手动改。
 *
 * 字体约定：
 *   主标题 / 书脊  → Georgia（衬线仪式）
 *   副标题 / 落款  → Georgia italic
 *   日期          → Georgia（数字）
 */
import type { Template } from './index';

/* ════════════════════════════ 封面模板（8 款） ════════════════════════════ */

/** 书脊宽度（百分比），所有封面统一 */
const SPINE_WIDTH = 9;

/**
 * 生成书脊底色 shape（左侧窄条，铺满高度）。
 * 调用方传入书脊底色。
 */
function spineShape(fill: string) {
  return {
    id: 'spine',
    x: 0, y: 0, width: SPINE_WIDTH, height: 100,
    type: 'rectangle' as const,
    fill, stroke: fill, strokeWidth: 0, opacity: 1, rotation: 0,
  };
}

/**
 * 生成书脊竖排文字（位于书脊中央，rotation -90）。
 * 文字框为窄长条，旋转后呈竖排。
 */
function spineText(text: string, color: string) {
  return {
    id: 'spineText',
    x: 2.5, y: 22, width: 4, height: 56,
    text,
    fontSize: 9,
    fontFamily: 'Georgia',
    color,
    align: 'center' as const,
    bold: false,
    italic: false,
    rotation: -90,
    placeholder: 'none' as const,
  };
}

/** A. Minimal White —— 纯白底，中央小图，衬线标题 + 极细装饰线 */
const coverMinimalWhite: Template = {
  id: 'cover-1', name: 'Minimal White', category: 'personality',
  preview: 'full', tags: ['cover', 'minimal', 'serif'],
  slots: [{ id: 'main', x: 24, y: 14, width: 52, height: 46 }],
  presetBackground: '#FAFAF8',
  presetTextElements: [
    spineText('MEMORIES · 2024', '#5A5A66'),
    { id: 'title', x: 12, y: 66, width: 76, height: 12, text: 'MEMORIES', fontSize: 26, fontFamily: 'Georgia', color: '#2A2A3A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 12, y: 80, width: 76, height: 6, text: 'A Photo Memoir', fontSize: 11, fontFamily: 'Georgia', color: '#8A8A9A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 12, y: 88, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#8A8A9A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#E8E6E0'),
    { id: 'divider', x: 42, y: 62, width: 16, height: 0.3, type: 'line', fill: '#2A2A3A', stroke: '#2A2A3A', strokeWidth: 1, opacity: 0.4, rotation: 0 },
  ],
};

/** B. Full Photo —— 全幅照片铺满，底部蒙版 + 反白左对齐标题 */
const coverFullPhoto: Template = {
  id: 'cover-2', name: 'Full Photo', category: 'personality',
  preview: 'full', tags: ['cover', 'fullbleed', 'overlay'],
  slots: [{ id: 'main', x: SPINE_WIDTH, y: 0, width: 100 - SPINE_WIDTH, height: 100 }],
  presetBackground: '#2A3A4A',
  presetTextElements: [
    spineText('JOURNEY', '#C8A868'),
    { id: 'title', x: 14, y: 64, width: 76, height: 14, text: 'JOURNEY', fontSize: 30, fontFamily: 'Georgia', color: '#F8F4ED', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 14, y: 80, width: 76, height: 6, text: 'The Road Ahead', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(248,244,237,0.75)', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 14, y: 88, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: 'rgba(248,244,237,0.6)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#1A2632'),
    { id: 'mask', x: SPINE_WIDTH, y: 50, width: 100 - SPINE_WIDTH, height: 50, type: 'rectangle', fill: 'rgba(0,0,0,0.45)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0 },
    { id: 'accent', x: 14, y: 78, width: 10, height: 0.3, type: 'line', fill: '#F8F4ED', stroke: '#F8F4ED', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** C. Editorial —— 左大图 + 右竖排标题，杂志式分栏 */
const coverEditorial: Template = {
  id: 'cover-3', name: 'Editorial', category: 'personality',
  preview: 'full', tags: ['cover', 'editorial', 'magazine'],
  slots: [{ id: 'main', x: SPINE_WIDTH, y: 0, width: 50, height: 100 }],
  presetBackground: '#FAFAF8',
  presetTextElements: [
    spineText('VOL. 2024', '#F8F4ED'),
    { id: 'title', x: 62, y: 14, width: 32, height: 36, text: 'MEMOIR', fontSize: 24, fontFamily: 'Georgia', color: '#2A2A3A', align: 'center', bold: true, italic: false, rotation: -90, placeholder: 'none' },
    { id: 'subtitle', x: 60, y: 56, width: 36, height: 7, text: 'A PHOTO MEMOIR', fontSize: 9, fontFamily: 'Georgia', color: '#5A5A6A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'issue', x: 60, y: 80, width: 36, height: 6, text: 'Issue No. 01', fontSize: 10, fontFamily: 'Georgia', color: '#9A9AAA', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 60, y: 88, width: 36, height: 5, text: '2024', fontSize: 9, fontFamily: 'Georgia', color: '#9A9AAA', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#2A2A3A'),
    { id: 'divider', x: 62, y: 52, width: 22, height: 0.3, type: 'line', fill: '#2A2A3A', stroke: '#2A2A3A', strokeWidth: 1, opacity: 0.4, rotation: 0 },
  ],
};

/** D. Minimal Black —— 深墨底，居中小图，烫金标题 + 金线 */
const coverMinimalBlack: Template = {
  id: 'cover-4', name: 'Minimal Black', category: 'personality',
  preview: 'full', tags: ['cover', 'dark', 'gold'],
  slots: [{ id: 'main', x: 30, y: 16, width: 40, height: 40 }],
  presetBackground: '#1A1A1E',
  presetTextElements: [
    spineText('MEMORIES · MMXXIV', '#C8A868'),
    { id: 'title', x: 12, y: 60, width: 76, height: 12, text: 'MEMORIES', fontSize: 26, fontFamily: 'Georgia', color: '#C8A868', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 12, y: 74, width: 76, height: 6, text: 'MMXXIV', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(200,168,104,0.7)', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 12, y: 82, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: 'rgba(200,168,104,0.5)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#0E0E12'),
    { id: 'goldLine', x: 40, y: 72, width: 20, height: 0.4, type: 'line', fill: '#C8A868', stroke: '#C8A868', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** E. Collage —— 多图 + 圆形色块，形状工具混搭 */
const coverCollage: Template = {
  id: 'cover-5', name: 'Collage', category: 'personality',
  preview: 'full', tags: ['cover', 'collage', 'shape'],
  slots: [
    { id: 'p1', x: 14, y: 10, width: 36, height: 30 },
    { id: 'p2', x: 54, y: 10, width: 34, height: 24 },
    { id: 'p3', x: 14, y: 44, width: 30, height: 22 },
  ],
  presetBackground: '#F4F2EC',
  presetTextElements: [
    spineText('FOUR MOMENTS', '#F4F2EC'),
    { id: 'title', x: 12, y: 72, width: 76, height: 10, text: 'FOUR MOMENTS', fontSize: 20, fontFamily: 'Georgia', color: '#3A2E22', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 12, y: 84, width: 76, height: 6, text: 'A Year in Frames', fontSize: 11, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 12, y: 90, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#3A2E22'),
    { id: 'circle', x: 54, y: 44, width: 34, height: 22, type: 'ellipse', fill: '#C45A4A', stroke: '#C45A4A', strokeWidth: 0, opacity: 0.85, rotation: 0 },
    { id: 'divider', x: 40, y: 68, width: 20, height: 0.3, type: 'line', fill: '#3A2E22', stroke: '#3A2E22', strokeWidth: 1, opacity: 0.3, rotation: 0 },
  ],
};

/** F. Elegant Serif —— 双线装饰 + 居中大标题 + 底部小图 */
const coverElegantSerif: Template = {
  id: 'cover-6', name: 'Elegant Serif', category: 'personality',
  preview: 'full', tags: ['cover', 'elegant', 'serif'],
  slots: [{ id: 'main', x: 28, y: 60, width: 44, height: 24 }],
  presetBackground: '#F5F2EC',
  presetTextElements: [
    spineText('MEMORIES', '#8A7A6A'),
    { id: 'title', x: 12, y: 24, width: 76, height: 16, text: 'MEMORIES', fontSize: 30, fontFamily: 'Georgia', color: '#3A3632', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 12, y: 42, width: 76, height: 6, text: 'A PHOTO COLLECTION', fontSize: 9, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 12, y: 88, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#E8E2D6'),
    { id: 'lineTop', x: 36, y: 20, width: 28, height: 0.3, type: 'line', fill: '#3A3632', stroke: '#3A3632', strokeWidth: 1, opacity: 0.4, rotation: 0 },
    { id: 'lineBottom', x: 36, y: 52, width: 28, height: 0.3, type: 'line', fill: '#3A3632', stroke: '#3A3632', strokeWidth: 1, opacity: 0.4, rotation: 0 },
  ],
};

/** G. Classic Border —— 双层边框装饰 + 居中标题，经典相册感 */
const coverClassicBorder: Template = {
  id: 'cover-7', name: 'Classic Border', category: 'personality',
  preview: 'full', tags: ['cover', 'classic', 'border'],
  slots: [{ id: 'main', x: 28, y: 30, width: 44, height: 36 }],
  presetBackground: '#FBFAF6',
  presetTextElements: [
    spineText('TIMELESS', '#5A4A3A'),
    { id: 'title', x: 12, y: 14, width: 76, height: 10, text: 'TIMELESS', fontSize: 22, fontFamily: 'Georgia', color: '#5A4A3A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 12, y: 74, width: 76, height: 6, text: 'A Keepsake Album', fontSize: 10, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 12, y: 84, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#EDE7DA'),
    { id: 'frameOuter', x: 13, y: 8, width: 74, height: 84, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: '#5A4A3A', strokeWidth: 1, opacity: 0.5, rotation: 0 },
    { id: 'frameInner', x: 16, y: 11, width: 68, height: 78, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: '#5A4A3A', strokeWidth: 0.5, opacity: 0.3, rotation: 0 },
  ],
};

/** H. Travel Log —— 顶部横幅图 + 底部标题 + 经纬度装饰 */
const coverTravelLog: Template = {
  id: 'cover-8', name: 'Travel Log', category: 'personality',
  preview: 'full', tags: ['cover', 'travel', 'banner'],
  slots: [{ id: 'main', x: SPINE_WIDTH, y: 10, width: 82 - SPINE_WIDTH, height: 48 }],
  presetBackground: '#F4EDE2',
  presetTextElements: [
    spineText('TRAVELS · 2024', '#3A2E22'),
    { id: 'title', x: 14, y: 64, width: 72, height: 12, text: 'TRAVELS', fontSize: 26, fontFamily: 'Georgia', color: '#3A2E22', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'subtitle', x: 14, y: 78, width: 72, height: 6, text: 'Postcards from the Road', fontSize: 11, fontFamily: 'Georgia', color: '#8A7A6A', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'coord', x: 14, y: 86, width: 72, height: 5, text: '34.0522° N · 118.2437° W', fontSize: 8, fontFamily: 'Georgia', color: '#8A7A6A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 14, y: 92, width: 72, height: 4, text: '2024', fontSize: 9, fontFamily: 'Georgia', color: '#8A7A6A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    spineShape('#3A2E22'),
    { id: 'divider', x: 14, y: 74, width: 12, height: 0.3, type: 'line', fill: '#3A2E22', stroke: '#3A2E22', strokeWidth: 1, opacity: 0.4, rotation: 0 },
  ],
};

/* ════════════════════════════ 封底模板（4 款） ════════════════════════════ */

/** 封底 A. Quiet —— 纯白底，居中落款 */
const backQuiet: Template = {
  id: 'backcover-1', name: 'Quiet', category: 'personality',
  preview: 'full', tags: ['backcover', 'minimal'],
  slots: [],
  presetBackground: '#FAFAF8',
  presetTextElements: [
    { id: 'backText', x: 18, y: 56, width: 64, height: 8, text: 'With Love & Gratitude', fontSize: 16, fontFamily: 'Georgia', color: '#5A5A6A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 18, y: 72, width: 64, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#9A9AAA', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    { id: 'divider', x: 42, y: 66, width: 16, height: 0.3, type: 'line', fill: '#9A9AAA', stroke: '#9A9AAA', strokeWidth: 1, opacity: 0.4, rotation: 0 },
  ],
};

/** 封底 B. Group Photo —— 浅底居中小图 + 下方落款 */
const backGroupPhoto: Template = {
  id: 'backcover-2', name: 'Group Photo', category: 'personality',
  preview: 'full', tags: ['backcover', 'photo'],
  slots: [{ id: 'main', x: 30, y: 14, width: 40, height: 40 }],
  presetBackground: '#F8F6F2',
  presetTextElements: [
    { id: 'backText', x: 14, y: 60, width: 72, height: 8, text: 'Moments Worth Keeping', fontSize: 15, fontFamily: 'Georgia', color: '#4A4A5A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 14, y: 72, width: 72, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#8A8A9A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date' },
  ],
};

/** 封底 C. Gold —— 深褐底，烫金落款 + 金线 */
const backGold: Template = {
  id: 'backcover-3', name: 'Gold', category: 'personality',
  preview: 'full', tags: ['backcover', 'gold'],
  slots: [],
  presetBackground: '#2A1F1A',
  presetTextElements: [
    { id: 'backText', x: 16, y: 54, width: 68, height: 10, text: 'Every Moment, Remembered', fontSize: 16, fontFamily: 'Georgia', color: '#C8A868', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none' },
    { id: 'date', x: 16, y: 72, width: 68, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: 'rgba(200,168,104,0.5)', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'date' },
  ],
  presetShapeElements: [
    { id: 'goldLine', x: 40, y: 66, width: 20, height: 0.4, type: 'line', fill: '#C8A868', stroke: '#C8A868', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** 封底 D. Vertical —— 米白底，竖排落款 */
const backVertical: Template = {
  id: 'backcover-4', name: 'Vertical', category: 'personality',
  preview: 'full', tags: ['backcover', 'vertical'],
  slots: [],
  presetBackground: '#F5F2EC',
  presetTextElements: [
    { id: 'backText', x: 38, y: 26, width: 24, height: 32, text: 'With Love', fontSize: 16, fontFamily: 'Georgia', color: '#3A3632', align: 'center', bold: false, italic: false, rotation: -90, placeholder: 'none' },
    { id: 'date', x: 38, y: 64, width: 24, height: 12, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#8A7A6A', align: 'center', bold: false, italic: true, rotation: -90, placeholder: 'date' },
  ],
  presetShapeElements: [
    { id: 'divider', x: 38, y: 60, width: 0.4, height: 14, type: 'line', fill: '#3A3632', stroke: '#3A3632', strokeWidth: 1, opacity: 0.25, rotation: 0 },
  ],
};

/* ════════════════════════════ 统一导出 ════════════════════════════ */

export const COVER_TEMPLATES: Template[] = [
  coverMinimalWhite, coverFullPhoto, coverEditorial, coverMinimalBlack,
  coverCollage, coverElegantSerif, coverClassicBorder, coverTravelLog,
];

export const BACK_COVER_TEMPLATES: Template[] = [
  backQuiet, backGroupPhoto, backGold, backVertical,
];

export const ALL_COVER_TEMPLATES: Template[] = [...COVER_TEMPLATES, ...BACK_COVER_TEMPLATES];

/** 封面/封底模板统一查找 */
export function findCoverTemplateById(id: string): Template | undefined {
  return ALL_COVER_TEMPLATES.find((t) => t.id === id);
}

/** 封面版式数（供随机/切换用） */
export const COVER_TEMPLATE_COUNT = COVER_TEMPLATES.length;
