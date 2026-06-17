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

/* ── 内置模板预设 ── */
export const TEMPLATES: Template[] = [
  {
    id: 'single', name: '单图', category: 'classic',
    slots: [{ id: 'main', x: 5, y: 5, width: 90, height: 90 }],
    preview: 'single',
  },
  {
    id: 'dual', name: '双图', category: 'classic',
    slots: [
      { id: 'left', x: 5, y: 5, width: 44, height: 90 },
      { id: 'right', x: 51, y: 5, width: 44, height: 90 },
    ],
    preview: 'dual',
  },
  {
    id: 'triple', name: '三图', category: 'classic',
    slots: [
      { id: 'top', x: 5, y: 5, width: 90, height: 43 },
      { id: 'bottom-l', x: 5, y: 52, width: 44, height: 43 },
      { id: 'bottom-r', x: 51, y: 52, width: 44, height: 43 },
    ],
    preview: 'triple',
  },
  {
    id: 'quad', name: '四图', category: 'classic',
    slots: [
      { id: 'tl', x: 5, y: 5, width: 44, height: 43 },
      { id: 'tr', x: 51, y: 5, width: 44, height: 43 },
      { id: 'bl', x: 5, y: 52, width: 44, height: 43 },
      { id: 'br', x: 51, y: 52, width: 44, height: 43 },
    ],
    preview: 'quad',
  },
  {
    id: 'full', name: '全幅', category: 'classic',
    slots: [{ id: 'full', x: 0, y: 0, width: 100, height: 100 }],
    preview: 'full',
  },
  {
    id: 'top-bottom', name: '上下', category: 'classic',
    slots: [
      { id: 'top', x: 5, y: 5, width: 90, height: 43 },
      { id: 'bottom', x: 5, y: 52, width: 90, height: 43 },
    ],
    preview: 'top-bottom',
  },
  {
    id: 'collage', name: '拼贴', category: 'creative',
    slots: [
      { id: 'big', x: 5, y: 5, width: 55, height: 90 },
      { id: 'sm1', x: 62, y: 5, width: 33, height: 43 },
      { id: 'sm2', x: 62, y: 52, width: 33, height: 43 },
    ],
    preview: 'collage',
  },
  {
    id: 'circle', name: '圆形', category: 'creative',
    slots: [{ id: 'circle', x: 5, y: 5, width: 90, height: 90 }],
    preview: 'circle',
  },
  {
    id: 'overlap', name: '重叠', category: 'creative',
    slots: [
      { id: 'back', x: 5, y: 5, width: 65, height: 90 },
      { id: 'front', x: 40, y: 15, width: 55, height: 70 },
    ],
    preview: 'overlap',
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
