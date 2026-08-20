/* ============================================================
   MemBook — 背景（主题色 / 渐变 / 纹理）与文字样式预设
   ============================================================ */

/* ── 背景主题色 ── */
export const THEME_BACKGROUNDS = [
  { name: '纯白', color: '#FFFFFF' },
  { name: '暖灰', color: '#F7F7F5' },
  { name: '米白', color: '#F5F0E8' },
  { name: '灰粉', color: '#F3ECE9' },
  { name: '灰紫', color: '#EFEBF2' },
  { name: '雾蓝', color: '#EDF1F5' },
  { name: '雾青', color: '#ECF2F2' },
  { name: '鼠尾草', color: '#F0F1EC' },
  { name: '燕麦', color: '#F6F1E7' },
  { name: '高级灰', color: '#E9E9E6' },
  { name: '墨黑', color: '#1F1F1E' },
  { name: '藏青', color: '#2A3441' },
];

/* ── 渐变背景预设（莫兰迪 + 鲜艳，与形状/文字共用同一套渐变） ── */
export const GRADIENT_BACKGROUNDS = [
  // 莫兰迪
  { name: '晨雾', value: 'linear-gradient(135deg, #E8E7E4 0%, #A6B8C9 100%)' },
  { name: '暮霭', value: 'linear-gradient(135deg, #D9CCBE 0%, #8A9BA8 100%)' },
  { name: '陶土', value: 'linear-gradient(135deg, #E8C4BA 0%, #B4553F 100%)' },
  { name: '杏橙', value: 'linear-gradient(135deg, #F0E3BC 0%, #C97B4A 100%)' },
  { name: '苔藓', value: 'linear-gradient(135deg, #D3DACB 0%, #7A8B6F 100%)' },
  { name: '雾青', value: 'linear-gradient(135deg, #C9DADA 0%, #6F8F8F 100%)' },
  { name: '雾蓝', value: 'linear-gradient(135deg, #D3DCE7 0%, #7A8DA6 100%)' },
  { name: '丁香', value: 'linear-gradient(135deg, #DDD6E4 0%, #8A7A9E 100%)' },
  { name: '裸粉', value: 'linear-gradient(135deg, #EED8D5 0%, #B98A8A 100%)' },
  { name: '卡其', value: 'linear-gradient(135deg, #D9CCBE 0%, #8A7668 100%)' },
  // 鲜艳
  { name: '日落', value: 'linear-gradient(135deg, #FF512F 0%, #F09819 100%)' },
  { name: '晚霞', value: 'linear-gradient(135deg, #FF6A88 0%, #FFD89B 100%)' },
  { name: '蜜桃', value: 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)' },
  { name: '柠檬', value: 'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)' },
  { name: '薄荷', value: 'linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)' },
  { name: '海洋', value: 'linear-gradient(135deg, #2193B0 0%, #6DD5ED 100%)' },
  { name: '天蓝', value: 'linear-gradient(135deg, #36D1DC 0%, #5B86E5 100%)' },
  { name: '星空', value: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)' },
  { name: '紫罗兰', value: 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)' },
  { name: '品牌紫', value: 'linear-gradient(135deg, #6C63FF 0%, #926BFF 100%)' },
  { name: '梦幻粉紫', value: 'linear-gradient(135deg, #F09BFF 0%, #A18CD1 100%)' },
  { name: '夜幕', value: 'linear-gradient(135deg, #0F2027 0%, #2C5364 100%)' },
];

/* ── 纹理背景预设 ── */
export const TEXTURE_BACKGROUNDS = [
  { name: '宣纸', value: 'texture-ricepaper' },
  { name: '牛皮纸', value: 'texture-kraft' },
  { name: '波点', value: 'texture-dots' },
  { name: '网格', value: 'texture-grid' },
  { name: '条纹', value: 'texture-stripes' },
  { name: '亚麻', value: 'texture-linen' },
];

/* ── 文字样式预设 ── */
export const TEXT_STYLE_PRESETS = [
  { name: '大标题', fontSize: 28, bold: true, italic: false, color: '#1A1A1A', placeholder: '输入标题' },
  { name: '小标题', fontSize: 20, bold: true, italic: false, color: '#374151', placeholder: '输入小标题' },
  { name: '正文', fontSize: 14, bold: false, italic: false, color: '#4B5563', placeholder: '输入正文' },
  { name: '引用', fontSize: 16, bold: false, italic: true, color: '#6B7280', placeholder: '输入引用文字' },
  { name: '手写', fontSize: 18, bold: false, italic: true, color: '#6C63FF', placeholder: '输入文字' },
  { name: '标注', fontSize: 12, bold: false, italic: false, color: '#EF4444', placeholder: '输入标注' },
];