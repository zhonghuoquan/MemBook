/**
 * 照片"落位动效"标记（模块级 Set，零依赖）
 *
 * 背景：CanvasPhotoRenderer 用 Konva.Tween 播放照片的 Q 弹入场动画（从透明+缩小弹到目标位）。
 *   触发开关是模块级 justPlacedKeys（key = `${slotId}-${photoId}`）。
 * 抽出为独立零依赖模块，供两条路径共用，避免 services 层反向依赖大组件：
 *   - useDragDrop：从照片列表拖照片到照片位（drop 成功后标记）
 *   - pageLayoutService：随机重排 / 拖动换位后，对换到新槽的照片打标，让重排也复用同一落位动效
 */

const justPlacedKeys = new Set<string>();

/** 标记某照片刚被放置到某槽位（将在 CanvasPhotoRenderer 渲染时触发 Q 弹落位动画） */
export function markPhotoJustPlaced(slotId: string, photoId: string): void {
  justPlacedKeys.add(`${slotId}-${photoId}`);
}

/** 消费标记（动画完成后调用，避免重复触发） */
export function consumePhotoJustPlaced(key: string): void {
  justPlacedKeys.delete(key);
}

/** 查询某照片在指定槽位是否处于"刚被放置"状态 */
export function hasPhotoJustPlaced(slotId: string, photoId: string): boolean {
  return justPlacedKeys.has(`${slotId}-${photoId}`);
}