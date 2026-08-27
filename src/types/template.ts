/* ============================================================
   MemBook — 页面模板 / 封面封底 类型与内置模板
   ============================================================ */

import type { SlotOverride } from './photo';
import type { GradientStop, ShapeType } from './elements';
import { GENERATED_TEMPLATES } from './generated-templates';
import { ALL_COVER_TEMPLATES, findCoverTemplateById } from './cover-templates';

/** Google Photos 智能编排使用的特殊模板 ID（不匹配任何真实模板） */
export const GOOGLE_PHOTOS_TEMPLATE_ID = '__google_photos__';

/** 从 slotOverrides 构造虚拟模板，用于支持 Google Photos 等动态布局页面 */
export function buildVirtualTemplate(page: { templateId?: string; slotOverrides?: Record<string, SlotOverride> }): Template | undefined {
  const isGp = page.templateId === GOOGLE_PHOTOS_TEMPLATE_ID;
  const slotIds = page.slotOverrides ? Object.keys(page.slotOverrides) : [];
  if (slotIds.length === 0) {
    // GP 页被「删空/移空」后 slotOverrides 被清为 {}，仍须返回一个有效的空虚拟模板。
    // 若返回 undefined → resolveTemplate 塌陷，页面被打回「无页可编辑」空态并触发下游崩溃。
    if (isGp) {
      return {
        id: GOOGLE_PHOTOS_TEMPLATE_ID,
        name: 'Google Photos 紧凑网格',
        category: 'creative',
        slots: [],
        preview: 'collage',
      };
    }
    return undefined;
  }
  return {
    id: GOOGLE_PHOTOS_TEMPLATE_ID,
    name: 'Google Photos 紧凑网格',
    category: 'creative',
    slots: slotIds.map((id) => ({ id, x: 0, y: 0, width: 0, height: 0 })),
    preview: 'collage',
  };
}

/** 判断页面是否使用 Google Photos 动态布局（统一入口，替代散落的 templateId 全等判断） */
export function isGooglePhotosPage(page: { templateId: string }): boolean {
  return page.templateId === GOOGLE_PHOTOS_TEMPLATE_ID;
}

/* ── 封面 / 封底特殊页面 ── */
/** 封面页的模板 ID 前缀（真实模板 ID = `${COVER_TEMPLATE_PREFIX}<index>`，如 cover-1） */
export const COVER_TEMPLATE_PREFIX = 'cover-';
/** 封底页的模板 ID 前缀 */
export const BACK_COVER_TEMPLATE_PREFIX = 'backcover-';

/** 页面类型：content=普通内容页 / cover=封面 / backCover=封底 */
export type PageKind = 'content' | 'cover' | 'backCover';

/** 判断页面是否为封面页 */
export function isCoverPage(page: { templateId: string }): boolean {
  return page.templateId.startsWith(COVER_TEMPLATE_PREFIX);
}

/** 判断页面是否为封底页 */
export function isBackCoverPage(page: { templateId: string }): boolean {
  return page.templateId.startsWith(BACK_COVER_TEMPLATE_PREFIX);
}

/** 判断页面是否为封面或封底页（特殊页面） */
export function isCoverOrBackCoverPage(page: { templateId: string }): boolean {
  return isCoverPage(page) || isBackCoverPage(page);
}

/**
 * 将 slotCornerRadius 归一化为单一数值（取四角平均值）。
 * 用于缩略图/预览/SmartLayout 等不支持每角单独圆角的渲染场景；
 * 编辑器 Canvas 与导出引擎走 roundRect 原生支持联合类型，无需归一化。
 */
export function normalizeSlotCornerRadius(r: number | [number, number, number, number] | undefined): number {
  if (r === undefined) return 2;
  if (typeof r === 'number') return r;
  return (r[0] + r[1] + r[2] + r[3]) / 4;
}

/**
 * 解析页面最终使用的模板（统一入口）：
 * 静态模板优先；Google Photos 等动态布局页面回退到 slotOverrides 构造的虚拟模板。
 * 用户通过"添加照片位"按钮创建的额外槽位（extraSlots，百分比坐标）会合并到返回的 slots 中。
 * 用户删除的模板内置槽位（hiddenTemplateSlotIds）会从返回的 slots 中过滤掉，画面显示空白。
 */
export function resolveTemplate(page: { templateId: string; slotOverrides?: Record<string, SlotOverride>; extraSlots?: SlotLayout[]; hiddenTemplateSlotIds?: string[] }): Template | undefined {
  const base = findTemplateById(page.templateId) ?? buildVirtualTemplate(page);
  if (!base) return undefined;
  // 过滤用户删除的模板内置槽位（保留原模板结构，仅运行时隐藏）
  const hidden = new Set(page.hiddenTemplateSlotIds ?? []);
  const visibleSlots = hidden.size > 0 ? base.slots.filter((s) => !hidden.has(s.id)) : base.slots;
  // 合并用户添加的额外槽位（去重：跳过已存在于模板中的 slotId）
  const extra = page.extraSlots;
  if (!extra || extra.length === 0) return { ...base, slots: visibleSlots };
  const existingIds = new Set(visibleSlots.map((s) => s.id));
  const mergedSlots = [...visibleSlots, ...extra.filter((s) => !existingIds.has(s.id))];
  return { ...base, slots: mergedSlots };
}

/* ── 页面模板 ── */
export type SlotLayout = {
  id: string;
  x: number;      // 百分比 0-100
  y: number;
  width: number;
  height: number;
};

export type Template = {
  id: string;
  name: string;
  /** 中文名称（中文界面显示用；缺省时回退 name） */
  nameZh?: string;
  category: 'classic' | 'creative' | 'personality';
  slots: SlotLayout[];
  preview: string;
  tags?: string[];
  /** 9+ 图模板的子分类，用于筛选器细分：grid=网格阵列, collage=拼贴叠加, magazine=杂志集锦 */
  subCategory?: 'grid' | 'collage' | 'magazine';
  /** 预设文字元素（百分比坐标，应用时换算为 mm；主要用于封面/封底模板） */
  presetTextElements?: PresetTextElement[];
  /** 预设形状元素（百分比坐标，应用时换算为 mm；主要用于封面/封底模板） */
  presetShapeElements?: PresetShapeElement[];
  /** 预设背景色（主要用于封面/封底模板） */
  presetBackground?: string;
  /** 封面模板：书脊背景色（仅封面模板需要） */
  spineColor?: string;
  /**
   * 封面/封底照片槽位四角圆角（px）：number=统一，[tl,tr,br,bl]=每角单独（顺时针左上→右上→右下→左下）。
   * 按模板设计美观性自定义：全幅照片槽圆角 0（铺满），局部/贴边照片槽按风格设圆角。缺省 4。
   */
  slotCornerRadius?: number | [number, number, number, number];
  /**
   * 封面模板配套的封底模板（整体设计）：每套封面都内置一套风格统一的封底，
   * 应用封面时自动同步应用配套封底，不拆分开。仅封面模板需要。
   */
  backCover?: Template;
};

/**
 * 预设文字元素：与 slots 同为百分比坐标（0-100），应用模板时按页面 mm 尺寸换算。
 * 用于封面/封底模板内置的标题、日期、引言等，让模板开箱即用，用户只需改文字。
 */
export type PresetTextElement = {
  id: string;
  x: number; y: number; width: number; height: number; // 百分比 0-100
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  rotation: number;
  /**
   * 垂直对齐：顶/居中/底（默认居中）。文本框高度大于文字时生效。
   * 封面模板文字框高度通常贴合文字，缺省视为居中。
   */
  verticalAlign?: 'top' | 'center' | 'bottom';
  /** 字间距（逻辑像素，默认 0）。横排=水平字符间距，竖排=垂直字符间距 */
  letterSpacing?: number;
  /** 行距因子（相对字号倍数，默认 1.2）。横排=行高，竖排=列间距的额外部分 */
  lineHeight?: number;
  /** 占位符：应用时自动替换为相册名/日期，用户可再编辑 */
  placeholder?: 'albumName' | 'date' | 'none';
  /** 渐变填充文字：设置后替代 color 渲染线性渐变（与文字工具一致，仅线性） */
  gradient?: GradientStop[];
  /** 线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  gradientAngle?: number;
};

/**
 * 预设形状元素：百分比坐标，用于封面/封底模板内置的装饰线、色块、几何形状。
 * 复用现有 ShapeType，与工具栏形状统一，应用后用户可用形状工具继续编辑。
 */
export type PresetShapeElement = {
  id: string;
  x: number; y: number; width: number; height: number; // 百分比 0-100
  type: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  rotation: number;
  /** 渐变填充：设置后替代 fill 渲染线性渐变（与形状工具一致，仅线性） */
  gradient?: GradientStop[];
  /** 线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  gradientAngle?: number;
  /** 描边渐变：设置后替代 stroke 渲染渐变描边 */
  strokeGradient?: GradientStop[];
  /** 描边线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  strokeGradientAngle?: number;
  /** 圆角占比（0-1，仅矩形类生效，矩形类默认 0，roundRect 系列默认 0.15） */
  cornerRadius?: number;
  /** 切角大小（0-1 比例，仅切角矩形类生效，默认 0.25） */
  cornerCut?: number;
};

/* ── 自定义模板 ── */
export type CustomTemplate = {
  id: string;
  name: string;
  slots: SlotLayout[];
  isBuiltIn?: false;       // false = 用户自定义
  createdAt: string;
  updatedAt: string;
};

/* ── 自定义模板运行时注册表 ── */
// 由 db 层加载后注册,供 resolveTemplate / pageSlice 等同步函数统一查询
let _customTemplateRegistry: CustomTemplate[] = [];

/** 注册自定义模板到运行时注册表(通常在 App 启动或 TemplateGallery 加载后调用) */
export function registerCustomTemplates(templates: CustomTemplate[]): void {
  _customTemplateRegistry = templates;
}

/** 获取当前注册的自定义模板列表 */
export function getCustomTemplateRegistry(): CustomTemplate[] {
  return _customTemplateRegistry;
}

/** 将 CustomTemplate 转换为 Template(补默认 category/preview) */
function customTemplateToTemplate(ct: CustomTemplate): Template {
  const n = ct.slots.length;
  const preview: string = n <= 1 ? 'full' : n === 2 ? 'dual' : n === 3 ? 'triple' : n === 4 ? 'quad' : 'collage';
  return {
    id: ct.id,
    name: ct.name,
    category: 'personality',
    slots: ct.slots,
    preview,
  };
}

/** 统一模板查找:先查内置 TEMPLATES,再查自定义模板注册表 */
export function findTemplateById(id: string): Template | undefined {
  const builtin = TEMPLATES.find((t) => t.id === id);
  if (builtin) return builtin;
  const cover = findCoverTemplateById(id);
  if (cover) return cover;
  const custom = _customTemplateRegistry.find((t) => t.id === id);
  return custom ? customTemplateToTemplate(custom) : undefined;
}

/* ── 内置模板预设 ── */
export const TEMPLATES: Template[] = [
  /* ========= 1图 ========= */
  {
    id: 'full',
    name: '全幅单张',
    category: 'classic',
    slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
    preview: 'full',
  },

  /* ========= 2图 ========= */
  {
    id: 'dual-half',
    name: '双图并排',
    category: 'classic',
    slots: [
      { id: 'left', x: 3, y: 5, width: 45.5, height: 90 },
      { id: 'right', x: 51.5, y: 5, width: 45.5, height: 90 },
    ],
    preview: 'dual',
  },
  {
    id: 'dual-big-small',
    name: '一大一小',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 64, height: 90 },
      { id: 'small', x: 70, y: 5, width: 27, height: 90 },
    ],
    preview: 'dual',
  },
  {
    id: 'dual-stack',
    name: '上下叠排',
    category: 'personality',
    slots: [
      { id: 'top', x: 3, y: 5, width: 94, height: 43 },
      { id: 'bottom', x: 3, y: 51, width: 94, height: 44 },
    ],
    preview: 'dual',
  },

  /* ========= 3图 ========= */
  {
    id: 'pin-shape',
    name: '品字形',
    category: 'classic',
    slots: [
      { id: 'top', x: 3, y: 5, width: 94, height: 43 },
      { id: 'bottom-l', x: 3, y: 52, width: 45.5, height: 43 },
      { id: 'bottom-r', x: 51.5, y: 52, width: 45.5, height: 43 },
    ],
    preview: 'triple',
  },
  {
    id: 'triple-col',
    name: '三图并排',
    category: 'classic',
    slots: [
      { id: 'col1', x: 3, y: 5, width: 29.3, height: 90 },
      { id: 'col2', x: 35.3, y: 5, width: 29.3, height: 90 },
      { id: 'col3', x: 67.7, y: 5, width: 29.3, height: 90 },
    ],
    preview: 'triple',
  },

  {
    id: 'magazine-triple',
    name: '杂志三图',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 60, height: 90 },
      { id: 'rt', x: 66, y: 5, width: 31, height: 43 },
      { id: 'rb', x: 66, y: 51, width: 31, height: 44 },
    ],
    preview: 'triple',
  },

  {
    id: 'triple-portrait',
    name: '竖版主图',
    category: 'personality',
    slots: [
      { id: 'main', x: 3, y: 5, width: 42, height: 90 },
      { id: 'rt', x: 48, y: 5, width: 49, height: 43 },
      { id: 'rb', x: 48, y: 51, width: 49, height: 44 },
    ],
    preview: 'triple',
  },

  /* ========= 3图：三行并列（不同比例） ========= */
  {
    id: 'three-row-equal',
    name: '三行等比',
    category: 'classic',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 29.3 },
      { id: 'r2', x: 3, y: 35.3, width: 94, height: 29.3 },
      { id: 'r3', x: 3, y: 67.7, width: 94, height: 29.3 },
    ],
    preview: 'triple',
  },
  {
    id: 'three-row-panorama',
    name: '三行全景',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 20 },
      { id: 'r2', x: 3, y: 26, width: 94, height: 48 },
      { id: 'r3', x: 3, y: 77, width: 94, height: 20 },
    ],
    preview: 'triple',
  },
  {
    id: 'three-row-large-top',
    name: '三行上大下小',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 50 },
      { id: 'r2', x: 3, y: 56, width: 94, height: 20 },
      { id: 'r3', x: 3, y: 79, width: 94, height: 18 },
    ],
    preview: 'triple',
  },
  {
    id: 'three-row-large-bottom',
    name: '三行上小下大',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 18 },
      { id: 'r2', x: 3, y: 24, width: 94, height: 20 },
      { id: 'r3', x: 3, y: 47, width: 94, height: 50 },
    ],
    preview: 'triple',
  },

  /* ========= 4图 ========= */
  {
    id: 'quad-col',
    name: '四图并排',
    category: 'classic',
    slots: [
      { id: 'col1', x: 3, y: 5, width: 21.5, height: 90 },
      { id: 'col2', x: 27.5, y: 5, width: 21.5, height: 90 },
      { id: 'col3', x: 52, y: 5, width: 21.5, height: 90 },
      { id: 'col4', x: 76.5, y: 5, width: 21.5, height: 90 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-grid',
    name: '四宫格',
    category: 'classic',
    slots: [
      { id: 'tl', x: 3, y: 5, width: 45.5, height: 43 },
      { id: 'tr', x: 51.5, y: 5, width: 45.5, height: 43 },
      { id: 'bl', x: 3, y: 52, width: 45.5, height: 43 },
      { id: 'br', x: 51.5, y: 52, width: 45.5, height: 43 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-hero',
    name: '1大3小',
    category: 'creative',
    slots: [
      { id: 'hero', x: 3, y: 5, width: 94, height: 57 },
      { id: 's1', x: 3, y: 65, width: 29.3, height: 30 },
      { id: 's2', x: 35.3, y: 65, width: 29.3, height: 30 },
      { id: 's3', x: 67.7, y: 65, width: 29.3, height: 30 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-asym',
    name: '四图不对称',
    category: 'personality',
    slots: [
      { id: 'lt', x: 3, y: 5, width: 45.5, height: 33 },
      { id: 'lb', x: 3, y: 41, width: 45.5, height: 54 },
      { id: 'rt', x: 51.5, y: 5, width: 45.5, height: 54 },
      { id: 'rb', x: 51.5, y: 62, width: 45.5, height: 33 },
    ],
    preview: 'quad',
  },

  {
    id: 'quad-stagger',
    name: '阶梯交错',
    category: 'personality',
    slots: [
      { id: 'big', x: 3, y: 5, width: 64, height: 58 },
      { id: 'rt', x: 70, y: 5, width: 27, height: 27.5 },
      { id: 'rb', x: 70, y: 35.5, width: 27, height: 27.5 },
      { id: 'bot', x: 3, y: 66, width: 94, height: 29 },
    ],
    preview: 'quad',
  },

  /* ========= 5图 ========= */
  {
    id: 'five-top2-bot3',
    name: '五图-上二下三',
    category: 'classic',
    slots: [
      { id: 't1', x: 3, y: 5, width: 45.5, height: 43 },
      { id: 't2', x: 51.5, y: 5, width: 45.5, height: 43 },
      { id: 'b1', x: 3, y: 52, width: 29.3, height: 43 },
      { id: 'b2', x: 35.3, y: 52, width: 29.3, height: 43 },
      { id: 'b3', x: 67.7, y: 52, width: 29.3, height: 43 },
    ],
    preview: 'quad',
  },
  {
    id: 'five-top3-bot2',
    name: '五图-上三下二',
    category: 'classic',
    slots: [
      { id: 't1', x: 3, y: 5, width: 29.3, height: 43 },
      { id: 't2', x: 35.3, y: 5, width: 29.3, height: 43 },
      { id: 't3', x: 67.7, y: 5, width: 29.3, height: 43 },
      { id: 'b1', x: 3, y: 52, width: 45.5, height: 43 },
      { id: 'b2', x: 51.5, y: 52, width: 45.5, height: 43 },
    ],
    preview: 'triple',
  },
  {
    id: 'five-left3-right2',
    name: '五图-左三右二',
    category: 'classic',
    slots: [
      { id: 'l1', x: 3, y: 5, width: 55.5, height: 28.3 },
      { id: 'l2', x: 3, y: 36.3, width: 55.5, height: 28.3 },
      { id: 'l3', x: 3, y: 67.7, width: 55.5, height: 28.3 },
      { id: 'r1', x: 61.5, y: 5, width: 35.5, height: 43 },
      { id: 'r2', x: 61.5, y: 52, width: 35.5, height: 43 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-left2-right3',
    name: '五图-左二右三',
    category: 'classic',
    slots: [
      { id: 'l1', x: 3, y: 5, width: 35.5, height: 43 },
      { id: 'l2', x: 3, y: 52, width: 35.5, height: 43 },
      { id: 'r1', x: 41.5, y: 5, width: 55.5, height: 28.3 },
      { id: 'r2', x: 41.5, y: 36.3, width: 55.5, height: 28.3 },
      { id: 'r3', x: 41.5, y: 67.7, width: 55.5, height: 28.3 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-left3-right2-big',
    name: '五图-左三右二大',
    category: 'personality',
    slots: [
      { id: 'l1', x: 3, y: 5, width: 40.5, height: 28.3 },
      { id: 'l2', x: 3, y: 36.3, width: 40.5, height: 28.3 },
      { id: 'l3', x: 3, y: 67.7, width: 40.5, height: 28.3 },
      { id: 'r1', x: 46.5, y: 5, width: 50.5, height: 43 },
      { id: 'r2', x: 46.5, y: 52, width: 50.5, height: 43 },
    ],
    preview: 'collage',
  },

  {
    id: 'five-cross',
    name: '十字焦点',
    category: 'personality',
    slots: [
      { id: 't1', x: 3, y: 5, width: 45.5, height: 26 },
      { id: 't2', x: 51.5, y: 5, width: 45.5, height: 26 },
      { id: 'mid', x: 3, y: 34, width: 94, height: 32 },
      { id: 'b1', x: 3, y: 69, width: 45.5, height: 26 },
      { id: 'b2', x: 51.5, y: 69, width: 45.5, height: 26 },
    ],
    preview: 'collage',
    tags: ['stagger'],
  },
  {
    id: 'magazine-five',
    name: '杂志五图',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 50, height: 90 },
      { id: 'stl', x: 56, y: 5, width: 19, height: 43 },
      { id: 'str', x: 78, y: 5, width: 19, height: 43 },
      { id: 'sbl', x: 56, y: 51, width: 19, height: 44 },
      { id: 'sbr', x: 78, y: 51, width: 19, height: 44 },
    ],
    preview: 'collage',
  },

  /* ========= 6图 ========= */
  {
    id: 'six-grid',
    name: '六图并排',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 43 },
      { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 43 },
      { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 43 },
      { id: 'r2c1', x: 3, y: 52, width: 29.3, height: 43 },
      { id: 'r2c2', x: 35.3, y: 52, width: 29.3, height: 43 },
      { id: 'r2c3', x: 67.7, y: 52, width: 29.3, height: 43 },
    ],
    preview: 'quad',
  },
  {
    id: 'six-hero-grid',
    name: '2大4小',
    category: 'creative',
    slots: [
      { id: 'b1', x: 3, y: 5, width: 45.5, height: 43 },
      { id: 'b2', x: 3, y: 51, width: 45.5, height: 44 },
      { id: 'stl', x: 51.5, y: 5, width: 21.25, height: 43 },
      { id: 'str', x: 75.75, y: 5, width: 21.25, height: 43 },
      { id: 'sbl', x: 51.5, y: 51, width: 21.25, height: 44 },
      { id: 'sbr', x: 75.75, y: 51, width: 21.25, height: 44 },
    ],
    preview: 'collage',
  },
  {
    id: 'six-magazine',
    name: '杂志六图',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 54, height: 90 },
      { id: 'rtl', x: 60, y: 5, width: 17, height: 28.3 },
      { id: 'rtr', x: 80, y: 5, width: 17, height: 28.3 },
      { id: 'rml', x: 60, y: 36.3, width: 17, height: 28.3 },
      { id: 'rmr', x: 80, y: 36.3, width: 17, height: 28.3 },
      { id: 'rbot', x: 60, y: 67.7, width: 37, height: 28.3 },
    ],
    preview: 'collage',
  },

  /* ========= 新增：1图补充 ========= */
  {
    id: 'full-bleed',
    name: '全幅出血',
    category: 'classic',
    slots: [{ id: 'main', x: 0, y: 0, width: 100, height: 100 }],
    preview: 'full',
  },
  {
    id: 'full-framed',
    name: '留白单张',
    category: 'classic',
    slots: [{ id: 'main', x: 6, y: 8, width: 88, height: 84 }],
    preview: 'full',
  },
  {
    id: 'full-panorama',
    name: '宽幅单张',
    category: 'creative',
    slots: [{ id: 'main', x: 3, y: 25, width: 94, height: 50 }],
    preview: 'full',
  },

  /* ========= 新增：2图补充 ========= */
  {
    id: 'dual-overlap',
    name: '双图交叠',
    category: 'creative',
    slots: [
      { id: 'back', x: 3, y: 8, width: 55, height: 84 },
      { id: 'front', x: 64, y: 18, width: 33, height: 64 },
    ],
    preview: 'dual',
  },
  {
    id: 'dual-diagonal',
    name: '对角双图',
    category: 'personality',
    slots: [
      { id: 'tl', x: 3, y: 5, width: 55, height: 42 },
      { id: 'br', x: 42, y: 53, width: 55, height: 42 },
    ],
    preview: 'dual',
  },

  /* ========= 新增：3图补充 ========= */
  {
    id: 'triple-l-shape',
    name: 'L型三图',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 64, height: 90 },
      { id: 'tr', x: 70, y: 5, width: 27, height: 42 },
      { id: 'br', x: 70, y: 53, width: 27, height: 42 },
    ],
    preview: 'triple',
  },
  {
    id: 'triple-stack-right',
    name: '左主右叠',
    category: 'personality',
    slots: [
      { id: 'main', x: 3, y: 5, width: 55, height: 90 },
      { id: 'rt', x: 61, y: 5, width: 36, height: 43 },
      { id: 'rb', x: 61, y: 52, width: 36, height: 43 },
    ],
    preview: 'triple',
  },
  {
    id: 'triple-horizontal-big',
    name: '横幅三图',
    category: 'classic',
    slots: [
      { id: 'top', x: 3, y: 5, width: 94, height: 52 },
      { id: 'bl', x: 3, y: 61, width: 45.5, height: 34 },
      { id: 'br', x: 51.5, y: 61, width: 45.5, height: 34 },
    ],
    preview: 'triple',
  },

  /* ========= 新增：4图补充 ========= */
  {
    id: 'quad-hero-left',
    name: '左大右三',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 55, height: 90 },
      { id: 'rt', x: 61, y: 5, width: 36, height: 27 },
      { id: 'rm', x: 61, y: 36, width: 36, height: 27 },
      { id: 'rb', x: 61, y: 67, width: 36, height: 28 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-hero-right',
    name: '右大左三',
    category: 'creative',
    slots: [
      { id: 'big', x: 42, y: 5, width: 55, height: 90 },
      { id: 'lt', x: 3, y: 5, width: 36, height: 27 },
      { id: 'lm', x: 3, y: 36, width: 36, height: 27 },
      { id: 'lb', x: 3, y: 67, width: 36, height: 28 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-triptych-plus',
    name: '三联加一',
    category: 'classic',
    slots: [
      { id: 'top', x: 3, y: 5, width: 94, height: 48 },
      { id: 'b1', x: 3, y: 57, width: 29.3, height: 38 },
      { id: 'b2', x: 35.3, y: 57, width: 29.3, height: 38 },
      { id: 'b3', x: 67.7, y: 57, width: 29.3, height: 38 },
    ],
    preview: 'quad',
  },
  {
    id: 'quad-masonry',
    name: '错落四图',
    category: 'personality',
    slots: [
      { id: 't1', x: 3, y: 5, width: 45.5, height: 38 },
      { id: 't2', x: 51.5, y: 5, width: 45.5, height: 52 },
      { id: 'b1', x: 3, y: 47, width: 45.5, height: 48 },
      { id: 'b2', x: 51.5, y: 61, width: 45.5, height: 34 },
    ],
    preview: 'quad',
  },

  /* ========= 4图：多行并列（不同比例） ========= */
  {
    id: 'four-row-equal',
    name: '四行等比',
    category: 'classic',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 22 },
      { id: 'r2', x: 3, y: 27, width: 94, height: 22 },
      { id: 'r3', x: 3, y: 51, width: 94, height: 22 },
      { id: 'r4', x: 3, y: 75, width: 94, height: 22 },
    ],
    preview: 'quad',
  },
  {
    id: 'four-row-panorama',
    name: '四行全景',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 14 },
      { id: 'r2', x: 3, y: 20, width: 94, height: 36 },
      { id: 'r3', x: 3, y: 59, width: 94, height: 14 },
      { id: 'r4', x: 3, y: 76, width: 94, height: 21 },
    ],
    preview: 'quad',
  },
  {
    id: 'four-row-large-mid',
    name: '四行中宽',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 16 },
      { id: 'r2', x: 3, y: 22, width: 94, height: 38 },
      { id: 'r3', x: 3, y: 63, width: 94, height: 16 },
      { id: 'r4', x: 3, y: 82, width: 94, height: 15 },
    ],
    preview: 'quad',
  },

  /* ========= 新增：5图补充 ========= */
  {
    id: 'five-circle-center',
    name: '中心焦点',
    category: 'creative',
    slots: [
      { id: 'tl', x: 3, y: 5, width: 35, height: 30 },
      { id: 'tr', x: 62, y: 5, width: 35, height: 30 },
      { id: 'mid', x: 28, y: 38, width: 44, height: 24 },
      { id: 'bl', x: 3, y: 66, width: 35, height: 29 },
      { id: 'br', x: 62, y: 66, width: 35, height: 29 },
    ],
    preview: 'collage',
    tags: ['stagger'],
  },
  {
    id: 'five-stagger',
    name: '错落五图',
    category: 'personality',
    slots: [
      { id: 't1', x: 3, y: 5, width: 27, height: 43 },
      { id: 't2', x: 35, y: 15, width: 32, height: 43 },
      { id: 't3', x: 70, y: 5, width: 27, height: 43 },
      { id: 'b1', x: 3, y: 55, width: 27, height: 40 },
      { id: 'b2', x: 35, y: 65, width: 62, height: 30 },
    ],
    preview: 'collage',
    tags: ['stagger'],
  },
  {
    id: 'five-panorama-center',
    name: '中横幅五图',
    category: 'classic',
    slots: [
      { id: 't1', x: 3, y: 5, width: 29.3, height: 30 },
      { id: 't2', x: 35.3, y: 5, width: 29.3, height: 30 },
      { id: 't3', x: 67.7, y: 5, width: 29.3, height: 30 },
      { id: 'mid', x: 3, y: 39, width: 94, height: 22 },
      { id: 'b1', x: 3, y: 65, width: 94, height: 30 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-left-big-right4',
    name: '左大右四',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 55, height: 90 },
      { id: 'r1', x: 61, y: 5, width: 36, height: 20 },
      { id: 'r2', x: 61, y: 28, width: 36, height: 20 },
      { id: 'r3', x: 61, y: 51, width: 36, height: 20 },
      { id: 'r4', x: 61, y: 74, width: 36, height: 21 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-top-big-bot4',
    name: '上大下四',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 94, height: 52 },
      { id: 'b1', x: 3, y: 61, width: 21.25, height: 34 },
      { id: 'b2', x: 27.25, y: 61, width: 21.25, height: 34 },
      { id: 'b3', x: 51.5, y: 61, width: 21.25, height: 34 },
      { id: 'b4', x: 75.75, y: 61, width: 21.25, height: 34 },
    ],
    preview: 'collage',
  },

  /* ========= 5图：多行并列（不同比例） ========= */
  {
    id: 'five-row-equal',
    name: '五行等比',
    category: 'classic',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 17.4 },
      { id: 'r2', x: 3, y: 22.4, width: 94, height: 17.4 },
      { id: 'r3', x: 3, y: 41.8, width: 94, height: 17.4 },
      { id: 'r4', x: 3, y: 61.2, width: 94, height: 17.4 },
      { id: 'r5', x: 3, y: 80.6, width: 94, height: 16.4 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-row-panorama',
    name: '五行全景',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 12 },
      { id: 'r2', x: 3, y: 18, width: 94, height: 12 },
      { id: 'r3', x: 3, y: 33, width: 94, height: 30 },
      { id: 'r4', x: 3, y: 66, width: 94, height: 14 },
      { id: 'r5', x: 3, y: 83, width: 94, height: 14 },
    ],
    preview: 'collage',
  },
  {
    id: 'five-row-large-mid',
    name: '五行中宽',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 12 },
      { id: 'r2', x: 3, y: 18, width: 94, height: 12 },
      { id: 'r3', x: 3, y: 33, width: 94, height: 34 },
      { id: 'r4', x: 3, y: 70, width: 94, height: 12 },
      { id: 'r5', x: 3, y: 85, width: 94, height: 12 },
    ],
    preview: 'collage',
  },

  /* ========= 新增：6图补充 ========= */
  {
    id: 'six-3x2-alt',
    name: '六图杂志',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 35, height: 43 },
      { id: 'r1c2', x: 41, y: 5, width: 25, height: 43 },
      { id: 'r1c3', x: 69, y: 5, width: 28, height: 43 },
      { id: 'r2c1', x: 3, y: 52, width: 28, height: 43 },
      { id: 'r2c2', x: 34, y: 52, width: 32, height: 43 },
      { id: 'r2c3', x: 69, y: 52, width: 28, height: 43 },
    ],
    preview: 'collage',
  },
  {
    id: 'six-left-big-right5',
    name: '左大右五',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 50, height: 90 },
      { id: 'r1', x: 56, y: 5, width: 41, height: 16 },
      { id: 'r2', x: 56, y: 24, width: 41, height: 16 },
      { id: 'r3', x: 56, y: 43, width: 41, height: 16 },
      { id: 'r4', x: 56, y: 62, width: 41, height: 16 },
      { id: 'r5', x: 56, y: 81, width: 41, height: 14 },
    ],
    preview: 'collage',
  },
  {
    id: 'six-around',
    name: '中心环绕',
    category: 'personality',
    slots: [
      { id: 'center', x: 32, y: 32, width: 36, height: 36 },
      { id: 'top', x: 32, y: 3, width: 36, height: 26 },
      { id: 'bottom', x: 32, y: 71, width: 36, height: 26 },
      { id: 'left', x: 3, y: 32, width: 26, height: 36 },
      { id: 'right', x: 71, y: 32, width: 26, height: 36 },
      { id: 'tl', x: 3, y: 3, width: 26, height: 26 },
    ],
    preview: 'collage',
    tags: ['stagger'],
  },

  /* ========= 6图：多行并列（不同比例） ========= */
  {
    id: 'six-row-equal',
    name: '六行等比',
    category: 'classic',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 14.5 },
      { id: 'r2', x: 3, y: 19.5, width: 94, height: 14.5 },
      { id: 'r3', x: 3, y: 36, width: 94, height: 14.5 },
      { id: 'r4', x: 3, y: 52.5, width: 94, height: 14.5 },
      { id: 'r5', x: 3, y: 69, width: 94, height: 14.5 },
      { id: 'r6', x: 3, y: 85.5, width: 94, height: 11.5 },
    ],
    preview: 'collage',
  },
  {
    id: 'six-row-panorama',
    name: '六行全景',
    category: 'personality',
    slots: [
      { id: 'r1', x: 3, y: 3, width: 94, height: 10 },
      { id: 'r2', x: 3, y: 16, width: 94, height: 10 },
      { id: 'r3', x: 3, y: 29, width: 94, height: 28 },
      { id: 'r4', x: 3, y: 60, width: 94, height: 10 },
      { id: 'r5', x: 3, y: 73, width: 94, height: 10 },
      { id: 'r6', x: 3, y: 86, width: 94, height: 11 },
    ],
    preview: 'collage',
  },
  {
    id: 'six-2x3-rows',
    name: '三行二列',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 3, width: 45.5, height: 29.3 },
      { id: 'r1c2', x: 51.5, y: 3, width: 45.5, height: 29.3 },
      { id: 'r2c1', x: 3, y: 35.3, width: 45.5, height: 29.3 },
      { id: 'r2c2', x: 51.5, y: 35.3, width: 45.5, height: 29.3 },
      { id: 'r3c1', x: 3, y: 67.7, width: 45.5, height: 29.3 },
      { id: 'r3c2', x: 51.5, y: 67.7, width: 45.5, height: 29.3 },
    ],
    preview: 'collage',
  },

  /* ========= 新增：7图 ========= */
  {
    id: 'seven-3x2-plus1',
    name: '六格加一',
    category: 'classic',
    slots: [
      { id: 'big', x: 3, y: 5, width: 55, height: 55 },
      { id: 'r1', x: 61, y: 5, width: 36, height: 28 },
      { id: 'r2', x: 61, y: 36, width: 36, height: 28 },
      { id: 'r3', x: 61, y: 67, width: 36, height: 28 },
      { id: 'b1', x: 3, y: 64, width: 17, height: 31 },
      { id: 'b2', x: 22, y: 64, width: 17, height: 31 },
      { id: 'b3', x: 41, y: 64, width: 17, height: 31 },
    ],
    preview: 'collage',
  },
  {
    id: 'seven-top-big-bot6',
    name: '上大下六',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 3, width: 94, height: 42 },
      { id: 'r1c1', x: 3, y: 47, width: 30, height: 22 },
      { id: 'r1c2', x: 35, y: 47, width: 30, height: 22 },
      { id: 'r1c3', x: 67, y: 47, width: 30, height: 22 },
      { id: 'r2c1', x: 3, y: 71, width: 30, height: 24 },
      { id: 'r2c2', x: 35, y: 71, width: 30, height: 24 },
      { id: 'r2c3', x: 67, y: 71, width: 30, height: 24 },
    ],
    preview: 'collage',
  },
  {
    id: 'seven-masonry',
    name: '瀑布七图',
    category: 'personality',
    slots: [
      { id: 'c1', x: 3, y: 5, width: 29.3, height: 55 },
      { id: 'c2', x: 35.3, y: 5, width: 29.3, height: 40 },
      { id: 'c3', x: 67.7, y: 5, width: 29.3, height: 50 },
      { id: 'c4', x: 3, y: 62, width: 29.3, height: 33 },
      { id: 'c5', x: 35.3, y: 47, width: 29.3, height: 30 },
      { id: 'c6', x: 67.7, y: 57, width: 29.3, height: 38 },
      { id: 'c7', x: 35.3, y: 79, width: 29.3, height: 16 },
    ],
    preview: 'collage',
    tags: ['masonry'],
  },
  {
    id: 'seven-panorama',
    name: '全景七图',
    category: 'classic',
    slots: [
      { id: 'pan', x: 3, y: 5, width: 94, height: 36 },
      { id: 'r1', x: 3, y: 45, width: 29.3, height: 24 },
      { id: 'r2', x: 35.3, y: 45, width: 29.3, height: 24 },
      { id: 'r3', x: 67.7, y: 45, width: 29.3, height: 24 },
      { id: 'b1', x: 3, y: 72, width: 29.3, height: 23 },
      { id: 'b2', x: 35.3, y: 72, width: 29.3, height: 23 },
      { id: 'b3', x: 67.7, y: 72, width: 29.3, height: 23 },
    ],
    preview: 'collage',
  },
  {
    id: 'seven-circle',
    name: '圆环七图',
    category: 'personality',
    slots: [
      { id: 'center', x: 35, y: 35, width: 30, height: 30 },
      { id: 't', x: 35, y: 5, width: 30, height: 27 },
      { id: 'tr', x: 68, y: 18, width: 27, height: 27 },
      { id: 'br', x: 68, y: 55, width: 27, height: 27 },
      { id: 'b', x: 35, y: 68, width: 30, height: 27 },
      { id: 'bl', x: 5, y: 55, width: 27, height: 27 },
      { id: 'tl', x: 5, y: 18, width: 27, height: 27 },
    ],
    preview: 'collage',
  },
  {
    id: 'seven-2x3-plus1',
    name: '二行三列加一',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 30, height: 30 },
      { id: 'r1c2', x: 35, y: 5, width: 30, height: 30 },
      { id: 'r1c3', x: 67, y: 5, width: 30, height: 30 },
      { id: 'r2c1', x: 3, y: 37, width: 30, height: 30 },
      { id: 'r2c2', x: 35, y: 37, width: 30, height: 30 },
      { id: 'r2c3', x: 67, y: 37, width: 30, height: 30 },
      { id: 'bot', x: 3, y: 70, width: 94, height: 25 },
    ],
    preview: 'collage',
  },

  /* ========= 新增：8图 ========= */
  {
    id: 'eight-grid-4x2',
    name: '四列两行',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 21.5, height: 43 },
      { id: 'r1c2', x: 27.5, y: 5, width: 21.5, height: 43 },
      { id: 'r1c3', x: 52, y: 5, width: 21.5, height: 43 },
      { id: 'r1c4', x: 76.5, y: 5, width: 21.5, height: 43 },
      { id: 'r2c1', x: 3, y: 52, width: 21.5, height: 43 },
      { id: 'r2c2', x: 27.5, y: 52, width: 21.5, height: 43 },
      { id: 'r2c3', x: 52, y: 52, width: 21.5, height: 43 },
      { id: 'r2c4', x: 76.5, y: 52, width: 21.5, height: 43 },
    ],
    preview: 'quad',
  },
  {
    id: 'eight-3x3-minus1',
    name: '九宫缺一',
    category: 'creative',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 28.3 },
      { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 28.3 },
      { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 28.3 },
      { id: 'r2c1', x: 3, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r2c2', x: 35.3, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r2c3', x: 67.7, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r3c1', x: 3, y: 67.7, width: 29.3, height: 27.3 },
      { id: 'r3c2', x: 35.3, y: 67.7, width: 29.3, height: 27.3 },
    ],
    preview: 'collage',
  },
  {
    id: 'eight-masonry',
    name: '瀑布八图',
    category: 'personality',
    slots: [
      { id: 'c1', x: 3, y: 5, width: 22.5, height: 50 },
      { id: 'c2', x: 28.5, y: 5, width: 22.5, height: 38 },
      { id: 'c3', x: 54, y: 5, width: 22.5, height: 46 },
      { id: 'c4', x: 79.5, y: 5, width: 17.5, height: 30 },
      { id: 'c5', x: 3, y: 59, width: 22.5, height: 36 },
      { id: 'c6', x: 28.5, y: 47, width: 22.5, height: 48 },
      { id: 'c7', x: 54, y: 55, width: 22.5, height: 40 },
      { id: 'c8', x: 79.5, y: 39, width: 17.5, height: 56 },
    ],
    preview: 'collage',
    tags: ['masonry'],
  },
  {
    id: 'eight-2x4',
    name: '两行四列',
    category: 'classic',
    slots: [
      { id: 'c1r1', x: 3, y: 5, width: 45.5, height: 20 },
      { id: 'c2r1', x: 51.5, y: 5, width: 45.5, height: 20 },
      { id: 'c1r2', x: 3, y: 28, width: 45.5, height: 20 },
      { id: 'c2r2', x: 51.5, y: 28, width: 45.5, height: 20 },
      { id: 'c1r3', x: 3, y: 51, width: 45.5, height: 20 },
      { id: 'c2r3', x: 51.5, y: 51, width: 45.5, height: 20 },
      { id: 'c1r4', x: 3, y: 74, width: 45.5, height: 21 },
      { id: 'c2r4', x: 51.5, y: 74, width: 45.5, height: 21 },
    ],
    preview: 'quad',
  },
  {
    id: 'eight-around',
    name: '中心环绕八',
    category: 'personality',
    slots: [
      { id: 'center', x: 32, y: 32, width: 36, height: 36 },
      { id: 'top', x: 32, y: 3, width: 36, height: 26 },
      { id: 'bottom', x: 32, y: 71, width: 36, height: 26 },
      { id: 'left', x: 3, y: 32, width: 26, height: 36 },
      { id: 'right', x: 71, y: 32, width: 26, height: 36 },
      { id: 'tl', x: 3, y: 3, width: 26, height: 26 },
      { id: 'tr', x: 71, y: 3, width: 26, height: 26 },
      { id: 'br', x: 71, y: 71, width: 26, height: 26 },
    ],
    preview: 'collage',
    tags: ['stagger'],
  },
  {
    id: 'eight-stagger',
    name: '交错八图',
    category: 'creative',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 30, height: 28 },
      { id: 'r1c2', x: 35, y: 5, width: 30, height: 28 },
      { id: 'r1c3', x: 67, y: 5, width: 30, height: 28 },
      { id: 'r2c1', x: 3, y: 36, width: 30, height: 28 },
      { id: 'r2c2', x: 35, y: 36, width: 30, height: 28 },
      { id: 'r2c3', x: 67, y: 36, width: 30, height: 28 },
      { id: 'r3c1', x: 3, y: 67, width: 45, height: 28 },
      { id: 'r3c2', x: 52, y: 67, width: 45, height: 28 },
    ],
    preview: 'collage',
  },

  /* ========= 生成器批量扩展模板（1-12 图，约 300 种） ========= */
  ...GENERATED_TEMPLATES,

  /* ========= 封面 / 封底模板库（美学版式） ========= */
  ...ALL_COVER_TEMPLATES,

  /* ========= 9-12 图基础平铺模板（按子分类组织） ========= */

  /* ── 9 图：网格阵列 ── */
  {
    id: 'nine-grid-3x3',
    name: '九宫格',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 28.3 },
      { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 28.3 },
      { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 28.3 },
      { id: 'r2c1', x: 3, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r2c2', x: 35.3, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r2c3', x: 67.7, y: 36.3, width: 29.3, height: 28.3 },
      { id: 'r3c1', x: 3, y: 67.7, width: 29.3, height: 27.3 },
      { id: 'r3c2', x: 35.3, y: 67.7, width: 29.3, height: 27.3 },
      { id: 'r3c3', x: 67.7, y: 67.7, width: 29.3, height: 27.3 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },
  /* ── 9 图：杂志集锦 ── */
  {
    id: 'nine-top-big-bot8',
    name: '上大下八',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 3, width: 94, height: 38 },
      { id: 'b1', x: 3, y: 43, width: 22, height: 24 },
      { id: 'b2', x: 27, y: 43, width: 22, height: 24 },
      { id: 'b3', x: 51, y: 43, width: 22, height: 24 },
      { id: 'b4', x: 75, y: 43, width: 22, height: 24 },
      { id: 'b5', x: 3, y: 69, width: 22, height: 26 },
      { id: 'b6', x: 27, y: 69, width: 22, height: 26 },
      { id: 'b7', x: 51, y: 69, width: 22, height: 26 },
      { id: 'b8', x: 75, y: 69, width: 22, height: 26 },
    ],
    preview: 'collage',
    subCategory: 'magazine',
  },

  /* ── 10 图：网格阵列 ── */
  {
    id: 'ten-grid-5x2',
    name: '五列两行',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 17.2, height: 43 },
      { id: 'r1c2', x: 23.2, y: 5, width: 17.2, height: 43 },
      { id: 'r1c3', x: 43.4, y: 5, width: 17.2, height: 43 },
      { id: 'r1c4', x: 63.6, y: 5, width: 17.2, height: 43 },
      { id: 'r1c5', x: 83.8, y: 5, width: 13.2, height: 43 },
      { id: 'r2c1', x: 3, y: 52, width: 17.2, height: 43 },
      { id: 'r2c2', x: 23.2, y: 52, width: 17.2, height: 43 },
      { id: 'r2c3', x: 43.4, y: 52, width: 17.2, height: 43 },
      { id: 'r2c4', x: 63.6, y: 52, width: 17.2, height: 43 },
      { id: 'r2c5', x: 83.8, y: 52, width: 13.2, height: 43 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },
  {
    id: 'ten-grid-2x5',
    name: '两行五列',
    category: 'classic',
    slots: [
      { id: 'c1r1', x: 3, y: 5, width: 45.5, height: 17.2 },
      { id: 'c2r1', x: 51.5, y: 5, width: 45.5, height: 17.2 },
      { id: 'c1r2', x: 3, y: 24.2, width: 45.5, height: 17.2 },
      { id: 'c2r2', x: 51.5, y: 24.2, width: 45.5, height: 17.2 },
      { id: 'c1r3', x: 3, y: 43.4, width: 45.5, height: 17.2 },
      { id: 'c2r3', x: 51.5, y: 43.4, width: 45.5, height: 17.2 },
      { id: 'c1r4', x: 3, y: 62.6, width: 45.5, height: 17.2 },
      { id: 'c2r4', x: 51.5, y: 62.6, width: 45.5, height: 17.2 },
      { id: 'c1r5', x: 3, y: 81.8, width: 45.5, height: 13.2 },
      { id: 'c2r5', x: 51.5, y: 81.8, width: 45.5, height: 13.2 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },

  /* ── 10 图：杂志集锦 ── */
  {
    id: 'ten-top-big-bot9',
    name: '上大下九',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 3, width: 94, height: 32 },
      { id: 'r1c1', x: 3, y: 37, width: 30, height: 18 },
      { id: 'r1c2', x: 35, y: 37, width: 30, height: 18 },
      { id: 'r1c3', x: 67, y: 37, width: 30, height: 18 },
      { id: 'r2c1', x: 3, y: 57, width: 30, height: 18 },
      { id: 'r2c2', x: 35, y: 57, width: 30, height: 18 },
      { id: 'r2c3', x: 67, y: 57, width: 30, height: 18 },
      { id: 'r3c1', x: 3, y: 77, width: 30, height: 18 },
      { id: 'r3c2', x: 35, y: 77, width: 30, height: 18 },
      { id: 'r3c3', x: 67, y: 77, width: 30, height: 18 },
    ],
    preview: 'collage',
    subCategory: 'magazine',
  },

  /* ── 11 图：网格阵列 ── */
  {
    id: 'eleven-grid-4x3-minus1',
    name: '四列三行缺一',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c2', x: 28.5, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c3', x: 54, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c4', x: 79.5, y: 5, width: 17.5, height: 28.3 },
      { id: 'r2c1', x: 3, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c2', x: 28.5, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c3', x: 54, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c4', x: 79.5, y: 36.3, width: 17.5, height: 28.3 },
      { id: 'r3c1', x: 3, y: 67.7, width: 22.5, height: 27.3 },
      { id: 'r3c2', x: 28.5, y: 67.7, width: 22.5, height: 27.3 },
      { id: 'r3c3', x: 54, y: 67.7, width: 22.5, height: 27.3 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },

  /* ── 11 图：杂志集锦 ── */
  {
    id: 'eleven-top-big-bot10',
    name: '上大下十',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 5, width: 94, height: 35 },
      { id: 'b1', x: 3, y: 44, width: 18, height: 25 },
      { id: 'b2', x: 24, y: 44, width: 18, height: 25 },
      { id: 'b3', x: 45, y: 44, width: 18, height: 25 },
      { id: 'b4', x: 66, y: 44, width: 18, height: 25 },
      { id: 'b5', x: 87, y: 44, width: 10, height: 25 },
      { id: 'b6', x: 3, y: 72, width: 18, height: 23 },
      { id: 'b7', x: 24, y: 72, width: 18, height: 23 },
      { id: 'b8', x: 45, y: 72, width: 18, height: 23 },
      { id: 'b9', x: 66, y: 72, width: 18, height: 23 },
      { id: 'b10', x: 87, y: 72, width: 10, height: 23 },
    ],
    preview: 'collage',
    subCategory: 'magazine',
  },

  /* ── 12 图：网格阵列 ── */
  {
    id: 'twelve-grid-4x3',
    name: '四列三行',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c2', x: 28.5, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c3', x: 54, y: 5, width: 22.5, height: 28.3 },
      { id: 'r1c4', x: 79.5, y: 5, width: 17.5, height: 28.3 },
      { id: 'r2c1', x: 3, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c2', x: 28.5, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c3', x: 54, y: 36.3, width: 22.5, height: 28.3 },
      { id: 'r2c4', x: 79.5, y: 36.3, width: 17.5, height: 28.3 },
      { id: 'r3c1', x: 3, y: 67.7, width: 22.5, height: 27.3 },
      { id: 'r3c2', x: 28.5, y: 67.7, width: 22.5, height: 27.3 },
      { id: 'r3c3', x: 54, y: 67.7, width: 22.5, height: 27.3 },
      { id: 'r3c4', x: 79.5, y: 67.7, width: 17.5, height: 27.3 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },
  {
    id: 'twelve-grid-3x4',
    name: '三列四行',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 21.5 },
      { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 21.5 },
      { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 21.5 },
      { id: 'r2c1', x: 3, y: 29.5, width: 29.3, height: 21.5 },
      { id: 'r2c2', x: 35.3, y: 29.5, width: 29.3, height: 21.5 },
      { id: 'r2c3', x: 67.7, y: 29.5, width: 29.3, height: 21.5 },
      { id: 'r3c1', x: 3, y: 54, width: 29.3, height: 21.5 },
      { id: 'r3c2', x: 35.3, y: 54, width: 29.3, height: 21.5 },
      { id: 'r3c3', x: 67.7, y: 54, width: 29.3, height: 21.5 },
      { id: 'r4c1', x: 3, y: 78.5, width: 29.3, height: 16.5 },
      { id: 'r4c2', x: 35.3, y: 78.5, width: 29.3, height: 16.5 },
      { id: 'r4c3', x: 67.7, y: 78.5, width: 29.3, height: 16.5 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },
  {
    id: 'twelve-grid-2x6',
    name: '两行六列',
    category: 'classic',
    slots: [
      { id: 'c1r1', x: 3, y: 5, width: 45.5, height: 14.5 },
      { id: 'c2r1', x: 51.5, y: 5, width: 45.5, height: 14.5 },
      { id: 'c1r2', x: 3, y: 21.5, width: 45.5, height: 14.5 },
      { id: 'c2r2', x: 51.5, y: 21.5, width: 45.5, height: 14.5 },
      { id: 'c1r3', x: 3, y: 38, width: 45.5, height: 14.5 },
      { id: 'c2r3', x: 51.5, y: 38, width: 45.5, height: 14.5 },
      { id: 'c1r4', x: 3, y: 54.5, width: 45.5, height: 14.5 },
      { id: 'c2r4', x: 51.5, y: 54.5, width: 45.5, height: 14.5 },
      { id: 'c1r5', x: 3, y: 71, width: 45.5, height: 14.5 },
      { id: 'c2r5', x: 51.5, y: 71, width: 45.5, height: 14.5 },
      { id: 'c1r6', x: 3, y: 87.5, width: 45.5, height: 7.5 },
      { id: 'c2r6', x: 51.5, y: 87.5, width: 45.5, height: 7.5 },
    ],
    preview: 'collage',
    subCategory: 'grid',
  },

  /* ── 12 图：杂志集锦 ── */
  {
    id: 'twelve-top-big-bot11',
    name: '上大下十一',
    category: 'creative',
    slots: [
      { id: 'big', x: 3, y: 3, width: 94, height: 30 },
      { id: 'r1c1', x: 3, y: 35, width: 22, height: 20 },
      { id: 'r1c2', x: 27, y: 35, width: 22, height: 20 },
      { id: 'r1c3', x: 51, y: 35, width: 22, height: 20 },
      { id: 'r1c4', x: 75, y: 35, width: 22, height: 20 },
      { id: 'r2c1', x: 3, y: 57, width: 22, height: 20 },
      { id: 'r2c2', x: 27, y: 57, width: 22, height: 20 },
      { id: 'r2c3', x: 51, y: 57, width: 22, height: 20 },
      { id: 'r2c4', x: 75, y: 57, width: 22, height: 20 },
      { id: 'r3c1', x: 3, y: 79, width: 30, height: 16 },
      { id: 'r3c2', x: 35, y: 79, width: 30, height: 16 },
      { id: 'r3c3', x: 67, y: 79, width: 30, height: 16 },
    ],
    preview: 'collage',
    subCategory: 'magazine',
  },

  /* ============================================================
     照片位叠加布局（overlay + white-space）
     设计要点：
     - 槽位有部分重叠，形成层次感与拼贴风格
     - slots 数组顺序 = 渲染层级（后者覆盖前者）
     - 留有呼吸空间，不填满整页
     - 应用到页面时等比缩放 + 居中对齐，保留设计相对位置
     ============================================================ */

  /* ── 2 图叠加 ── */
  {
    id: 'overlay-2p-diagonal',
    name: '错位双图',
    category: 'creative',
    slots: [
      { id: 'base', x: 8, y: 12, width: 58, height: 76 },
      { id: 'top', x: 44, y: 28, width: 48, height: 52 },
    ],
    preview: 'dual',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-2p-corner',
    name: '对角呼应',
    category: 'creative',
    slots: [
      { id: 'base', x: 6, y: 8, width: 54, height: 72 },
      { id: 'top', x: 42, y: 22, width: 52, height: 64 },
    ],
    preview: 'dual',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-2p-shift',
    name: '微移双图',
    category: 'personality',
    slots: [
      { id: 'base', x: 12, y: 10, width: 68, height: 80 },
      { id: 'top', x: 22, y: 18, width: 62, height: 72 },
    ],
    preview: 'dual',
    tags: ['overlay', 'white-space'],
  },

  /* ── 3 图叠加 ── */
  {
    id: 'overlay-3p-stair',
    name: '三层阶梯',
    category: 'creative',
    slots: [
      { id: 'base', x: 5, y: 15, width: 55, height: 70 },
      { id: 'mid', x: 40, y: 5, width: 42, height: 38 },
      { id: 'top', x: 45, y: 55, width: 45, height: 38 },
    ],
    preview: 'triple',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-3p-focus',
    name: '居中聚焦',
    category: 'creative',
    slots: [
      { id: 'base', x: 8, y: 10, width: 84, height: 80 },
      { id: 'mid', x: 24, y: 24, width: 52, height: 52 },
      { id: 'top', x: 46, y: 60, width: 32, height: 30 },
    ],
    preview: 'triple',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-3p-fan',
    name: '扇形展开',
    category: 'personality',
    slots: [
      { id: 'base', x: 10, y: 18, width: 50, height: 68 },
      { id: 'mid', x: 28, y: 12, width: 50, height: 68 },
      { id: 'top', x: 42, y: 22, width: 50, height: 68 },
    ],
    preview: 'triple',
    tags: ['overlay', 'white-space'],
  },

  /* ── 4 图叠加 ── */
  {
    id: 'overlay-4p-scatter',
    name: '错落拼贴',
    category: 'creative',
    slots: [
      { id: 'base', x: 5, y: 10, width: 52, height: 65 },
      { id: 'm1', x: 42, y: 5, width: 40, height: 35 },
      { id: 'm2', x: 45, y: 45, width: 38, height: 30 },
      { id: 'top', x: 10, y: 55, width: 38, height: 35 },
    ],
    preview: 'quad',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-4p-stack',
    name: '层叠四图',
    category: 'creative',
    slots: [
      { id: 'base', x: 8, y: 8, width: 64, height: 84 },
      { id: 'm1', x: 28, y: 16, width: 56, height: 50 },
      { id: 'm2', x: 18, y: 48, width: 50, height: 40 },
      { id: 'top', x: 40, y: 52, width: 44, height: 38 },
    ],
    preview: 'quad',
    tags: ['overlay', 'white-space'],
  },

  /* ── 5 图叠加 ── */
  {
    id: 'overlay-5p-collage',
    name: '散落留白',
    category: 'creative',
    slots: [
      { id: 'base', x: 8, y: 8, width: 48, height: 55 },
      { id: 'm1', x: 45, y: 5, width: 38, height: 32 },
      { id: 'm2', x: 50, y: 40, width: 35, height: 30 },
      { id: 'm3', x: 5, y: 55, width: 40, height: 35 },
      { id: 'top', x: 38, y: 62, width: 38, height: 30 },
    ],
    preview: 'collage',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-5p-petal',
    name: '花瓣聚心',
    category: 'personality',
    slots: [
      { id: 'base', x: 30, y: 30, width: 40, height: 40 },
      { id: 'tl', x: 8, y: 8, width: 38, height: 38 },
      { id: 'tr', x: 54, y: 8, width: 38, height: 38 },
      { id: 'bl', x: 8, y: 54, width: 38, height: 38 },
      { id: 'br', x: 54, y: 54, width: 38, height: 38 },
    ],
    preview: 'collage',
    tags: ['overlay', 'white-space'],
  },

  /* ── 6 图叠加 ── */
  {
    id: 'overlay-6p-mosaic',
    name: '密集拼贴',
    category: 'creative',
    slots: [
      { id: 'base', x: 5, y: 8, width: 45, height: 50 },
      { id: 'm1', x: 40, y: 5, width: 38, height: 30 },
      { id: 'm2', x: 50, y: 35, width: 35, height: 28 },
      { id: 'm3', x: 5, y: 50, width: 38, height: 28 },
      { id: 'm4', x: 35, y: 58, width: 35, height: 30 },
      { id: 'top', x: 20, y: 30, width: 32, height: 32 },
    ],
    preview: 'collage',
    tags: ['overlay', 'white-space'],
  },
  {
    id: 'overlay-6p-layered',
    name: '层叠六图',
    category: 'personality',
    slots: [
      { id: 'base', x: 6, y: 6, width: 60, height: 88 },
      { id: 'm1', x: 36, y: 10, width: 52, height: 40 },
      { id: 'm2', x: 14, y: 40, width: 48, height: 34 },
      { id: 'm3', x: 44, y: 46, width: 42, height: 30 },
      { id: 'm4', x: 20, y: 68, width: 44, height: 26 },
      { id: 'top', x: 48, y: 72, width: 40, height: 24 },
    ],
    preview: 'collage',
    tags: ['overlay', 'white-space'],
  },

  /* ============================================================
     补充常规模板：丰富比例与布局选择
     ============================================================ */

  /* ── 2 图：黄金分割双图 ── */
  {
    id: 'grid-2p-golden',
    name: '黄金双图',
    category: 'classic',
    slots: [
      { id: 'l', x: 3, y: 3, width: 58, height: 94 },
      { id: 'r', x: 63, y: 3, width: 34, height: 94 },
    ],
    preview: 'dual',
    tags: ['grid'],
  },
  /* ── 2 图：上下黄金 ── */
  {
    id: 'grid-2p-golden-v',
    name: '上下黄金',
    category: 'classic',
    slots: [
      { id: 't', x: 3, y: 3, width: 94, height: 58 },
      { id: 'b', x: 3, y: 63, width: 94, height: 34 },
    ],
    preview: 'dual',
    tags: ['grid'],
  },
  /* ── 3 图：宽窄宽三列 ── */
  {
    id: 'grid-3p-wnw',
    name: '宽窄宽三列',
    category: 'classic',
    slots: [
      { id: 'l', x: 3, y: 3, width: 30, height: 94 },
      { id: 'm', x: 35, y: 3, width: 30, height: 94 },
      { id: 'r', x: 67, y: 3, width: 30, height: 94 },
    ],
    preview: 'triple',
    tags: ['grid'],
  },
  /* ── 4 图：2x2 等比网格 ── */
  {
    id: 'grid-4p-equal',
    name: '等比四宫',
    category: 'classic',
    slots: [
      { id: 'tl', x: 3, y: 3, width: 45.5, height: 45.5 },
      { id: 'tr', x: 51.5, y: 3, width: 45.5, height: 45.5 },
      { id: 'bl', x: 3, y: 51.5, width: 45.5, height: 45.5 },
      { id: 'br', x: 51.5, y: 51.5, width: 45.5, height: 45.5 },
    ],
    preview: 'quad',
    tags: ['grid'],
  },
  /* ── 4 图：左大右三横（变体） ── */
  {
    id: 'grid-4p-lbig-r3',
    name: '左大右三横',
    category: 'classic',
    slots: [
      { id: 'big', x: 3, y: 3, width: 55, height: 94 },
      { id: 'r1', x: 61, y: 3, width: 36, height: 29 },
      { id: 'r2', x: 61, y: 35.5, width: 36, height: 29 },
      { id: 'r3', x: 61, y: 68, width: 36, height: 29 },
    ],
    preview: 'quad',
    tags: ['grid'],
  },
  /* ── 6 图：3x2 等比网格 ── */
  {
    id: 'grid-6p-3x2',
    name: '等比六宫',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 3, width: 30, height: 45.5 },
      { id: 'r1c2', x: 35, y: 3, width: 30, height: 45.5 },
      { id: 'r1c3', x: 67, y: 3, width: 30, height: 45.5 },
      { id: 'r2c1', x: 3, y: 51.5, width: 30, height: 45.5 },
      { id: 'r2c2', x: 35, y: 51.5, width: 30, height: 45.5 },
      { id: 'r2c3', x: 67, y: 51.5, width: 30, height: 45.5 },
    ],
    preview: 'collage',
    tags: ['grid'],
  },
  /* ── 6 图：2x3 等比网格 ── */
  {
    id: 'grid-6p-2x3',
    name: '横排六宫',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 3, width: 45.5, height: 30 },
      { id: 'r1c2', x: 51.5, y: 3, width: 45.5, height: 30 },
      { id: 'r2c1', x: 3, y: 35, width: 45.5, height: 30 },
      { id: 'r2c2', x: 51.5, y: 35, width: 45.5, height: 30 },
      { id: 'r3c1', x: 3, y: 67, width: 45.5, height: 30 },
      { id: 'r3c2', x: 51.5, y: 67, width: 45.5, height: 30 },
    ],
    preview: 'collage',
    tags: ['grid'],
  },
  /* ── 8 图：4x2 等比网格 ── */
  {
    id: 'grid-8p-4x2',
    name: '等比八宫',
    category: 'classic',
    slots: [
      { id: 'r1c1', x: 3, y: 3, width: 22, height: 45.5 },
      { id: 'r1c2', x: 27, y: 3, width: 22, height: 45.5 },
      { id: 'r1c3', x: 51, y: 3, width: 22, height: 45.5 },
      { id: 'r1c4', x: 75, y: 3, width: 22, height: 45.5 },
      { id: 'r2c1', x: 3, y: 51.5, width: 22, height: 45.5 },
      { id: 'r2c2', x: 27, y: 51.5, width: 22, height: 45.5 },
      { id: 'r2c3', x: 51, y: 51.5, width: 22, height: 45.5 },
      { id: 'r2c4', x: 75, y: 51.5, width: 22, height: 45.5 },
    ],
    preview: 'collage',
    tags: ['grid'],
  },
];