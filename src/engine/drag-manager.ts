/* ═══════════════════════════════════
   自定义拖拽管理器
   替代 HTML5 Drag and Drop，兼容 Tauri WebView2
   支持单张或多张照片同时拖拽
   ═══════════════════════════════════ */

export type DragState = {
  photoIds: string[];    // 拖拽中的照片ID列表（按选中顺序）
  clientX: number;
  clientY: number;
  offsetX: number;   // 点击点相对照片左上角的偏移
  offsetY: number;
  active: boolean;
};

export const dragState: DragState = {
  photoIds: [],
  clientX: 0,
  clientY: 0,
  offsetX: 0,
  offsetY: 0,
  active: false,
};

let listeners: Array<(s: DragState) => void> = [];

export function onDragStateChange(fn: (s: DragState) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function notify() {
  for (const fn of listeners) fn({ ...dragState, photoIds: [...dragState.photoIds] });
}

export function startDrag(photoIds: string[], clientX: number, clientY: number, offsetX: number, offsetY: number) {
  dragState.photoIds = photoIds;
  dragState.clientX = clientX;
  dragState.clientY = clientY;
  dragState.offsetX = offsetX;
  dragState.offsetY = offsetY;
  dragState.active = true;
  // 拖拽期间禁用文本选中：给 <html> 加 .is-dragging 类
  // globals.css 中 html.is-dragging * { user-select: none !important } 覆盖所有子元素
  // 之前的 document.body.style.userSelect 不继承到子元素，macOS 仍出现紫色高亮
  document.documentElement.classList.add('is-dragging');
  notify();
}

export function updateDrag(clientX: number, clientY: number) {
  if (!dragState.active) return;
  dragState.clientX = clientX;
  dragState.clientY = clientY;
  notify();
}

export function endDrag(): string[] {
  const ids = [...dragState.photoIds];
  dragState.active = false;
  // 恢复文本选中
  document.documentElement.classList.remove('is-dragging');
  notify();
  dragState.photoIds = [];
  return ids;
}
