/**
 * Canvas 模块的纯常量与工具函数
 * 从 Canvas.tsx 提取，不含任何组件状态依赖
 */

export const DEFAULT_W = 420;
export const DEFAULT_H = 560;
export const MM_TO_PX = 2;
export const MIN_SLOT_SIZE = 30;

/** 槽位缩放约束：角点自由拉伸、边点单轴、Shift 锁定比例、最小尺寸保护 */
export function applySlotResizeConstraints(
  oldBox: { x: number; y: number; width: number; height: number },
  newBox: { x: number; y: number; width: number; height: number },
  anchor: string | null | undefined,
  shiftKey: boolean,
): { x: number; y: number; width: number; height: number } {
  const isEdge = !!anchor && anchor.includes('middle');
  const ratioLocked = shiftKey && oldBox.width > 0 && oldBox.height > 0;
  let clamped = { ...newBox };

  if (isEdge && !shiftKey) {
    // 边中点默认：只改变一个轴，另一轴保持不变
    if (anchor === 'top-center' || anchor === 'bottom-center') {
      clamped.width = oldBox.width;
      clamped.x = oldBox.x;
    } else if (anchor === 'middle-left' || anchor === 'middle-right') {
      clamped.height = oldBox.height;
      clamped.y = oldBox.y;
    }
  } else if (ratioLocked) {
    // Shift：角点/边点均保持原比例
    const ratio = oldBox.width / oldBox.height;
    const targetH = (ratio * newBox.width + newBox.height) / (1 + ratio * ratio);
    const targetW = targetH * ratio;
    clamped.width = targetW;
    clamped.height = targetH;

    let newX = anchor?.includes('left')
      ? oldBox.x + oldBox.width - clamped.width
      : oldBox.x;
    let newY = anchor?.includes('top')
      ? oldBox.y + oldBox.height - clamped.height
      : oldBox.y;

    if (isEdge) {
      newX = oldBox.x + (oldBox.width - clamped.width) / 2;
      newY = oldBox.y + (oldBox.height - clamped.height) / 2;
    }

    clamped.x = newX;
    clamped.y = newY;
  }

  // 最小尺寸约束（保持比例时按 oldBox 比例计算；否则只约束当前轴）
  if (clamped.width < MIN_SLOT_SIZE) {
    clamped.width = MIN_SLOT_SIZE;
    if (ratioLocked) {
      clamped.height = oldBox.height * (MIN_SLOT_SIZE / oldBox.width);
    }
    // 如果左边正在被拖拽（x 变化），锁定右边使槽位不漂移
    if (Math.abs(newBox.x - oldBox.x) > 0.01) {
      clamped.x = oldBox.x + oldBox.width - clamped.width;
    }
  }
  if (clamped.height < MIN_SLOT_SIZE) {
    clamped.height = MIN_SLOT_SIZE;
    if (ratioLocked) {
      clamped.width = oldBox.width * (MIN_SLOT_SIZE / oldBox.height);
    }
    // 如果上边正在被拖拽（y 变化），锁定下边使槽位不漂移
    if (Math.abs(newBox.y - oldBox.y) > 0.01) {
      clamped.y = oldBox.y + oldBox.height - clamped.height;
    }
  }
  return clamped;
}

/** 判断十六进制颜色是否为深色背景 */
export function isDarkBackground(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // 亮度感知加权
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

/** 解析 CSS linear-gradient 中的颜色为 Konva 渐变色标 */
export function parseGradientColors(css: string): (string | number)[] {
  const match = css.match(/linear-gradient\(([^)]+)\)/);
  if (!match) return [];
  const inner = match[1];
  // 提取所有 #hex 或 rgba() 颜色
  const colors: string[] = [];
  const colorRegex = /#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)/g;
  let m;
  while ((m = colorRegex.exec(inner)) !== null) {
    colors.push(m[0]);
  }
  if (colors.length < 2) return [];
  // 均匀分布色标
  const stops: (string | number)[] = [];
  colors.forEach((c, i) => {
    stops.push(i / (colors.length - 1));
    stops.push(c);
  });
  return stops;
}

/** 纹理背景的基础色 */
export function getTextureBaseColor(texture: string): string {
  const map: Record<string, string> = {
    'texture-ricepaper': '#F5F0E8',
    'texture-kraft': '#C4A882',
    'texture-dots': '#F9FAFB',
    'texture-grid': '#F9FAFB',
    'texture-stripes': '#FAFAFA',
    'texture-linen': '#F0EDE8',
  };
  return map[texture] || '#FFFFFF';
}

/** 根据容器尺寸计算让页面完整可见的缩放（保留 padding，最大可放大到 200%） */
export function computeFitZoom(containerW: number, containerH: number, pageW: number, pageH: number, padding = 80) {
  if (pageW <= 0 || pageH <= 0) return 1;
  const zoomX = (containerW - padding * 2) / pageW;
  const zoomY = (containerH - padding * 2) / pageH;
  return Math.max(0.1, Math.min(zoomX, zoomY, 2));
}

/** 判断事件目标是否为可输入元素（input/textarea/contentEditable），用于拦截空格键等快捷键 */
export function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
