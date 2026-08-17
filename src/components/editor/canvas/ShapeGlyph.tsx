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
 * 注意：形状本体必须 listening=true（可被点击），否则 Group 无命中区域、
 * 点击无法选中形状（事件穿透到 Stage 背景）。
 */
import { Ellipse, Arrow, Line, Rect } from 'react-konva';
import type { ShapeElement } from '../../../types';
import { getShapePolygonPoints, getRectCornerRadii } from '../../../utils/shapeGeometry';
import { gradientFlatStops, linearGradientEndpoints } from '../../../constants/colorPalette';
import { MIN_STROKE_WIDTH } from './constants';

export function ShapeGlyph({
  shape, pw, ph,
}: {
  shape: ShapeElement;
  pw: number;
  ph: number;
}) {
  const hasGradient = shape.gradient && shape.gradient.length >= 2;
  const hasStrokeGradient = shape.strokeGradient && shape.strokeGradient.length >= 2;
  const common: Record<string, unknown> = {
    stroke: shape.stroke || undefined,
    strokeWidth: Math.max(MIN_STROKE_WIDTH, shape.strokeWidth),
    strokeScaleEnabled: false,
    opacity: shape.opacity,
    // 形状本体需可点击（选中），事件无需处理，冒泡到 Group 的 onClick
    listening: true,
  };
  // 注意 Konva 的 *GradientColorStops 需要「扁平数组」[offset0, color0, offset1, color1, ...]
  // （见 Shape.js __getLinearGradient：for n+=2 addColorStop(stops[n], stops[n+1])），
  // 不能传嵌套数组，否则 Canvas2D 缩略图/导出正常而 Konva 主画布渐变填充失败。
  // 线性渐变：按角度确定起止点（默认 45 = 左上到右下），结果以「形状中心为原点」计算，
  // 与 Ellipse / 多边形（Line）的本地坐标一致。
  if (hasGradient) {
    const stops = gradientFlatStops(shape.gradient!);
    const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, shape.gradientAngle ?? 45);
    common.fillLinearGradientStartPoint = { x: startX, y: startY };
    common.fillLinearGradientEndPoint = { x: endX, y: endY };
    common.fillLinearGradientColorStops = stops;
  } else {
    common.fill = shape.fill || undefined;
  }
  if (hasStrokeGradient) {
    const strokes = gradientFlatStops(shape.strokeGradient!);
    const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, shape.strokeGradientAngle ?? 45);
    common.stroke = undefined;
    common.strokeLinearGradientStartPoint = { x: startX, y: startY };
    common.strokeLinearGradientEndPoint = { x: endX, y: endY };
    common.strokeLinearGradientColorStops = strokes;
  }
  // 矩形类用 x=-pw/2 / y=-ph/2 定位到左上角，Konva 渐变点相对节点本地原点（= 矩形左上角），
  // 需把中心系端点平移 +pw/2 / +ph/2，否则渐变只覆盖形状一半（与导出/缩略图不一致）。
  if (hasGradient) {
    const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, shape.gradientAngle ?? 45);
    common.rectGradient = {
      fillLinearGradientStartPoint: { x: startX + pw / 2, y: startY + ph / 2 },
      fillLinearGradientEndPoint: { x: endX + pw / 2, y: endY + ph / 2 },
      fillLinearGradientColorStops: gradientFlatStops(shape.gradient!),
    };
  }
  if (hasStrokeGradient) {
    const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, shape.strokeGradientAngle ?? 45);
    common.rectStrokeGradient = {
      stroke: undefined,
      strokeLinearGradientStartPoint: { x: startX + pw / 2, y: startY + ph / 2 },
      strokeLinearGradientEndPoint: { x: endX + pw / 2, y: endY + ph / 2 },
      strokeLinearGradientColorStops: gradientFlatStops(shape.strokeGradient!),
    };
  }

  switch (shape.type) {
    case 'circle':
    case 'ellipse':
      // 圆形/椭圆填满盒子（缩成椭圆以匹配控制框，与 PPT 椭圆行为一致）
      return <Ellipse radiusX={pw / 2} radiusY={ph / 2} {...common} />;
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
      // 矩形用 x=-pw/2 / y=-ph/2 定位于左上角，渐变点须用 rectGradient（中心系端点 + pw/2 / +ph/2），
      // 否则渐变只覆盖形状一半（与导出/缩略图不一致）。
      return <Rect width={pw} height={ph} x={-pw / 2} y={-ph / 2} cornerRadius={getRectCornerRadii(shape.type, pw, ph, shape.cornerRadius) ?? undefined}
        {...(hasGradient || hasStrokeGradient
          ? { ...common, ...(common.rectGradient as object), ...(common.rectStrokeGradient as object) }
          : common)} />;
    case 'arrow':
      return <Arrow points={[-pw / 2, 0, pw / 2, 0]} pointerLength={Math.min(24, pw / 3)} pointerWidth={Math.min(18, ph / 2)} fill={shape.fill || shape.stroke || '#6C63FF'} stroke={shape.stroke || undefined} strokeWidth={Math.max(MIN_STROKE_WIDTH, shape.strokeWidth)} strokeScaleEnabled={false} opacity={shape.opacity} listening={true} />;
    case 'line':
      return <Line points={[-pw / 2, 0, pw / 2, 0]} stroke={shape.stroke || shape.fill || '#6C63FF'} strokeWidth={Math.max(MIN_STROKE_WIDTH, shape.strokeWidth) || 1} lineCap="round" opacity={shape.opacity} listening={true} />;
    default:
      return <Rect width={pw} height={ph} x={-pw / 2} y={-ph / 2} cornerRadius={0} {...common} />;
  }
}

/** 把 Pt[] 转成 Konva Line 需要的扁平坐标数组 */
function pointsToFlat(pts: { x: number; y: number }[]): number[] {
  const arr: number[] = [];
  for (const p of pts) { arr.push(p.x, p.y); }
  return arr;
}