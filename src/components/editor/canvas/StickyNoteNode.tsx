/**
 * 便利贴渲染组件
 *
 * 参照 StickerNode 实现，保持 UI 与操作逻辑一致：
 * - Group 定位于便利贴中心（note.x/y 为左上角，组件内部换算为中心坐标）
 * - 不使用 offsetX/offsetY（避免旋转中心偏移到右下角的旧 bug）
 * - 8 方向 resize（角点圆形 + 边点长方块），缩放锚点含旋转修正
 * - 旋转手柄（白色圆底 + ↻ 图标，以中心点旋转，单击旋转 90°）
 * - 点击选中、拖拽移动、双击编辑
 */
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useUIStore } from '../../../store';
import type { StickyNote } from '../../../types';
import type { AlignBounds } from '../../../engine/alignment-engine';

function StickyNoteNodeImpl({
  note, id, mmToPx, isSelected, interactive = true,
  onUpdate: onUpdateRaw, onRequestEdit: onRequestEditRaw, onSelect: onSelectRaw, alignDrag,
}: {
  note: StickyNote;
  /** 元素唯一 id，回传到父级统一处理器（使回调引用稳定，配合 React.memo 生效） */
  id: string;
  mmToPx: number;
  canDrag: boolean;
  isSelected: boolean;
  /** 是否可交互（画笔/橡皮擦模式下设为 false，禁用选中/拖拽，让事件穿透到 Stage） */
  interactive?: boolean;
  onUpdate: (id: string, patch: Partial<StickyNote>, recordHistory?: boolean) => void;
  onRemove: (id: string) => void;
  onRequestEdit: (id: string, text: string) => void;
  onSelect: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** 对齐吸附 + 引导线（返回逻辑像素偏移）；省略 = 该元素不参与对齐 */
  alignDrag?: (bounds: AlignBounds, excludeId: string | string[]) => { offsetX: number; offsetY: number };
}) {
  const { t } = useTranslation();
  // 本地包装：注入本元素 id，内部既有调用点签名不变；useCallback 保证引用稳定，
  // 避免 effect 依赖（含 onUpdate/onSelect）每次渲染重建导致 Konva 事件反复重绑。
  const onUpdate = useCallback(
    (patch: Partial<StickyNote>, recordHistory?: boolean) => onUpdateRaw(id, patch, recordHistory),
    [onUpdateRaw, id],
  );
  const onSelect = useCallback(
    (e: KonvaEventObject<MouseEvent>) => onSelectRaw(id, e),
    [onSelectRaw, id],
  );
  const onRequestEdit = useCallback(
    (text: string) => onRequestEditRaw(id, text),
    [onRequestEditRaw, id],
  );
  // 对齐：note.x/y 为左上角，以候选左上角计算包围盒（左上角基准 px），叠加吸附偏移
  const alignCandidate = useCallback(
    (x: number, y: number) => {
      if (!alignDrag) return { x, y };
      const bounds: AlignBounds = {
        x: x * mmToPx,
        y: y * mmToPx,
        width: note.width * mmToPx,
        height: note.height * mmToPx,
      };
      const { offsetX, offsetY } = alignDrag(bounds, id);
      return { x: x + offsetX / mmToPx, y: y + offsetY / mmToPx };
    },
    [alignDrag, id, note.width, note.height, mmToPx],
  );
  // note.x/y 为左上角；组件内部换算为中心坐标，与贴纸保持一致
  const cx = note.x + note.width / 2;
  const cy = note.y + note.height / 2;
  const px = cx * mmToPx;
  const py = cy * mmToPx;
  const pw = Math.max(note.width * mmToPx, 40);
  const ph = Math.max(note.height * mmToPx, 40);
  const style = note.style || 'rounded';
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const [hovered, setHovered] = useState(false);

  // 主 Group ref：用于旋转时获取便利贴中心的绝对坐标
  const mainGroupRef = useRef<Konva.Group>(null);

  // resize ref（与贴纸一致：锚点 = 对角/对边在页面空间的固定点，含旋转修正）
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

  // 根据样式计算圆角
  const cornerRadius = style === 'square' ? 3
    : style === 'rounded' ? 10
    : 8;
  // 多层柔和阴影：投影更深、更扩散，呈现纸张悬浮感
  const shadowBlur = style === 'shadow' ? 18 : (hovered || isSelected ? 12 : 8);
  const shadowOffsetY = style === 'shadow' ? 10 : (hovered || isSelected ? 6 : 4);
  const shadowOpacity = style === 'shadow' ? 0.32 : (hovered || isSelected ? 0.26 : 0.18);
  // 折角尺寸（rounded 样式右上角的小折角，模拟便签纸撕开效果）
  const foldSize = Math.min(pw, ph) * 0.14;

  // 控制点尺寸（参考照片槽样式：6px 圆半径，1.5px 描边）
  const hsz = 6 / canvasZoom;
  const sw = 1.5 / canvasZoom;
  // 旋转图标尺寸（参考 RotationIcon：24px）
  const ICON_SIZE = 24 / canvasZoom;
  const ICON_OFFSET = 16 / canvasZoom;

  // 旋转角度吸附
  const snapAngle = (angle: number, shiftKey: boolean) => {
    if (shiftKey) return angle;
    const step = 15;
    return Math.round(angle / step) * step;
  };

  // ── 将屏幕空间 delta 转换为便利贴本地空间 delta（考虑旋转） ──
  const screenDeltaToLocal = (dx: number, dy: number): { lx: number; ly: number } => {
    const rad = note.rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      lx: dx * cos + dy * sin,
      ly: -dx * sin + dy * cos,
    };
  };

  // ── 角点 resize 手柄（圆形，独立宽高缩放，以对角为原点） ──
  // note.x/y 为左上角，中心 = (note.x + w/2, note.y + h/2)。锚点 = 对角页面坐标（含旋转）。
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
          const rad = note.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点（对角）本地坐标：与拖拽角符号相反
          const anchorLX = isLeft ? note.width / 2 : -note.width / 2;
          const anchorLY = isTop ? note.height / 2 : -note.height / 2;
          // 锚点页面坐标 = 中心 + R(θ) * 锚点本地（缩放全程保持不动）
          const anchorPX = cx + (anchorLX * cos - anchorLY * sin);
          const anchorPY = cy + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: note.width, startH: note.height,
            startX: cx, startY: cy,
            startPos,
            isLeft, isTop,
            axes: 'both',
            cos, sin, anchorPX, anchorPY,
          };
          const onMove = (me: KonvaEventObject<MouseEvent>) => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            // 角点独立宽高缩放（不等比，与文字工具一致）
            let newW = Math.max(20, startW + (isLeft ? -dx : dx));
            let newH = Math.max(20, startH + (isTop ? -dy : dy));
            // Shift 保持宽高比（PPT 角点等比）：以移动量更大的维度为准，另一维度按原比例推导
            if (me.evt?.shiftKey && startW > 0.01 && startH > 0.01) {
              const ratio = startW / startH;
              if (Math.abs(newW - startW) >= Math.abs(newH - startH)) {
                newH = Math.max(20, newW / ratio);
              } else {
                newW = Math.max(20, newH * ratio);
              }
            }
            const newAnchorLX = isLeft ? newW / 2 : -newW / 2;
            const newAnchorLY = isTop ? newH / 2 : -newH / 2;
            const newCenterX = aPX - (newAnchorLX * c - newAnchorLY * s);
            const newCenterY = aPY - (newAnchorLX * s + newAnchorLY * c);
            // note.x/y 为左上角，从中心反算
            onUpdate({ width: newW, height: newH, x: newCenterX - newW / 2, y: newCenterY - newH / 2 }, false);
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
          const rad = note.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点 = 对边中点本地坐标（仅缩放轴方向非零）
          const anchorLX = axes === 'h' ? (isLeft ? note.width / 2 : -note.width / 2) : 0;
          const anchorLY = axes === 'v' ? (isTop ? note.height / 2 : -note.height / 2) : 0;
          const anchorPX = cx + (anchorLX * cos - anchorLY * sin);
          const anchorPY = cy + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: note.width, startH: note.height,
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
              nw = Math.max(20, startW + (isLeft ? -dx : dx));
            } else {
              nh = Math.max(20, startH + (isTop ? -dy : dy));
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
      rotation={note.rotation}
      listening={interactive}
      draggable={interactive}
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
        const dx = (pos.x - startX) / mmToPx / canvasZoom;
        const dy = (pos.y - startY) / mmToPx / canvasZoom;
        const aligned = alignCandidate(startNx + dx, startNy + dy);
        onUpdate({ x: aligned.x, y: aligned.y }, false);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const { startX, startY, startNx, startNy } = dragRef.current;
        const stage = e.target.getStage()!;
        const pos = stage.getPointerPosition();
        let finalX = note.x, finalY = note.y;
        if (pos) {
          const dx = (pos.x - startX) / mmToPx / canvasZoom;
          const dy = (pos.y - startY) / mmToPx / canvasZoom;
          const aligned = alignCandidate(startNx + dx, startNy + dy);
          finalX = aligned.x;
          finalY = aligned.y;
        }
        onUpdate({ x: finalX, y: finalY }, true);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onRequestEdit(note.text);
      }}
    >
      {/* 便利贴主体（纸张底色 + 柔和阴影） */}
      <Rect
        width={pw} height={ph}
        x={-pw / 2} y={-ph / 2}
        fill={note.color}
        shadowColor={`rgba(0,0,0,${shadowOpacity})`}
        shadowBlur={shadowBlur}
        shadowOffsetY={shadowOffsetY}
        cornerRadius={cornerRadius}
        stroke="rgba(0,0,0,0.06)"
        strokeWidth={0.5 / canvasZoom}
        strokeScaleEnabled={false}
      />
      {/* 顶部高光层：增强纸张质感（半透明白色渐变，从上到下淡出） */}
      <Rect
        x={-pw / 2} y={-ph / 2}
        width={pw} height={ph * 0.35}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: ph * 0.35 }}
        fillLinearGradientColorStops={[0, 'rgba(255,255,255,0.28)', 1, 'rgba(255,255,255,0)']}
        cornerRadius={cornerRadius}
        listening={false}
      />
      {/* 底部阴影渐变：增强深度（透明到淡黑） */}
      <Rect
        x={-pw / 2} y={-ph / 2}
        width={pw} height={ph}
        fillLinearGradientStartPoint={{ x: 0, y: ph * 0.65 }}
        fillLinearGradientEndPoint={{ x: 0, y: ph }}
        fillLinearGradientColorStops={[0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.1)']}
        cornerRadius={cornerRadius}
        listening={false}
      />
      {/* rounded 样式：右上角折角（模拟便签纸撕开效果） */}
      {style === 'rounded' && (
        <Group listening={false}>
          <Line
            points={[pw / 2 - foldSize, -ph / 2, pw / 2, -ph / 2, pw / 2, -ph / 2 + foldSize]}
            closed
            fill="rgba(0,0,0,0.1)"
          />
          <Line
            points={[pw / 2 - foldSize, -ph / 2, pw / 2, -ph / 2 + foldSize]}
            stroke="rgba(0,0,0,0.15)"
            strokeWidth={0.5 / canvasZoom}
            strokeScaleEnabled={false}
          />
        </Group>
      )}
      {/* shadow 样式：增强3D投影（右上到左下的对角渐变） */}
      {style === 'shadow' && (
        <Rect
          x={-pw / 2} y={-ph / 2}
          width={pw} height={ph}
          fillLinearGradientStartPoint={{ x: pw, y: -ph }}
          fillLinearGradientEndPoint={{ x: 0, y: ph }}
          fillLinearGradientColorStops={[0, 'rgba(255,255,255,0.18)', 1, 'rgba(0,0,0,0.12)']}
          cornerRadius={cornerRadius}
          listening={false}
        />
      )}
      {/* 胶带装饰（tape 样式：米黄色半透明，对角倾斜，更真实） */}
      {style === 'tape' && (
        <Group listening={false}>
          <Rect
            x={-pw * 0.18} y={-ph / 2 - 7}
            width={pw * 0.36} height={16}
            fill="rgba(255, 224, 160, 0.72)"
            cornerRadius={1}
            stroke="rgba(180, 140, 60, 0.18)"
            strokeWidth={0.5 / canvasZoom}
            strokeScaleEnabled={false}
            rotation={-4}
            shadowColor="rgba(0,0,0,0.1)"
            shadowBlur={4}
            shadowOffsetY={1}
          />
          {/* 胶带边缘锯齿（细虚线模拟撕开边缘） */}
          <Line
            points={[-pw * 0.18, -ph / 2 - 7, -pw * 0.18 + pw * 0.36, -ph / 2 - 7]}
            stroke="rgba(180, 140, 60, 0.2)"
            strokeWidth={0.5 / canvasZoom}
            dash={[1.5, 1.5]}
            rotation={-4}
            strokeScaleEnabled={false}
          />
        </Group>
      )}
      {/* 文字（增加内边距和行高，提升可读性） */}
      <Text
        x={-pw / 2 + 8}
        y={-ph / 2 + 8}
        width={pw - 16}
        height={ph - 16}
        text={note.text || t('editor.stickyNote.placeholder')}
        fontSize={note.fontSize}
        fontFamily={note.fontFamily}
        fill={note.text ? '#2c2c2c' : '#999'}
        wrap="word"
        ellipsis
        fontStyle={note.text ? 'normal' : 'italic'}
        lineHeight={1.4}
      />
      {/* hover 边框 */}
      {hovered && !isSelected && (
        <Rect
          x={-pw / 2 - 1} y={-ph / 2 - 1}
          width={pw + 2} height={ph + 2}
          fill="transparent"
          stroke="rgba(108,99,255,0.3)"
          strokeWidth={1.5 / canvasZoom}
          strokeScaleEnabled={false}
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
        />
      )}
      {/* 选中态：8 方向 resize 手柄（角点圆形 + 边点长方块，与贴纸一致） */}
      {isSelected && (
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
                // 旋转中心 = 便利贴中心在 Stage 坐标系中的位置（Group 无 offset，本地原点 = 中心）
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
                  startRotation: note.rotation,
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
                  // 单击不再 +90°（避免误触角度跳变）；仅实际拖动旋转时记录历史
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

export const StickyNoteNode = memo(StickyNoteNodeImpl);
