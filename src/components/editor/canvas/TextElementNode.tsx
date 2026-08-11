/**
 * 文字元素渲染组件
 * 从 Canvas.tsx 提取，自包含组件
 *
 * 2026-08-09 重构：
 * - 中心定位（与便利贴/贴纸一致），支持任意角度旋转
 * - 旋转手柄（白色圆底 + ↻ 图标，以中心点旋转，15° 吸附，单击旋转 90°）
 * - 8 方向 resize（角点独立宽高 + 边点单维度），缩放锚点含旋转修正
 * - rotation === -90 时保持竖排（春联）模式，逐字正立排列
 */
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import type { PageTextElement } from '../../../types';

function TextElementNodeImpl({
  el, mmToPx, canvasZoom, isSelected, isEditing, interactive = true, onUpdate, onRemove: _onRemove, onClick, onDblClick,
}: {
  el: PageTextElement;
  mmToPx: number;
  canvasZoom: number;
  isSelected: boolean;
  isEditing: boolean;
  /** 是否可交互（画笔/橡皮擦模式下设为 false，禁用选中/拖拽，让事件穿透到 Stage） */
  interactive?: boolean;
  onUpdate: (patch: Partial<PageTextElement>, recordHistory?: boolean) => void;
  onRemove: () => void;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onDblClick: () => void;
}) {
  const { t } = useTranslation();
  // el.x/y 为左上角；组件内部换算为中心坐标，与便利贴/贴纸保持一致
  const cx = el.x + el.width / 2;
  const cy = el.y + (el.height ?? 20) / 2;
  const px = cx * mmToPx;
  const py = cy * mmToPx;
  const pw = Math.max(el.width * mmToPx, 50);
  const ph = Math.max((el.height ?? 20) * mmToPx, 20);
  const [hovered, setHovered] = useState(false);

  // 竖排（春联）模式：rotation === -90 时逐字竖排，文字保持正立，Group 不旋转
  const isVertical = el.rotation === -90;
  // 非竖排模式下应用实际旋转角度
  const groupRotation = isVertical ? 0 : (el.rotation ?? 0);

  // 控制点尺寸随缩放自适应
  const hsz = 6 / canvasZoom;
  const sw = 1.5 / canvasZoom;
  // 旋转图标尺寸
  const ICON_SIZE = 24 / canvasZoom;
  const ICON_OFFSET = 16 / canvasZoom;

  // 主 Group ref：用于旋转时获取中心绝对坐标
  const mainGroupRef = useRef<Konva.Group>(null);
  // resize ref（与便利贴一致：锚点 = 对角/对边在页面空间的固定点，含旋转修正）
  const resizeRef = useRef({
    startW: 0, startH: 0, startX: 0, startY: 0,
    startPos: { x: 0, y: 0 },
    isLeft: false, isTop: false,
    axes: 'both' as 'both' | 'h' | 'v',
    cos: 1, sin: 0,
    anchorPX: 0, anchorPY: 0,
  });
  // rotate ref
  const rotateRef = useRef({ center: { x: 0, y: 0 }, startAngle: 0, startRotation: 0 });
  // drag ref
  const dragRef = useRef({ startX: 0, startY: 0, startNx: 0, startNy: 0 });

  // 旋转角度吸附
  const snapAngle = (angle: number, shiftKey: boolean) => {
    if (shiftKey) return angle;
    const step = 15;
    return Math.round(angle / step) * step;
  };

  // 将屏幕空间 delta 转换为元素本地空间 delta（考虑旋转）
  const screenDeltaToLocal = (dx: number, dy: number): { lx: number; ly: number } => {
    const rad = groupRotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      lx: dx * cos + dy * sin,
      ly: -dx * sin + dy * cos,
    };
  };

  // ── 角点 resize 手柄（圆形，独立宽高缩放，以对角为原点） ──
  // el.x/y 为左上角，中心 = (el.x + w/2, el.y + h/2)。锚点 = 对角页面坐标（含旋转）。
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
          const rad = groupRotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点（对角）本地坐标：与拖拽角符号相反
          const anchorLX = isLeft ? el.width / 2 : -el.width / 2;
          const anchorLY = isTop ? (el.height ?? 20) / 2 : -(el.height ?? 20) / 2;
          // 锚点页面坐标 = 中心 + R(θ) * 锚点本地
          const anchorPX = cx + (anchorLX * cos - anchorLY * sin);
          const anchorPY = cy + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: el.width, startH: el.height ?? 20,
            startX: cx, startY: cy,
            startPos,
            isLeft, isTop,
            axes: 'both',
            cos, sin, anchorPX, anchorPY,
          };
          const onMove = () => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            // 角点独立宽高缩放（不等比）
            const nw = Math.max(30, startW + (isLeft ? -dx : dx));
            const nh = Math.max(14, startH + (isTop ? -dy : dy));
            const newAnchorLX = isLeft ? nw / 2 : -nw / 2;
            const newAnchorLY = isTop ? nh / 2 : -nh / 2;
            const newCenterX = aPX - (newAnchorLX * c - newAnchorLY * s);
            const newCenterY = aPY - (newAnchorLX * s + newAnchorLY * c);
            // el.x/y 为左上角，从中心反算
            onUpdate({ width: nw, height: nh, x: newCenterX - nw / 2, y: newCenterY - nh / 2 }, false);
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
          const rad = groupRotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const anchorLX = axes === 'h' ? (isLeft ? el.width / 2 : -el.width / 2) : 0;
          const anchorLY = axes === 'v' ? (isTop ? (el.height ?? 20) / 2 : -(el.height ?? 20) / 2) : 0;
          const anchorPX = cx + (anchorLX * cos - anchorLY * sin);
          const anchorPY = cy + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: el.width, startH: el.height ?? 20,
            startX: cx, startY: cy,
            startPos,
            isLeft, isTop,
            axes,
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
              nw = Math.max(30, startW + (isLeft ? -dx : dx));
            } else {
              nh = Math.max(14, startH + (isTop ? -dy : dy));
            }
            const newAnchorLX = ax === 'h' ? (isLeft ? nw / 2 : -nw / 2) : 0;
            const newAnchorLY = ax === 'v' ? (isTop ? nh / 2 : -nh / 2) : 0;
            const newCenterX = aPX - (newAnchorLX * c - newAnchorLY * s);
            const newCenterY = aPY - (newAnchorLX * s + newAnchorLY * c);
            onUpdate({ width: nw, height: nh, x: newCenterX - nw / 2, y: newCenterY - nh / 2 }, false);
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
      rotation={groupRotation}
      listening={interactive}
      draggable={!isEditing && interactive}
      onClick={(e) => { e.cancelBubble = true; onClick(e); }}
      onDblClick={(e) => { e.cancelBubble = true; onDblClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => {
        e.cancelBubble = true;
        const stage = e.target.getStage()!;
        const startPos = stage.getPointerPosition()!;
        dragRef.current = {
          startX: startPos.x,
          startY: startPos.y,
          startNx: el.x,
          startNy: el.y,
        };
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        const dx = (pos.x - startX) / mmToPx / canvasZoom;
        const dy = (pos.y - startY) / mmToPx / canvasZoom;
        onUpdate({ x: startNx + dx, y: startNy + dy }, false);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        let finalX = el.x, finalY = el.y;
        if (pos) {
          const dx = (pos.x - startX) / mmToPx / canvasZoom;
          const dy = (pos.y - startY) / mmToPx / canvasZoom;
          finalX = startNx + dx;
          finalY = startNy + dy;
        }
        onUpdate({ x: finalX, y: finalY }, true);
      }}
    >
      {/* hover/选中 背景 */}
      {(hovered || isSelected) && (
        <Rect
          x={-pw / 2} y={-ph / 2}
          width={pw} height={ph}
          fill="transparent"
          stroke={isSelected ? '#6C63FF' : 'rgba(108,99,255,0.3)'}
          strokeWidth={isSelected ? 1.5 / canvasZoom : 1 / canvasZoom}
          dash={isSelected ? [5 / canvasZoom, 3 / canvasZoom] : undefined}
          strokeScaleEnabled={false}
        />
      )}
      {/* 文字内容 */}
      {isVertical ? (
        /* 竖向（春联）：每个字符正立，从上到下排列，\n 或超出高度自动换列（右→左） */
        (() => {
          const text = el.text || t('editor.textElement.placeholder');
          const stepY = el.fontSize + 2;
          const stepX = el.fontSize + 6;
          let ccx = pw / 2 - el.fontSize - 4; // 从最右侧开始
          let ccy = -ph / 2 + 4;
          const nodes: { char: string; x: number; y: number }[] = [];
          for (const ch of text) {
            if (ch === '\n') {
              ccx -= stepX;
              ccy = -ph / 2 + 4;
              continue;
            }
            if (ccy + el.fontSize > ph / 2 - 4) {
              ccx -= stepX;
              ccy = -ph / 2 + 4;
            }
            nodes.push({ char: ch, x: ccx, y: ccy });
            ccy += stepY;
          }
          return nodes.map((n, i) => (
            <Text key={i} x={n.x} y={n.y}
              text={n.char}
              fontSize={el.fontSize} fontFamily={el.fontFamily}
              fill={el.color}
              fontStyle={`${el.bold ? 'bold' : 'normal'} ${el.italic ? 'italic' : 'normal'}`}
            />
          ));
        })()
      ) : (
        /* 横向：普通横排 */
        <Text
          x={-pw / 2 + 4} y={-ph / 2 + 4}
          width={pw - 8}
          text={el.text || t('editor.textElement.placeholder')}
          fontSize={el.fontSize} fontFamily={el.fontFamily}
          fill={el.text ? el.color : '#999'}
          fontStyle={`${el.bold ? 'bold' : 'normal'} ${el.italic ? 'italic' : 'normal'}${!el.text ? ' italic' : ''}`}
          align={el.align} wrap="word"
        />
      )}
      {/* 选中态：8方向控制点 */}
      {isSelected && (
        <>
          {/* 4 角（圆形，独立宽高缩放） */}
          {cornerHandle(-pw / 2, -ph / 2, 'nw-resize')}
          {cornerHandle(pw / 2, -ph / 2, 'ne-resize')}
          {cornerHandle(-pw / 2, ph / 2, 'sw-resize')}
          {cornerHandle(pw / 2, ph / 2, 'se-resize')}
          {/* 4 边中点（长方块） */}
          {edgeHandle(0, -ph / 2, 'n-resize', 'v')}
          {edgeHandle(0, ph / 2, 's-resize', 'v')}
          {edgeHandle(-pw / 2, 0, 'w-resize', 'h')}
          {edgeHandle(pw / 2, 0, 'e-resize', 'h')}
        </>
      )}
      {/* 旋转手柄（白色圆底 + ↻ 图标，以中心点旋转，单击旋转 90°） */}
      {isSelected && (
        <>
          <Line
            points={[0, ph / 2, 0, ph / 2 + ICON_OFFSET]}
            stroke="#6C63FF"
            strokeWidth={1 / canvasZoom}
            strokeScaleEnabled={false}
          />
          <Group
            x={0}
            y={ph / 2 + ICON_OFFSET + ICON_SIZE / 2}
          >
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
                  startRotation: el.rotation ?? 0,
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
                  if (!didMove) {
                    onUpdate({ rotation: ((el.rotation ?? 0) + 90) % 360 }, true);
                  } else {
                    onUpdate({}, true);
                  }
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

export const TextElementNode = memo(TextElementNodeImpl);
