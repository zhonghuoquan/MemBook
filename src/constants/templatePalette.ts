/**
 * 模板/相册卡片空态的柔和配色方案
 * 以主题紫为轴心，向粉、蓝、桃、薄荷、暖黄偏移，提高饱和度与色相差异，
 * 确保在缩略图、网格视图等小尺寸场景下相邻槽位也能清晰区分。
 */

/** 配色版本号；修改调色板后同步递增，使旧缩略图缓存失效 */
export const SLOT_PALETTE_VERSION = 6;

export const SLOT_PALETTE = [
  'linear-gradient(135deg, #D4C8FF 0%, #F0ECFF 100%)',   // 薰衣草紫
  'linear-gradient(135deg, #F0C4EC 0%, #FCF0FF 100%)',   // 粉紫
  'linear-gradient(135deg, #C4DCFF 0%, #E8F4FF 100%)',   // 蓝紫
  'linear-gradient(135deg, #FFD4C4 0%, #FFF4F0 100%)',   // 暖桃
  'linear-gradient(135deg, #B8EAD0 0%, #E8FAF2 100%)',   // 薄荷
  'linear-gradient(135deg, #FFE8B8 0%, #FFFCF0 100%)',   // 暖黄
];

export const SLOT_BORDER_COLORS = [
  'rgba(150, 130, 255, 0.45)',
  'rgba(220, 140, 210, 0.45)',
  'rgba(120, 160, 235, 0.45)',
  'rgba(255, 150, 120, 0.45)',
  'rgba(100, 200, 160, 0.45)',
  'rgba(230, 180, 100, 0.45)',
];

/** Canvas / Konva 使用的渐变起止色（与 SLOT_PALETTE 一一对应） */
export const SLOT_CANVAS_PALETTE: [string, string][] = [
  ['#D4C8FF', '#F0ECFF'],
  ['#F0C4EC', '#FCF0FF'],
  ['#C4DCFF', '#E8F4FF'],
  ['#FFD4C4', '#FFF4F0'],
  ['#B8EAD0', '#E8FAF2'],
  ['#FFE8B8', '#FFFCF0'],
];
