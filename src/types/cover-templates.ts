/* 封面/封底模板库（对齐 Mixbook 竞品招牌风格 · 全英文文案 · 书脊为页面物理扩展）
 * ──────────────────────────────────────────────────────────────────────
 * 设计原则（参考 mixbook.com/all-photo-books 模板画廊）：
 *   ① 明亮简约为主，大量留白，照片为主导；
 *   ② 书脊为页面左侧物理扩展（6% 页宽），渲染时画布扩展，用户可在此添加文字/形状；
 *   ③ 照片呈现方式对齐 Mixbook 招牌款：
 *        - 全幅照片 + 文字叠图（Full Photo Travel / Everyday Modern Family）
 *        - 单图 + 年份极简（Minimal White / Everyday Photo Book）
 *        - 双竖图并排（Multi Photo Layout）
 *        - 米色左面板 + 右照片（Couple's Story）
 *        - 明黄彩色底 + 粗体 + 太阳图形（Summer Coffee Table Book）
 *        - 彩色笔触线条装饰（Year in Review）
 *   ④ 文字排版：衬线大字报(Georgia) / 无衬线现代 / 手写花体(Georgia italic) / 居中精致小字；
 *   ⑤ 渐变能力：文字/形状均支持线性渐变填充与渐变描边（与文字/形状工具一致），
 *      背景渐变通过「整页渐变形状」实现，形成丰富视觉层次；
 *   ⑥ slots 与 preset 元素同为百分比坐标（0-100），自适应所有页面尺寸；
 *   ⑦ 所有元素应用后皆为独立可编辑元素，用户可拖动/改色/删改；
 *   ⑧ 占位符仅用于 date（自动填充照片年份区间）；主标题固定英文装饰文案，用户可手动改。
 *
 * 字体约定：
 *   衬线   → Georgia（经典相册仪式感）
 *   无衬线 → 'Helvetica Neue', Arial, sans-serif（现代简洁）
 *   日期   → Georgia（数字）
 */
import type { Template, GradientStop } from './index';

/* ════════════════════════════ 封面模板（8 款） ════════════════════════════ */

/** 无衬线现代字体（回退系统 sans-serif） */
const SANS = "'Helvetica Neue', Arial, sans-serif";

/** 手写花体（Georgia italic，Mixbook 常用来做金色/优雅标题） */
const SCRIPT = 'Georgia';

/* ── 新增艺术字体（与 fonts.css 的 font-family 一致，预览/画布/导出均可用） ── */
/** 英文衬线大牌（婚礼/杂志/奢华） */
const PLAYFAIR = "'Playfair Display', serif";
/** 英文优雅衬线（森林/杂志副标） */
const CORMORANT = "'Cormorant Garamond', serif";
/** 英文手写花体（优雅/婚礼/奢华） */
const VIBES = "'Great Vibes', cursive";
/** 英文手写（海洋/随性） */
const CAVEAT = "'Caveat', cursive";
/** 英文圆润手写（宠物/趣味） */
const PACIFICO = "'Pacifico', cursive";
/** 英文现代无衬线（都市/复古/极简） */
const MONTSERRAT = "'Montserrat', sans-serif";
/** 中文可爱体（宝宝/萌宠） */
const KUAILE = "'站酷快乐体', sans-serif";
/** 中文萌萌体（节日/宝宝） */
const XIAOWANZI = "'新蒂小丸子体', sans-serif";
/** 中文圆润黄油体（节日/趣味） */
const HUANGYOU = "'站酷庆科黄油体', sans-serif";
/** 中文毛笔楷书（水墨国风） */
const MAOBI = "'马善政毛笔楷书', serif";
/** 中文秀丽体（国风副标） */
const XIAOWEI = "'站酷小薇体', sans-serif";

/* ── 常用渐变（避免重复定义，供多套模板复用） ── */
/** 金色渐变：优雅标题 / 装饰线 */
const GOLD: GradientStop[] = [
  { offset: 0, color: '#E9CD85' },
  { offset: 0.55, color: '#C99B3F' },
  { offset: 1, color: '#8C6A1E' },
];
/** 玫瑰金渐变：优雅装饰 */
const ROSEGOLD: GradientStop[] = [
  { offset: 0, color: '#F2D0C0' },
  { offset: 0.6, color: '#D9A08A' },
  { offset: 1, color: '#B07A63' },
];
/** 墨蓝→深蓝渐变：大气标题 */
const INKDARK: GradientStop[] = [
  { offset: 0, color: '#3A4657' },
  { offset: 1, color: '#1B2430' },
];
/** 珊瑚活力渐变：明亮标题 */
const CORAL: GradientStop[] = [
  { offset: 0, color: '#FF8A6B' },
  { offset: 1, color: '#E13A6E' },
];
/** 彩虹笔触：彩色装饰线条 */
const RAINBOW_1: GradientStop[] = [
  { offset: 0, color: '#E13A6E' },
  { offset: 0.5, color: '#5B7CFA' },
  { offset: 1, color: '#3EBF8A' },
];
/** 蓝紫渐变：装饰 */
const BLUEVIOLET: GradientStop[] = [
  { offset: 0, color: '#5B7CFA' },
  { offset: 1, color: '#8A5BF0' },
];
/** 深绿渐变：土地/装饰 */
const FOREST: GradientStop[] = [
  { offset: 0, color: '#3EBF8A' },
  { offset: 1, color: '#1F7A5C' },
];

/** A. Minimal White —— 极简白：纯白底 + 渐变墨蓝衬线标题 + 金色细线 */
const coverMinimalWhite: Template = {
  id: 'cover-1', name: 'Minimal White', nameZh: '极简白', category: 'personality',
  preview: 'full', tags: ['cover', 'minimal', 'serif'],
  slots: [{ id: 'main', x: 14, y: 10, width: 72, height: 56 }],
  slotCornerRadius: [4, 4, 4, 4],
  presetBackground: '#FFFFFF',
  spineColor: '#FFFFFF',
  presetTextElements: [
    { id: 'title', x: 12, y: 70, width: 76, height: 8, text: 'A YEAR IN FOCUS', fontSize: 15, fontFamily: 'Georgia', color: '#3A3A4A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: INKDARK, gradientAngle: 90, letterSpacing: 3, lineHeight: 1.4 },
    { id: 'date', x: 12, y: 84, width: 76, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#9AA0A6', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 68, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.5, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** B. Full Photo Travel —— 全幅照片 + 文字叠图 + 底部渐变蒙版 + 渐变副标题 */
const coverFullPhoto: Template = {
  id: 'cover-2', name: 'Full Photo Travel', nameZh: '全幅旅行', category: 'personality',
  preview: 'full', tags: ['cover', 'fullbleed', 'travel'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#EDF2F7',
  spineColor: '#D7DEE6',
  presetTextElements: [
    { id: 'title', x: 6, y: 58, width: 84, height: 14, text: 'EXPLORE', fontSize: 34, fontFamily: SANS, color: '#FFFFFF', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.2 },
    { id: 'subtitle', x: 6, y: 72, width: 78, height: 7, text: 'The World Around You', fontSize: 13, fontFamily: SANS, color: '#FFFFFF', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: [{ offset: 0, color: '#FFE9A8' }, { offset: 1, color: '#FFB74D', alpha: 0.9 }], gradientAngle: 0, letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 6, y: 82, width: 78, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.75)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 46, width: 100, height: 54, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0.05 }, { offset: 1, color: '#000000', alpha: 0.55 }], gradientAngle: 270 },
  ],
};

/** C. Everyday Modern Family —— 全幅家庭照 + 底部渐变蒙版 + 奶油渐变背景 */
const coverEverydayFamily: Template = {
  id: 'cover-3', name: 'Everyday Family', nameZh: '日常家庭', category: 'personality',
  preview: 'full', tags: ['cover', 'family', 'fullbleed'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#F5F5F2',
  spineColor: '#E5E3DC',
  presetTextElements: [
    { id: 'title', x: 14, y: 70, width: 76, height: 10, text: 'THE EVERYDAY', fontSize: 24, fontFamily: 'Georgia', color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'subtitle', x: 14, y: 82, width: 76, height: 6, text: 'A Family Journal', fontSize: 12, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.9)', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', gradient: ROSEGOLD, gradientAngle: 0, letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 14, y: 86, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.8)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 58, width: 100, height: 42, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0 }, { offset: 1, color: '#000000', alpha: 0.5 }], gradientAngle: 90 },
  ],
};

/** D. Multi Photo Layout —— 双竖图并排 + 渐变标题 + 菱形/切角装饰 */
const coverMultiPhoto: Template = {
  id: 'cover-4', name: 'Multi Photo', nameZh: '多图拼排', category: 'personality',
  preview: 'dual', tags: ['cover', 'dual', 'shapes'],
  slots: [
    { id: 'left', x: 12, y: 10, width: 37, height: 58 },
    { id: 'right', x: 51, y: 10, width: 37, height: 58 },
  ],
  slotCornerRadius: 4,
  presetBackground: '#F7F7F5',
  spineColor: '#E9E6DF',
  presetTextElements: [
    { id: 'title', x: 12, y: 74, width: 76, height: 10, text: 'OUR ADVENTURES', fontSize: 20, fontFamily: 'Georgia', color: '#3A3230', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: INKDARK, gradientAngle: 90, letterSpacing: 3, lineHeight: 1.4 },
    { id: 'subtitle', x: 12, y: 84, width: 76, height: 6, text: 'Two Sides of the Story', fontSize: 11, fontFamily: 'Georgia', color: '#9A948C', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 12, y: 88, width: 76, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#9A948C', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [],
};

/** E. Couple's Story —— 米色左面板 + 渐变金色标题 + 右照片 */
const coverCouplesStory: Template = {
  id: 'cover-5', name: "Couple's Story", nameZh: '恋恋故事', category: 'personality',
  preview: 'full', tags: ['cover', 'couple', 'elegant'],
  slots: [{ id: 'main', x: 52, y: 0, width: 48, height: 100 }],
  // 右半幅全高照片：左两角（面向文字面板的内侧硬边）为 0，右两角贴页面边为 0 → 四周全直角锐利
  slotCornerRadius: 0,
  presetBackground: '#F7F4EE',
  spineColor: '#EFE8DC',
  presetTextElements: [
    { id: 'title', x: 12, y: 20, width: 34, height: 16, text: 'THE STORY\nOF US', fontSize: 22, fontFamily: 'Georgia', color: '#3A3632', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 2, lineHeight: 1.6 },
    { id: 'subtitle', x: 12, y: 46, width: 34, height: 7, text: 'A Love Story in Frames', fontSize: 11, fontFamily: 'Georgia', color: '#B9A27E', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 12, y: 60, width: 34, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#9A9AA8', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 14, y: 40, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.6, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** F. Classic Blue —— 全幅照片 + 底部深蓝渐变蒙版 + 白色衬线标题（大气优雅） */
const coverClassicBlue: Template = {
  id: 'cover-6', name: 'Classic Blue', nameZh: '经典蓝调', category: 'personality',
  preview: 'full', tags: ['cover', 'classic', 'fullbleed'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#EAF1F8',
  spineColor: '#D3E0EC',
  presetTextElements: [
    { id: 'title', x: 8, y: 56, width: 84, height: 16, text: 'EVERYDAY\nMOMENTS', fontSize: 26, fontFamily: 'Georgia', color: '#FFFFFF', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 82, width: 80, height: 6, text: 'A Photographic Record', fontSize: 13, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.9)', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 88, width: 80, height: 5, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.75)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 42, width: 100, height: 58, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#0E2240', alpha: 0 }, { offset: 0.5, color: '#0E2240', alpha: 0.5 }, { offset: 1, color: '#0E2240', alpha: 0.85 }], gradientAngle: 90 },
  ],
};

/** G. Summer Bright —— 明黄彩底 + 渐变珊瑚标题 + 太阳图形 */
const coverSummerBright: Template = {
  id: 'cover-7', name: 'Summer Bright', nameZh: '明亮盛夏', category: 'personality',
  preview: 'full', tags: ['cover', 'summer', 'bold'],
  slots: [{ id: 'main', x: 24, y: 12, width: 52, height: 44 }],
  slotCornerRadius: 4,
  presetBackground: '#FFDF5C',
  spineColor: '#E8B93E',
  presetTextElements: [
    { id: 'title', x: 10, y: 60, width: 80, height: 14, text: 'SUMMER', fontSize: 30, fontFamily: SANS, color: '#E13A6E', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', gradient: CORAL, gradientAngle: 90, letterSpacing: 8, lineHeight: 1.2 },
    { id: 'date', x: 10, y: 76, width: 80, height: 8, text: '2026', fontSize: 16, fontFamily: SANS, color: '#E13A6E', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 6, lineHeight: 1.2 },
    { id: 'subtitle', x: 10, y: 84, width: 80, height: 5, text: 'Sun Soaked Days', fontSize: 10, fontFamily: 'Georgia', color: '#B06A2E', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.4 },
  ],
  presetShapeElements: [
    { id: 'sun', x: 44, y: 4, width: 12, height: 12, type: 'circle', fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#FFF3C4' }], gradientAngle: 135 },
  ],
};

/** H. Year in Review —— 奶油渐变底 + 彩虹笔触 + 渐变标题 */
const coverYearInReview: Template = {
  id: 'cover-8', name: 'Year in Review', nameZh: '年度回顾', category: 'personality',
  preview: 'full', tags: ['cover', 'review', 'colorful'],
  slots: [{ id: 'main', x: 18, y: 20, width: 64, height: 44 }],
  slotCornerRadius: 4,
  presetBackground: '#FFFFFF',
  spineColor: '#E8E8E8',
  presetTextElements: [
    { id: 'title', x: 10, y: 68, width: 80, height: 16, text: 'YEAR IN\nREVIEW', fontSize: 26, fontFamily: SANS, color: '#2A2A3A', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', gradient: BLUEVIOLET, gradientAngle: 90, letterSpacing: 4, lineHeight: 1.5 },
    { id: 'subtitle', x: 10, y: 84, width: 80, height: 6, text: 'The Highlights of 2024', fontSize: 11, fontFamily: 'Georgia', color: '#9AA0A6', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 88, width: 80, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#9AA0A6', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'stripe1', x: 12, y: 6, width: 76, height: 1.5, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: RAINBOW_1, gradientAngle: 0 },
    { id: 'stripe2', x: 12, y: 9, width: 76, height: 1.5, type: 'rectangle', fill: '#5B7CFA', stroke: '#5B7CFA', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: FOREST, gradientAngle: 0 },
    { id: 'stripe3', x: 12, y: 12, width: 76, height: 1.5, type: 'rectangle', fill: '#3EBF8A', stroke: '#3EBF8A', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: BLUEVIOLET, gradientAngle: 0 },
  ],
};

/* ════════════════════════════ 新增封面模板（12 款 · 汇集新字体/形状能力） ════════════════════════════
 * 覆盖常见相册场景与风格类型：宝宝、婚礼、复古、杂志、自然、黑白艺术、节日、都市、
 * 萌宠、海洋、奢华、水墨国风。文案兼顾中文艺术字体与英文字体，满足对应场景审美。
 */

/** I-1. Baby Sweet —— 宝宝甜心：奶油粉底 + 圆角大图 + 中文可爱体 + 粉彩圆点 */
const coverBabySweet: Template = {
  id: 'cover-9', name: 'Baby Sweet', nameZh: '宝宝甜心', category: 'personality',
  preview: 'full', tags: ['cover', 'baby', 'cute'],
  slots: [{ id: 'main', x: 18, y: 8, width: 64, height: 50 }],
  slotCornerRadius: 4,
  presetBackground: '#FFF3EA',
  spineColor: '#F5E0D2',
  presetTextElements: [
    { id: 'title', x: 8, y: 64, width: 84, height: 10, text: '宝宝日记', fontSize: 22, fontFamily: KUAILE, color: '#E07A5F', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'albumName', letterSpacing: 2, lineHeight: 1.3 },
    { id: 'subtitle', x: 8, y: 76, width: 84, height: 6, text: 'Sweetest Little Moments', fontSize: 12, fontFamily: CORMORANT, color: '#B0786A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 84, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#C99B8A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'dot1', x: 6, y: 5, width: 12, height: 12, type: 'circle', fill: '#FFD166', stroke: '#FFD166', strokeWidth: 0, opacity: 0.55, rotation: 0 },
    { id: 'dot2', x: 82, y: 4, width: 14, height: 14, type: 'circle', fill: '#F4A7B9', stroke: '#F4A7B9', strokeWidth: 0, opacity: 0.5, rotation: 0 },
    { id: 'dot3', x: 78, y: 58, width: 10, height: 10, type: 'circle', fill: '#A8D8B9', stroke: '#A8D8B9', strokeWidth: 0, opacity: 0.5, rotation: 0 },
  ],
};

/** I-2. Wedding Elegance —— 婚礼雅致：象牙白 + 全幅照 + Playfair 衬线 + 金色手写副标 */
const coverWeddingElegance: Template = {
  id: 'cover-10', name: 'Wedding Elegance', nameZh: '婚礼雅致', category: 'classic',
  preview: 'full', tags: ['cover', 'wedding', 'elegant'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#FBF8F3',
  spineColor: '#EFEAE0',
  presetTextElements: [
    { id: 'title', x: 8, y: 58, width: 84, height: 12, text: 'OUR WEDDING', fontSize: 26, fontFamily: PLAYFAIR, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 72, width: 84, height: 8, text: 'A celebration of love', fontSize: 16, fontFamily: VIBES, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 0, letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 82, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: PLAYFAIR, color: 'rgba(255,255,255,0.85)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 50, width: 100, height: 50, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0 }, { offset: 1, color: '#000000', alpha: 0.55 }], gradientAngle: 90 },
  ],
};

/** I-3. Retro Film —— 复古胶片：暖色底 + 上半幅照片 + 胶片感粗体 */
const coverRetroFilm: Template = {
  id: 'cover-11', name: 'Retro Film', nameZh: '复古胶片', category: 'creative',
  preview: 'full', tags: ['cover', 'retro', 'vintage'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 74 }],
  slotCornerRadius: 0,
  presetBackground: '#EFE3D0',
  spineColor: '#DFC9A8',
  presetTextElements: [
    { id: 'title', x: 8, y: 78, width: 84, height: 8, text: 'RETRO FILM', fontSize: 24, fontFamily: MONTSERRAT, color: '#3A2E22', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 8, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 88, width: 84, height: 6, text: 'Captured in Time', fontSize: 12, fontFamily: CORMORANT, color: '#8A6E55', align: 'left', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 93, width: 84, height: 5, text: '2024', fontSize: 10, fontFamily: 'Georgia', color: '#8A6E55', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 8, y: 86, width: 30, height: 0.4, type: 'line', fill: '#C9A87A', stroke: '#C9A87A', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** I-4. Modern Editorial —— 现代杂志：纯白大留白 + 底部照片条 + 大号衬线 VOL 标题 */
const coverModernEditorial: Template = {
  id: 'cover-12', name: 'Editorial', nameZh: '现代杂志', category: 'classic',
  preview: 'full', tags: ['cover', 'editorial', 'minimal'],
  slots: [{ id: 'main', x: 0, y: 64, width: 100, height: 30 }],
  slotCornerRadius: 0,
  presetBackground: '#FFFFFF',
  spineColor: '#F0F0F0',
  presetTextElements: [
    { id: 'title', x: 8, y: 22, width: 84, height: 10, text: 'VOL. 01', fontSize: 30, fontFamily: CORMORANT, color: '#1A1A1A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 36, width: 84, height: 6, text: 'THE FAMILY ARCHIVE', fontSize: 11, fontFamily: MONTSERRAT, color: '#8A8A8A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 46, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: CORMORANT, color: '#B0B0B0', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'rule', x: 8, y: 18, width: 16, height: 0.5, type: 'line', fill: '#1A1A1A', stroke: '#1A1A1A', strokeWidth: 1, opacity: 0.8, rotation: 0 },
  ],
};

/** I-5. Nature Forest —— 森系自然：浅绿底 + 直角照片 + 优雅衬线 + 叶片点缀 */
const coverNatureForest: Template = {
  id: 'cover-13', name: 'Nature Forest', nameZh: '森系自然', category: 'creative',
  preview: 'full', tags: ['cover', 'nature', 'green'],
  slots: [{ id: 'main', x: 16, y: 8, width: 68, height: 54 }],
  slotCornerRadius: 0,
  presetBackground: '#E8EFE4',
  spineColor: '#D3E0CC',
  presetTextElements: [
    { id: 'title', x: 8, y: 66, width: 84, height: 10, text: 'FOREST', fontSize: 26, fontFamily: CORMORANT, color: '#2F5D44', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 78, width: 84, height: 6, text: 'Grounding in Green', fontSize: 12, fontFamily: CORMORANT, color: '#6B8F72', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 86, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#6B8F72', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'sun', x: 78, y: 6, width: 10, height: 10, type: 'circle', fill: '#D9E8C8', stroke: '#D9E8C8', strokeWidth: 0, opacity: 0.8, rotation: 0 },
    { id: 'leaf', x: 8, y: 8, width: 8, height: 14, type: 'ellipse', fill: '#A8C9A0', stroke: '#A8C9A0', strokeWidth: 0, opacity: 0.6, rotation: 30 },
  ],
};

/** I-6. Mono Art —— 黑白艺术：纯黑底 + 全幅照 + 高对比大标题 */
const coverMonoArt: Template = {
  id: 'cover-14', name: 'Mono Art', nameZh: '黑白艺术', category: 'personality',
  preview: 'full', tags: ['cover', 'mono', 'art'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#111111',
  spineColor: '#222222',
  presetTextElements: [
    { id: 'title', x: 8, y: 20, width: 84, height: 10, text: 'MONO', fontSize: 34, fontFamily: MONTSERRAT, color: '#FFFFFF', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 12, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 32, width: 84, height: 6, text: 'In Black & White', fontSize: 11, fontFamily: MONTSERRAT, color: 'rgba(255,255,255,0.7)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 40, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: MONTSERRAT, color: 'rgba(255,255,255,0.6)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 0, width: 100, height: 48, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0.5 }, { offset: 1, color: '#000000', alpha: 0 }], gradientAngle: 90 },
  ],
};

/** I-7. Holiday Cheer —— 节日欢庆：暖色底 + 圆角照片 + 中文圆润体 + 圣诞彩球 */
const coverHolidayCheer: Template = {
  id: 'cover-15', name: 'Holiday Cheer', nameZh: '节日欢庆', category: 'creative',
  preview: 'full', tags: ['cover', 'holiday', 'festive'],
  slots: [{ id: 'main', x: 16, y: 8, width: 68, height: 52 }],
  slotCornerRadius: 4,
  presetBackground: '#F7E9E1',
  spineColor: '#E8D5C8',
  presetTextElements: [
    { id: 'title', x: 8, y: 64, width: 84, height: 10, text: '圣诞快乐', fontSize: 24, fontFamily: XIAOWANZI, color: '#B3261E', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'albumName', letterSpacing: 2, lineHeight: 1.3 },
    { id: 'subtitle', x: 8, y: 76, width: 84, height: 6, text: 'Merry & Bright', fontSize: 13, fontFamily: HUANGYOU, color: '#2F7A4D', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 85, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#B3261E', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'star', x: 46, y: 2, width: 8, height: 8, type: 'star', fill: '#F5C542', stroke: '#F5C542', strokeWidth: 0, opacity: 0.9, rotation: 0 },
    { id: 'ball1', x: 8, y: 6, width: 8, height: 8, type: 'circle', fill: '#B3261E', stroke: '#B3261E', strokeWidth: 0, opacity: 0.7, rotation: 0 },
    { id: 'ball2', x: 84, y: 8, width: 9, height: 9, type: 'circle', fill: '#2F7A4D', stroke: '#2F7A4D', strokeWidth: 0, opacity: 0.7, rotation: 0 },
  ],
};

/** I-8. Urban Bold —— 都市撞色：几何色块 + 现代粗体 + 撞色照片 */
const coverUrbanBold: Template = {
  id: 'cover-16', name: 'Urban Bold', nameZh: '都市撞色', category: 'creative',
  preview: 'full', tags: ['cover', 'urban', 'geometric'],
  slots: [{ id: 'main', x: 0, y: 46, width: 100, height: 50 }],
  slotCornerRadius: 0,
  presetBackground: '#F4F1EA',
  spineColor: '#E5E0D4',
  presetTextElements: [
    { id: 'title', x: 8, y: 12, width: 84, height: 10, text: 'URBAN', fontSize: 30, fontFamily: MONTSERRAT, color: '#2A2A2A', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 8, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 24, width: 84, height: 6, text: 'City Lights', fontSize: 11, fontFamily: MONTSERRAT, color: '#6A6A6A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 32, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: MONTSERRAT, color: '#6A6A6A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'block1', x: 70, y: 6, width: 22, height: 16, type: 'rectangle', fill: '#FF6B6B', stroke: '#FF6B6B', strokeWidth: 0, opacity: 0.9, rotation: 0 },
    { id: 'block2', x: 8, y: 34, width: 14, height: 10, type: 'circle', fill: '#F4C95D', stroke: '#F4C95D', strokeWidth: 0, opacity: 0.8, rotation: 0 },
  ],
};

/** I-9. Pet Love —— 萌宠乐园：暖米底 + 圆角照片 + 中文可爱体 + 爪印圆点 */
const coverPetLove: Template = {
  id: 'cover-17', name: 'Pet Love', nameZh: '萌宠乐园', category: 'personality',
  preview: 'full', tags: ['cover', 'pet', 'cute'],
  slots: [{ id: 'main', x: 16, y: 6, width: 68, height: 54 }],
  slotCornerRadius: 4,
  presetBackground: '#FFF7E6',
  spineColor: '#F5EAD0',
  presetTextElements: [
    { id: 'title', x: 8, y: 64, width: 84, height: 10, text: '萌宠日记', fontSize: 22, fontFamily: KUAILE, color: '#E8865A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'albumName', letterSpacing: 2, lineHeight: 1.3 },
    { id: 'subtitle', x: 8, y: 76, width: 84, height: 6, text: 'Furry Little Friends', fontSize: 12, fontFamily: PACIFICO, color: '#C99B6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 85, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#C99B6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'paw1', x: 80, y: 6, width: 8, height: 8, type: 'circle', fill: '#F6C177', stroke: '#F6C177', strokeWidth: 0, opacity: 0.7, rotation: 0 },
    { id: 'paw2', x: 8, y: 8, width: 9, height: 9, type: 'circle', fill: '#F6C177', stroke: '#F6C177', strokeWidth: 0, opacity: 0.7, rotation: 0 },
  ],
};

/** I-10. Ocean Breeze —— 海洋清新：浅蓝底 + 直角照片 + 现代粗体 + 波浪/太阳 */
const coverOceanBreeze: Template = {
  id: 'cover-18', name: 'Ocean Breeze', nameZh: '海洋清新', category: 'creative',
  preview: 'full', tags: ['cover', 'ocean', 'fresh'],
  slots: [{ id: 'main', x: 14, y: 8, width: 72, height: 56 }],
  slotCornerRadius: 0,
  presetBackground: '#EAF6FB',
  spineColor: '#D6ECF5',
  presetTextElements: [
    { id: 'title', x: 8, y: 68, width: 84, height: 10, text: 'OCEAN', fontSize: 26, fontFamily: MONTSERRAT, color: '#2776C9', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 8, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 80, width: 84, height: 6, text: 'Tides & Time', fontSize: 16, fontFamily: CAVEAT, color: '#4FA3D9', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 87, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#4FA3D9', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'sun', x: 78, y: 6, width: 12, height: 12, type: 'circle', fill: '#F4D35E', stroke: '#F4D35E', strokeWidth: 0, opacity: 0.8, rotation: 0 },
    { id: 'wave1', x: 8, y: 4, width: 30, height: 0.6, type: 'line', fill: '#A8D8EA', stroke: '#A8D8EA', strokeWidth: 1, opacity: 0.8, rotation: 0 },
    { id: 'wave2', x: 34, y: 7, width: 30, height: 0.6, type: 'line', fill: '#7CC4E0', stroke: '#7CC4E0', strokeWidth: 1, opacity: 0.8, rotation: 0 },
  ],
};

/** I-11. Luxury Gold —— 奢华鎏金：深蓝黑底 + 全幅照 + 衬线金字 + 手写副标 */
const coverLuxuryGold: Template = {
  id: 'cover-19', name: 'Luxury Gold', nameZh: '奢华鎏金', category: 'classic',
  preview: 'full', tags: ['cover', 'luxury', 'gold'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#121826',
  spineColor: '#0E1420',
  presetTextElements: [
    { id: 'title', x: 8, y: 56, width: 84, height: 12, text: 'LUXE', fontSize: 30, fontFamily: PLAYFAIR, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 12, lineHeight: 1.2 },
    { id: 'subtitle', x: 8, y: 70, width: 84, height: 8, text: 'Timeless Elegance', fontSize: 16, fontFamily: VIBES, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 0, letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 8, y: 82, width: 84, height: 6, text: '2024', fontSize: 11, fontFamily: PLAYFAIR, color: 'rgba(255,255,255,0.7)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 46, width: 100, height: 54, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#0A0F1A', alpha: 0.15 }, { offset: 1, color: '#0A0F1A', alpha: 0.75 }], gradientAngle: 90 },
  ],
};

/** I-12. Ink Oriental —— 水墨国风：宣纸米底 + 右侧竖幅照 + 毛笔楷书 + 朱砂印章 */
const coverInkOriental: Template = {
  id: 'cover-20', name: 'Ink Oriental', nameZh: '水墨国风', category: 'classic',
  preview: 'full', tags: ['cover', 'ink', 'chinese'],
  slots: [{ id: 'main', x: 60, y: 10, width: 34, height: 70 }],
  slotCornerRadius: 0,
  presetBackground: '#F5F0E6',
  spineColor: '#E8DFCC',
  presetTextElements: [
    { id: 'title', x: 10, y: 20, width: 44, height: 14, text: '山水之间', fontSize: 30, fontFamily: MAOBI, color: '#2A2A2A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'albumName', letterSpacing: 2, lineHeight: 1.5 },
    { id: 'subtitle', x: 10, y: 40, width: 40, height: 8, text: '岁月留痕', fontSize: 16, fontFamily: XIAOWEI, color: '#6A5A4A', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.5 },
    { id: 'date', x: 10, y: 52, width: 40, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#8A7A66', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'seal', x: 10, y: 62, width: 9, height: 9, type: 'rectangle', fill: '#C0392B', stroke: '#C0392B', strokeWidth: 0, opacity: 0.9, rotation: 0, cornerRadius: 0.1 },
    { id: 'ink', x: 52, y: 70, width: 16, height: 16, type: 'circle', fill: 'rgba(0,0,0,0)', stroke: '#2A2A2A', strokeWidth: 1.5, opacity: 0.3, rotation: 0 },
  ],
};

/* ════════════════════════════ 封底模板（与封面成套设计） ════════════════════════════
 * 每套封面都配套一款风格统一的封底（同背景色/字体/配色），经 cover.backCover 关联，
 * 应用封面时自动同步应用配套封底，整体成套、不拆分开。
 */

/** 封底（配套 Minimal White）：纯白底 · 渐变衬线落款 + 金色细线 */
const backMinimalWhite: Template = {
  id: 'backcover-1', name: 'Minimal', nameZh: '极简封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'minimal'],
  slots: [],
  presetBackground: '#FFFFFF',
  presetTextElements: [
    { id: 'backText', x: 12, y: 52, width: 76, height: 8, text: 'With Love & Gratitude', fontSize: 15, fontFamily: 'Georgia', color: '#3A3A4A', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', gradient: INKDARK, gradientAngle: 90, letterSpacing: 1, lineHeight: 1.5 },
    { id: 'date', x: 12, y: 66, width: 76, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#9AA0A6', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 42, y: 62, width: 16, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.5, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Full Photo Travel）：全幅照片 + 底部渐变蒙版 + 白色粗体 */
const backFullPhoto: Template = {
  id: 'backcover-2', name: 'Travel', nameZh: '旅行封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'fullbleed'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#EDF2F7',
  presetTextElements: [
    { id: 'backText', x: 6, y: 76, width: 84, height: 10, text: 'KEEP EXPLORING', fontSize: 20, fontFamily: SANS, color: '#FFFFFF', align: 'left', bold: true, italic: false, rotation: 0, placeholder: 'none', gradient: [{ offset: 0, color: '#FFE9A8' }, { offset: 1, color: '#FFB74D' }], gradientAngle: 0, letterSpacing: 4, lineHeight: 1.3 },
    { id: 'date', x: 6, y: 84, width: 78, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.8)', align: 'left', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 60, width: 100, height: 40, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0.05 }, { offset: 1, color: '#000000', alpha: 0.5 }], gradientAngle: 270 },
  ],
};

/** 封底（配套 Everyday Family）：全幅照片 + 底部渐变蒙版 + 居中白色衬线 */
const backEveryday: Template = {
  id: 'backcover-3', name: 'Family', nameZh: '家庭封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'fullbleed'],
  slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
  slotCornerRadius: 0,
  presetBackground: '#F5F5F2',
  presetTextElements: [
    { id: 'backText', x: 14, y: 72, width: 72, height: 10, text: 'Made with Love', fontSize: 20, fontFamily: 'Georgia', color: '#FFFFFF', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', gradient: ROSEGOLD, gradientAngle: 0, letterSpacing: 2, lineHeight: 1.5 },
    { id: 'date', x: 14, y: 84, width: 72, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.85)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'mask', x: 0, y: 58, width: 100, height: 42, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 1, rotation: 0, gradient: [{ offset: 0, color: '#000000', alpha: 0 }, { offset: 1, color: '#000000', alpha: 0.5 }], gradientAngle: 90 },
  ],
};

/** 封底（配套 Multi Photo）：双竖图并排 + 渐变衬线标题 + 菱形装饰 */
const backMultiPhoto: Template = {
  id: 'backcover-4', name: 'Multi', nameZh: '拼图封底', category: 'personality',
  preview: 'dual', tags: ['backcover', 'dual'],
  slots: [
    { id: 'left', x: 12, y: 12, width: 37, height: 50 },
    { id: 'right', x: 51, y: 12, width: 37, height: 50 },
  ],
  slotCornerRadius: 4,
  presetBackground: '#F7F7F5',
  presetTextElements: [
    { id: 'backText', x: 12, y: 66, width: 76, height: 8, text: 'Our Story', fontSize: 18, fontFamily: 'Georgia', color: '#3A3230', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: INKDARK, gradientAngle: 90, letterSpacing: 3, lineHeight: 1.4 },
    { id: 'date', x: 12, y: 80, width: 76, height: 6, text: '2024', fontSize: 11, fontFamily: 'Georgia', color: '#9A948C', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'date', letterSpacing: 3 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 92, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.5, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Couple's Story）：米白底 · 金色渐变衬线优雅落款 + 菱形 */
const backCouplesStory: Template = {
  id: 'backcover-5', name: 'Couple', nameZh: '情侣封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'elegant'],
  slots: [],
  presetBackground: '#F7F4EE',
  presetTextElements: [
    { id: 'backText', x: 14, y: 50, width: 72, height: 10, text: 'Forever & Always', fontSize: 18, fontFamily: 'Georgia', color: '#3A3632', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 1, lineHeight: 1.5 },
    { id: 'date', x: 14, y: 66, width: 72, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#9A9AA8', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 38, y: 62, width: 24, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.6, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Classic Blue）：深蓝底 + 金色渐变手写花体落款 + 金色细线 */
const backClassicBlue: Template = {
  id: 'backcover-6', name: 'Classic', nameZh: '经典封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'classic'],
  slots: [],
  presetBackground: '#0E2240',
  presetTextElements: [
    { id: 'backText', x: 14, y: 50, width: 72, height: 10, text: 'Cherished Moments', fontSize: 20, fontFamily: SCRIPT, color: '#B08A3E', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 2, lineHeight: 1.5 },
    { id: 'date', x: 14, y: 66, width: 72, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#C9D6E8', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 62, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.6, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Summer Bright）：明黄底 + 渐变珊瑚粗体 + 三角/星形装饰 */
const backSummerBright: Template = {
  id: 'backcover-7', name: 'Summer', nameZh: '盛夏封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'bold'],
  slots: [],
  presetBackground: '#FFDF5C',
  presetTextElements: [
    { id: 'backText', x: 10, y: 60, width: 80, height: 12, text: 'Good Times', fontSize: 24, fontFamily: SANS, color: '#E13A6E', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', gradient: CORAL, gradientAngle: 90, letterSpacing: 6, lineHeight: 1.3 },
    { id: 'date', x: 10, y: 78, width: 80, height: 8, text: '2026', fontSize: 16, fontFamily: SANS, color: '#E13A6E', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 6 },
  ],
  presetShapeElements: [
    { id: 'sun', x: 44, y: 4, width: 12, height: 12, type: 'circle', fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#FFF3C4' }], gradientAngle: 135 },
  ],
};

/** 封底（配套 Year in Review）：白底 + 彩虹渐变笔触 + 渐变标题 */
const backYearInReview: Template = {
  id: 'backcover-8', name: 'Review', nameZh: '年度封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'colorful'],
  slots: [],
  presetBackground: '#FFFFFF',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 10, text: 'The Year in Moments', fontSize: 18, fontFamily: SANS, color: '#2A2A3A', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', gradient: BLUEVIOLET, gradientAngle: 90, letterSpacing: 3, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#9AA0A6', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'stripe1', x: 12, y: 6, width: 76, height: 1.5, type: 'rectangle', fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: RAINBOW_1, gradientAngle: 0 },
    { id: 'stripe2', x: 12, y: 9, width: 76, height: 1.5, type: 'rectangle', fill: '#5B7CFA', stroke: '#5B7CFA', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: FOREST, gradientAngle: 0 },
    { id: 'stripe3', x: 12, y: 12, width: 76, height: 1.5, type: 'rectangle', fill: '#3EBF8A', stroke: '#3EBF8A', strokeWidth: 0, opacity: 0.9, rotation: 0, gradient: BLUEVIOLET, gradientAngle: 0 },
  ],
};

/* ════════════════════════════ 新增封底（配套 12 款新增封面） ════════════════════════════ */

/** 封底（配套 Baby Sweet）：奶油粉底 + 中文可爱体落款 */
const backBabySweet: Template = {
  id: 'backcover-9', name: 'Baby', nameZh: '宝宝封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'cute'],
  slots: [],
  presetBackground: '#FFF3EA',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 10, text: '被爱包围', fontSize: 20, fontFamily: KUAILE, color: '#E07A5F', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#C99B8A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'dot', x: 46, y: 6, width: 8, height: 8, type: 'circle', fill: '#F4A7B9', stroke: '#F4A7B9', strokeWidth: 0, opacity: 0.5, rotation: 0 },
  ],
};

/** 封底（配套 Wedding Elegance）：象牙白 + 金色手写落款 */
const backWeddingElegance: Template = {
  id: 'backcover-10', name: 'Wedding', nameZh: '婚礼封底', category: 'classic',
  preview: 'full', tags: ['backcover', 'elegant'],
  slots: [],
  presetBackground: '#FBF8F3',
  presetTextElements: [
    { id: 'backText', x: 10, y: 50, width: 80, height: 10, text: 'Forever & Always', fontSize: 18, fontFamily: VIBES, color: '#3A3632', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 1, lineHeight: 1.5 },
    { id: 'date', x: 10, y: 66, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: PLAYFAIR, color: '#B9A27E', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 62, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.6, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Retro Film）：暖色底 + 复古粗体落款 */
const backRetroFilm: Template = {
  id: 'backcover-11', name: 'Retro', nameZh: '复古封底', category: 'creative',
  preview: 'full', tags: ['backcover', 'vintage'],
  slots: [],
  presetBackground: '#EFE3D0',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 8, text: 'Old Memories', fontSize: 18, fontFamily: MONTSERRAT, color: '#3A2E22', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#8A6E55', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 64, width: 20, height: 0.4, type: 'line', fill: '#C9A87A', stroke: '#C9A87A', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** 封底（配套 Modern Editorial）：纯白 + 大号衬线落款 */
const backModernEditorial: Template = {
  id: 'backcover-12', name: 'End', nameZh: '杂志封底', category: 'classic',
  preview: 'full', tags: ['backcover', 'minimal'],
  slots: [],
  presetBackground: '#FFFFFF',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 10, text: 'The End', fontSize: 22, fontFamily: CORMORANT, color: '#1A1A1A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: CORMORANT, color: '#B0B0B0', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 64, width: 20, height: 0.5, type: 'line', fill: '#1A1A1A', stroke: '#1A1A1A', strokeWidth: 1, opacity: 0.6, rotation: 0 },
  ],
};

/** 封底（配套 Nature Forest）：浅绿底 + 优雅衬线落款 */
const backNatureForest: Template = {
  id: 'backcover-13', name: 'Nature', nameZh: '自然封底', category: 'creative',
  preview: 'full', tags: ['backcover', 'green'],
  slots: [],
  presetBackground: '#E8EFE4',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 8, text: 'Grow with Nature', fontSize: 18, fontFamily: CORMORANT, color: '#2F5D44', align: 'center', bold: false, italic: true, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.5 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#6B8F72', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'leaf', x: 46, y: 6, width: 8, height: 14, type: 'ellipse', fill: '#A8C9A0', stroke: '#A8C9A0', strokeWidth: 0, opacity: 0.6, rotation: 30 },
  ],
};

/** 封底（配套 Mono Art）：纯黑 + 高对比落款 */
const backMonoArt: Template = {
  id: 'backcover-14', name: 'Mono', nameZh: '黑白封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'mono'],
  slots: [],
  presetBackground: '#111111',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 8, text: 'Contrast', fontSize: 20, fontFamily: MONTSERRAT, color: '#FFFFFF', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 6, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: MONTSERRAT, color: 'rgba(255,255,255,0.6)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [],
};

/** 封底（配套 Holiday Cheer）：暖红底 + 中文圆润体落款 */
const backHolidayCheer: Template = {
  id: 'backcover-15', name: 'Holiday', nameZh: '节日封底', category: 'creative',
  preview: 'full', tags: ['backcover', 'festive'],
  slots: [],
  presetBackground: '#B3261E',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 10, text: '欢乐常伴', fontSize: 22, fontFamily: XIAOWANZI, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: 'rgba(255,255,255,0.85)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'star', x: 46, y: 6, width: 8, height: 8, type: 'star', fill: '#F5C542', stroke: '#F5C542', strokeWidth: 0, opacity: 0.9, rotation: 0 },
  ],
};

/** 封底（配套 Urban Bold）：深蓝底 + 现代粗体落款 */
const backUrbanBold: Template = {
  id: 'backcover-16', name: 'Urban', nameZh: '都市封底', category: 'creative',
  preview: 'full', tags: ['backcover', 'geometric'],
  slots: [],
  presetBackground: '#2A3B5C',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 8, text: 'City Lights', fontSize: 18, fontFamily: MONTSERRAT, color: '#FFFFFF', align: 'center', bold: true, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 4, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: MONTSERRAT, color: 'rgba(255,255,255,0.7)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'block', x: 44, y: 6, width: 12, height: 8, type: 'rectangle', fill: '#FF6B6B', stroke: '#FF6B6B', strokeWidth: 0, opacity: 0.8, rotation: 0 },
  ],
};

/** 封底（配套 Pet Love）：暖米底 + 中文可爱体落款 */
const backPetLove: Template = {
  id: 'backcover-17', name: 'Pet', nameZh: '萌宠封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'cute'],
  slots: [],
  presetBackground: '#FFF7E6',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 10, text: '有你真好', fontSize: 20, fontFamily: KUAILE, color: '#E8865A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 2, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#C99B6A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'paw', x: 46, y: 6, width: 8, height: 8, type: 'circle', fill: '#F6C177', stroke: '#F6C177', strokeWidth: 0, opacity: 0.7, rotation: 0 },
  ],
};

/** 封底（配套 Ocean Breeze）：浅蓝底 + 手写落款 */
const backOceanBreeze: Template = {
  id: 'backcover-18', name: 'Ocean', nameZh: '海洋封底', category: 'creative',
  preview: 'full', tags: ['backcover', 'fresh'],
  slots: [],
  presetBackground: '#EAF6FB',
  presetTextElements: [
    { id: 'backText', x: 10, y: 52, width: 80, height: 8, text: 'Tides & Time', fontSize: 18, fontFamily: CAVEAT, color: '#2776C9', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 1, lineHeight: 1.4 },
    { id: 'date', x: 10, y: 68, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#4FA3D9', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'wave', x: 8, y: 6, width: 30, height: 0.6, type: 'line', fill: '#7CC4E0', stroke: '#7CC4E0', strokeWidth: 1, opacity: 0.8, rotation: 0 },
  ],
};

/** 封底（配套 Luxury Gold）：深蓝黑底 + 金色手写落款 */
const backLuxuryGold: Template = {
  id: 'backcover-19', name: 'Luxe', nameZh: '奢华封底', category: 'classic',
  preview: 'full', tags: ['backcover', 'gold'],
  slots: [],
  presetBackground: '#121826',
  presetTextElements: [
    { id: 'backText', x: 10, y: 50, width: 80, height: 10, text: 'Timeless', fontSize: 20, fontFamily: VIBES, color: '#FFFFFF', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', gradient: GOLD, gradientAngle: 90, letterSpacing: 2, lineHeight: 1.5 },
    { id: 'date', x: 10, y: 66, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: PLAYFAIR, color: 'rgba(255,255,255,0.7)', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'divider', x: 40, y: 62, width: 20, height: 0.4, type: 'line', fill: '#C99B3F', stroke: '#C99B3F', strokeWidth: 1, opacity: 0.6, rotation: 0, gradient: GOLD, gradientAngle: 0 },
  ],
};

/** 封底（配套 Ink Oriental）：宣纸米底 + 毛笔楷书落款 + 朱砂印 */
const backInkOriental: Template = {
  id: 'backcover-20', name: 'Ink', nameZh: '水墨封底', category: 'classic',
  preview: 'full', tags: ['backcover', 'chinese'],
  slots: [],
  presetBackground: '#F5F0E6',
  presetTextElements: [
    { id: 'backText', x: 10, y: 50, width: 80, height: 10, text: '静水流深', fontSize: 22, fontFamily: MAOBI, color: '#2A2A2A', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'none', letterSpacing: 3, lineHeight: 1.5 },
    { id: 'date', x: 10, y: 66, width: 80, height: 6, text: '2024', fontSize: 12, fontFamily: 'Georgia', color: '#8A7A66', align: 'center', bold: false, italic: false, rotation: 0, placeholder: 'date', letterSpacing: 4 },
  ],
  presetShapeElements: [
    { id: 'seal', x: 46, y: 6, width: 8, height: 8, type: 'rectangle', fill: '#C0392B', stroke: '#C0392B', strokeWidth: 0, opacity: 0.9, rotation: 0, cornerRadius: 0.1 },
  ],
};

/** 封底（配套 Blank）：纯白无元素 */
const backBlank: Template = {
  id: 'backcover-blank', name: 'Blank', nameZh: '空白封底', category: 'personality',
  preview: 'full', tags: ['backcover', 'blank'],
  slots: [],
  presetBackground: '#FFFFFF',
  presetTextElements: [],
  presetShapeElements: [],
};

/* ════════════════════════════ 封面 × 封底 成套关联 ════════════════════════════ */
/** 空白封面模板：无槽位、无预设元素，纯白底 + 书脊，用户自由发挥 */
const coverBlank: Template = {
  id: 'cover-blank', name: 'Blank', nameZh: '空白封面', category: 'personality',
  preview: 'full', tags: ['cover', 'blank'],
  slots: [],
  presetBackground: '#FFFFFF',
  spineColor: '#FFFFFF',
  presetTextElements: [],
  presetShapeElements: [],
};

/* 每套封面通过 backCover 关联配套封底，保证整体设计成套、不拆分开。 */
coverBlank.backCover = backBlank;
coverMinimalWhite.backCover = backMinimalWhite;
coverFullPhoto.backCover = backFullPhoto;
coverEverydayFamily.backCover = backEveryday;
coverMultiPhoto.backCover = backMultiPhoto;
coverCouplesStory.backCover = backCouplesStory;
coverClassicBlue.backCover = backClassicBlue;
coverSummerBright.backCover = backSummerBright;
coverYearInReview.backCover = backYearInReview;
coverBabySweet.backCover = backBabySweet;
coverWeddingElegance.backCover = backWeddingElegance;
coverRetroFilm.backCover = backRetroFilm;
coverModernEditorial.backCover = backModernEditorial;
coverNatureForest.backCover = backNatureForest;
coverMonoArt.backCover = backMonoArt;
coverHolidayCheer.backCover = backHolidayCheer;
coverUrbanBold.backCover = backUrbanBold;
coverPetLove.backCover = backPetLove;
coverOceanBreeze.backCover = backOceanBreeze;
coverLuxuryGold.backCover = backLuxuryGold;
coverInkOriental.backCover = backInkOriental;

/** 空白封面模板：无槽位、无预设元素，纯白底 + 书脊，用户自由发挥 */
export const COVER_TEMPLATES: Template[] = [
  coverBlank, coverMinimalWhite, coverFullPhoto, coverEverydayFamily, coverMultiPhoto,
  coverCouplesStory, coverClassicBlue, coverSummerBright, coverYearInReview,
  coverBabySweet, coverWeddingElegance, coverRetroFilm, coverModernEditorial,
  coverNatureForest, coverMonoArt, coverHolidayCheer, coverUrbanBold,
  coverPetLove, coverOceanBreeze, coverLuxuryGold, coverInkOriental,
];

export const BACK_COVER_TEMPLATES: Template[] = [
  backBlank, backMinimalWhite, backFullPhoto, backEveryday, backMultiPhoto,
  backCouplesStory, backClassicBlue, backSummerBright, backYearInReview,
  backBabySweet, backWeddingElegance, backRetroFilm, backModernEditorial,
  backNatureForest, backMonoArt, backHolidayCheer, backUrbanBold,
  backPetLove, backOceanBreeze, backLuxuryGold, backInkOriental,
];

export const ALL_COVER_TEMPLATES: Template[] = [...COVER_TEMPLATES, ...BACK_COVER_TEMPLATES];

/** 封面/封底模板统一查找 */
export function findCoverTemplateById(id: string): Template | undefined {
  return ALL_COVER_TEMPLATES.find((t) => t.id === id);
}

/** 封面版式数（供随机/切换用） */
export const COVER_TEMPLATE_COUNT = COVER_TEMPLATES.length;

/** 按界面语言返回模板名称（中文模式用 nameZh，否则用 name） */
export function getTemplateName(template: Template, isZh: boolean): string {
  return isZh && template.nameZh ? template.nameZh : template.name;
}