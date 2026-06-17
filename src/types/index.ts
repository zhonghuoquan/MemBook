/* ============================================================
   MemBook — 核心类型定义
   ============================================================ */

/* ── 相册规格 ── */
export type AlbumSize = {
  id: string;
  name: string;
  width: number;  // mm
  height: number; // mm
  desc: string;
};

export const ALBUM_SIZES: AlbumSize[] = [
  { id: 'sq-210', name: '正方形', width: 210, height: 210, desc: '210×210 mm · 经典方册' },
  { id: 'v-210', name: '竖版', width: 210, height: 280, desc: '210×280 mm · 标准竖版' },
  { id: 'h-297', name: '横版', width: 297, height: 210, desc: '297×210 mm · 宽屏横版' },
  { id: 'mini', name: '迷你', width: 148, height: 148, desc: '148×148 mm · 掌心小册' },
  { id: 'custom', name: '自定义', width: 0, height: 0, desc: '自由设置尺寸 · 宽×高 mm' },
];

/* 自定义尺寸的默认间距约束 */
export const CUSTOM_SIZE_MIN = 50;    // 最小 50mm
export const CUSTOM_SIZE_MAX = 600;   // 最大 600mm
export const CUSTOM_SIZE_STEP = 5;    // 步进 5mm
export const CUSTOM_SIZE_DEFAULT = 210; // 默认值

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
  category: 'classic' | 'creative';
  slots: SlotLayout[];
  preview: string;
};

/* ── 照片 ── */
export type Photo = {
  id: string;
  src: string;        // 本地文件句柄或 blob URL
  name: string;
  date: string;       // ISO date string
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait' | 'square';
  file?: File;
};

/* ── 页面 ── */
export type PhotoPlacement = {
  slotId: string;
  photoId: string | null;
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
};

export type AlbumPage = {
  id: string;
  templateId: string;
  placements: PhotoPlacement[];
  background: string; // color hex
};

/* ── 相册项目 ── */
export type AlbumProject = {
  id: string;
  name: string;
  size: AlbumSize;
  pages: AlbumPage[];
  createdAt: string;
  updatedAt: string;
};

/* ── 编辑器状态 ── */
export type ViewMode = 'single' | 'grid' | 'fullscreen';
export type PanelTab = 'photos' | 'templates' | 'theme' | 'tools' | 'market';
export type EditTab = 'crop' | 'adjust' | 'filter' | 'rotate';
export type HomeTab = 'create' | 'projects' | 'templates';

export type BottomNavState = 'expanded' | 'collapsed';

/* ── 历史状态 ── */
export type HistoryEntry = {
  timestamp: number;
  pages: AlbumPage[];
  selectedSlotId: string | null;
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
    category: 'creative',
    slots: [
      { id: 'l1', x: 3, y: 5, width: 40.5, height: 28.3 },
      { id: 'l2', x: 3, y: 36.3, width: 40.5, height: 28.3 },
      { id: 'l3', x: 3, y: 67.7, width: 40.5, height: 28.3 },
      { id: 'r1', x: 46.5, y: 5, width: 50.5, height: 43 },
      { id: 'r2', x: 46.5, y: 52, width: 50.5, height: 43 },
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
];

/* ── 背景主题色 ── */
export const THEME_BACKGROUNDS = [
  { name: '纯白', color: '#FFFFFF' },
  { name: '暖灰', color: '#F8F9FA' },
  { name: '米白', color: '#FFF8E7' },
  { name: '浅粉', color: '#FFF0F0' },
  { name: '薰衣草', color: '#F0EFFF' },
  { name: '浅蓝', color: '#EFF6FF' },
  { name: '薄荷', color: '#ECFDF5' },
  { name: '淡黄', color: '#FFFBEB' },
  { name: '高级灰', color: '#F1F3F5' },
  { name: '墨黑', color: '#1A1A1A' },
  { name: '藏青', color: '#1E3A5F' },
  { name: '复古绿', color: '#2D5016' },
];

/* ── Toast ── */
export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type Toast = {
  id: string;
  type: ToastType;
  message: string;
};
