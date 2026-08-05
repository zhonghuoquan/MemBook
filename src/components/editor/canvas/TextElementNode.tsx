/**
 * 文字元素渲染组件
 * 从 Canvas.tsx 提取，自包含组件
 */
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Rect, Text, Circle } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { PageTextElement } from '../../../types';

function TextElementNodeImpl({
  el, mmToPx, canvasZoom, isSelected, isEditing, onUpdate, onRemove: _onRemove, onClick, onDblClick,
}: {
  el: PageTextElement;
  mmToPx: number;
  canvasZoom: number;
  isSelected: boolean;
  isEditing: boolean;
  onUpdate: (patch: Partial<PageTextElement>, recordHistory?: boolean) => void;
  onRemove: () => void;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onDblClick: () => void;
}) {
  const { t } = useTranslation();
  const px = el.x * mmToPx;
  const py = el.y * mmToPx;
  const pw = Math.max(el.width * mmToPx, 50);
  const ph = Math.max(el.height * mmToPx, 20);
  const [hovered, setHovered] = useState(false);

  // 控制点大小随缩放自适应（缩放越大点越小，保持视觉一致）
  const sz = Math.max(4, Math.min(8, 6 / canvasZoom));

  // 拖拽ref
  const dragRef = useRef({ startX: 0, startY: 0, startNx: 0, startNy: 0 });
  // resize ref
  const resizeRef = useRef({ startW: 0, startH: 0, startX: 0, startY: 0, startPos: { x: 0, y: 0 }, isLeft: false, isTop: false, axes: 'both' as 'both' | 'h' | 'v' });

  // 角点（圆形）
  function cornerHandle(cursor: string, cx: number, cy: number, axes: 'both' | 'h' | 'v') {
    return (
      <Circle x={cx} y={cy} radius={sz} fill="white" stroke="#6C63FF" strokeWidth={1.5 / canvasZoom}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => { e.cancelBubble = true; startResize(e, cx, cy, axes); }}
      />
    );
  }
  // 边点（长方块）
  function edgeHandle(cursor: string, cx: number, cy: number, orientation: 'h' | 'v') {
    const isH = orientation === 'h';
    return (
      <Rect x={cx - (isH ? sz * 1.5 : sz / 2)} y={cy - (isH ? sz / 2 : sz * 1.5)}
        width={isH ? sz * 3 : sz} height={isH ? sz : sz * 3}
        fill="white" stroke="#6C63FF" strokeWidth={1.5 / canvasZoom} cornerRadius={1}
        onMouseEnter={() => { document.body.style.cursor = cursor; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
        onMouseDown={(e) => { e.cancelBubble = true; startResize(e, cx, cy, orientation === 'h' ? 'h' : 'v'); }}
      />
    );
  }

  // 统一缩放逻辑：使用Konva Stage事件代替window级别事件
  function startResize(e: KonvaEventObject<MouseEvent>, hx: number, hy: number, axes: 'both' | 'h' | 'v') {
    const stage = e.target.getStage()!;
    const startPos = stage.getPointerPosition()!;
    resizeRef.current = {
      startW: el.width, startH: el.height,
      startX: el.x, startY: el.y,
      startPos,
      isLeft: hx <= 0, isTop: hy <= 0,
      axes,
    };
    const onMove = () => {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const { startW, startH, startX, startY, startPos: sp, isLeft, isTop, axes: ax } = resizeRef.current;
      const dx = (pos.x - sp.x) / mmToPx / canvasZoom, dy = (pos.y - sp.y) / mmToPx / canvasZoom;
      let nw = startW, nh = startH, nx = startX, ny = startY;
      if (ax === 'both' || ax === 'h') { nw = Math.max(30, startW + (isLeft ? -dx : dx)); if (isLeft) nx = startX + (startW - nw); }
      if (ax === 'both' || ax === 'v') { nh = Math.max(14, startH + (isTop ? -dy : dy)); if (isTop) ny = startY + (startH - nh); }
      onUpdate({ width: nw, height: nh, x: nx, y: ny }, false);
    };
    const onUp = () => {
      stage.off('mousemove.resize mouseup.resize');
      document.body.style.cursor = '';
      onUpdate({}, true);
    };
    stage.on('mousemove.resize', onMove);
    stage.on('mouseup.resize', onUp);
  }

  // 竖向（春联）模式：旋转 -90° 改为逐个字符从上到下排列，文字保持正立
  const isVertical = el.rotation === -90;
  return (
    <Group
      x={px} y={py}
      draggable={!isEditing}
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
      rotation={0}
    >
      {/* hover/选中 背景 */}
      {(hovered || isSelected) && (
        <Rect width={pw} height={ph} fill="transparent"
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
          let cx = pw - el.fontSize - 4; // 从最右侧开始
          let cy = 4;
          const nodes: { char: string; x: number; y: number }[] = [];
          for (const ch of text) {
            if (ch === '\n') {
              cx -= stepX;
              cy = 4;
              continue;
            }
            if (cy + el.fontSize > ph - 4) {
              cx -= stepX;
              cy = 4;
            }
            nodes.push({ char: ch, x: cx, y: cy });
            cy += stepY;
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
        <Text x={4} y={4} width={pw - 8}
          text={el.text || t('editor.textElement.placeholder')}
          fontSize={el.fontSize} fontFamily={el.fontFamily}
          fill={el.text ? el.color : '#999'}
          fontStyle={`${el.bold ? 'bold' : 'normal'} ${el.italic ? 'italic' : 'normal'}${!el.text ? ' italic' : ''}`}
          align={el.align} wrap="word"
        />
      )}
      {/* 选中态：8方向控制点（编辑时也保持可见） */}
      {isSelected && (
        <>
          {cornerHandle('nw-resize', 0, 0, 'both')}
          {edgeHandle('n-resize', pw / 2, 0, 'h')}
          {cornerHandle('ne-resize', pw, 0, 'both')}
          {edgeHandle('w-resize', 0, ph / 2, 'v')}
          {edgeHandle('e-resize', pw, ph / 2, 'v')}
          {cornerHandle('sw-resize', 0, ph, 'both')}
          {edgeHandle('s-resize', pw / 2, ph, 'h')}
          {cornerHandle('se-resize', pw, ph, 'both')}
        </>
      )}
    </Group>
  );
}

export const TextElementNode = memo(TextElementNodeImpl);
