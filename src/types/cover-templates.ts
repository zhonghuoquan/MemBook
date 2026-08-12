/* 封面/封底内置模板库
 * ──────────────────────────────────────────────────
 * 设计定位（与内容页拼图模板区隔）：
 *   封面美感的本质是"取舍"而非"堆叠"——多留白、低饱和、明确层级、一个情绪锚点。
 * 每款封面版式均遵循三条铁律：
 *   ① 视觉重心只有 1 个（主图或标题），其余让位；
 *   ② 文字区预留充足负空间（≥25%）；
 *   ③ 单一主色 + 一个点缀色，绝不全彩渐变。
 *
 * 所有版式复用现有 Template 结构（slots 为百分比坐标），文字区不硬编码，
 * 由 cover-generator.ts 在生成时自动产出 textElements，生成后用户照常自由编辑。
 */
import type { Template } from './index';

/** 封面版式池（A~F 六款美学性格） */
export const COVER_TEMPLATES: Template[] = [
  /* A. 呼吸留白 —— 主图偏一隅，大面积空白，短标题居中 */
  {
    id: 'cover-1', name: '呼吸留白', category: 'personality',
    slots: [{ id: 'main', x: 12, y: 14, width: 40, height: 40 }],
    preview: 'full', tags: ['cover', 'white-space', 'minimal'],
  },
  /* B. 全幅底图 —— 主图铺满，底部叠玻璃渐变蒙版，标题反白压图 */
  {
    id: 'cover-2', name: '全幅底图', category: 'personality',
    slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
    preview: 'full', tags: ['cover', 'fullbleed'],
  },
  /* C. 黄金分割双栏 —— 左 62% 主图，右 38% 竖排文字，中间留呼吸缝 */
  {
    id: 'cover-3', name: '黄金分割双栏', category: 'personality',
    slots: [{ id: 'main', x: 0, y: 5, width: 62, height: 90 }],
    preview: 'full', tags: ['cover', 'magazine'],
  },
  /* D. 仪式衬线 —— 小主图居中偏上，下方衬线标题 + 装饰线 + 日期，留白 40% */
  {
    id: 'cover-4', name: '仪式衬线', category: 'personality',
    slots: [{ id: 'main', x: 30, y: 10, width: 40, height: 40 }],
    preview: 'full', tags: ['cover', 'serif', 'memory'],
  },
  /* E. 非对称留白 —— 主图不居中，标题大字与主图形成对角线张力 */
  {
    id: 'cover-5', name: '非对称留白', category: 'personality',
    slots: [{ id: 'main', x: 55, y: 8, width: 42, height: 50 }],
    preview: 'full', tags: ['cover', 'modern'],
  },
  /* F. 场景化 —— 契合相册类型，主图偏下、上部留出大标题空间 */
  {
    id: 'cover-6', name: '场景化', category: 'personality',
    slots: [{ id: 'main', x: 15, y: 34, width: 70, height: 56 }],
    preview: 'full', tags: ['cover', 'albumtype'],
  },
  /* G. 双图对页 —— 多元素构图：主图横贯上部 + 右下竖图小槽，标题压主图下方 */
  {
    id: 'cover-7', name: '双图对页', category: 'personality',
    slots: [
      { id: 'main', x: 0, y: 0, width: 100, height: 58 },
      { id: 'accent', x: 74, y: 74, width: 22, height: 22 },
    ],
    preview: 'full', tags: ['cover', 'dualframe', 'collage'],
  },
  /* H. 色块卡片 —— 大图圆角卡片 + 右侧竖长装饰槽，标题在左下留白 */
  {
    id: 'cover-8', name: '色块卡片', category: 'personality',
    slots: [
      { id: 'main', x: 6, y: 6, width: 68, height: 62 },
      { id: 'accent', x: 80, y: 72, width: 16, height: 22 },
    ],
    preview: 'full', tags: ['cover', 'colorblock', 'modern'],
  },
];

/** 封底版式池（更简单：纯色/浅背景 + 居中纪念语 + 可选一张合影小图） */
export const BACK_COVER_TEMPLATES: Template[] = [
  {
    id: 'backcover-1', name: '安静留白', category: 'personality',
    slots: [{ id: 'main', x: 30, y: 12, width: 40, height: 30 }],
    preview: 'full', tags: ['backcover', 'white-space'],
  },
  {
    id: 'backcover-2', name: '居中落款', category: 'personality',
    slots: [],
    preview: 'full', tags: ['backcover', 'minimal'],
  },
  {
    id: 'backcover-3', name: '合影小图', category: 'personality',
    slots: [{ id: 'main', x: 24, y: 12, width: 52, height: 40 }],
    preview: 'full', tags: ['backcover', 'memory'],
  },
  {
    id: 'backcover-4', name: '落款横幅', category: 'personality',
    slots: [{ id: 'main', x: 18, y: 58, width: 64, height: 26 }],
    preview: 'full', tags: ['backcover', 'signature'],
  },
];

/** 封面/封底模板统一查找 */
export const ALL_COVER_TEMPLATES: Template[] = [...COVER_TEMPLATES, ...BACK_COVER_TEMPLATES];

/** 根据模板 ID 判断并返回封面/封底模板 */
export function findCoverTemplateById(id: string): Template | undefined {
  return ALL_COVER_TEMPLATES.find((t) => t.id === id);
}

/** 封面版式数（供随机/切换用） */
export const COVER_TEMPLATE_COUNT = COVER_TEMPLATES.length;
