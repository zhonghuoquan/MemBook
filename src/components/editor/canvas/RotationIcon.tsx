/**
 * 旋转图标组件：编辑模式下拖拽旋转照片
 * 从 Canvas.tsx 提取，自包含组件
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Group, Circle, Text } from 'react-konva';
import Konva from 'konva';

export function RotationIcon({
  photoCenterX,
  photoCenterY,
  photoImgH,
  rotationDeg,
  canvasZoom,
  onRotate90,
  onFreeRotateStart,
  onFreeRotateMove,
  onFreeRotateEnd,
}: {
  photoCenterX: number;   // 照片视觉中心 X（槽位坐标系）
  photoCenterY: number;   // 照片视觉中心 Y（槽位坐标系）
  photoImgH: number;      // 照片缩放后的实际高度
  rotationDeg: number;    // 当前旋转角度
  canvasZoom: number;     // 页面缩放，用于保持图标屏幕大小恒定
  onRotate90: () => void;
  onFreeRotateStart: (startAngle: number) => void;
  onFreeRotateMove: (deltaAngle: number) => void;
  onFreeRotateEnd: () => void;
}) {
  const iconRef = useRef<Konva.Group>(null);
  const startAngleRef = useRef(0);
  const isDraggingRef = useRef(false);
  // 拖拽过程中，旋转中心会因包围盒变化而漂移，需在开始拖拽时固定
  const centerLockRef = useRef({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);

  const ICON_SIZE = 24;
  const ICON_OFFSET_Y = 12;

  // 基于旋转角度计算图标位置：始终在照片矩形正下方（非包围盒底部）
  const rad = rotationDeg * Math.PI / 180;
  const dist = photoImgH / 2 + ICON_OFFSET_Y + ICON_SIZE / 2;
  const iconX = photoCenterX - Math.sin(rad) * dist;
  const iconY = photoCenterY + Math.cos(rad) * dist;

  // 非拖拽时：自动贴合到旋转后照片底部（React 重渲染后同步）
  useEffect(() => {
    if (isDraggingRef.current) return;
    const iconNode = iconRef.current;
    if (iconNode) {
      iconNode.x(iconX);
      iconNode.y(iconY);
      iconNode.opacity(1);
    }
  }, [iconX, iconY]);

  // 辅助函数：计算图标相对于照片中心的角度（使用锁定中心避免漂移）
  const calcAngleFromIcon = useCallback(() => {
    const iconNode = iconRef.current;
    if (!iconNode) return 0;
    const iconStagePos = iconNode.getAbsolutePosition();
    const cl = centerLockRef.current;
    const dx = iconStagePos.x - cl.x;
    const dy = iconStagePos.y - cl.y;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }, []);

  // 单击 → 旋转 90°
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    onRotate90();
  }, [onRotate90]);

  // 拖拽开始 → 隐藏图标（命令式，不触发重渲染），锁定旋转中心，记录初始角度
  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    isDraggingRef.current = true;
    const iconNode = iconRef.current;
    if (iconNode) {
      iconNode.opacity(0); // 命令式隐藏，不中断拖拽
      const parent = iconNode.getParent();
      const parentAbsPos = parent ? parent.getAbsolutePosition() : { x: 0, y: 0 };
      const parentScale = parent ? parent.getAbsoluteScale() : { x: 1, y: 1 };
      centerLockRef.current = {
        x: parentAbsPos.x + photoCenterX * parentScale.x,
        y: parentAbsPos.y + photoCenterY * parentScale.y,
      };
    }
    startAngleRef.current = calcAngleFromIcon();
    onFreeRotateStart(startAngleRef.current);
  }, [photoCenterX, photoCenterY, calcAngleFromIcon, onFreeRotateStart]);

  // 拖拽移动 → 计算角度偏移驱动旋转（图标隐藏中，仅角度计算）
  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const currentAngle = calcAngleFromIcon();
    const deltaAngle = currentAngle - startAngleRef.current;
    onFreeRotateMove(deltaAngle);
  }, [calcAngleFromIcon, onFreeRotateMove]);

  // 拖拽结束 → 显示图标（命令式），贴合到旋转后照片底部
  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    isDraggingRef.current = false;
    setHovering(false); // 重置 hover 状态
    onFreeRotateEnd();
    const iconNode = iconRef.current;
    if (iconNode) {
      iconNode.x(iconX);
      iconNode.y(iconY);
      iconNode.opacity(1); // 命令式显示
    }
  }, [onFreeRotateEnd, iconX, iconY]);

  return (
    <Group
      ref={iconRef}
      x={iconX}
      y={iconY}
      offsetX={ICON_SIZE / 2}
      offsetY={ICON_SIZE / 2}
      scaleX={(hovering ? 1.15 : 1) / canvasZoom}
      scaleY={(hovering ? 1.15 : 1) / canvasZoom}
      draggable
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={handleClick}
      onTap={handleClick as any}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {/* 白色底圆 + 投影 */}
      <Circle
        x={ICON_SIZE / 2} y={ICON_SIZE / 2}
        radius={ICON_SIZE / 2 - 2}
        fill="#ffffff"
        stroke="rgba(108,99,255,0.3)"
        strokeWidth={1}
        shadowColor="rgba(0,0,0,0.12)"
        shadowBlur={8}
        shadowOffsetY={2}
      />
      {/* 旋转图标：Unicode 符号 ↻ */}
      <Text
        x={0} y={-1}
        width={ICON_SIZE} height={ICON_SIZE}
        text="↻"
        fontSize={16}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#6c63ff"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  );
}
