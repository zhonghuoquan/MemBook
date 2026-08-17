/**
 * 形状元素渲染组件（类似 PPT 添加形状）
 *
 * Konva Group 渲染常见形状（矩形/圆形/椭圆/三角/菱形/五边形/六边形/星形/箭头/直线）。
 *
 * 控制交互（对齐文字/便利贴/贴纸的自绘手柄体系，不使用 Konva Transformer）：
 * - 单击选中形状；选中后显示 8 方向控制节点（角点圆形 + 边点长方块）+ 旋转手柄
 * - 角点缩放：独立宽高（Shift 保持宽高比）；边点缩放：单维度；旋转：任意角度（15° 吸附）
 * - 拖拽移动：Group draggable，onDragMove 实时写 store，保证悬浮工具栏/选中框跟随
 * - 选中态虚线边框（多选时由 showSelectionBox 渲染；单选时由选中虚线框渲染）
 *
 * 坐标约定：shape.x/y 为页面内中心点（mm），width/height 为外形包围盒尺寸（mm）。
 * Group 无 offset，子元素以 -pw/2 绘于中心两侧，Konva 缩放/旋转以 Group 原点 = 形状中心为基准。
 */
import { memo, useRef, useState } from 'react';
import { Group, Rect, Circle, Line, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useUIStore } from '../../../store';
import type { ShapeElement } from '../../../types';
import { ShapeGlyph } from './ShapeGlyph';
import { isCornerAdjustable, isCutAdjustable } from '../../../utils/shapeGeometry';
import { MIN_SHAPE_SIZE_MM } from './constants';

function ShapeNodeImpl({
  shape, mmToPx, isSelected, interactive = true, isMulti = false,
  onSelect, onMove, onMoveEnd, onUpdate,
}: {
  shape: ShapeElement;
  mmToPx: number;
  isSelected: boolean;
  /** 是否可交互（画笔/橡皮擦模式下设为 false，禁用选中/拖拽，让事件穿透到 Stage） */
  interactive?: boolean;
  /** 是否处于多选（多选时由多选包围盒统一控制，不渲染本元素独立 8 手柄） */
  isMulti?: boolean;
  onSelect: (e: { evt: MouseEvent }) => void;
  /** 拖拽移动中实时回调（mm 坐标），用于悬浮工具栏跟随 */
  onMove?: (x: number, y: number) => void;
  /** 拖拽结束回调（mm 坐标），提交历史快照 */
  onMoveEnd?: (x: number, y: number) => void;
  /** 缩放/旋转实时更新（mm 坐标），recordHistory=false 时不入历史 */
  onUpdate: (patch: Partial<ShapeElement>, recordHistory?: boolean) => void;
}) {
  const px = shape.x * mmToPx;
  const py = shape.y * mmToPx;
  const isLine = shape.type === 'line';
  // 线段本体尺寸：直线宽度 = 线段长度(mm)，高度 = 描边粗细
  const drawPw = Math.max(shape.width * mmToPx, MIN_SHAPE_SIZE_MM * mmToPx);
  const drawPh = isLine
    ? Math.max(shape.strokeWidth, MIN_SHAPE_SIZE_MM * mmToPx)
    : Math.max(shape.height * mmToPx, MIN_SHAPE_SIZE_MM * mmToPx);
  // 控制框尺寸：非直线=贴合本体；直线 lineCap="round" 圆头向两端各延伸 strokeWidth/2，
  // 控制框须把圆头也包进去（宽 +strokeWidth、高含描边），否则上下/左右不紧贴最大边。
  const pw = isLine ? drawPw + shape.strokeWidth : drawPw;
  const ph = isLine ? drawPh + shape.strokeWidth : drawPh;
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const [hovered, setHovered] = useState(false);

  // 主 Group ref：用于旋转时获取形状中心的绝对坐标
  const mainGroupRef = useRef<Konva.Group>(null);
  // resize ref（锚点 = 对角/对边在页面空间的固定点，含旋转修正）
  const resizeRef = useRef({
    startW: 0, startH: 0, startX: 0, startY: 0,
    startPos: { x: 0, y: 0 },
    isLeft: false, isTop: false,
    axes: 'both' as 'both' | 'h' | 'v',
    isHorz: false,
    cos: 1, sin: 0,
    anchorPX: 0, anchorPY: 0,
  });
  // rotate ref
  const rotateRef = useRef({ center: { x: 0, y: 0 }, startAngle: 0, startRotation: 0 });
  // drag ref
  const dragRef = useRef({ startX: 0, startY: 0, startNx: 0, startNy: 0 });
  // corner-radius ref（PPT 式圆角调节：记录起始半径与起始本地指针）
  const cornerRef = useRef({ startCr: 0, startLocalX: 0, startLocalY: 0 });
  // corner-cut ref（PPT 式切角调节：记录起始切角像素与起始本地指针）
  const cutCornerRef = useRef({ startCutPx: 0, startLocalX: 0, startLocalY: 0 });

  // 控制点尺寸（与文字/便利贴/贴纸一致：随缩放自适应，屏幕恒定 6px）
  const hsz = 6 / canvasZoom;
  const sw = 1.5 / canvasZoom;
  // 旋转图标尺寸
  const ICON_SIZE = 24 / canvasZoom;
  const ICON_OFFSET = 16 / canvasZoom;

  // 旋转角度吸附（Shift 临时取消）
  const snapAngle = (angle: number, shiftKey: boolean) => {
    if (shiftKey) return angle;
    const step = 15;
    return Math.round(angle / step) * step;
  };

  // 将屏幕空间 delta 转换为形状本地空间 delta（考虑旋转）
  const screenDeltaToLocal = (dx: number, dy: number): { lx: number; ly: number } => {
    const rad = shape.rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      lx: dx * cos + dy * sin,
      ly: -dx * sin + dy * cos,
    };
  };

  // ── 角点 resize 手柄（圆形，独立宽高缩放，以对角为原点；Shift 保持宽高比） ──
  function cornerHandle(hx: number, hy: number, cursor: string) {
    return (
      <Circle
        x={hx} y={hy} radius={hsz}
        fill="white" stroke="#6C63FF" strokeWidth={sw}
        strokeScaleEnabled={false}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const startPos = stage.getPointerPosition()!;
          const isLeft = hx < 0;
          const isTop = hy < 0;
          const rad = shape.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点（对角）页面坐标 = 中心 + R(θ) * 锚点本地（缩放全程保持不动）
          const anchorLX = isLeft ? shape.width / 2 : -shape.width / 2;
          const anchorLY = isTop ? shape.height / 2 : -shape.height / 2;
          const anchorPX = shape.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = shape.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: shape.width, startH: shape.height,
            startX: shape.x, startY: shape.y,
            startPos,
            isLeft, isTop, axes: 'both', isHorz: false,
            cos, sin, anchorPX, anchorPY,
          };
          const onMove = (me: KonvaEventObject<MouseEvent>) => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            let newW = Math.max(MIN_SHAPE_SIZE_MM, startW + (isLeft ? -dx : dx));
            let newH = Math.max(MIN_SHAPE_SIZE_MM, startH + (isTop ? -dy : dy));
            // Shift 保持宽高比：以移动量更大的维度为准，另一维度按原比例推导
            if (me.evt?.shiftKey && startW > 0.01 && startH > 0.01) {
              const ratio = startW / startH;
              if (Math.abs(newW - startW) >= Math.abs(newH - startH)) {
                newH = Math.max(MIN_SHAPE_SIZE_MM, newW / ratio);
              } else {
                newW = Math.max(MIN_SHAPE_SIZE_MM, newH * ratio);
              }
            }
            const newAnchorLX = isLeft ? newW / 2 : -newW / 2;
            const newAnchorLY = isTop ? newH / 2 : -newH / 2;
            const newCenterX = aPX - (newAnchorLX * c - newAnchorLY * s);
            const newCenterY = aPY - (newAnchorLX * s + newAnchorLY * c);
            onUpdate({ width: newW, height: newH, x: newCenterX, y: newCenterY }, false);
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

  // ── 边点 resize 手柄（长方块，单维度缩放，以对边为原点） ──
  function edgeHandle(hx: number, hy: number, cursor: string, axes: 'h' | 'v') {
    const isHorz = axes === 'v'; // 上下边 → 横长条
    const w = isHorz ? hsz * 3 : hsz;
    const h = isHorz ? hsz : hsz * 3;
    return (
      <Rect
        x={hx - w / 2} y={hy - h / 2}
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
          const isLeft = hx < 0;
          const isTop = hy < 0;
          const rad = shape.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点 = 对边中点本地坐标（仅缩放轴方向非零）
          const anchorLX = axes === 'h' ? (isLeft ? shape.width / 2 : -shape.width / 2) : 0;
          const anchorLY = axes === 'v' ? (isTop ? shape.height / 2 : -shape.height / 2) : 0;
          const anchorPX = shape.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = shape.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: shape.width, startH: shape.height,
            startX: shape.x, startY: shape.y,
            startPos,
            isLeft, isTop, axes, isHorz,
            cos, sin, anchorPX, anchorPY,
          };
          const onMove = () => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, axes: ax, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            let nw = startW, nh = startH;
            if (ax === 'h') {
              nw = Math.max(MIN_SHAPE_SIZE_MM, startW + (isLeft ? -dx : dx));
            } else {
              nh = Math.max(MIN_SHAPE_SIZE_MM, startH + (isTop ? -dy : dy));
            }
            const newAnchorLX = ax === 'h' ? (isLeft ? nw / 2 : -nw / 2) : 0;
            const newAnchorLY = ax === 'v' ? (isTop ? nh / 2 : -nh / 2) : 0;
            const newCenterX = aPX - (newAnchorLX * c - newAnchorLY * s);
            const newCenterY = aPY - (newAnchorLX * s + newAnchorLY * c);
            onUpdate({ width: nw, height: nh, x: newCenterX, y: newCenterY }, false);
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

  // ── 圆角调节手柄（PPT 式黄色菱形，仅矩形类，拖动调整 cornerRadius 0-1 比例） ──
  function cornerRadiusHandle() {
    const maxR = Math.max(1, Math.min(pw, ph) / 2);
    // cornerRadius 为 0-1 比例（= min(w,h)/2 的倍数）；rectangle 默认 0，roundRect 系列默认 0.15
    const frac = shape.cornerRadius ?? 0;
    const crPx = frac * maxR;
    // 距角的最小间距，避免与角点缩放圆重叠；随圆角半径增大而内移
    const gap = hsz;
    const off = gap + crPx;
    const hx = -pw / 2 + off;
    const hy = -ph / 2 + off;
    const ds = hsz * 1.6; // 菱形尺寸
    return (
      <Group
        x={hx} y={hy}
        onMouseEnter={() => { document.body.style.cursor = 'nwse-resize'; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const local = mainGroupRef.current?.getRelativePointerPosition();
          if (!local) return;
          cornerRef.current = { startCr: frac, startLocalX: local.x, startLocalY: local.y };
          const onMove = () => {
            const l = mainGroupRef.current?.getRelativePointerPosition();
            if (!l) return;
            const dx = l.x - cornerRef.current.startLocalX;
            const dy = l.y - cornerRef.current.startLocalY;
            const newFrac = Math.max(0, Math.min(1, cornerRef.current.startCr + Math.max(dx, dy) / maxR));
            onUpdate({ cornerRadius: newFrac }, false);
          };
          const onUp = () => {
            stage.off('mousemove.corner mouseup.corner');
            document.body.style.cursor = '';
            onUpdate({}, true);
          };
          stage.on('mousemove.corner', onMove);
          stage.on('mouseup.corner', onUp);
        }}
      >
        <Rect
          x={-ds / 2} y={-ds / 2} width={ds} height={ds} rotation={45}
          fill="#FFC107" stroke="#E6A800"
          strokeWidth={sw} strokeScaleEnabled={false}
        />
      </Group>
    );
  }

  // ── 切角调节手柄（PPT 式黄色菱形，仅切角矩形类，拖动调整 cornerCut） ──
  function cutAdjustHandle() {
    const maxCutPx = Math.max(1, Math.min(pw, ph) / 2);
    const cutPx = (shape.cornerCut ?? 0.25) * maxCutPx;
    // 手柄位于「切角斜边中点」：距角固定 gap + 切角/2，随切角增大沿对角线向形状中心移动
    const gap = hsz * 1.5;
    const off = gap + cutPx / 2;
    const hx = -pw / 2 + off;
    const hy = -ph / 2 + off;
    const ds = hsz * 1.6;
    return (
      <Group
        x={hx} y={hy}
        onMouseEnter={() => { document.body.style.cursor = 'nwse-resize'; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const local = mainGroupRef.current?.getRelativePointerPosition();
          if (!local) return;
          cutCornerRef.current = { startCutPx: cutPx, startLocalX: local.x, startLocalY: local.y };
          const onMove = () => {
            const l = mainGroupRef.current?.getRelativePointerPosition();
            if (!l) return;
            const dx = l.x - cutCornerRef.current.startLocalX;
            const dy = l.y - cutCornerRef.current.startLocalY;
            // 手柄在斜边中点：手柄移动 Δ，切角变化 2Δ（切角 = 2×中点距角距离）
            const newCutPx = Math.max(0, Math.min(maxCutPx, cutCornerRef.current.startCutPx + 2 * Math.max(dx, dy)));
            onUpdate({ cornerCut: newCutPx / maxCutPx }, false);
          };
          const onUp = () => {
            stage.off('mousemove.cutcorner mouseup.cutcorner');
            document.body.style.cursor = '';
            onUpdate({}, true);
          };
          stage.on('mousemove.cutcorner', onMove);
          stage.on('mouseup.cutcorner', onUp);
        }}
      >
        <Rect
          x={-ds / 2} y={-ds / 2} width={ds} height={ds} rotation={45}
          fill="#FFC107" stroke="#E6A800"
          strokeWidth={sw} strokeScaleEnabled={false}
        />
      </Group>
    );
  }

  return (
    <Group
      ref={mainGroupRef}
      id={`shape-node-${shape.id}`}
      name={`shape-node shape-${shape.type}`}
      x={px}
      y={py}
      rotation={shape.rotation}
      // 无 offset：Group 本地原点即形状中心（子元素画在 -pw/2），旋转/缩放以中心为基准
      listening={interactive}
      draggable={interactive}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(e as { evt: MouseEvent });
      }}
      onMouseEnter={() => {
        setHovered(true);
        if (interactive && !isSelected) document.body.style.cursor = 'move';
      }}
      onMouseLeave={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        const stage = e.target.getStage()!;
        const startPos = stage.getPointerPosition()!;
        dragRef.current = {
          startX: startPos.x,
          startY: startPos.y,
          startNx: shape.x,
          startNy: shape.y,
        };
      }}
      onDragMove={(e) => {
        // 实时写 store：拖拽中悬浮工具栏/选中框跟随，且 React 重渲染不会把位置拉回
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        const dx = (pos.x - startX) / mmToPx / canvasZoom;
        const dy = (pos.y - startY) / mmToPx / canvasZoom;
        onMove?.(startNx + dx, startNy + dy);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        let finalX = shape.x, finalY = shape.y;
        if (pos) {
          const dx = (pos.x - startX) / mmToPx / canvasZoom;
          const dy = (pos.y - startY) / mmToPx / canvasZoom;
          finalX = startNx + dx;
          finalY = startNy + dy;
        }
        onMoveEnd?.(finalX, finalY);
      }}
    >
      {/* 形状本体（以中心为原点绘制：x=-pw/2） */}
      <ShapeGlyph shape={shape} pw={drawPw} ph={drawPh} />

      {/* hover 边框（贴合控制盒边界，使手柄居中于边框线上） */}
      {hovered && !isSelected && (
        <Rect
          x={-pw / 2} y={-ph / 2}
          width={pw} height={ph}
          fill="transparent"
          stroke="rgba(108,99,255,0.3)"
          strokeWidth={1.5 / canvasZoom}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}

      {/* 选中虚线边框（贴合控制盒边界，与手柄中线对齐） */}
      {isSelected && (
        <Rect
          x={-pw / 2} y={-ph / 2}
          width={pw} height={ph}
          fill="transparent"
          stroke="#6C63FF"
          strokeWidth={1.5 / canvasZoom}
          dash={[5 / canvasZoom, 3 / canvasZoom]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}

      {/* 选中态：8 方向 resize 手柄（角点圆形 + 边点长方块） + 旋转手柄（与文字/便利贴/贴纸一致）。
          仅单选时渲染；多选由多选包围盒统一控制，避免与独立手柄冲突 */}
      {isSelected && interactive && !isMulti && (
        <>
          {/* 4 角（圆形） */}
          {cornerHandle(-pw / 2, -ph / 2, 'nw-resize')}
          {cornerHandle(pw / 2, -ph / 2, 'ne-resize')}
          {cornerHandle(-pw / 2, ph / 2, 'sw-resize')}
          {cornerHandle(pw / 2, ph / 2, 'se-resize')}
          {/* 4 边中点（长方块） */}
          {edgeHandle(0, -ph / 2, 'n-resize', 'v')}
          {edgeHandle(0, ph / 2, 's-resize', 'v')}
          {edgeHandle(-pw / 2, 0, 'w-resize', 'h')}
          {edgeHandle(pw / 2, 0, 'e-resize', 'h')}
          {/* 圆角调节手柄（PPT 式黄色菱形，仅矩形类） */}
          {isCornerAdjustable(shape.type) && cornerRadiusHandle()}
          {/* 切角调节手柄（PPT 式黄色菱形，仅切角矩形类） */}
          {isCutAdjustable(shape.type) && cutAdjustHandle()}
          {/* 旋转手柄（以中心点旋转，15° 吸附，单击不旋转） */}
          <Line
            points={[0, ph / 2, 0, ph / 2 + ICON_OFFSET]}
            stroke="#6C63FF"
            strokeWidth={1 / canvasZoom}
            strokeScaleEnabled={false}
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
                let centerX: number, centerY: number;
                if (groupNode) {
                  const center = groupNode.getAbsoluteTransform(stage).point({ x: 0, y: 0 });
                  centerX = center.x;
                  centerY = center.y;
                } else {
                  centerX = px;
                  centerY = py;
                }
                const pointer = stage.getPointerPosition()!;
                rotateRef.current = {
                  center: { x: centerX, y: centerY },
                  startAngle: Math.atan2(pointer.y - centerY, pointer.x - centerX) * 180 / Math.PI,
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
                  const newRotation = snapAngle(startRotation + delta, me.evt?.shiftKey ?? false);
                  onUpdate({ rotation: newRotation }, false);
                };
                const onUp = () => {
                  stage.off('mousemove.rotate mouseup.rotate');
                  document.body.style.cursor = '';
                  // 单击不再旋转（避免误触角度跳变）；仅实际拖动旋转时记录历史
                  if (didMove) onUpdate({}, true);
                };
                stage.on('mousemove.rotate', onMove);
                stage.on('mouseup.rotate', onUp);
              }}
            />
            <Text
              x={-ICON_SIZE / 2}
              y={-ICON_SIZE / 2 - 1 / canvasZoom}
              width={ICON_SIZE}
              height={ICON_SIZE}
              text="↻"
              fontSize={16 / canvasZoom}
              fontFamily="system-ui, -apple-system, sans-serif"
              fill="#6c63ff"
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </Group>
        </>
      )}
    </Group>
  );
}

export const ShapeNode = memo(ShapeNodeImpl);