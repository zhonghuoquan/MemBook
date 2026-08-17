/**
 * 文字编辑态 HTML 控制点层（2026-08-16）
 *
 * 背景：双击进入编辑时，文字内容由 DOM 浮层（contentEditable，TextDomNode）承载，
 * 该浮层位于 Konva Stage 之上（Canvas 文字 DOM 层容器 zIndex=1）且 pointerEvents:auto，
 * 会拦截点击，导致 Konva 层绘制的控制点被遮挡、无法拖拽。
 *
 * 方案：编辑态在文字 DOM 层之上再叠一层 HTML 控制点（8 方向 resize + 旋转手柄），
 * 实现 PPT 式的「编辑时也能拖动控制点调整大小/旋转」。几何算法与 Konva 的
 * TextElementNode cornerHandle/edgeHandle 完全一致（对角/对边为锚点、含旋转修正）。
 * 非编辑态仍由 Konva 绘制选中虚线框与控制点，两态视觉一致、互不重复。
 */
import { memo, useRef } from 'react';
import type { PageTextElement } from '../../../types';
import { MM_TO_PX } from './constants';

function TextEditHandlesImpl({
  el, canvasZoom, onUpdate,
}: {
  el: PageTextElement;
  canvasZoom: number;
  onUpdate: (patch: Partial<PageTextElement>, recordHistory?: boolean) => void;
}) {
  const isV = el.isVertical === true;
  const MIN_W_MM = isV ? 4 : 8;
  const MIN_H_MM = isV ? 8 : 4;
  // 命中区/虚线框尺寸（mm→px，含 zoom；与 TextElementNode 一致）
  const pw = Math.max(el.width * MM_TO_PX, MIN_W_MM * MM_TO_PX) * canvasZoom;
  const ph = Math.max((el.height ?? 20) * MM_TO_PX, MIN_H_MM * MM_TO_PX) * canvasZoom;
  const rotation = el.rotation ?? 0;
  const cx = el.x + el.width / 2;
  const cy = el.y + (el.height ?? 20) / 2;
  const boxRef = useRef<HTMLDivElement>(null);
  // 控制点屏幕尺寸恒定（DOM 层坐标已含 canvasZoom，故用固定 px，不随 zoom 再缩放）
  const hsz = 6;
  const sw = 1.5;
  const ICON_SIZE = 24;
  const ICON_OFFSET = 16;

  const rs = useRef({
    startW: 0, startH: 0, startPos: { x: 0, y: 0 },
    isLeft: false, isTop: false, axes: 'both' as 'both' | 'h' | 'v',
    cos: 1, sin: 0, anchorPX: 0, anchorPY: 0,
  });
  const rr = useRef({ center: { x: 0, y: 0 }, startAngle: 0, startRotation: 0 });

  const snap = (a: number) => Math.round(a / 15) * 15;

  const beginResize = (hx: number, hy: number, axes: 'both' | 'h' | 'v') => (e: React.MouseEvent) => {
    e.preventDefault(); // 阻止 contentEditable 失焦（保持编辑态）
    e.stopPropagation();
    const startPos = { x: e.clientX, y: e.clientY };
    const isLeft = hx < 0, isTop = hy < 0;
    const rad = rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const elW = el.width, elH = el.height ?? 20;
    let anchorLX = 0, anchorLY = 0;
    if (axes === 'both') { anchorLX = isLeft ? elW / 2 : -elW / 2; anchorLY = isTop ? elH / 2 : -elH / 2; }
    else if (axes === 'h') { anchorLX = isLeft ? elW / 2 : -elW / 2; }
    else { anchorLY = isTop ? elH / 2 : -elH / 2; }
    const anchorPX = cx + (anchorLX * cos - anchorLY * sin);
    const anchorPY = cy + (anchorLX * sin + anchorLY * cos);
    rs.current = { startW: elW, startH: elH, startPos, isLeft, isTop, axes, cos, sin, anchorPX, anchorPY };
    const onMove = (me: MouseEvent) => {
      const cur = rs.current;
      const sdx = (me.clientX - cur.startPos.x) / MM_TO_PX / canvasZoom;
      const sdy = (me.clientY - cur.startPos.y) / MM_TO_PX / canvasZoom;
      // 屏幕 delta → 元素本地 delta（考虑旋转）
      const dx = sdx * cur.cos + sdy * cur.sin;
      const dy = -sdx * cur.sin + sdy * cur.cos;
      let nw = cur.startW, nh = cur.startH;
      if (cur.axes === 'both' || cur.axes === 'h') nw = Math.max(MIN_W_MM, cur.startW + (cur.isLeft ? -dx : dx));
      if (cur.axes === 'both' || cur.axes === 'v') nh = Math.max(MIN_H_MM, cur.startH + (cur.isTop ? -dy : dy));
      const nAX = cur.axes === 'v' ? 0 : (cur.isLeft ? nw / 2 : -nw / 2);
      const nAY = cur.axes === 'h' ? 0 : (cur.isTop ? nh / 2 : -nh / 2);
      const ncx = cur.anchorPX - (nAX * cur.cos - nAY * cur.sin);
      const ncy = cur.anchorPY - (nAX * cur.sin + nAY * cur.cos);
      onUpdate({ width: nw, height: nh, x: ncx - nw / 2, y: ncy - nh / 2 }, false);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onUpdate({}, true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const beginRotate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = boxRef.current?.getBoundingClientRect();
    const center = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    const pointer = { x: e.clientX, y: e.clientY };
    rr.current = {
      center,
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI,
      startRotation: el.rotation ?? 0,
    };
    let didMove = false;
    const onMove = (me: MouseEvent) => {
      didMove = true;
      const { center: c, startAngle, startRotation } = rr.current;
      const curAngle = Math.atan2(me.clientY - c.y, me.clientX - c.x) * 180 / Math.PI;
      onUpdate({ rotation: snap(startRotation + (curAngle - startAngle)) }, false);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (didMove) onUpdate({}, true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const corner = (hx: number, hy: number, cursor: string) => (
    <div
      key={`c${hx}-${hy}`}
      onMouseDown={beginResize(hx, hy, 'both')}
      style={{
        position: 'absolute', left: hx - hsz / 2, top: hy - hsz / 2,
        width: hsz, height: hsz, borderRadius: '50%',
        background: '#fff', boxShadow: `0 0 0 ${sw}px #6C63FF`,
        cursor, pointerEvents: 'auto', zIndex: 3,
      }}
    />
  );
  const edge = (hx: number, hy: number, cursor: string, axes: 'h' | 'v') => {
    const isHorz = axes === 'v';
    const w = isHorz ? hsz * 3 : hsz;
    const h = isHorz ? hsz : hsz * 3;
    return (
      <div
        key={`e${hx}-${hy}`}
        onMouseDown={beginResize(hx, hy, axes)}
        style={{
          position: 'absolute', left: hx - w / 2, top: hy - h / 2,
          width: w, height: h, borderRadius: 1,
          background: '#fff', boxShadow: `0 0 0 ${sw}px #6C63FF`,
          cursor, pointerEvents: 'auto', zIndex: 3,
        }}
      />
    );
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: 'absolute',
        left: cx * MM_TO_PX * canvasZoom,
        top: cy * MM_TO_PX * canvasZoom,
        width: 0, height: 0,
        transform: `rotate(${rotation}deg)`,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {/* 编辑态选中虚线框（与非编辑态 Konva 同源：紫色虚线） */}
      <div style={{ position: 'absolute', left: -pw / 2, top: -ph / 2, width: pw, height: ph, border: `${sw}px dashed #6C63FF`, pointerEvents: 'none' }} />
      {/* 8 方向控制点 */}
      {corner(-pw / 2, -ph / 2, 'nw-resize')}
      {corner(pw / 2, -ph / 2, 'ne-resize')}
      {corner(-pw / 2, ph / 2, 'sw-resize')}
      {corner(pw / 2, ph / 2, 'se-resize')}
      {edge(0, -ph / 2, 'n-resize', 'v')}
      {edge(0, ph / 2, 's-resize', 'v')}
      {edge(-pw / 2, 0, 'w-resize', 'h')}
      {edge(pw / 2, 0, 'e-resize', 'h')}
      {/* 旋转手柄（白色圆底 + ↻，以中心点旋转，15° 吸附） */}
      <div style={{ position: 'absolute', left: -sw, top: ph / 2, width: sw * 2, height: ICON_OFFSET, background: '#6C63FF', pointerEvents: 'none' }} />
      <div
        onMouseDown={beginRotate}
        style={{
          position: 'absolute', left: -ICON_SIZE / 2, top: ph / 2 + ICON_OFFSET,
          width: ICON_SIZE, height: ICON_SIZE, borderRadius: '50%',
          background: '#fff', boxShadow: '0 0 0 1px rgba(108,99,255,0.3), 0 2px 8px rgba(0,0,0,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'grab', pointerEvents: 'auto', zIndex: 3,
          fontSize: 14, color: '#6C63FF', userSelect: 'none',
        }}
        onMouseEnter={() => { document.body.style.cursor = 'grab'; }}
        onMouseLeave={() => { document.body.style.cursor = ''; }}
      >
        ↻
      </div>
    </div>
  );
}

export const TextEditHandles = memo(TextEditHandlesImpl);