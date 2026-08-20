/* ============================================================
   MemBook — 页面装饰元素（画笔 / 便利贴 / 文字 / 贴纸 / 形状）类型
   ============================================================ */

/* ── 画笔工具 ── */
export type BrushType = 'pencil' | 'brush' | 'marker' | 'highlighter';

/**
 * 笔触类型样式参数（统一管理四种笔触的视觉差异）
 * - pencil: 细线、高精度，tension 0.3 让线条更锐利
 * - brush: 中等粗度，柔和的贝塞尔曲线
 * - marker: 粗度适中，tension 0.5 平滑
 * - highlighter: 最粗、半透明、multiply 混合模式模拟荧光笔效果
 */
export const BRUSH_STYLE_MAP: Record<BrushType, {
  widthMultiplier: number;   // 线宽倍数（相对 strokeWidth）
  tension: number;           // 贝塞尔曲线张力
  opacityMultiplier: number; // 透明度倍数（highlighter 更透明）
  blendMode: 'source-over' | 'multiply'; // 混合模式
}> = {
  pencil: { widthMultiplier: 1, tension: 0.3, opacityMultiplier: 1, blendMode: 'source-over' },
  brush: { widthMultiplier: 2.5, tension: 0.5, opacityMultiplier: 1, blendMode: 'source-over' },
  marker: { widthMultiplier: 1.8, tension: 0.5, opacityMultiplier: 0.85, blendMode: 'source-over' },
  highlighter: { widthMultiplier: 4, tension: 0.5, opacityMultiplier: 0.4, blendMode: 'multiply' },
};

export type BrushStroke = {
  id: string;
  points: number[];           // Konva Line points [x1,y1,x2,y2,...] in logical mm
  brushType: BrushType;
  color: string;              // hex color
  strokeWidth: number;        // px
  opacity: number;            // 0.1 ~ 1.0
  tension: number;            // Konva line tension
  lineCap: 'round' | 'square';
  zIndex: number;
};

/* ── 便利贴 ── */
export type StickyNoteStyle = 'square' | 'rounded' | 'tape' | 'shadow';
export type StickyNote = {
  id: string;
  x: number;                  // mm
  y: number;
  zIndex: number;
  width: number;              // mm
  height: number;
  color: string;              // 便利贴背景色
  text: string;
  fontSize: number;
  fontFamily: string;
  rotation: number;           // degrees
  style?: StickyNoteStyle;    // 便利贴样式
};

/* ── 页面文字元素 ── */
export type PageTextElement = {
  id: string;
  x: number;                  // mm
  y: number;
  width: number;              // mm
  height: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;              // 文字颜色
  align: 'left' | 'center' | 'right';
  /** 垂直对齐：顶/居中/底（默认居中）。文本框高度大于文字时生效 */
  verticalAlign?: 'top' | 'center' | 'bottom';
  bold: boolean;
  italic: boolean;
  underline?: boolean;        // 下划线
  rotation: number;
  /** 竖排模式（春联/书脊等逐字排列）。与 rotation 解耦：仅此标志为 true 时逐字竖排，旋转角度不影响竖排判断 */
  isVertical?: boolean;
  /** 字间距（逻辑像素，默认 0）。横排=水平字符间距，竖排=垂直字符间距 */
  letterSpacing?: number;
  /** 行距因子（相对字号倍数，默认 1.2）。横排=行高，竖排=列间距的额外部分（(lineHeight-1)*fontSize） */
  lineHeight?: number;
  /** 渐变填充：设置后将替代 color 渲染渐变。undefined 表示纯色模式 */
  gradient?: GradientStop[];
  /** 渐变类型：linear=线性渐变，radial=径向渐变 */
  gradientType?: 'linear' | 'radial';
  /** 线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  gradientAngle?: number;
  zIndex: number;
};

/** 文字默认行距因子（与渲染层 lineHeight=1.2 一致） */
export const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
/** 文字默认字间距（逻辑像素） */
export const DEFAULT_TEXT_LETTER_SPACING = 0;

/* ── 贴纸元素（页面内） ── */
export type StickerElement = {
  id: string;
  x: number; y: number;        // mm，页面内位置（中心点）
  width: number; height: number; // mm
  stickerId: string;            // 引用 stickers 表中的贴纸
  rotation: number;
  flipH: boolean; flipV: boolean;
  zIndex: number;
};

/* ── 形状元素（页面内，类似 PPT 添加形状） ── */
export type ShapeType =
  | 'rectangle' | 'roundedRect' | 'singleRoundRect' | 'diagonalRoundRect'
  | 'parallelogram' | 'trapezoid' | 'cutCornerRect' | 'cutDiagonalRect'
  | 'circle' | 'ellipse'
  | 'triangle' | 'diamond' | 'pentagon' | 'hexagon'
  | 'star' | 'arrow' | 'line';

/** 渐变颜色停止点 */
export type GradientStop = {
  offset: number; // 0-1
  color: string;
  /** 该色标不透明度 0-1（默认 1 不透明），用于让渐变某端变半透明 */
  alpha?: number;
};

/**
 * 形状元素：可调整尺寸、填充色、描边、透明度、旋转。
 * x/y 为页面内中心点（mm），width/height 为外形包围盒尺寸（mm）。
 */
export type ShapeElement = {
  id: string;
  x: number; y: number;        // mm，页面内位置（中心点）
  width: number; height: number; // mm，外形包围盒
  type: ShapeType;
  /** 填充色（hex），支持空字符串表示无填充。渐变模式下 fill 作为渐变起始色 */
  fill: string;
  /** 描边色（hex） */
  stroke: string;
  /** 描边粗细（px，渲染时随画布缩放） */
  strokeWidth: number;
  /** 整体透明度 0-1 */
  opacity: number;
  rotation: number;
  zIndex: number;
  /** 渐变填充：设置后将替代 fill 渲染渐变。undefined 表示纯色模式 */
  gradient?: GradientStop[];
  /** 渐变类型：linear=线性渐变，radial=径向渐变 */
  gradientType?: 'linear' | 'radial';
  /** 线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  gradientAngle?: number;
  /** 描边渐变：设置后将替代 stroke 渲染渐变描边。undefined 表示纯色描边 */
  strokeGradient?: GradientStop[];
  /** 描边线性渐变角度（0-360 度，默认 45 = 左上到右下） */
  strokeGradientAngle?: number;
  /** 圆角占比（0-1，为 min(w,h)/2 的倍数，仅矩形类生效）：rectangle 默认 0，roundRect 系列默认 0.15，可被 PPT 式调节手柄调整；100%（=1）时正方形变为正圆 */
  cornerRadius?: number;
  /** 切角大小（0-1 比例，为 min(w,h)/2 的倍数，仅切角矩形类生效）：cutCornerRect/cutDiagonalRect 默认 0.25，可被 PPT 式调节手柄调整 */
  cornerCut?: number;
};

/** 形状默认尺寸（mm） */
export const DEFAULT_SHAPE_SIZE = { width: 60, height: 60 };

/** 形状默认样式：新建形状的统一外观（填充/描边/粗细/透明度） */
export const DEFAULT_SHAPE_STYLE = {
  fill: '#6C63FF',
  stroke: '#6C63FF',
  strokeWidth: 2,
  opacity: 1,
};

/** 形状支持的类型列表（供工具面板展示） */
export const SHAPE_TYPES: ShapeType[] = [
  'rectangle', 'roundedRect', 'singleRoundRect', 'diagonalRoundRect',
  'parallelogram', 'trapezoid', 'cutCornerRect', 'cutDiagonalRect',
  'circle', 'ellipse',
  'triangle', 'diamond', 'pentagon', 'hexagon',
  'star', 'arrow', 'line',
];

/* ── 编辑器工具模式 ── */
export type EditorTool = 'none' | 'brush' | 'eraser' | 'text' | 'sticky' | 'shape';

/* ── 画笔设置 ── */
export type BrushSettings = {
  brushType: BrushType;
  strokeWidth: number;
  color: string;
  opacity: number;
  recentColors?: string[];    // 最近使用的颜色（最多 8 个）
};

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  brushType: 'pencil',
  strokeWidth: 2,
  color: '#6C63FF',
  opacity: 1,
  recentColors: [],
};

/* ── 便利贴默认色 ── */
export const STICKY_COLORS = [
  { name: '经典黄', color: '#FFF3B0' },
  { name: '暖橙', color: '#FFD8A8' },
  { name: '天蓝', color: '#BAE6FD' },
  { name: '薄荷绿', color: '#C3F0D5' },
  { name: '薰衣紫', color: '#DDD6FE' },
  { name: '纯白', color: '#FFFFFF' },
];