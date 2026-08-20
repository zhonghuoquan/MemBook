/**
 * 形状本体渲染：根据形状类型返回对应的 Konva 绘制节点。
 * 以形状中心为原点绘制。
 *
 * 约定：所有形状都「填满」其控制盒 pw×ph，使选中控制框与形状实际边缘贴合，
 * 缩放时锚点固定、无不匹配漂移。
 * - 矩形类（含圆角/切角）：直接按 pw×ph 绘制
 * - 正多边形/星形：由共享 getShapePolygonPoints 按其自然包围盒缩放填满盒子，
 *   保证最外边缘（minX/maxX/minY/maxY）恰好贴合控制盒四边
 *
 * 画刷判定（填充/描边/渐变 stop/透明度/描边下限）统一由共享 buildShapePaintSpec 给出，
 * 与导出引擎/缩略图/预览同源——此处仅做 Konva 属性适配 + 本地原点平移，
 * 避免编辑器与位图端因各自内联计算产生渐变方向/描边下限/透明度差异。
 *
 * 注意：形状本体必须 listening=true（可被点击），否则 Group 无命中区域、
 * 点击无法选中形状（事件穿透到 Stage 背景）。
 */
import { Ellipse, Arrow, Line, Rect } from 'react-konva';
import type { ShapeElement } from '../../../types';
import { getShapePolygonPoints, getRectCornerRadii } from '../../../utils/shapeGeometry';
import { buildShapePaintSpec } from '../../../utils/thumbnailCore';

export function ShapeGlyph({
  shape, pw, ph,
}: {
  shape: ShapeElement;
  pw: number;
  ph: number;
}) {
  // 画刷规格（spec 基于逻辑坐标 ×MM_TO_PX 给出，乘 k 映射到画布像素；stop 已统一解析 rgba）：
  // - 填充：纯色 / 线性 / 径向（编辑器此前缺径向，此为与导出/缩略图对齐的修复）
  // - 描边：纯色 / 线性
  // - 描边宽下限 MIN_STROKE_WIDTH、透明度缺省 1
  const spec = buildShapePaintSpec(shape);
  const k = spec.pw > 0 ? pw / spec.pw : 1; // 逻辑坐标 → 画布像素的均匀比例
  const halfW = pw / 2;
  const halfH = ph / 2;

  // 中心原点坐标的渐变/实色画刷（Ellipse / 多边形 Line / Arrow / Line 用）
  const fillCenter: Record<string, unknown> = {};
  const strokeCenter: Record<string, unknown> = {};
  let solidFill: string | undefined;
  let solidStroke: string | undefined;

  if (spec.fill) {
    if (spec.fill.kind === 'solid') {
      solidFill = spec.fill.color;
    } else if (spec.fill.kind === 'linear') {
      fillCenter.fillLinearGradientStartPoint = { x: spec.fill.start.x * k, y: spec.fill.start.y * k };
      fillCenter.fillLinearGradientEndPoint = { x: spec.fill.end.x * k, y: spec.fill.end.y * k };
      fillCenter.fillLinearGradientColorStops = spec.fill.stops;
    } else {
      fillCenter.fillRadialGradientStartPoint = { x: 0, y: 0 };
      fillCenter.fillRadialGradientStartRadius = 0;
      fillCenter.fillRadialGradientEndPoint = { x: 0, y: 0 };
      fillCenter.fillRadialGradientEndRadius = spec.fill.radius * k;
    }
  }
  if (spec.stroke) {
    if (spec.stroke.kind === 'solid') {
      solidStroke = spec.stroke.color;
    } else {
      strokeCenter.stroke = undefined;
      strokeCenter.strokeLinearGradientStartPoint = { x: spec.stroke.start.x * k, y: spec.stroke.start.y * k };
      strokeCenter.strokeLinearGradientEndPoint = { x: spec.stroke.end.x * k, y: spec.stroke.end.y * k };
      strokeCenter.strokeLinearGradientColorStops = spec.stroke.stops;
    }
  }

  const common: Record<string, unknown> = {
    ...(solidFill !== undefined ? { fill: solidFill } : {}),
    ...(solidStroke !== undefined ? { stroke: solidStroke } : {}),
    ...fillCenter,
    ...strokeCenter,
    strokeWidth: spec.lineWidth,
    strokeScaleEnabled: false,
    opacity: spec.opacity,
    listening: true,
  };

  // 矩形类：Konva Rect 本地原点是左上角，渐变点须从「中心原点」平移到左上角（+halfW/+halfH），
  // 否则渐变只覆盖形状一半（与导出/缩略图不一致）。
  const rectFillGrad: Record<string, unknown> = spec.fill && spec.fill.kind !== 'solid'
    ? spec.fill.kind === 'linear'
      ? {
        fillLinearGradientStartPoint: { x: spec.fill.start.x * k + halfW, y: spec.fill.start.y * k + halfH },
        fillLinearGradientEndPoint: { x: spec.fill.end.x * k + halfW, y: spec.fill.end.y * k + halfH },
        fillLinearGradientColorStops: spec.fill.stops,
      }
      : {
        fillRadialGradientStartPoint: { x: halfW, y: halfH },
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndPoint: { x: halfW, y: halfH },
        fillRadialGradientEndRadius: spec.fill.radius * k,
      }
    : {};
  const rectStrokeGrad: Record<string, unknown> = spec.stroke && spec.stroke.kind !== 'solid'
    ? {
      stroke: undefined,
      strokeLinearGradientStartPoint: { x: spec.stroke.start.x * k + halfW, y: spec.stroke.start.y * k + halfH },
      strokeLinearGradientEndPoint: { x: spec.stroke.end.x * k + halfW, y: spec.stroke.end.y * k + halfH },
      strokeLinearGradientColorStops: spec.stroke.stops,
    }
    : {};
  const rectProps = { ...common, ...rectFillGrad, ...rectStrokeGrad };

  switch (shape.type) {
    case 'circle':
    case 'ellipse':
      // 圆形/椭圆填满盒子（缩成椭圆以匹配控制框，与 PPT 椭圆行为一致）
      return <Ellipse radiusX={halfW} radiusY={halfH} {...common} />;
    case 'triangle':
    case 'diamond':
    case 'pentagon':
    case 'hexagon':
    case 'star':
    case 'parallelogram':
    case 'trapezoid':
    case 'cutCornerRect':
    case 'cutDiagonalRect':
      // 多边形/星形/切角矩形：用共享顶点填满 pw×ph 控制盒
      return <Line points={pointsToFlat(getShapePolygonPoints(shape.type, pw, ph, shape.cornerCut))} closed {...common} />;
    case 'rectangle':
    case 'roundedRect':
    case 'singleRoundRect':
    case 'diagonalRoundRect':
      // 矩形类：每角圆角半径由共享 getRectCornerRadii 计算（支持 cornerRadius 调节）。
      // 矩形用 x=-pw/2 / y=-ph/2 定位于左上角，渐变点须用 rectFillGrad/rectStrokeGrad（中心系平移）。
      return <Rect width={pw} height={ph} x={-halfW} y={-halfH} cornerRadius={getRectCornerRadii(shape.type, pw, ph, shape.cornerRadius) ?? undefined} {...rectProps} />;
    case 'arrow':
      return <Arrow points={[-halfW, 0, halfW, 0]} pointerLength={Math.min(24, pw / 3)} pointerWidth={Math.min(18, ph / 2)} fill={shape.fill || shape.stroke || '#6C63FF'} stroke={shape.stroke || undefined} strokeWidth={spec.lineWidth} strokeScaleEnabled={false} opacity={spec.opacity} listening={true} />;
    case 'line':
      return <Line points={[-halfW, 0, halfW, 0]} stroke={shape.stroke || shape.fill || '#6C63FF'} strokeWidth={spec.lineWidth} lineCap="round" opacity={spec.opacity} listening={true} />;
    default:
      return <Rect width={pw} height={ph} x={-halfW} y={-halfH} cornerRadius={0} {...rectProps} />;
  }
}

/** 把 Pt[] 转成 Konva Line 需要的扁平坐标数组 */
function pointsToFlat(pts: { x: number; y: number }[]): number[] {
  const arr: number[] = [];
  for (const p of pts) { arr.push(p.x, p.y); }
  return arr;
}