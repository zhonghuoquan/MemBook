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

/**
 * 为纹理背景生成 Canvas tile 图案（32×32）
 * 用于 Konva fillPatternImage（画布渲染）和 Canvas createPattern（导出渲染）
 * 使用确定性坐标（非 random），保证 useMemo 缓存稳定
 */
export function createTextureCanvas(texture: string): HTMLCanvasElement | null {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  switch (texture) {
    case 'texture-ricepaper': {
      // 宣纸：米色底 + 随机分布的小颗粒
      ctx.fillStyle = '#F5F0E8';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#E8E0D0';
      const dots: [number, number][] = [[4,6],[12,3],[20,8],[28,5],[6,14],[14,18],[22,12],[30,16],[8,24],[16,28],[24,22],[2,30],[18,24],[26,30],[10,10],[24,4]];
      for (const [x, y] of dots) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'texture-kraft': {
      // 牛皮纸：棕色底 + 纤维线条 + 深色斑点
      ctx.fillStyle = '#C4A882';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(120, 90, 50, 0.15)';
      ctx.lineWidth = 0.5;
      const lines: [number, number, number, number][] = [[2,0,6,32],[10,0,14,32],[18,0,22,32],[26,0,30,32]];
      for (const [x1, y1, x2, y2] of lines) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(100, 70, 30, 0.08)';
      const spots: [number, number][] = [[5,5],[15,12],[25,8],[8,20],[20,25],[28,18]];
      for (const [x, y] of spots) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'texture-dots': {
      // 波点：浅灰底 + 规则圆点
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#D1D5DB';
      const step = 12;
      for (let x = step / 2; x < size; x += step) {
        for (let y = step / 2; y < size; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'texture-grid': {
      // 网格：浅灰底 + 网格线
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      const step = 16;
      for (let x = 0; x <= size; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
    case 'texture-stripes': {
      // 条纹：浅灰底 + 45度对角条纹
      ctx.fillStyle = '#FAFAFA';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      for (let i = -size; i < size * 2; i += 5) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size, size);
        ctx.stroke();
      }
      break;
    }
    case 'texture-linen': {
      // 亚麻：米色底 + 细密十字纹理
      ctx.fillStyle = '#F0EDE8';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(0,0,0,0.03)';
      ctx.lineWidth = 1;
      const step = 4;
      for (let x = 0; x <= size; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
    default:
      return null;
  }
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
