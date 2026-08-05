/**
 * 便利贴渲染组件
 * 从 Canvas.tsx 提取，自包含组件
 */
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useUIStore } from '../../../store';
import type { StickyNote } from '../../../types';

function StickyNoteNodeImpl({
  note, mmToPx, isSelected, onUpdate, onRemove: _onRemove, onRequestEdit, onSelect,
}: {
  note: StickyNote;
  mmToPx: number;
  canDrag: boolean;
  isSelected: boolean;
  onUpdate: (patch: Partial<StickyNote>, recordHistory?: boolean) => void;
  onRemove: () => void;
  onRequestEdit: (text: string) => void;
  onSelect: (e: KonvaEventObject<MouseEvent>) => void;
}) {
  const { t } = useTranslation();
  const px = note.x * mmToPx;
  const py = note.y * mmToPx;
  const pw = Math.max(note.width * mmToPx, 40);
  const ph = Math.max(note.height * mmToPx, 40);
  const style = note.style || 'rounded';
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const [hovered, setHovered] = useState(false);

  // 拖拽ref：记录起始位置，防止跳动
  const dragRef = useRef({ startX: 0, startY: 0, startNx: 0, startNy: 0 });
  // resize/rotate ref：记录起始状态
  const resizeRef = useRef({ startW: 0, startH: 0, startX: 0, startY: 0, startPos: { x: 0, y: 0 }, isLeft: false, isTop: false, axes: 'both' as 'both' | 'h' | 'v' });
  const rotateRef = useRef({ center: { x: 0, y: 0 }, startAngle: 0, startRotation: 0 });

  // 根据样式计算圆角
  const cornerRadius = style === 'square' ? 2
    : style === 'rounded' ? 8
    : 6;
  // 根据样式计算阴影
  const shadowBlur = style === 'shadow' ? 12 : (hovered || isSelected ? 8 : 4);
  const shadowOffsetY = style === 'shadow' ? 6 : (hovered || isSelected ? 4 : 2);
  const shadowOpacity = style === 'shadow' ? 0.25 : (hovered || isSelected ? 0.22 : 0.15);

  // resize 手柄大小（自适应缩放）
  const sz = Math.max(4, Math.min(8, 6 / canvasZoom));

  // ── 旋转角度吸附（按住Shift自由旋转，默认吸附到15°倍数） ──
  const snapAngle = (angle: number, shiftKey: boolean) => {
    if (shiftKey) return angle;
    const step = 15;
    return Math.round(angle / step) * step;
  };

  // ── resize手柄：使用Konva内部drag事件 ──
  function resizeHandle(cx: number, cy: number, cursor: string, axes: 'both' | 'h' | 'v') {
    return (
      <Circle x={cx} y={cy} radius={sz} fill="white" stroke="#6C63FF" strokeWidth={1.5 / canvasZoom}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage()!;
          const startPos = stage.getPointerPosition()!;
          resizeRef.current = {
            startW: note.width, startH: note.height,
            startX: note.x, startY: note.y,
            startPos,
            isLeft: cx < 0, isTop: cy < 0,
            axes,
          };
          // 使用Konva Stage的mouseMove/mouseUp事件代替window级别
          const onMove = (_me: KonvaEventObject<MouseEvent>) => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startX, startY, startPos: sp, isLeft, isTop, axes: ax } = resizeRef.current;
            const dx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const dy = (pos.y - sp.y) / mmToPx / canvasZoom;
            let nw = startW, nh = startH, nx = startX, ny = startY;
            if (ax === 'both' || ax === 'h') {
              nw = Math.max(30, startW + (isLeft ? -dx : dx));
              if (isLeft) nx = startX + (startW - nw);
            }
            if (ax === 'both' || ax === 'v') {
              nh = Math.max(30, startH + (isTop ? -dy : dy));
              if (isTop) ny = startY + (startH - nh);
            }
            onUpdate({ width: nw, height: nh, x: nx, y: ny }, false);
          };
          const onUp = () => {
            stage.off('mousemove.resize mouseup.resize');
            document.body.style.cursor = '';
            // 松手时记录一次快照
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
      x={px + pw / 2}
      y={py + ph / 2}
      offsetX={pw / 2}
      offsetY={ph / 2}
      rotation={note.rotation}
      draggable={true}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => {
        e.cancelBubble = true;
        const stage = e.target.getStage()!;
        const startPos = stage.getPointerPosition()!;
        dragRef.current = {
          startX: startPos.x,
          startY: startPos.y,
          startNx: note.x,
          startNy: note.y,
        };
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        // 使用pointer delta换算mm增量，不受Konva Group position干扰
        const dx = (pos.x - startX) / mmToPx / canvasZoom;
        const dy = (pos.y - startY) / mmToPx / canvasZoom;
        onUpdate({ x: startNx + dx, y: startNy + dy }, false);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        // 最终位置：如果有pointer位置用pointer delta，否则用当前位置
        let finalX = note.x, finalY = note.y;
        if (pos) {
          const dx = (pos.x - startX) / mmToPx / canvasZoom;
          const dy = (pos.y - startY) / mmToPx / canvasZoom;
          finalX = startNx + dx;
          finalY = startNy + dy;
        }
        onUpdate({ x: finalX, y: finalY }, true);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onRequestEdit(note.text);
      }}
    >
      {/* 便利贴主体 */}
      <Rect
        width={pw} height={ph}
        x={-pw / 2} y={-ph / 2}
        fill={note.color}
        shadowColor={`rgba(0,0,0,${shadowOpacity})`}
        shadowBlur={shadowBlur}
        shadowOffsetY={shadowOffsetY}
        cornerRadius={cornerRadius}
        stroke={hovered && !isSelected ? 'rgba(108,99,255,0.3)' : 'rgba(0,0,0,0.08)'}
        strokeWidth={hovered && !isSelected ? 1.5 / canvasZoom : 0.5}
        strokeScaleEnabled={false}
      />
      {/* 胶带装饰 */}
      {style === 'tape' && (
        <Rect
          x={-pw / 4} y={-ph / 2 - 4}
          width={pw / 2} height={12}
          fill="rgba(255,255,255,0.55)"
          cornerRadius={2}
          stroke="rgba(0,0,0,0.06)"
          strokeWidth={0.5}
          strokeScaleEnabled={false}
          rotation={-2}
        />
      )}
      {/* 文字 */}
      <Text
        x={-pw / 2 + 6}
        y={-ph / 2 + 6}
        width={pw - 12}
        height={ph - 12}
        text={note.text || t('editor.stickyNote.placeholder')}
        fontSize={note.fontSize}
        fontFamily={note.fontFamily}
        fill={note.text ? '#333' : '#999'}
        wrap="word"
        ellipsis
        fontStyle={note.text ? 'normal' : 'italic'}
      />
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
        />
      )}
      {/* 选中态：4 角 resize 手柄 */}
      {isSelected && (
        <>
          {resizeHandle(-pw / 2, -ph / 2, 'nw-resize', 'both')}
          {resizeHandle(pw / 2, -ph / 2, 'ne-resize', 'both')}
          {resizeHandle(-pw / 2, ph / 2, 'sw-resize', 'both')}
          {resizeHandle(pw / 2, ph / 2, 'se-resize', 'both')}
        </>
      )}
      {/* 旋转手柄 + 连接线 */}
      {isSelected && (
        <>
          {/* 连接线：从底边中点到旋转手柄 */}
          <Line
            points={[0, ph / 2, 0, ph / 2 + 20 / canvasZoom]}
            stroke="#6C63FF"
            strokeWidth={1 / canvasZoom}
            strokeScaleEnabled={false}
          />
          <Circle
            x={0}
            y={ph / 2 + 20 / canvasZoom}
            radius={5 / canvasZoom}
            fill="white"
            stroke="#6C63FF"
            strokeWidth={1.5 / canvasZoom}
            onMouseEnter={() => { document.body.style.cursor = 'grab'; }}
            onMouseLeave={() => { document.body.style.cursor = ''; }}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              const stage = e.target.getStage()!;
              // center in stage space
              const groupNode = e.target.getParent()!;
              const center = groupNode.getClientRect({ relativeTo: stage });
              const cx = center.x + center.width / 2;
              const cy = center.y + center.height / 2;
              rotateRef.current = {
                center: { x: cx, y: cy },
                startAngle: Math.atan2(stage.getPointerPosition()!.y - cy, stage.getPointerPosition()!.x - cx) * 180 / Math.PI,
                startRotation: note.rotation,
              };
              const onMove = (me: KonvaEventObject<MouseEvent>) => {
                const pos = stage.getPointerPosition();
                if (!pos) return;
                const { center: c, startAngle, startRotation } = rotateRef.current;
                const curAngle = Math.atan2(pos.y - c.y, pos.x - c.x) * 180 / Math.PI;
                const delta = curAngle - startAngle;
                const newRotation = snapAngle(startRotation + delta, me.evt?.shiftKey ?? false);
                onUpdate({ rotation: newRotation }, false);
              };
              const onUp = () => {
                stage.off('mousemove.rotate mouseup.rotate');
                document.body.style.cursor = '';
                onUpdate({}, true);
              };
              stage.on('mousemove.rotate', onMove);
              stage.on('mouseup.rotate', onUp);
            }}
          />
        </>
      )}
    </Group>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeImpl);
