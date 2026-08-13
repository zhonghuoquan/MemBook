/**
 * 统一颜色色盘
 * 供文字 / 背景 / 形状在左侧面板中共用，避免各处颜色来源不一致。
 *
 * 设计目标：
 * - 不体现具体色号（无 #hex 输入框），仅提供「主题色 + 渐变色」两类色盘。
 * - 主题色为纯色，用于文字、形状填充/描边、便利贴等。
 * - 渐变色为 CSS linear-gradient，用于背景与形状填充。
 */

/** 主题色（纯色色盘） */
export const THEME_COLORS: string[] = [
  '#1A1A1A', '#4B5563', '#9CA3AF', '#FFFFFF',
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#22C55E', '#14B8A6', '#3B82F6', '#6366F1',
  '#8B5CF6', '#6C63FF', '#EC4899', '#F43F5E',
];

/** 渐变色色盘（linear-gradient），形状填充/背景均可使用 */
export const GRADIENT_COLORS: { name: string; value: string }[] = [
  { name: '暖阳', value: 'linear-gradient(135deg, #FFF1EB 0%, #ACE0F9 100%)' },
  { name: '晚霞', value: 'linear-gradient(135deg, #FFD1FF 0%, #FAD0C4 50%, #FFD89B 100%)' },
  { name: '薄荷冰', value: 'linear-gradient(135deg, #A1C4FD 0%, #C2E9FB 100%)' },
  { name: '薰衣草', value: 'linear-gradient(135deg, #E8D5F5 0%, #F5E6CC 100%)' },
  { name: '森林', value: 'linear-gradient(135deg, #D4FC79 0%, #96E6A1 100%)' },
  { name: '星空', value: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)' },
  { name: '深海', value: 'linear-gradient(135deg, #0C3483 0%, #A2B2DF 100%)' },
  { name: '日落', value: 'linear-gradient(135deg, #F093FB 0%, #F5576C 100%)' },
];
