/* ============================================================
   MemBook — 相册规格 / 尺寸 / 边距 / 相册项目类型
   ============================================================ */

import type { AlbumPage } from './photo';

/* ── 相册规格 ── */
export type AlbumSize = {
  id: string;
  name: string;
  width: number;  // mm
  height: number; // mm
  desc: string;
};

/* ── 丰富预设尺寸系统（尺寸数值的单一数据源，ALBUM_SIZES 由此派生） ── */
export type SizePresetCategory = 'classic' | 'photo' | 'paper';

export type SizePreset = {
  id: string;
  name: string;
  width: number;
  height: number;
  category: SizePresetCategory;
  orientation: 'landscape' | 'portrait' | 'square';
  desc: string;
};

export const SIZE_PRESETS: SizePreset[] = [
  /* ── 经典尺寸 ── */
  { id: 'sq-210', name: '经典方形', width: 210, height: 210, category: 'classic', orientation: 'square', desc: '210×210 mm' },
  { id: 'v-210', name: '经典竖版', width: 210, height: 280, category: 'classic', orientation: 'portrait', desc: '210×280 mm' },
  { id: 'h-297', name: '经典横版', width: 297, height: 210, category: 'classic', orientation: 'landscape', desc: '297×210 mm' },
  { id: 'mini', name: '迷你方册', width: 148, height: 148, category: 'classic', orientation: 'square', desc: '148×148 mm' },

  /* ── 冲印尺寸 ── */
  { id: 'photo-5', name: '5 寸 (3R)', width: 127, height: 89, category: 'photo', orientation: 'landscape', desc: '127×89 mm' },
  { id: 'photo-6', name: '6 寸 (4R)', width: 152, height: 102, category: 'photo', orientation: 'landscape', desc: '152×102 mm' },
  { id: 'photo-7', name: '7 寸 (5R)', width: 178, height: 127, category: 'photo', orientation: 'landscape', desc: '178×127 mm' },
  { id: 'photo-8', name: '8 寸 (6R)', width: 203, height: 152, category: 'photo', orientation: 'landscape', desc: '203×152 mm' },
  { id: 'photo-10', name: '10 寸 (8R)', width: 254, height: 203, category: 'photo', orientation: 'landscape', desc: '254×203 mm' },

  /* ── 纸张标准 ── */
  { id: 'paper-a6', name: 'A6', width: 148, height: 105, category: 'paper', orientation: 'landscape', desc: '148×105 mm' },
  { id: 'paper-a5', name: 'A5', width: 210, height: 148, category: 'paper', orientation: 'landscape', desc: '210×148 mm' },
  { id: 'paper-a4', name: 'A4', width: 297, height: 210, category: 'paper', orientation: 'landscape', desc: '297×210 mm' },
  { id: 'paper-b5', name: 'B5', width: 250, height: 176, category: 'paper', orientation: 'landscape', desc: '250×176 mm' },
  { id: 'paper-letter', name: 'Letter', width: 279, height: 216, category: 'paper', orientation: 'landscape', desc: '279×216 mm' },
];

/** 由 SIZE_PRESETS 派生 AlbumSize（尺寸数值单一来源），保留编辑器旧版展示文案 */
function fromPreset(id: string, name: string, desc: string): AlbumSize {
  const p = SIZE_PRESETS.find((sp) => sp.id === id);
  return { id, name, width: p?.width ?? 0, height: p?.height ?? 0, desc };
}

export const ALBUM_SIZES: AlbumSize[] = [
  fromPreset('sq-210', '正方形', '210×210 mm · 经典方册'),
  fromPreset('v-210', '竖版', '210×280 mm · 标准竖版'),
  fromPreset('h-297', '横版', '297×210 mm · 宽屏横版'),
  fromPreset('mini', '迷你', '148×148 mm · 掌心小册'),
  { id: 'custom', name: '自定义', width: 0, height: 0, desc: '自由设置尺寸 · 宽×高 mm' },
];

/* ── 相册类型 ── */
export type AlbumTypeId = 'travel' | 'family' | 'wedding' | 'growth' | 'pet' | 'other';

export type AlbumTypeOption = {
  id: AlbumTypeId;
  name: string;
  icon: string;   // emoji 作为图标
};

export const ALBUM_TYPES: AlbumTypeOption[] = [
  { id: 'travel', name: '旅行纪念', icon: '✈️' },
  { id: 'family', name: '家庭相册', icon: '👨‍👩‍👧' },
  { id: 'wedding', name: '婚礼纪念', icon: '💒' },
  { id: 'growth', name: '成长记录', icon: '🌱' },
  { id: 'pet', name: '宠物相册', icon: '🐾' },
  { id: 'other', name: '其他', icon: '📷' },
];

/* 自定义尺寸的默认间距约束 */
export const CUSTOM_SIZE_MIN = 50;    // 最小 50mm
export const CUSTOM_SIZE_MAX = 600;   // 最大 600mm
export const CUSTOM_SIZE_STEP = 5;    // 步进 5mm
export const CUSTOM_SIZE_DEFAULT = 210; // 默认值

/* ── 页面边距/间距 ── */
export type PageMarginSettings = {
  top: number;    // mm
  bottom: number; // mm
  left: number;   // mm
  right: number;  // mm
};
export const PAGE_MARGIN_DEFAULT = 15;   // 默认边距 15mm
export const PAGE_GAP_DEFAULT = 5;       // 默认间距 5mm
export const PAGE_MARGIN_MIN = 0;
export const PAGE_MARGIN_MAX = 40;
export const PAGE_GAP_MIN = 0;
export const PAGE_GAP_MAX = 20;
export const PAGE_MARGIN_STEP = 1;
export const PAGE_GAP_STEP = 1;

/** 页面边距/间距/圆角快捷预设（创建相册与页面设置共用） */
export interface PageMarginPreset {
  label: string;
  margin: number;
  gap: number;
  cornerRadius: number;
}
export const PAGE_MARGIN_PRESETS: PageMarginPreset[] = [
  { label: '无', margin: 0, gap: 0, cornerRadius: 0 },
  { label: '紧凑', margin: 8, gap: 3, cornerRadius: 4 },
  { label: '标准', margin: 15, gap: 5, cornerRadius: 8 },
  { label: '宽松', margin: 25, gap: 8, cornerRadius: 12 },
  { label: '极宽', margin: 35, gap: 12, cornerRadius: 16 },
];

/* ── 页面边距配置 ── */
export type PageMargin = {
  margin: number;  // mm，外边缘距
  gap: number;     // mm，槽位间距
};

/* ── 相册项目 ── */
/** 参考线（相册级编辑辅助）：随页面缩放/平移显示，不参与导出/缩略图/打印 */
export type AlbumGuideLine = {
  id: string;
  orientation: 'horizontal' | 'vertical';
  /** 位置（mm，页面坐标系），渲染转 px = position × MM_TO_PX */
  position: number;
};

export type AlbumProject = {
  id: string;
  name: string;
  size: AlbumSize;
  margin: PageMargin;
  pages: AlbumPage[];
  createdAt: string;
  updatedAt: string;
  /** 相册类型 */
  albumType?: AlbumTypeId;
  /** 相册描述 */
  description?: string;
  /** 相册级参考线（编辑辅助，跨页共享；旧数据无此字段默认空） */
  guideLines?: AlbumGuideLine[];
};