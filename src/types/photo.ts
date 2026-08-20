/* ============================================================
   MemBook — 照片 / 页面 / 槽位 类型
   ============================================================ */

import type { BrushStroke, StickyNote, PageTextElement, StickerElement, ShapeElement } from './elements';
import type { PageKind, SlotLayout } from './template';
import type { PageMarginSettings } from './album';

/* ── 照片 ── */
export type DateSource = 'exif' | 'modified' | 'unknown';
export type LocationStatus = 'pending' | 'success' | 'failed';

export type Photo = {
  id: string;
  src: string;        // blob URL (import 模式) 或 文件相对路径 (direct 模式)
  name: string;
  date: string;       // ISO date string
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait' | 'square';
  fileSize?: number;  // 文件大小（字节）
  processing?: boolean; // 是否正在后台处理中
  file?: File;
  storageMode?: 'direct' | 'import';  // 此照片使用的存储方式
  relativePath?: string;  // direct 模式：文件相对路径；Tauri import 模式：原文件绝对路径，用于导出/刷新后重建 blob URL
  blobId?: string;        // import 模式：IndexedDB 中的 blob ID（兼容旧数据，等价于 originalBlobId）
  originalBlobId?: string; // import 模式：高清原图 blob ID，用于导出
  previewBlobId?: string;  // import 模式：编辑预览图 blob ID，用于画布渲染
  thumbBlobId?: string;    // import 模式：缩略图 blob ID（256px），用于网格/面板小图。P1-1 LOD 三级体系。
  /** 日期来源：EXIF 拍摄日期 / 文件修改日期 / 未知 */
  dateSource?: DateSource;
  /** 逆地理编码后的地点名称（如 "杭州市-西湖区"） */
  location?: string;
  /** GPS 纬度 */
  latitude?: number;
  /** GPS 经度 */
  longitude?: number;
  /** 地点获取状态 */
  locationStatus?: LocationStatus;
  /** 所属项目 ID，用于项目间照片隔离 */
  albumId?: string;
  /** 封面预设照片标记：系统自动为封面照片位生成的占位图，仅封面显示、不出现在照片列表中 */
  isCoverPreset?: boolean;
  /** P1-1 清晰度评分（0-1，Laplacian variance 归一化），用于评分系统识别失焦废图。 */
  clarityScore?: number;
};

/* ── 页面 ── */
export type PhotoAdjustments = {
  // 光效
  exposure: number;      // -100 ~ 100, 0 = normal
  brightness: number;    // -100 ~ 100, 0 = normal
  contrast: number;      // -100 ~ 100, 0 = normal
  // 色彩
  saturation: number;    // -100 ~ 100, 0 = normal
  temperature: number;   // -100 ~ 100, 负=冷(蓝), 正=暖(黄), 0 = normal
  // 效果
  vignette: number;      // 0 ~ 100, 0 = 无晕影
};

export type PhotoPlacement = {
  slotId: string;
  photoId: string | null;
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  adjustments?: PhotoAdjustments;
  filter?: string | null;    // filter name, null = none
  filterIntensity?: number;  // 滤镜强度 0~100, 默认 100
  // 编辑模式下的照片平移/缩放/旋转偏移（用于照片在槽位内的微调）
  panX?: number;
  panY?: number;
  panScale?: number;         // 覆盖 cover-fit 的缩放比例，≥1=放大
  panRotation?: number;      // 编辑模式旋转角度（度），0|90|180|270 或任意角度
  /** 用户可配置的槽位阴影开关（per-placement），undefined/false=无阴影 */
  shadow?: boolean;
};

/* ── 照片位用户自定义尺寸覆盖 ── */
export type SlotOverride = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AlbumPage = {
  id: string;
  templateId: string;
  placements: PhotoPlacement[];
  background: string; // color hex
  slotOverrides?: Record<string, SlotOverride>; // slotId → 用户自定义位置/尺寸
  slotCornerRadius?: number | [number, number, number, number]; // 本页独立槽位圆角 px，number=统一，[tl,tr,br,bl]=每角单独，默认 2
  slotOrder?: string[];        // 槽位渲染顺序（slotId 数组），后渲染的在上层
  /** 槽位层级映射（slotId → zIndex 数值），与装饰元素共享同一命名空间，使槽位可超越/低于装饰元素 */
  slotZIndices?: Record<string, number>;
  /** 用户通过"添加照片位"按钮添加的额外槽位（百分比坐标，与模板槽位一致），运行时经 resolveTemplate 合并到 slots 列表 */
  extraSlots?: SlotLayout[];
  brushStrokes?: BrushStroke[];
  stickyNotes?: StickyNote[];
  textElements?: PageTextElement[];
  stickerElements?: StickerElement[];
  shapeElements?: ShapeElement[];
  /** Google Photos 页面：引擎输出的原始 mm 坐标（用于页面设置变更时重新计算） */
  googlePhotosMmLayout?: Array<{ photoId: string; x: number; y: number; width: number; height: number }>;
  /** Google Photos 页面：未旋转的基准 mm 坐标（角度切换后用于排版变化重排） */
  googlePhotosBaseMmLayout?: Array<{ photoId: string; x: number; y: number; width: number; height: number }>;
  /** Google Photos 页面：基准布局生成时的页面尺寸（旋转后可能不同于当前相册尺寸） */
  googlePhotosBasePageSize?: { width: number; height: number };
  /** Google Photos 页面：创建时使用的边距+间距配置 */
  googlePhotosMmConfig?: { margin: PageMarginSettings; gap: number };
  /** Google Photos 页面：行结构数据（用于间距变更时重新运行 fillPage） */
  googlePhotosInternalRows?: Array<{ photoIds: string[]; rowHeight: number }>;
  /** Google Photos 页面：原始布局行（包含 SpanGroup 结构，用于边距变更时保持竖图跨行） */
  googlePhotosLayoutRows?: Array<{
    type?: 'span';
    portraitPhotoId?: string;
    portraitTotalHeight?: number;
    photoIds?: string[];
    subRows?: Array<{ photoIds: string[]; rowHeight: number; tier?: 'hero' | 'standard' | 'detail' }>;
    rowHeight?: number;
    side?: 'left' | 'right';
    tier?: 'hero' | 'standard' | 'detail';
  }>;
  /** Google Photos 页面：未旋转的基准布局行（角度切换后用于排版变化重排） */
  googlePhotosBaseLayoutRows?: Array<{
    type?: 'span';
    portraitPhotoId?: string;
    portraitTotalHeight?: number;
    photoIds?: string[];
    subRows?: Array<{ photoIds: string[]; rowHeight: number; tier?: 'hero' | 'standard' | 'detail' }>;
    rowHeight?: number;
    side?: 'left' | 'right';
    tier?: 'hero' | 'standard' | 'detail';
  }>;
  /** Google Photos 页面：当前应用的旋转角度（0/90/180/270） */
  perPageRotation?: 0 | 90 | 180 | 270;
  /** 单页排版变化覆盖（GP 页独立设置） */
  perPageRhythm?: string;
  /** 单页实际使用的 tier pattern，旧页重排时保留视觉比例 */
  perPageTierPattern?: string;
  /** 单页随机种子（0-99） */
  layoutSeed?: number;
  /** 单页水平偏压（-10~+10，同行内左右宽度分布） */
  perPageBiasX?: number;
  /** 单页垂直偏压（-10~+10，各行行高分布） */
  perPageBiasY?: number;
  /** 用户手动覆盖的时间水印文字（null 表示恢复默认） */
  watermarkTextOverride?: string | null;
  /** 单页是否隐藏时间水印 */
  watermarkHidden?: boolean;
  /** 用户删除的模板内置槽位 ID（保留原模板结构，仅在 resolveTemplate 时过滤） */
  hiddenTemplateSlotIds?: string[];
  /** 页面类型：content=普通内容页 / cover=封面 / backCover=封底。缺省 = 'content'，兼容旧数据 */
  pageKind?: PageKind;
  /** 封面/封底：书脊宽度（mm，默认 0 表示无书脊）。计算方式：书脊宽度 ≈ 页数 × 纸张厚度。 */
  spineWidth?: number;
  /** 封面：内容坐标烘焙的书脊偏移锚点（mm）= 折线在数据坐标中的位置。
   *  书脊宽度变化时内容数据不再移动，渲染统一按 (当前书脊宽 - 锚点) 偏移，实现「书脊向左扩展、封面内容固定」。
   *  缺省回退 = spineWidth（旧数据烘焙偏移即当前书脊宽）。 */
  spineAnchorMm?: number;
  /** 封面/封底：书脊背景色（从模板继承，可用户修改） */
  spineColor?: string;
  /** 封面：书脊顶部 MemBook logo 水印颜色（未设置时按书脊底色深浅自动黑/白） */
  spineLogoColor?: string;
  /** 背景图片（用户上传）：dataURL 或 blob URL，叠加在 background 底色之上。无则仅用 background 纯色/渐变/纹理 */
  backgroundImage?: string;
  /** 背景图片填充方式：cover=铺满裁剪（默认）/ contain=完整缩放居中 */
  backgroundImageFit?: 'cover' | 'contain';
};

/** 背景应用描述：同时设置底色（纯色 hex / 渐变 css / 纹理 texture-xxx）与背景图片 */
export type BackgroundApply = {
  background?: string;
  backgroundImage?: string;
  backgroundImageFit?: 'cover' | 'contain';
};

/** 背景「应用到」范围：区分封面/封底/普通页面，避免混为一谈全部改动 */
export type BackgroundApplyScope =
  | 'current'   // 仅当前页
  | 'normal'    // 所有普通页面（不含封面/封底）
  | 'cover'     // 封面页
  | 'back'      // 封底页
  | 'all';      // 全部页面（含封面/封底）

/** 读取槽位 zIndex：未配置时返回 0（与装饰元素共享同一命名空间） */
export function getSlotZIndex(page: { slotZIndices?: Record<string, number> }, slotId: string): number {
  return page.slotZIndices?.[slotId] ?? 0;
}