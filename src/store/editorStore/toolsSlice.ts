import { DEFAULT_BRUSH_SETTINGS } from '../../types';
import type { EditorSlice, ToolsSlice } from './types';

/* ── 工具模式 slice ── */
export const createToolsSlice: EditorSlice<ToolsSlice> = (set) => ({
  /* ── 工具模式 ── */
  activeTool: 'none',
  brushSettings: DEFAULT_BRUSH_SETTINGS,
  /* 自动编辑信号：ToolsPanel 添加文字后通知 Canvas 打开内联编辑器 */
  pendingTextEditId: null,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setBrushSettings: (patch) => set((s) => ({ brushSettings: { ...s.brushSettings, ...patch } })),
  setPendingTextEditId: (id) => set({ pendingTextEditId: id }),
});
