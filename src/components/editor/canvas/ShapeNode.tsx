/**
 * 形状元素渲染组件（类似 PPT 添加形状）
 *
 * Konva Group 渲染常见形状（矩形/圆形/椭圆/三角/菱形/五边形/六边形/星形/箭头/直线），支持：
 * - 8 方向 resize（角点圆形 + 边点长方块，参考照片槽样式）
 * - 角点拖拽按比例缩放（以对角为原点）
 * - 边点拖拽单维度缩放（以对边为原点）
 * - 旋转手柄（以中心点旋转，单击旋转 90°）
 * - 填充色 / 描边 / 透明度
 * - 点击选中、拖拽移动
 * - 选中态虚线边框
 */
import { memo, useRef, useState } from 'react';
import { Group, Rect, Circle, Ellipse, RegularPolygon, Star, Arrow, Line, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useUIStore } from '../../../store';
import type { ShapeElement } from '../../../types';

/** 根据形状类型返回 Konva 绘制节点 */
function ShapeGlyph({
  shape, pw, ph, canvasZoom,
}: {
  shape: ShapeElement;
  pw: number;
  ph: number;
  canvasZoom: number;
}) {
  const common = {
    fill: shape.fill || undefined,
    stroke: shape.stroke || undefined,
    strokeWidth: Math.max(0.5, shape.strokeWidth / canvasZoom),
    strokeScaleEnabled: false,
    opacity: shape.opacity,
    listening: false,
  };
  switch (shape.type) {
    case 'circle':
      return <Circle radius={Math.min(pw, ph) / 2} {...common} />;
    case 'ellipse':
      return <Ellipse radiusX={pw / 2} radiusY={ph / 2} {...common} />;
    case 'triangle':
      return <RegularPolygon sides={3} radius={Math.min(pw, ph) / 2} {...common} />;
    case 'diamond':
      return <RegularPolygon sides={4} radius={Math.min(pw, ph) / 2} {...common} />;
    case 'pentagon':
      return <RegularPolygon sides={5} radius={Math.min(pw, ph) / 2} {...common} />;
    case 'hexagon':
      return <RegularPolygon sides={6} radius={Math.min(pw, ph) / 2} {...common} />;
    case 'star':
      return <Star numPoints={5} innerRadius={Math.min(pw, ph) / 4} outerRadius={Math.min(pw, ph) / 2} {...common} />;
    case 'arrow':
      return <Arrow points={[-pw / 2, 0, pw / 2, 0]} pointerLength={Math.min(24, pw / 3)} pointerWidth={Math.min(18, ph / 2)} fill={shape.fill || shape.stroke || '#6C63FF'} stroke={shape.stroke || undefined} strokeWidth={Math.max(0.5, shape.strokeWidth / canvasZoom)} strokeScaleEnabled={false} opacity={shape.opacity} listening={false} />;
    case 'line':
      return <Line points={[-pw / 2, 0, pw / 2, 0]} stroke={shape.stroke || shape.fill || '#6C63FF'} strokeWidth={Math.max(1, shape.strokeWidth / canvasZoom) || 3} lineCap="round" opacity={shape.opacity} listening={false} />;
    case 'square':
      return <Rect width={pw} height={pw} x={-pw / 2} y={-pw / 2} cornerRadius={0} {...common} />;
    case 'rectangle':
    default:
      return <Rect width={pw} height={ph} x={-pw / 2} y={-ph / 2} cornerRadius={0} {...common} />;
  }
}

function ShapeNodeImpl({
  shape, mmToPx, isSelected, showHandles = true, interactive = true,
  onUpdate, onRemove: _onRemove, onSelect,
}: {
  shape: ShapeElement;
  mmToPx: number;
  isSelected: boolean;
  /** 是否显示 resize/旋转等单独控制手柄。多选模式下应设为 false，由组包围盒统一控制 */
  showHandles?: boolean;
  /** 是否可交互（画笔/橡皮擦模式下设为 false，禁用选中/拖拽，让事件穿透到 Stage） */
  interactive?: boolean;
  onUpdate: (patch: Partial<ShapeElement>, recordHistory?: boolean) => void;
  onRemove: () => void;
  onSelect: (e: KonvaEventObject<MouseEvent>) => void;
}) {
  const px = shape.x * mmToPx;
  const py = shape.y * mmToPx;
  const pw = Math.max(shape.width * mmToPx, 20);
  const ph = Math.max(shape.height * mmToPx, 20);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const [hovered, setHovered] = useState(false);
  const mainGroupRef = useRef<Konva.Group>(null);

  const resizeRef = useRef({
    startW: 0, startH: 0, startX: 0, startY: 0,
    startPos: { x: 0, y: 0 },
    isLeft: false, isTop: false,
    axes: 'both' as 'both' | 'h' | 'v',
    cos: 1, sin: 0,
    anchorPX: 0, anchorPY: 0,
  });
  const rotateRef = useRef({ center: { x: 0, y: 0 }, startAngle: 0, startRotation: 0 });

  const hsz = 6 / canvasZoom;
  const sw = 1.5 / canvasZoom;
  const ICON_SIZE = 24 / canvasZoom;
  const ICON_OFFSET = 16 / canvasZoom;

  const snapAngle = (angle: number, shiftKey: boolean) => {
    if (shiftKey) return angle;
    const step = 15;
    return Math.round(angle / step) * step;
  };

  const screenDeltaToLocal = (dx: number, dy: number): { lx: number; ly: number } => {
    const rad = shape.rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { lx: dx * cos + dy * sin, ly: -dx * sin + dy * cos };
  };

  function cornerHandle(cx: number, cy: number, cursor: string) {
    return (
      <Circle
        x={cx} y={cy} radius={hsz}
        fill="white" stroke="#6C63FF" strokeWidth={sw}
        strokeScaleEnabled={false}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const startPos = stage.getPointerPosition()!;
          const isLeft = cx < 0;
          const isTop = cy < 0;
          const rad = shape.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const anchorLX = isLeft ? shape.width / 2 : -shape.width / 2;
          const anchorLY = isTop ? shape.height / 2 : -shape.height / 2;
          const anchorPX = shape.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = shape.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: shape.width, startH: shape.height,
            startX: shape.x, startY: shape.y,
            startPos, isLeft, isTop, axes: 'both', cos, sin, anchorPX, anchorPY,
          };
          const onMove = () => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            const diagX = isLeft ? -startW : startW;
            const diagY = isTop ? -startH : startH;
            const diagLen = Math.sqrt(diagX * diagX + diagY * diagY);
            if (diagLen < 0.001) return;
            const curX = diagX + dx;
            const curY = diagY + dy;
            const proj = (curX * diagX + curY * diagY) / diagLen;
            const scale = proj / diagLen;
            const newW = Math.max(10, startW * scale);
            const newH = Math.max(10, startH * scale);
            const newAnchorLX = isLeft ? newW / 2 : -newW / 2;
            const newAnchorLY = isTop ? newH / 2 : -newH / 2;
            const nx = aPX - (newAnchorLX * c - newAnchorLY * s);
            const ny = aPY - (newAnchorLX * s + newAnchorLY * c);
            onUpdate({ width: newW, height: newH, x: nx, y: ny }, false);
          };
          const onUp = () => {
            stage.off('mousemove.resize mouseup.resize');
            document.body.style.cursor = '';
            onUpdate({}, true);
          };
          stage.on('mousemove.resize', onMove);
          stage.on('mouseup.resize', onUp);
        }}
      />
    );
  }

  function edgeHandle(cx: number, cy: number, cursor: string, axes: 'h' | 'v') {
    const isHorz = axes === 'h';
    const w = isHorz ? hsz : hsz * 3;
    const h = isHorz ? hsz * 3 : hsz;
    return (
      <Rect
        x={cx - w / 2} y={cy - h / 2}
        width={w} height={h}
        fill="white" stroke="#6C63FF" strokeWidth={sw}
        cornerRadius={1 / canvasZoom}
        strokeScaleEnabled={false}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const startPos = stage.getPointerPosition()!;
          const isLeft = cx < 0;
          const isTop = cy < 0;
          const rad = shape.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const anchorLX = isHorz ? (isLeft ? shape.width / 2 : -shape.width / 2) : 0;
          const anchorLY = !isHorz ? (isTop ? shape.height / 2 : -shape.height / 2) : 0;
          const anchorPX = shape.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = shape.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: shape.width, startH: shape.height,
            startX: shape.x, startY: shape.y,
            startPos, isLeft, isTop, axes, cos, sin, anchorPX, anchorPY,
          };
          const onMove = () => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, axes: ax, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            let nw = startW, nh = startH;
            if (ax === 'h') nw = Math.max(10, startW + (isLeft ? -dx : dx));
            else nh = Math.max(10, startH + (isTop ? -dy : dy));
            const newAnchorLX = isHorz ? (isLeft ? nw / 2 : -nw / 2) : 0;
            const newAnchorLY = !isHorz ? (isTop ? nh / 2 : -nh / 2) : 0;
            const nx = aPX - (newAnchorLX * c - newAnchorLY * s);
            const ny = aPY - (newAnchorLX * s + newAnchorLY * c);
            onUpdate({ width: nw, height: nh, x: nx, y: ny }, false);
          };
          const onUp = () => {
            stage.off('mousemove.resize mouseup.resize');
            document.body.style.cursor = '';
            onUpdate({}, true);
          };
          stage.on('mousemove.resize', onMove);
          stage.on('mouseup.resize', onUp);
        }}
      />
    );
  }

  return (
    <Group
      ref={mainGroupRef}
      x={px}
      y={py}
      rotation={shape.rotation}
      listening={interactive}
      draggable={interactive}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => { e.cancelBubble = true; }}
      onDragMove={(e) => { e.cancelBubble = true; }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        onUpdate({ x: node.x() / mmToPx, y: node.y() / mmToPx }, true);
      }}
    >
      {/* 形状本体 */}
      <ShapeGlyph shape={shape} pw={pw} ph={ph} canvasZoom={canvasZoom} />

      {/* hover 边框 */}
      {hovered && !isSelected && (
        <Rect
          x={-pw / 2 - 1} y={-ph / 2 - 1}
          width={pw + 2} height={ph + 2}
          fill="transparent"
          stroke="rgba(108,99,255,0.3)"
          strokeWidth={1.5 / canvasZoom}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}

      {/* 选中虚线边框 */}
      {isSelected && (
        <Rect
          x={-pw / 2 - 2} y={-ph / 2 - 2}
          width={pw + 4} height={ph + 4}
          fill="transparent"
          stroke="#6C63FF"
          strokeWidth={1.5 / canvasZoom}
          dash={[5 / canvasZoom, 3 / canvasZoom]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}

      {isSelected && showHandles && (
        <>
          {cornerHandle(-pw / 2, -ph / 2, 'nw-resize')}
          {cornerHandle(pw / 2, -ph / 2, 'ne-resize')}
          {cornerHandle(-pw / 2, ph / 2, 'sw-resize')}
          {cornerHandle(pw / 2, ph / 2, 'se-resize')}
          {edgeHandle(0, -ph / 2, 'n-resize', 'v')}
          {edgeHandle(0, ph / 2, 's-resize', 'v')}
          {edgeHandle(-pw / 2, 0, 'w-resize', 'h')}
          {edgeHandle(pw / 2, 0, 'e-resize', 'h')}
        </>
      )}

      {isSelected && showHandles && (
        <>
          <Line
            points={[0, ph / 2, 0, ph / 2 + ICON_OFFSET]}
            stroke="#6C63FF"
            strokeWidth={1 / canvasZoom}
            strokeScaleEnabled={false}
            listening={false}
          />
          <Group x={0} y={ph / 2 + ICON_OFFSET + ICON_SIZE / 2}>
            <Circle
              x={0} y={0}
              radius={ICON_SIZE / 2 - 2 / canvasZoom}
              fill="#ffffff"
              stroke="rgba(108,99,255,0.3)"
              strokeWidth={1 / canvasZoom}
              shadowColor="rgba(0,0,0,0.12)"
              shadowBlur={8 / canvasZoom}
              shadowOffsetY={2 / canvasZoom}
              onMouseEnter={() => { document.body.style.cursor = 'grab'; }}
              onMouseLeave={() => { document.body.style.cursor = ''; }}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                const stage = e.target.getStage()!;
                const groupNode = mainGroupRef.current;
                let cx: number, cy: number;
                if (groupNode) {
                  const center = groupNode.getAbsoluteTransform(stage).point({ x: 0, y: 0 });
                  cx = center.x;
                  cy = center.y;
                } else {
                  cx = px;
                  cy = py;
                }
                const pointer = stage.getPointerPosition()!;
                rotateRef.current = {
                  center: { x: cx, y: cy },
                  startAngle: Math.atan2(pointer.y - cy, pointer.x - cx) * 180 / Math.PI,
                  startRotation: shape.rotation,
                };
                let didMove = false;
                const onMove = (me: KonvaEventObject<MouseEvent>) => {
                  const pos = stage.getPointerPosition();
                  if (!pos) return;
                  didMove = true;
                  const { center: c, startAngle, startRotation } = rotateRef.current;
                  const curAngle = Math.atan2(pos.y - c.y, pos.x - c.x) * 180 / Math.PI;
                  const delta = curAngle - startAngle;
                  onUpdate({ rotation: snapAngle(startRotation + delta, me.evt?.shiftKey ?? false) }, false);
                };
                const onUp = () => {
                  stage.off('mousemove.rotate mouseup.rotate');
                  document.body.style.cursor = '';
                  if (!didMove) {
                    onUpdate({ rotation: (shape.rotation + 90) % 360 }, true);
                  } else {
                    onUpdate({}, true);
                  }
                };
                stage.on('mousemove.rotate', onMove);
                stage.on('mouseup.rotate', onUp);
              }}
            />
            <Text
              x={-ICON_SIZE / 2} y={-ICON_SIZE / 2 - 1 / canvasZoom}
              width={ICON_SIZE} height={ICON_SIZE}
              text="↻" fontSize={16 / canvasZoom}
              fontFamily="system-ui, -apple-system, sans-serif"
              fill="#6c63ff" align="center" verticalAlign="middle"
              listening={false}
            />
          </Group>
        </>
      )}
    </Group>
  );
}

export const ShapeNode = memo(ShapeNodeImpl);
