/**
 * 贴纸元素渲染组件
 *
 * Konva Group 渲染贴纸图片，支持：
 * - 8 方向 resize（角点圆形 + 边点长方块，参考照片槽样式）
 * - 角点拖拽按比例缩放（以对角为原点）
 * - 边点拖拽单维度缩放（以对边为原点）
 * - 旋转手柄（参考照片编辑模式 RotationIcon，以中心点旋转，单击旋转 90°）
 * - 镜像翻转（flipH/flipV）
 * - 点击选中、拖拽移动
 * - 选中态虚线边框
 */
import { memo, useRef, useState } from 'react';
import { Group, Rect, Image as KonvaImage, Circle, Line, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useUIStore } from '../../../store';
import { useStickerImage } from '../../../hooks/useStickerSrc';
import type { StickerElement } from '../../../types';

function StickerNodeImpl({
  sticker, mmToPx, isSelected, showHandles = true, interactive = true,
  onUpdate, onRemove: _onRemove, onSelect,
}: {
  sticker: StickerElement;
  mmToPx: number;
  isSelected: boolean;
  /** 是否显示 resize/旋转等单独控制手柄。多选模式下应设为 false，由组包围盒统一控制 */
  showHandles?: boolean;
  /** 是否可交互（画笔/橡皮擦模式下设为 false，禁用选中/拖拽，让事件穿透到 Stage） */
  interactive?: boolean;
  onUpdate: (patch: Partial<StickerElement>, recordHistory?: boolean) => void;
  onRemove: () => void;
  onSelect: (e: KonvaEventObject<MouseEvent>) => void;
}) {
  const px = sticker.x * mmToPx;
  const py = sticker.y * mmToPx;
  const pw = Math.max(sticker.width * mmToPx, 20);
  const ph = Math.max(sticker.height * mmToPx, 20);
  const canvasZoom = useUIStore((s) => s.canvasZoom);
  const [hovered, setHovered] = useState(false);

  // 加载贴纸图片（blobId 格式为 sticker-blob-{stickerId}）
  const blobId = sticker.stickerId ? `sticker-blob-${sticker.stickerId}` : null;
  const { image } = useStickerImage(blobId);
  const imageRef = useRef<Konva.Image>(null);
  // 主 Group ref：用于旋转时获取贴纸中心的绝对坐标
  const mainGroupRef = useRef<Konva.Group>(null);

  // resize ref
  // P0-fix: 缩放锚点 = 对角/对边在页面空间的固定点（含旋转修正）。
  //   sticker.x/y 是中心点坐标，旧代码按"左上角"处理 → 实际以中心缩放，
  //   且旋转后锚点会漂移。改为记录锚点页面坐标 + 旋转矩阵，缩放后反算新中心。
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

  // ── 将屏幕空间 delta 转换为贴纸本地空间 delta（考虑旋转） ──
  // 贴纸旋转 θ 后，屏幕 dx/dy 需要反向旋转才能得到本地 delta
  const screenDeltaToLocal = (dx: number, dy: number): { lx: number; ly: number } => {
    const rad = sticker.rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      lx: dx * cos + dy * sin,
      ly: -dx * sin + dy * cos,
    };
  };

  // ── 角点 resize 手柄（圆形，按比例缩放，以对角为原点） ──
  // P0-fix: sticker.x/y 是中心点。锚点 = 对角点在页面空间的固定位置（含旋转），
  //   缩放后反算新中心 = anchorPage - R(θ) * newAnchorLocal，保证对角点屏幕不动。
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
          const rad = sticker.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点（对角）本地坐标：与拖拽角符号相反
          const anchorLX = isLeft ? sticker.width / 2 : -sticker.width / 2;
          const anchorLY = isTop ? sticker.height / 2 : -sticker.height / 2;
          // 锚点页面坐标 = 中心 + R(θ) * 锚点本地（缩放全程保持不动）
          const anchorPX = sticker.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = sticker.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: sticker.width, startH: sticker.height,
            startX: sticker.x, startY: sticker.y,
            startPos,
            isLeft, isTop,
            axes: 'both',
            cos, sin, anchorPX, anchorPY,
          };
          const onMove = (_me: KonvaEventObject<MouseEvent>) => {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { startW, startH, startPos: sp, isLeft, isTop, cos: c, sin: s, anchorPX: aPX, anchorPY: aPY } = resizeRef.current;
            // 屏幕空间 delta → mm
            const sdx = (pos.x - sp.x) / mmToPx / canvasZoom;
            const sdy = (pos.y - sp.y) / mmToPx / canvasZoom;
            // 转换到贴纸本地空间（考虑旋转）
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            // 对角向量（从锚点到拖拽角，本地空间）
            const diagX = isLeft ? -startW : startW;
            const diagY = isTop ? -startH : startH;
            const diagLen = Math.sqrt(diagX * diagX + diagY * diagY);
            if (diagLen < 0.001) return;
            // 当前指针相对锚点的本地向量
            const curX = diagX + dx;
            const curY = diagY + dy;
            // 投影到对角方向，得到缩放比例
            const proj = (curX * diagX + curY * diagY) / diagLen;
            const scale = proj / diagLen;
            const newW = Math.max(10, startW * scale);
            const newH = Math.max(10, startH * scale);
            // 新锚点本地坐标（尺寸变化后）
            const newAnchorLX = isLeft ? newW / 2 : -newW / 2;
            const newAnchorLY = isTop ? newH / 2 : -newH / 2;
            // 新中心 = 锚点页面坐标 - R(θ) * 新锚点本地坐标
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

  // ── 边点 resize 手柄（长方块，单维度缩放，以对边为原点） ──
  // P0-fix: 锚点 = 对边中点在页面空间的固定位置（含旋转）。
  //   仅缩放单维度，另一维度不变 → 锚点本地坐标仅一轴非零。
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
          const rad = sticker.rotation * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // 锚点 = 对边中点本地坐标（仅缩放轴方向非零）
          const anchorLX = isHorz ? (isLeft ? sticker.width / 2 : -sticker.width / 2) : 0;
          const anchorLY = !isHorz ? (isTop ? sticker.height / 2 : -sticker.height / 2) : 0;
          const anchorPX = sticker.x + (anchorLX * cos - anchorLY * sin);
          const anchorPY = sticker.y + (anchorLX * sin + anchorLY * cos);
          resizeRef.current = {
            startW: sticker.width, startH: sticker.height,
            startX: sticker.x, startY: sticker.y,
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
            // 转换到贴纸本地空间（考虑旋转）
            const { lx: dx, ly: dy } = screenDeltaToLocal(sdx, sdy);
            let nw = startW, nh = startH;
            if (ax === 'h') {
              nw = Math.max(10, startW + (isLeft ? -dx : dx));
            } else {
              nh = Math.max(10, startH + (isTop ? -dy : dy));
            }
            // 新锚点本地坐标（仅缩放轴随尺寸变化）
            const newAnchorLX = isHorz ? (isLeft ? nw / 2 : -nw / 2) : 0;
            const newAnchorLY = !isHorz ? (isTop ? nh / 2 : -nh / 2) : 0;
            // 新中心 = 锚点页面坐标 - R(θ) * 新锚点本地坐标
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
      rotation={sticker.rotation}
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
      }}
      onDragMove={(e) => {
        // 不调用 onUpdate，避免 Konva 拖拽位置与 React state 重新渲染冲突导致闪烁放大
        e.cancelBubble = true;
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        // 拖拽结束后读取 Konva Group 的实际位置（已由 Konva 拖拽更新），一次性更新 state
        const node = e.target;
        const newX = node.x() / mmToPx;
        const newY = node.y() / mmToPx;
        onUpdate({ x: newX, y: newY }, true);
      }}
    >
      {/* 贴纸图片 */}
      <KonvaImage
        ref={imageRef}
        image={image || undefined}
        width={pw}
        height={ph}
        x={-pw / 2}
        y={-ph / 2}
        // 镜像翻转
        scaleX={sticker.flipH ? -1 : 1}
        scaleY={sticker.flipV ? -1 : 1}
        offsetX={sticker.flipH ? pw : 0}
        offsetY={sticker.flipV ? ph : 0}
        shadowColor="rgba(0,0,0,0.15)"
        shadowBlur={hovered || isSelected ? 8 : 4}
        shadowOffsetY={hovered || isSelected ? 4 : 2}
        shadowOpacity={0.2}
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

      {/* 选中态：8 方向 resize 手柄（角点圆形 + 边点长方块，参考照片槽样式）
          多选模式下隐藏，由组包围盒统一控制 */}
      {isSelected && showHandles && (
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

      {/* 旋转手柄（参考照片编辑模式 RotationIcon：位于贴纸下方，白色圆底 + ↻ 图标，以中心点旋转，单击旋转 90°）
          多选模式下隐藏 */}
      {isSelected && showHandles && (
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
                // 旋转中心 = 贴纸图片中心在 Stage 坐标系中的位置
                // Group 无 offset：T(x,y) * R(θ)，图片中心在 Group 本地坐标 = (0, 0)
                // （Image x=-pw/2, y=-ph/2，中心 = (-pw/2+pw/2, -ph/2+ph/2) = (0,0)）
                // 因此旋转枢轴 = Group 原点 = 图片中心，旋转时中心保持不变
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
                  startRotation: sticker.rotation,
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
                    // 单击：旋转 90°（参考照片 RotationIcon 行为）
                    onUpdate({ rotation: (sticker.rotation + 90) % 360 }, true);
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

export const StickerNode = memo(StickerNodeImpl);
