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

/* 封底落款引言（与封面区别开：封面"开场热烈"，封底"结尾安静"，形成首尾情绪落差） */
const BACK_COVER_QUOTES: Record<AlbumTypeId, string> = {
  travel: '愿回忆，常驻心头',
  family: '此间温暖，来日方长',
  wedding: '愿岁月温柔，陪你到白头',
  growth: '故事未完，继续长大',
  pet: '世界很大，幸好有你',
  other: '愿每一瞬美好，都被记得',
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

/** RGB [0-255] → HSL（h 0-360, s/l 0-1），纯本地无依赖 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60; break;
      case gn: h = ((bn - rn) / d + 2) * 60; break;
      case bn: h = ((rn - gn) / d + 4) * 60; break;
    }
  }
  return [h, s, l];
}

/** HSL → RGB（返回 [0-255]） */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * 降低饱和度 20-30%、提亮，避免生硬撞色。
 * 改在 HSL 空间操作：只调整饱和度 + 明度通道，规避旧实现"三通道统一放大导致高亮照片
 * clamp 到 255 变成死白"的溢出失真（"好看"与"炫"的分界线）。
 */
function desaturateAndLighten([r, g, b]: [number, number, number], reduce = 0.28, lift = 1.18): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  // 降饱和：饱和度整体按比例降低（保留色相与低饱和灰阶的柔和感）
  const ns = Math.max(0, Math.min(1, s * (1 - reduce)));
  // 提亮：在明度通道做温和提升，并用 tanh 软压缩避免逼近 1 时硬截断死白
  const nl = Math.max(0, Math.min(1, l + (0.5 - l) * (lift - 1) * 0.55));
  const [nr, ng, nb] = hslToRgb(h, ns, nl);
  return [nr, ng, nb];
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
/** 根据模板主图槽的宽高比判断期望的照片方向（'portrait'|'landscape'|'square'） */
function templateSlotDirection(template: Template): 'portrait' | 'landscape' | 'square' {
  const main = template.slots.find((s) => s.id === 'main');
  if (!main) return 'square';
  const ratio = main.width / main.height; // 槽位百分比宽高比
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.85) return 'portrait';
  return 'square';
}

/** 照片方向与目标方向匹配的加分（避免横竖不匹配导致裁切毁图） */
function directionBonus(photo: Photo, target: 'portrait' | 'landscape' | 'square'): number {
  // 全幅底图/方形槽对方向宽容，给予少量偏好；竖长/横长槽强匹配方向
  if (target === 'square') {
    return photo.orientation === 'square' ? 0.5 : 0;
  }
  if (photo.orientation === target) return 1.2;
  // 方形照片对竖/横槽尚可（cover-fit 裁切安全），给少量加分
  if (photo.orientation === 'square') return 0.4;
  return 0;
}

export function pickCoverPhoto(photos: Photo[], contents: Map<string, PhotoContentInfo>, template?: Template): string | null {
  if (!photos || photos.length === 0) return null;
  const targetDir = template ? templateSlotDirection(template) : 'square';
  let bestId: string | null = null;
  let bestScore = -Infinity;
  for (const p of photos) {
    const c = contents.get(p.id) ?? (p.clarityScore != null ? { ...DEFAULT_CONTENT_INFO, clarityScore: p.clarityScore } : DEFAULT_CONTENT_INFO);
    if (c.clarityScore < 0.35) continue; // 模糊废图排除
    const centrality = 1 - Math.abs(c.focusX - 0.5) * 2 - Math.abs(c.focusY - 0.5) * 2;
    // 加入方向匹配加权：清晰度/人脸是主导，方向是微调，避免因方向压过画质选到次图
    const score = c.faceCount * 1.0 + c.clarityScore * 1.2 + Math.max(0, centrality) * 0.8 + directionBonus(p, targetDir) * 0.5;
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
  } else if (template.id === 'cover-7') {
    titleX = 14; titleY = 64; titleW = 72;  // 双图对页：主图下部居中，避让右下竖图
  } else if (template.id === 'cover-8') {
    titleX = 8; titleY = 74; titleW = 60;   // 色块卡片：左下留白，避让右侧竖长装饰槽
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

/** 构建封底文字元素（居中落款，更简单）。坐标基于百分比（0-100），传入 pageMm 时换算为 mm。 */
export function buildBackCoverTextElements(
  fields: { backText?: string; date?: string; author?: string },
  palette: CoverPalette,
  pageMm?: { width: number; height: number },
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
  // 传入页面尺寸时换算为 mm 坐标（供 store 更新文字层直接使用）
  if (pageMm) {
    return els.map((el) => ({
      ...el,
      x: (el.x / 100) * pageMm.width,
      y: (el.y / 100) * pageMm.height,
      width: (el.width / 100) * pageMm.width,
      height: (el.height / 100) * pageMm.height,
    }));
  }
  return els;
}

/* ══════════════════════ 一键换设计（重新智能生成） ══════════════════════ */

/**
 * 一键换设计：在当前封面基础上生成"下一个候选设计"，给用户"再给我一个"的探索体验。
 * 规则（保持美学底线）：
 *   - 模板：切换到下一款封面版式（循环）；
 *   - 主图：从候选池（按美学分排序）中选下一张（换主图）；
 *   - 配色：若换主图则重新按新主图取色，否则保持当前配色，避免无意义抖动。
 * 返回一个新的封面页（保留用户已填的标题/副标题/作者/日期文案）。
 */
export function regenerateCoverDesign(
  currentPage: AlbumPage,
  input: CoverGenerateInput,
  contents: Map<string, PhotoContentInfo> = new Map(),
  pageMm: { width: number; height: number },
  step = 1,
): CoverPageResult {
  // 1. 模板循环：当前模板 → 下一款封面版式
  const curIdx = Math.max(0, COVER_TEMPLATES.findIndex((t) => t.id === currentPage.templateId));
  const nextTemplate = COVER_TEMPLATES[(curIdx + step + COVER_TEMPLATES.length) % COVER_TEMPLATES.length];

  // 2. 主图候选池（按美学分降序，含方向匹配到目标版式）
  const targetDir = templateSlotDirection(nextTemplate);
  const candidates = (input.photos ?? [])
    .map((p) => ({ p, score: coverScore(p, contents, targetDir) }))
    .filter((c) => c.score >= 0) // 过滤废图
    .sort((a, b) => b.score - a.score)
    .map((c) => c.p.id);

  // 3. 换主图：跳过当前主图，取下一个候选（不足则复用当前）
  let coverPhotoId: string | null = null;
  if (candidates.length > 0) {
    const cur = currentPage.placements.find((pl) => pl.slotId === 'main')?.photoId;
    const startIdx = cur ? candidates.indexOf(cur) : -1;
    if (candidates.length === 1) {
      coverPhotoId = candidates[0];
    } else if (startIdx >= 0) {
      coverPhotoId = candidates[(startIdx + step + candidates.length) % candidates.length];
    } else {
      coverPhotoId = candidates[0];
    }
  }

  // 4. 生成新封面页（保留用户文案）
  const result = generateCoverPage(
    {
      ...input,
      coverPhotoId: coverPhotoId ?? undefined,
      templateId: nextTemplate.id,
    },
    contents,
    pageMm,
  );

  // 5. 保留用户已编辑的封面元信息（标题/副标题/作者/日期/封底文案）
  const cf = currentPage.coverFields ?? {};
  if (cf.title) result.page.coverFields = { ...result.page.coverFields, title: cf.title };
  if (cf.subtitle) result.page.coverFields = { ...result.page.coverFields, subtitle: cf.subtitle };
  if (cf.author) result.page.coverFields = { ...result.page.coverFields, author: cf.author };
  if (cf.dateText) result.page.coverFields = { ...result.page.coverFields, dateText: cf.dateText };

  // 6. 按用户文案重建文字元素（保持三档层级，若用户改了标题/日期等则同步更新文字层）
  result.page.textElements = buildCoverTextElements(
    nextTemplate,
    {
      title: cf.title ?? result.page.coverFields?.title ?? (input.albumName.replace(/相册$/u, '') || '回忆'),
      date: cf.dateText ?? result.page.coverFields?.dateText,
      subtitle: cf.subtitle ?? result.page.coverFields?.subtitle,
      author: cf.author ?? result.page.coverFields?.author,
    },
    result.palette,
  ).map((el) => ({
    ...el,
    x: (el.x / 100) * pageMm.width,
    y: (el.y / 100) * pageMm.height,
    width: (el.width / 100) * pageMm.width,
    height: (el.height / 100) * pageMm.height,
  }));

  return result;
}

/** 封面美学分（供一键换设计的候选池排序复用，含方向匹配） */
function coverScore(p: Photo, contents: Map<string, PhotoContentInfo>, targetDir: 'portrait' | 'landscape' | 'square' = 'square'): number {
  const c = contents.get(p.id) ?? (p.clarityScore != null ? { ...DEFAULT_CONTENT_INFO, clarityScore: p.clarityScore } : DEFAULT_CONTENT_INFO);
  if (c.clarityScore < 0.35) return -1; // 废图排除
  const centrality = 1 - Math.abs(c.focusX - 0.5) * 2 - Math.abs(c.focusY - 0.5) * 2;
  return c.faceCount * 1.0 + c.clarityScore * 1.2 + Math.max(0, centrality) * 0.8 + directionBonus(p, targetDir) * 0.5;
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

  // 智能选主图（含方向匹配：优先选与版式主图槽横竖吻合的照片）
  const coverPhotoId = input.coverPhotoId ?? pickCoverPhoto(input.photos, contents, template);
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
    { backText: input.albumType ? BACK_COVER_QUOTES[input.albumType] : '愿你记得这些时光', date, author: undefined },
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
      backText: input.albumType ? BACK_COVER_QUOTES[input.albumType] : undefined,
      dateText: date,
    },
    placements: [],
    background: palette.background,
    slotCornerRadius: 4,
    textElements,
  };
  return page;
}
