/**
 * Canvas 模块的纯常量与工具函数
 * 从 Canvas.tsx 提取，不含任何组件状态依赖
 */
import { paintTextureTile, getTextureBaseColor as sharedTextureBaseColor } from '../../../utils/sharedRender';

export const DEFAULT_W = 420;
export const DEFAULT_H = 560;
export const MM_TO_PX = 2;
export const MIN_SLOT_SIZE = 30;

/** 形状最小尺寸（mm）：面板输入 / 画布拖拽缩放下限统一使用，允许用户设置更小的尺寸 */
export const MIN_SHAPE_SIZE_MM = 2;

/** 描边粗细最小值（px）：允许用户设置更细的描边，0 值由「无描边」选项表达 */
export const MIN_STROKE_WIDTH = 0.1;

/** 描边粗细最大值（px） */
export const MAX_STROKE_WIDTH = 40;

/** 封面页默认书脊宽度（mm）：作为页面左侧的物理扩展区，用户可在其上添加文字/形状 */
export const DEFAULT_SPINE_WIDTH_MM = 18;

/** 书脊背面与封面正面之间的间隙（mm），模拟装订折痕厚度，封面页面呈现为两块 */
export const SPINE_GAP_MM = 6;

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

/** 判断十六进制颜色是否为深色背景（sharedRender 共享实现，与缩略图/导出一致） */
export { isDarkBackground } from '../../../utils/sharedRender';

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

/** 纹理背景的基础色（复用 sharedRender 共享实现，与缩略图/导出一致） */
export function getTextureBaseColor(texture: string): string {
  return sharedTextureBaseColor(texture);
}

/**
 * 为纹理背景生成 Canvas tile 图案（32×32）
 * 用于 Konva fillPatternImage（画布渲染）和 Canvas createPattern（导出渲染）
 * 绘制逻辑复用 sharedRender.paintTextureTile，与缩略图 Worker 端图案一致
 */
export function createTextureCanvas(texture: string): HTMLCanvasElement | null {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  paintTextureTile(ctx, texture, size);
  return c;
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
