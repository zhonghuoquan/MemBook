/* ═══════════════════════════════════════
   框选 + 组合缩放引擎
   支持：框选矩形检测 → 包围盒计算 → 等比缩放变换
   ═══════════════════════════════════════ */

export interface SlotRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** 框选命中检测：完全包含 */
export function hitTestMarquee(
  marquee: { x1: number; y1: number; x2: number; y2: number },
  slot: SlotRect,
): boolean {
  const mx1 = Math.min(marquee.x1, marquee.x2);
  const my1 = Math.min(marquee.y1, marquee.y2);
  const mx2 = Math.max(marquee.x1, marquee.x2);
  const my2 = Math.max(marquee.y1, marquee.y2);
  return slot.x >= mx1 && slot.x + slot.width <= mx2 && slot.y >= my1 && slot.y + slot.height <= my2;
}

/** 计算多重选槽位的包围盒 */
export function computeBBox(slots: SlotRect[], _pageW: number, _pageH: number): BBox | null {
  if (slots.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of slots) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x + s.width > maxX) maxX = s.x + s.width;
    if (s.y + s.height > maxY) maxY = s.y + s.height;
  }
  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/** 控制点锚点类型 */
export type AnchorHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/** 控制点位置（基于包围盒） */
export const ANCHORS: { key: AnchorHandle; x: 'min' | 'mid' | 'max'; y: 'min' | 'mid' | 'max' }[] = [
  { key: 'nw', x: 'min', y: 'min' },
  { key: 'n', x: 'mid', y: 'min' },
  { key: 'ne', x: 'max', y: 'min' },
  { key: 'w', x: 'min', y: 'mid' },
  { key: 'e', x: 'max', y: 'mid' },
  { key: 'sw', x: 'min', y: 'max' },
  { key: 's', x: 'mid', y: 'max' },
  { key: 'se', x: 'max', y: 'max' },
];

/** 根据锚点类型计算固定原点（对点/对边） */
function getScaleOrigin(bbox: BBox, handle: AnchorHandle): { x: number; y: number } {
  switch (handle) {
    case 'nw': return { x: bbox.maxX, y: bbox.maxY };
    case 'n':  return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.maxY };
    case 'ne': return { x: bbox.minX, y: bbox.maxY };
    case 'w':  return { x: bbox.maxX, y: (bbox.minY + bbox.maxY) / 2 };
    case 'e':  return { x: bbox.minX, y: (bbox.minY + bbox.maxY) / 2 };
    case 'sw': return { x: bbox.maxX, y: bbox.minY };
    case 's':  return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY };
    case 'se': return { x: bbox.minX, y: bbox.minY };
  }
}

/** 是否等比缩放（角点拖拽） */
export function isUniformScale(handle: AnchorHandle): boolean {
  return handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se';
}

/** 计算缩放后的槽位 */
export function computeScaledSlots(
  slots: SlotRect[],
  bbox: BBox,
  handle: AnchorHandle,
  newMouseX: number,  // 逻辑坐标
  newMouseY: number,
  pageW: number,
  pageH: number,
  minSize: number = 30,
): SlotRect[] | null {
  const origin = getScaleOrigin(bbox, handle);

  // 水平缩放比
  const oldDX = handle.includes('e') ? bbox.width : (handle.includes('w') ? -bbox.width : 0);
  const newDX = newMouseX - origin.x;
  let scaleX = oldDX !== 0 ? newDX / oldDX : 1;
  if (scaleX < 0.05) scaleX = 0.05;

  // 垂直缩放比
  const oldDY = handle.includes('s') ? bbox.height : (handle.includes('n') ? -bbox.height : 0);
  const newDY = newMouseY - origin.y;
  let scaleY = oldDY !== 0 ? newDY / oldDY : 1;
  if (scaleY < 0.05) scaleY = 0.05;

  // 边拖拽：仅对应轴缩放
  if (handle === 'e' || handle === 'w') scaleY = 1;
  else if (handle === 'n' || handle === 's') scaleX = 1;
  // 角点拖拽：XY 独立缩放（非等比），不做 uniform 约束

  const result: SlotRect[] = [];
  for (const s of slots) {
    const newX = origin.x + (s.x - origin.x) * scaleX;
    const newY = origin.y + (s.y - origin.y) * scaleY;
    let newW = s.width * Math.abs(scaleX);
    let newH = s.height * Math.abs(scaleY);
    if (newW < minSize) newW = minSize;
    if (newH < minSize) newH = minSize;

    // 不超出页面
    if (newX + newW > pageW) newW = pageW - newX;
    if (newY + newH > pageH) newH = pageH - newY;
    if (newW < minSize) return null;
    if (newH < minSize) return null;

    result.push({ id: s.id, x: Math.round(newX * 100) / 100, y: Math.round(newY * 100) / 100, width: Math.round(newW * 100) / 100, height: Math.round(newH * 100) / 100 });
  }
  return result;
}

/** 计算整体移动后的槽位 */
export function computeMovedSlots(
  slots: SlotRect[],
  dx: number,
  dy: number,
): SlotRect[] {
  return slots.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
}
