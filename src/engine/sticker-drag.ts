/* ═══════════════════════════════════
   贴纸拖拽管理器
   与照片 drag-manager 平行的轻量拖拽系统，
   用于从 StickerPanel 拖拽贴纸到画布工作区。
   ═══════════════════════════════════ */

export type StickerDragState = {
  stickerId: string;     // 贴纸记录 ID（关联 stickers 表）
  blobId: string;        // 贴纸图片 Blob ID
  dataURL: string;       // 拖拽预览用的 dataURL（已加载的缩略图）
  width: number;         // 贴纸原始像素宽（用于计算默认尺寸宽高比）
  height: number;        // 贴纸原始像素高
  clientX: number;
  clientY: number;
  offsetX: number;       // 点击点相对贴纸卡片左上角的偏移
  offsetY: number;
  active: boolean;
};

export const stickerDragState: StickerDragState = {
  stickerId: '',
  blobId: '',
  dataURL: '',
  width: 0,
  height: 0,
  clientX: 0,
  clientY: 0,
  offsetX: 0,
  offsetY: 0,
  active: false,
};

let listeners: Array<(s: StickerDragState) => void> = [];

export function onStickerDragStateChange(fn: (s: StickerDragState) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function notify() {
  for (const fn of listeners) fn({ ...stickerDragState });
}

export function startStickerDrag(
  stickerId: string,
  blobId: string,
  dataURL: string,
  width: number,
  height: number,
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number,
) {
  stickerDragState.stickerId = stickerId;
  stickerDragState.blobId = blobId;
  stickerDragState.dataURL = dataURL;
  stickerDragState.width = width;
  stickerDragState.height = height;
  stickerDragState.clientX = clientX;
  stickerDragState.clientY = clientY;
  stickerDragState.offsetX = offsetX;
  stickerDragState.offsetY = offsetY;
  stickerDragState.active = true;
  notify();
}

export function updateStickerDrag(clientX: number, clientY: number) {
  if (!stickerDragState.active) return;
  stickerDragState.clientX = clientX;
  stickerDragState.clientY = clientY;
  notify();
}

/** 结束拖拽，返回贴纸拖拽数据（active 期间才有值）
 *  可传入 mouseup 的最终坐标，确保 Canvas drop 检测使用真实释放位置
 *  （而非最后一次 mousemove 的位置，避免快速拖拽到面板释放时坐标滞后） */
export function endStickerDrag(clientX?: number, clientY?: number): StickerDragState | null {
  if (!stickerDragState.active) return null;
  if (clientX !== undefined) stickerDragState.clientX = clientX;
  if (clientY !== undefined) stickerDragState.clientY = clientY;
  const data = { ...stickerDragState };
  stickerDragState.active = false;
  notify();
  stickerDragState.stickerId = '';
  stickerDragState.blobId = '';
  stickerDragState.dataURL = '';
  stickerDragState.width = 0;
  stickerDragState.height = 0;
  return data;
}

/** 当前是否正在拖拽贴纸 */
export function isStickerDragging(): boolean {
  return stickerDragState.active;
}
