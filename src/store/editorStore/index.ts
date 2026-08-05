import { create } from 'zustand';
import type { EditorState } from './types';
import { createSelectionSlice } from './selectionSlice';
import { createPageSlice } from './pageSlice';
import { createPlacementSlice } from './placementSlice';
import { createAlbumMetaSlice } from './albumMetaSlice';
import { createToolsSlice } from './toolsSlice';
import { createDecorationsSlice } from './decorationsSlice';
import { createWatermarkSlice } from './watermarkSlice';

// 重新导出辅助函数/常量，保持外部 API 兼容
export { calcSlotPixelSize, reclampPagePlacements, makePlacementMigrator, buildRegenPageData, dirtyMarginPageIds } from './helpers';
// 重新导出类型，便于外部使用
export type { EditorState } from './types';

export const useEditorStore = create<EditorState>()((...a) => ({
  ...createSelectionSlice(...a),
  ...createPageSlice(...a),
  ...createPlacementSlice(...a),
  ...createAlbumMetaSlice(...a),
  ...createToolsSlice(...a),
  ...createDecorationsSlice(...a),
  ...createWatermarkSlice(...a),
}));
