/* ────────────────────────────────────────────────────────────
   cover-generator —— 封面/封底智能生成规则引擎（纯本地，规则化）
   ────────────────────────────────────────────────────────────
   设计原则（与 MemBook 本地优先一致）：
     1. 确定性、可解释：不依赖云端大模型，仅用现有 content-aware 数据
     2. 美学把关：自动生成时强制"降饱和 + 单一主色 + 文字对比"，守住美感底线
     3. 可再编辑：封面文字落地为 textElements，生成后用户照常自由拖动编辑

   四大规则：
     ① 智能选主图：faceCount + clarityScore + 主体居中 → 综合打分
     ② 智能配色：取主图 dominantColor，降饱和 20-30% 生成背景，计算文字对比色
     ③ 智能排版：按封面版式自动定位文字区（三档层级：主标题/日期/落款）
     ④ 智能文案：标题取相册名，日期取照片 EXIF 区间，引言按相册类型兜底
   ──────────────────────────────────────────────────────────── */
import type { AlbumPage, AlbumTypeId, PageTextElement, Photo, Template } from '../types';
import { COVER_TEMPLATES, BACK_COVER_TEMPLATES } from '../types/cover-templates';
import { DEFAULT_CONTENT_INFO, type PhotoContentInfo } from './content-aware';

/* 封面文字字体语言（遵循设计：主标题圆润现代 + 日期衬线仪式） */
const COVER_TITLE_FONT = '思源黑体';   // 主标题：现代圆润（对应 Quicksand 的亲和定位）
const COVER_DATE_FONT = '宋体';        // 日期：衬线仪式感
const COVER_QUOTE_FONT = '楷体';       // 引言：手写情绪
const COVER_AUTHOR_FONT = '思源黑体';  // 落款：克制动线

/* 品牌点缀色（全页最多 1 个点缀色） */
// 供渲染层叠加装饰线等使用（预留，当前文字层级已覆盖）
// const BRAND_ACCENT = '#6C63FF';

/* 相册类型 → 一句话引言（情绪锚点兜底文案） */
const TYPE_QUOTES: Record<AlbumTypeId, string> = {
  travel: '把风景还给风，把回忆留给自己',
  family: '在一起的日子，都是好日子',
  wedding: '以你之姓，冠我之名',
  growth: '每一寸成长，都值得被记住',
  pet: '你是我世界里的毛茸茸',
  other: '那些值得被收藏的瞬间',
};

/** 智能配色结果 */
export interface CoverPalette {
  /** 页面背景色（hex） */
  background: string;
  /** 是否深色背景（决定文字用浅金/米白 还是 墨蓝/深紫） */
  dark: boolean;
  /** 主标题文字色 */
  titleColor: string;
  /** 次要文字色（日期/引言/落款） */
  bodyColor: string;
}

/** 封面生成输入 */
export interface CoverGenerateInput {
  photos: Photo[];
  albumName: string;
  albumType?: AlbumTypeId;
  /** 封面主图候选：默认由引擎按美学分自选 */
  coverPhotoId?: string;
  /** 目标封面模板 ID（缺省随机一款） */
  templateId?: string;
}

/** 封面生成结果：一个可直接插入 pages 的封面页 */
export interface CoverPageResult {
  page: AlbumPage;
  /** 命中的封面模板 ID */
  templateId: string;
  /** 实际使用的主图 photoId（可能为 null，表示无照片时纯文字版式） */
  coverPhotoId: string | null;
  /** 使用的配色（供封底复用，保持首尾一致） */
  palette: CoverPalette;
}

/* ══════════════════════ 颜色工具（本地，无外部依赖） ══════════════════════ */

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 降低饱和度 20-30%，提亮，避免生硬撞色（"好看"与"炫"的分界线） */
function desaturateAndLighten([r, g, b]: [number, number, number], reduce = 0.28, lift = 1.18): [number, number, number] {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const nr = gray + (r - gray) * (1 - reduce);
  const ng = gray + (g - gray) * (1 - reduce);
  const nb = gray + (b - gray) * (1 - reduce);
  return [nr * lift, ng * lift, nb * lift];
}

/** 计算背景亮度，判断文字用深色还是浅色 */
function luminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 从主图颜色推导封面配色（暗背景→浅金/米白文字，亮背景→墨蓝/深紫文字） */
export function buildCoverPalette(dominantColor: [number, number, number], darkOverride?: boolean): CoverPalette {
  const reduced = desaturateAndLighten(dominantColor);
  // 过深的原色提亮后仍偏暗 → 走深色底；否则浅色底
  const dark = darkOverride ?? luminance(reduced) < 0.45;
  if (dark) {
    return {
      background: rgbToHex(...reduced),
      dark: true,
      titleColor: '#FFF8EC',      // 浅金米白
      bodyColor: 'rgba(255,248,236,0.82)',
    };
  }
  return {
    background: rgbToHex(...reduced),
    dark: false,
    titleColor: '#2B2A4A',        // 墨蓝
    bodyColor: 'rgba(43,42,74,0.72)',
  };
}

/* ══════════════════════ 智能选主图 ══════════════════════ */

/**
 * 按"美学分"挑选封面主图：
 *   分数 = faceCount*1.0 + clarityScore*1.2 + 主体居中程度
 * 过滤过曝/欠曝/构图杂乱（清晰度 < 0.35 视为废图直接排除）。
 */
export function pickCoverPhoto(photos: Photo[], contents: Map<string, PhotoContentInfo>): string | null {
  if (!photos || photos.length === 0) return null;
  let bestId: string | null = null;
  let bestScore = -Infinity;
  for (const p of photos) {
    const c = contents.get(p.id) ?? (p.clarityScore != null ? { ...DEFAULT_CONTENT_INFO, clarityScore: p.clarityScore } : DEFAULT_CONTENT_INFO);
    if (c.clarityScore < 0.35) continue; // 模糊废图排除
    const centrality = 1 - Math.abs(c.focusX - 0.5) * 2 - Math.abs(c.focusY - 0.5) * 2;
    const score = c.faceCount * 1.0 + c.clarityScore * 1.2 + Math.max(0, centrality) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  return bestId;
}

/* ══════════════════════ 智能文案 ══════════════════════ */

/** 从照片日期推导年份区间（如 2023-2024） */
function deriveDateRange(photos: Photo[]): string | undefined {
  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => !Number.isNaN(y));
  if (years.length === 0) return undefined;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

/** 相册名去除"相册"等后缀，作为封面主标题（保留年份） */
function cleanTitle(albumName: string): string {
  return albumName.replace(/相册$/u, '').trim() || '回忆';
}

/* ══════════════════════ 智能排版（产出 textElements） ══════════════════════ */

/**
 * 根据封面模板 slots 布局，生成对应位置的文字元素（三档层级）。
 * 坐标基于页面百分比（0-100）换算，文字元素单位使用 mm 需调用方按页面 mm 尺寸换算，
 * 这里统一以百分比定位 + 由 buildCoverPage 负责换算成 mm。
 */
export function buildCoverTextElements(
  template: Template,
  fields: { title: string; date?: string; subtitle?: string; author?: string },
  palette: CoverPalette,
): PageTextElement[] {
  const els: PageTextElement[] = [];
  // 主图槽的几何（用于文字避让）
  const main = template.slots.find((s) => s.id === 'main');
  const mainTop = main ? main.y : -1;
  const mainBottom = main ? main.y + main.height : -1;

  // 默认标题区：优先放在主图下方的留白区（避免压主图）；全幅底图放到中部靠上（配蒙版反白）
  const isFullBleed = template.id === 'cover-2';
  let titleX: number, titleY: number, titleW: number;
  if (isFullBleed) {
    titleX = 12; titleY = 66; titleW = 76; // 全幅：压图反白
  } else if (template.id === 'cover-3') {
    titleX = 66; titleY = 30; titleW = 30; // 黄金分割双栏：右侧竖排文字区
  } else if (template.id === 'cover-5') {
    titleX = 8; titleY = 66; titleW = 80;  // 非对称：左下
  } else {
    titleX = 14; titleY = Math.max(mainBottom + 4, 56); titleW = 72;
  }

  // 1. 主标题（hero，三档中的最大强调）
  els.push({
    id: `cover-title-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    x: titleX, y: titleY, width: titleW, height: 16,
    text: fields.title,
    fontSize: isFullBleed ? 34 : 30,
    fontFamily: COVER_TITLE_FONT,
    color: palette.titleColor,
    align: 'center',
    bold: true, italic: false,
    rotation: 0, zIndex: 100,
  });

  // 2. 日期（衬线仪式感，置于主标题下方）
  if (fields.date) {
    els.push({
      id: `cover-date-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: titleX, y: titleY + 18, width: titleW, height: 8,
      text: fields.date,
      fontSize: 16,
      fontFamily: COVER_DATE_FONT,
      color: palette.bodyColor,
      align: 'center',
      bold: false, italic: true,
      rotation: 0, zIndex: 99,
    });
  }

  // 3. 副标题/引言（情绪锚点）
  if (fields.subtitle) {
    const quoteY = titleY + (fields.date ? 30 : 22);
    els.push({
      id: `cover-quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: titleX + 8, y: quoteY, width: titleW - 16, height: 10,
      text: fields.subtitle,
      fontSize: 14,
      fontFamily: COVER_QUOTE_FONT,
      color: palette.bodyColor,
      align: 'center',
      bold: false, italic: true,
      rotation: 0, zIndex: 98,
    });
  }

  // 4. 作者/落款（最小，留白间距拉大）
  if (fields.author) {
    els.push({
      id: `cover-author-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: titleX + 10, y: titleY + (fields.subtitle ? 44 : 36) + (fields.date ? 0 : -8), width: titleW - 20, height: 6,
      text: fields.author,
      fontSize: 12,
      fontFamily: COVER_AUTHOR_FONT,
      color: palette.bodyColor,
      align: 'center',
      bold: false, italic: false,
      rotation: 0, zIndex: 97,
    });
  }

  // 主题角标：主图槽未被文字覆盖时，在空白角加品牌点缀线（装饰性，仅非全幅且主图偏上时）
  if (!isFullBleed && main && mainTop < 40) {
    // 利用 slot 作为主图，装饰线由渲染层根据 pageKind 叠加，无需额外元素
  }

  return els;
}

/** 构建封底文字元素（居中落款，更简单） */
export function buildBackCoverTextElements(
  fields: { backText?: string; date?: string; author?: string },
  palette: CoverPalette,
): PageTextElement[] {
  const els: PageTextElement[] = [];
  let y = 70;
  if (fields.backText) {
    els.push({
      id: `back-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: 12, y, width: 76, height: 12,
      text: fields.backText,
      fontSize: 16,
      fontFamily: COVER_QUOTE_FONT,
      color: palette.bodyColor,
      align: 'center',
      bold: false, italic: true,
      rotation: 0, zIndex: 100,
    });
    y += 16;
  }
  const signature = [fields.date, fields.author].filter(Boolean).join(' · ');
  if (signature) {
    els.push({
      id: `back-sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: 12, y, width: 76, height: 8,
      text: signature,
      fontSize: 13,
      fontFamily: COVER_DATE_FONT,
      color: palette.bodyColor,
      align: 'center',
      bold: false, italic: false,
      rotation: 0, zIndex: 99,
    });
  }
  return els;
}

/* ══════════════════════ 主入口 ══════════════════════ */

/**
 * 生成一个封面页（AlbumPage）。
 * - 纯本地规则引擎，输入 photos 的可选内容感知数据（缺省用 DEFAULT_CONTENT_INFO 兜底）
 * - 返回可直接插入 pages 数组的页面对象，并附带配色供封底复用
 */
export function generateCoverPage(
  input: CoverGenerateInput,
  contents: Map<string, PhotoContentInfo> = new Map(),
  pageMm: { width: number; height: number },
): CoverPageResult {
  const templateId = input.templateId ?? COVER_TEMPLATES[Math.floor(Math.random() * COVER_TEMPLATES.length)].id;
  const template = COVER_TEMPLATES.find((t) => t.id === templateId) ?? COVER_TEMPLATES[0];

  // 智能选主图
  const coverPhotoId = input.coverPhotoId ?? pickCoverPhoto(input.photos, contents);
  const coverPhoto = input.photos.find((p) => p.id === coverPhotoId);

  // 智能配色（取主图主色，缺省用品牌紫系）
  const content = coverPhoto ? (contents.get(coverPhoto.id) ?? DEFAULT_CONTENT_INFO) : null;
  const palette = content
    ? buildCoverPalette(content.dominantColor)
    : buildCoverPalette([108, 99, 255]); // 品牌紫 #6C63FF 兜底

  // 智能文案
  const title = cleanTitle(input.albumName);
  const date = deriveDateRange(input.photos);
  const subtitle = input.albumType ? TYPE_QUOTES[input.albumType] : undefined;

  // 智能排版（百分比坐标 → mm 换算）
  const els = buildCoverTextElements(template, { title, date, subtitle }, palette);
  const scale = (v: number, axis: 'x' | 'y') => (axis === 'x' ? (v / 100) * pageMm.width : (v / 100) * pageMm.height);
  const textElements: PageTextElement[] = els.map((el) => ({
    ...el,
    x: scale(el.x, 'x'),
    y: scale(el.y, 'y'),
    width: scale(el.width, 'x'),
    height: scale(el.height, 'y'),
  }));

  // 构建页面：封面主图放进 main 槽位
  const placements = template.slots.map((slot) => ({
    slotId: slot.id,
    photoId: slot.id === 'main' ? (coverPhotoId ?? null) : null,
  }));

  const page: AlbumPage = {
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId,
    pageKind: 'cover',
    coverFields: {
      title,
      subtitle,
      dateText: date,
    },
    placements,
    background: palette.background,
    slotCornerRadius: 4,
    textElements,
  };

  return { page, templateId, coverPhotoId, palette };
}

/**
 * 生成一个封底页（AlbumPage），复用封面配色保持首尾呼应。
 */
export function generateBackCoverPage(
  input: CoverGenerateInput,
  palette: CoverPalette,
  pageMm: { width: number; height: number },
): AlbumPage {
  const template = BACK_COVER_TEMPLATES[0];
  const date = deriveDateRange(input.photos);
  const els = buildBackCoverTextElements(
    { backText: input.albumType ? TYPE_QUOTES[input.albumType] : '愿你记得这些时光', date, author: undefined },
    palette,
  );
  const scale = (v: number, axis: 'x' | 'y') => (axis === 'x' ? (v / 100) * pageMm.width : (v / 100) * pageMm.height);
  const textElements: PageTextElement[] = els.map((el) => ({
    ...el,
    x: scale(el.x, 'x'),
    y: scale(el.y, 'y'),
    width: scale(el.width, 'x'),
    height: scale(el.height, 'y'),
  }));

  const page: AlbumPage = {
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    pageKind: 'backCover',
    coverFields: {
      backText: input.albumType ? TYPE_QUOTES[input.albumType] : undefined,
      dateText: date,
    },
    placements: [],
    background: palette.background,
    slotCornerRadius: 4,
    textElements,
  };
  return page;
}
