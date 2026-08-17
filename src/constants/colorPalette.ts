/**
 * 统一颜色色盘
 * 供文字 / 背景 / 形状共用，避免各处颜色来源不一致。
 *
 * 设计目标：
 * - 分「莫兰迪高级灰」与「鲜艳好看」两大色系，各按色相分组 + 明度梯度有序排列。
 * - 渐变提供统一结构化数据（css 供背景/预览，stops 供 Konva/Canvas 形状与文字），
 *   保证形状/文字/背景三端渐变一致。
 * - 含基础主题色系（品牌紫等）与鲜艳渐变色系。
 */
import type { GradientStop } from '../types';

/** 渐变预设：同时提供 CSS 字符串（背景/预览）与结构化 stops（形状/文字） */
export type GradientPreset = {
  name: string;
  /** CSS linear-gradient，用于背景渲染与 swatch 预览 */
  css: string;
  /** 结构化渐变停止点，用于 Konva / Canvas 形状与文字 */
  stops: GradientStop[];
  /** 渐变类型（当前统一为线性） */
  type: 'linear' | 'radial';
};

/** 纯色阵列：10 列色系 × 10 = 100 个色块 */
export type ColorColumn = { name: string; colors: string[] };

export const SOLID_COLOR_COLUMNS: ColorColumn[] = [
  { name: '中性', colors: ['#FFFFFF', '#F7F7F5', '#E8E7E4', '#D5D4D0', '#C9C7C3', '#9A9895', '#6B6A68', '#4A4A48', '#3D3D3B', '#1F1F1E'] },
  { name: '红', colors: ['#FFE0E0', '#FF9A9E', '#FF7875', '#FF4D4F', '#F5222D', '#E8C4BA', '#C9745F', '#B4553F', '#A52A2A', '#8C1D18'] },
  { name: '橙', colors: ['#FFE8CC', '#FFD9A8', '#FFC53D', '#FFA940', '#FA8C16', '#FF7A45', '#E6B98F', '#D99A6B', '#C97B4A', '#D2691E'] },
  { name: '黄', colors: ['#FFFFCC', '#FFF3B0', '#FFE58F', '#FADB14', '#F5D000', '#E6CF8F', '#D9B96B', '#C9A24B', '#FAAD14', '#B8860B'] },
  { name: '绿', colors: ['#E8F5E9', '#D3DACB', '#B5C0AB', '#A8E6A0', '#95DE64', '#73D13D', '#52C41A', '#389E0D', '#7A8B6F', '#228B22'] },
  { name: '青', colors: ['#E0FFFF', '#C9DADA', '#ABC4C4', '#8DAAAA', '#5CDBD3', '#36CFC9', '#13C2C2', '#6F8F8F', '#00CED1', '#008B8B'] },
  { name: '蓝', colors: ['#E6F0FF', '#D3DCE7', '#B5C2D3', '#97A8BD', '#69B1FF', '#40A9FF', '#1677FF', '#7A8DA6', '#2F54EB', '#1D39C4'] },
  { name: '紫', colors: ['#F0EBFA', '#DDD6E4', '#C2B6CC', '#A698B5', '#B37FEB', '#9254DE', '#6C63FF', '#8A7A9E', '#722ED1', '#4A00E0'] },
  { name: '粉', colors: ['#FFE0EC', '#FFD0E0', '#FFC0D8', '#FF85C0', '#F759AB', '#EB2F96', '#DEBEBB', '#CFA6A6', '#B98A8A', '#C41D7F'] },
  { name: '棕', colors: ['#EFE6DC', '#D9CCBE', '#C0AE9C', '#A6927F', '#D2A679', '#C68E5A', '#A9713D', '#8B5A2B', '#6B4226', '#4A2E1A'] },
];

/** 标准色（单独一行） */
export const STANDARD_COLORS: string[] = [
  '#FF0000', '#FF7F00', '#FFD700', '#FFFF00', '#00FF00', '#00FFFF',
  '#0000FF', '#8B00FF', '#FF00FF', '#FF69B4', '#A52A2A', '#008080',
];

/** 色盘（10×10 摊平，供下方网格铺满） */
export const PALETTE_COLORS: string[] = SOLID_COLOR_COLUMNS.flatMap((c) => c.colors);

/** 平铺全部纯色（供画笔等需要单一数组的场景） */
export const THEME_COLORS: string[] = [
  ...new Set([...STANDARD_COLORS, ...PALETTE_COLORS]),
];

/** 从 CSS 渐变字符串（形如 `linear-gradient(135deg, #A 0%, #B 100%)`）解析出结构化 stops */
function cssToStops(css: string): GradientStop[] {
  const match = css.match(/#[0-9A-Fa-f]{3,8}\s*\d*(?:\.\d+)?%/g);
  if (!match || match.length < 2) return [];
  const stops: GradientStop[] = [];
  for (const seg of match) {
    const colorMatch = seg.match(/#[0-9A-Fa-f]{3,8}/);
    const offsetMatch = seg.match(/(\d+(?:\.\d+)?)%/);
    if (!colorMatch) continue;
    const offset = offsetMatch ? Math.min(1, Math.max(0, parseFloat(offsetMatch[1]) / 100)) : stops.length;
    stops.push({ offset, color: colorMatch[0] });
  }
  return stops;
}

/** 结构化渐变 stops → CSS linear-gradient 字符串（用于预览/背景/选中态回显）。
 * 必须应用各色标自身 alpha（经 toRgba），与渲染端 gradientFlatStops / 文字层 gradientToCssByAngle 一致，
 * 否则如全幅旅行/日常家庭的半透明黑色蒙版渐变，在 swatch 预览里显示为不透明黑、与画布实际过渡不一致。 */
export function gradientToCss(stops: GradientStop[]): string {
  const parts = stops.map((s) => `${s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color} ${Math.round(s.offset * 100)}%`);
  return `linear-gradient(135deg, ${parts.join(', ')})`;
}

/** 将 hex/rgba 颜色转换为带透明度 rgba 字符串 */
export function toRgba(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const trimmed = color.trim();
  // rgba()/rgb() 格式：解析 r/g/b，最终 alpha = 自带 alpha × 传入 alpha（与 8 位 hex 一致）。
  // 历史 bug：旧实现命中到末尾 `return color` 忽略 alpha 参数，导致渐变首端 alpha=0 仍残留浅色。
  const m = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    const existingA = m[4] != null ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1;
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${existingA * a})`;
  }
  const hex = color.replace('#', '');
  if (hex.length === 6 && /^[0-9A-Fa-f]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (hex.length === 8 && /^[0-9A-Fa-f]{8}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const existingA = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${existingA * a})`;
  }
  // 未知格式：原样返回
  return color;
}

/** 将渐变 stops 应用各色标自身透明度，返回 Konva 扁平数组 [offset, color, ...] */
export function gradientFlatStops(stops: GradientStop[]): (number | string)[] {
  return stops.flatMap((s) => [s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color]);
}

/** 线性渐变角度（0-360，默认 45 = 左上→右下）对应的起止点（相对中心） */
export function linearGradientEndpoints(
  w: number,
  h: number,
  angleDeg: number,
): { startX: number; startY: number; endX: number; endY: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfW = w / 2;
  const halfH = h / 2;
  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [-halfW, halfH],
    [halfW, halfH],
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of corners) {
    const p = x * dx + y * dy;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return {
    startX: dx * min,
    startY: dy * min,
    endX: dx * max,
    endY: dy * max,
  };
}

/* ══════════════════════ 渐变阵列：5 列 × 7 行 = 35 ══════════════════════ */
export type GradientColumn = { name: string; presets: GradientPreset[] };
export const GRADIENT_COLOR_COLUMNS: GradientColumn[] = [
  {
    name: '暖调',
    presets: [
      { name: '日落', css: 'linear-gradient(135deg, #FF512F 0%, #F09819 100%)', type: 'linear', stops: [] },
      { name: '晚霞', css: 'linear-gradient(135deg, #FF6A88 0%, #FF99AC 50%, #FFD89B 100%)', type: 'linear', stops: [] },
      { name: '热情', css: 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)', type: 'linear', stops: [] },
      { name: '蜜桃', css: 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)', type: 'linear', stops: [] },
      { name: '柠檬', css: 'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)', type: 'linear', stops: [] },
      { name: '陶土', css: 'linear-gradient(135deg, #E8C4BA 0%, #B4553F 100%)', type: 'linear', stops: [] },
      { name: '杏橙', css: 'linear-gradient(135deg, #F0E3BC 0%, #C97B4A 100%)', type: 'linear', stops: [] },
    ],
  },
  {
    name: '自然',
    presets: [
      { name: '薄荷', css: 'linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)', type: 'linear', stops: [] },
      { name: '森林', css: 'linear-gradient(135deg, #11998E 0%, #38EF7D 100%)', type: 'linear', stops: [] },
      { name: '苔藓', css: 'linear-gradient(135deg, #D3DACB 0%, #7A8B6F 100%)', type: 'linear', stops: [] },
      { name: '雾青', css: 'linear-gradient(135deg, #C9DADA 0%, #6F8F8F 100%)', type: 'linear', stops: [] },
      { name: '晨雾', css: 'linear-gradient(135deg, #E8E7E4 0%, #A6B8C9 100%)', type: 'linear', stops: [] },
      { name: '暮霭', css: 'linear-gradient(135deg, #D9CCBE 0%, #8A9BA8 100%)', type: 'linear', stops: [] },
      { name: '翡翠', css: 'linear-gradient(135deg, #A8E6CF 0%, #3EC6A0 100%)', type: 'linear', stops: [] },
    ],
  },
  {
    name: '蓝海',
    presets: [
      { name: '海洋', css: 'linear-gradient(135deg, #2193B0 0%, #6DD5ED 100%)', type: 'linear', stops: [] },
      { name: '天蓝', css: 'linear-gradient(135deg, #36D1DC 0%, #5B86E5 100%)', type: 'linear', stops: [] },
      { name: '极光', css: 'linear-gradient(135deg, #00C9FF 0%, #92FE9D 100%)', type: 'linear', stops: [] },
      { name: '雾蓝', css: 'linear-gradient(135deg, #D3DCE7 0%, #7A8DA6 100%)', type: 'linear', stops: [] },
      { name: '钢铁', css: 'linear-gradient(135deg, #868F96 0%, #596164 100%)', type: 'linear', stops: [] },
      { name: '深夜', css: 'linear-gradient(135deg, #1A2980 0%, #26D0CE 100%)', type: 'linear', stops: [] },
      { name: '夜幕', css: 'linear-gradient(135deg, #0F2027 0%, #203A43 50%, #2C5364 100%)', type: 'linear', stops: [] },
    ],
  },
  {
    name: '紫梦',
    presets: [
      { name: '星空', css: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)', type: 'linear', stops: [] },
      { name: '紫罗兰', css: 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)', type: 'linear', stops: [] },
      { name: '品牌紫', css: 'linear-gradient(135deg, #6C63FF 0%, #926BFF 100%)', type: 'linear', stops: [] },
      { name: '梦幻粉紫', css: 'linear-gradient(135deg, #F09BFF 0%, #A18CD1 100%)', type: 'linear', stops: [] },
      { name: '丁香', css: 'linear-gradient(135deg, #DDD6E4 0%, #8A7A9E 100%)', type: 'linear', stops: [] },
      { name: '葡萄', css: 'linear-gradient(135deg, #8E54E9 0%, #4776E6 100%)', type: 'linear', stops: [] },
      { name: '薰衣草', css: 'linear-gradient(135deg, #C9B8E8 0%, #8A7FB8 100%)', type: 'linear', stops: [] },
    ],
  },
  {
    name: '粉调',
    presets: [
      { name: '裸粉', css: 'linear-gradient(135deg, #EED8D5 0%, #B98A8A 100%)', type: 'linear', stops: [] },
      { name: '卡其', css: 'linear-gradient(135deg, #D9CCBE 0%, #8A7668 100%)', type: 'linear', stops: [] },
      { name: '樱花', css: 'linear-gradient(135deg, #F8C8DC 0%, #F4A8C6 100%)', type: 'linear', stops: [] },
      { name: '珊瑚', css: 'linear-gradient(135deg, #FF7E5F 0%, #FEB47B 100%)', type: 'linear', stops: [] },
      { name: '暖阳', css: 'linear-gradient(135deg, #FFD66B 0%, #FF9E64 100%)', type: 'linear', stops: [] },
      { name: '麦田', css: 'linear-gradient(135deg, #E6C37E 0%, #C8863E 100%)', type: 'linear', stops: [] },
      { name: '香槟', css: 'linear-gradient(135deg, #F3E5C3 0%, #E0C9A8 100%)', type: 'linear', stops: [] },
    ],
  },
];

/** 平铺全部渐变预设 */
export const GRADIENT_COLORS: GradientPreset[] = GRADIENT_COLOR_COLUMNS.flatMap((c) => c.presets);

/* ══════════════════════════ 三色 / 四色渐变（多色标） ══════════════════════════ */

/** 三色渐变预设（3 个色标 0/50/100），在渐变面板中作为独立一行展示 */
export const TRIPLE_GRADIENT_PRESETS: GradientPreset[] = [
  { name: '鎏金晚霞', css: 'linear-gradient(135deg, #F6D365 0%, #FDA085 50%, #FF9A9E 100%)', type: 'linear', stops: [] },
  { name: '霓虹橙', css: 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 50%, #FFB75E 100%)', type: 'linear', stops: [] },
  { name: '极光蓝绿', css: 'linear-gradient(135deg, #00C9FF 0%, #92FE9D 50%, #43E97B 100%)', type: 'linear', stops: [] },
  { name: '薰衣紫', css: 'linear-gradient(135deg, #667EEA 0%, #764BA2 50%, #F093FB 100%)', type: 'linear', stops: [] },
  { name: '深海波光', css: 'linear-gradient(135deg, #2193B0 0%, #6DD5ED 50%, #B2FEFA 100%)', type: 'linear', stops: [] },
];

/** 四色渐变预设（4 个色标 0/33/66/100），在渐变面板中作为独立一行展示 */
export const QUAD_GRADIENT_PRESETS: GradientPreset[] = [
  { name: '彩虹', css: 'linear-gradient(135deg, #FF5F6D 0%, #FFC371 33%, #A8E063 66%, #36D1DC 100%)', type: 'linear', stops: [] },
  { name: '霓虹光谱', css: 'linear-gradient(135deg, #F5576C 0%, #F093FB 33%, #5F27CD 66%, #00DBDE 100%)', type: 'linear', stops: [] },
  { name: '日落四彩', css: 'linear-gradient(135deg, #FF512F 0%, #F09819 33%, #FFD200 66%, #FF6A88 100%)', type: 'linear', stops: [] },
  { name: '极光四彩', css: 'linear-gradient(135deg, #7F00FF 0%, #E100FF 33%, #00DBDE 66%, #FC00FF 100%)', type: 'linear', stops: [] },
  { name: '海洋四彩', css: 'linear-gradient(135deg, #00C9FF 0%, #92FE9D 33%, #43E97B 66%, #38F9D7 100%)', type: 'linear', stops: [] },
];

// 填充三色/四色预设的结构化 stops
for (const g of [...TRIPLE_GRADIENT_PRESETS, ...QUAD_GRADIENT_PRESETS]) {
  g.stops = cssToStops(g.css);
}

// 填充各预设的结构化 stops
for (const g of GRADIENT_COLORS) {
  g.stops = cssToStops(g.css);
}