/**
 * 形状几何计算（纯函数，无 React / store 依赖）。
 *
 * 目标：让所有「非矩形」形状的**最外边缘**恰好贴合其控制盒 pw×ph，
 * 使控制器手柄与形状实际边缘对齐，缩放锚点固定不漂移。
 *
 * 实现：先用单位圆（外接圆半径 1）生成名义顶点，再计算其自然包围盒，
 * 最后按 pw÷自然宽、ph÷自然高分别缩放并居中，填满控制盒。
 * （相比「以 min(pw,ph) 为外接圆 + 等倍拉伸」，本方法保证形状的
 *  minX/maxX/minY/maxY 恰好 = 控制盒四边，贴合最外边缘。）
 */
import type { ShapeType } from '../types';

export interface Pt { x: number; y: number; }

/** 把名义顶点按包围盒缩放到填满 pw×ph，并居中到原点 */
function fitToBox(pts: Pt[], pw: number, ph: number): Pt[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const sx = pw / w;
  const sy = ph / h;
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;
  return pts.map((p) => ({ x: (p.x - cx) * sx, y: (p.y - cy) * sy }));
}

/** 正多边形顶点（外接圆半径 1，顶点朝上 -90°） */
function regularPolygon(n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return pts;
}

/** 五角星顶点（外接圆半径 1，内圆 0.5，交替） */
function star5(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.5;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/**
 * 返回形状的多边形顶点（mm，以中心为原点，已填满 pw×ph 控制盒）。
 * 供 Konva 画布、导出引擎、缩略图三端共用，保证最外边缘贴合控制盒。
 * 仅适用于「多边形类」形状；矩形类（含圆角/切角）不走此函数。
 * @param cornerCut 切角比例（0-1，为 min(pw,ph)/2 的倍数），仅切角矩形类生效
 */
export function getShapePolygonPoints(type: ShapeType, pw: number, ph: number, cornerCut?: number): Pt[] {
  const halfW = pw / 2;
  const halfH = ph / 2;
  switch (type) {
    case 'triangle': return fitToBox(regularPolygon(3), pw, ph);
    case 'diamond': return fitToBox(regularPolygon(4), pw, ph);
    case 'pentagon': return fitToBox(regularPolygon(5), pw, ph);
    case 'hexagon': return fitToBox(regularPolygon(6), pw, ph);
    case 'star': return fitToBox(star5(), pw, ph);
    case 'parallelogram': {
      const skew = Math.min(pw, ph) * 0.25;
      return [
        { x: -halfW + skew, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW - skew, y: halfH },
        { x: -halfW, y: halfH },
      ];
    }
    case 'trapezoid': {
      const topHalfW = halfW * 0.6;
      return [
        { x: -topHalfW, y: -halfH },
        { x: topHalfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ];
    }
    case 'cutCornerRect': {
      const cut = getCutPx(cornerCut, pw, ph);
      return [
        { x: -halfW, y: -halfH + cut },
        { x: -halfW + cut, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ];
    }
    case 'cutDiagonalRect': {
      const cut = getCutPx(cornerCut, pw, ph);
      return [
        { x: -halfW, y: -halfH + cut },
        { x: -halfW + cut, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH - cut },
        { x: halfW - cut, y: halfH },
        { x: -halfW, y: halfH },
      ];
    }
    default: return [];
  }
}

/** 计算切角像素值：cornerCut(0-1) × min(pw,ph)/2，默认 0.25 */
function getCutPx(cornerCut: number | undefined, pw: number, ph: number): number {
  const maxCut = Math.min(pw, ph) / 2;
  return (cornerCut ?? 0.25) * maxCut;
}

/** 该形状是否为「切角可调整」的矩形类（用于显示 PPT 式切角调节手柄） */
export function isCutAdjustable(type: ShapeType): boolean {
  return type === 'cutCornerRect' || type === 'cutDiagonalRect';
}

/** 该形状是否为「角可调整」的矩形类（用于显示 PPT 式圆角调节手柄） */
export function isCornerAdjustable(type: ShapeType): boolean {
  return type === 'rectangle' || type === 'roundedRect' || type === 'singleRoundRect' || type === 'diagonalRoundRect';
}

/** 矩形类形状的每角圆角半径数组（像素，Konva cornerRadius 顺序：左上、右上、右下、左下）。返回 null 表示非矩形类 */
export function getRectCornerRadii(
  type: ShapeType,
  pw: number,
  ph: number,
  cornerRadius?: number,
): number[] | null {
  const maxR = Math.min(pw, ph) / 2;
  // cornerRadius 为 0-1 比例（= min(w,h)/2 的倍数）；rectangle 默认 0，roundRect 系列默认 0.15
  const r = (cornerRadius ?? 0.15) * maxR;
  switch (type) {
    case 'rectangle': {
      const rr = (cornerRadius ?? 0) * maxR;
      return [rr, rr, rr, rr];
    }
    case 'roundedRect': return [r, r, r, r];
    case 'singleRoundRect': return [r, 0, 0, 0];
    case 'diagonalRoundRect': return [r, 0, r, 0];
    default: return null;
  }
}