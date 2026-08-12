import type { EditorSlice, SelectionSlice } from './types';

/* ── 选区管理 slice ──
 * 多选协议：
 *   - Ctrl+click 元素 → toggleMultiSelect({type, id})
 *   - 普通点击元素 → 先 clearMultiSelect，再设置对应 selectedXxxId
 *   - 点击空白 → clearSelection（清空所有单选+多选）
 *   - multiSelectedElements.length >= 2 时为多选模式，各 selectedXxxId 应为 null
 *   - 框选仍使用 multiSelectedSlots（仅槽位），与 multiSelectedElements 并存
 */
export const createSelectionSlice: EditorSlice<SelectionSlice> = (set, get) => ({
  selectedSlotId: null,
  selectedPhotoId: null,
  multiSelectedSlots: [],
  selectedTextId: null,
  selectedStickyId: null,
  selectedStickerId: null,
  selectedShapeId: null,
  multiSelectedElements: [],
  // 单选严格跨类型互斥：选中任一元素时，清空其他类型的单选 + 所有多选
  setSelectedSlot: (slotId) => set({
    selectedSlotId: slotId,
    selectedTextId: null,
    selectedStickyId: null,
    selectedStickerId: null,
    selectedShapeId: null,
    multiSelectedSlots: [],
    multiSelectedElements: [],
  }),
  setSelectedPhoto: (photoId) => set({ selectedPhotoId: photoId }),
  setMultiSelectedSlots: (slots) => set({ multiSelectedSlots: slots, selectedSlotId: null }),
  setSelectedTextId: (id) => set({
    selectedTextId: id,
    selectedSlotId: null,
    selectedStickyId: null,
    selectedStickerId: null,
    selectedShapeId: null,
    multiSelectedElements: [],
  }),
  setSelectedStickyId: (id) => set({
    selectedStickyId: id,
    selectedSlotId: null,
    selectedTextId: null,
    selectedStickerId: null,
    selectedShapeId: null,
    multiSelectedElements: [],
  }),
  setSelectedStickerId: (id) => set({
    selectedStickerId: id,
    selectedSlotId: null,
    selectedTextId: null,
    selectedStickyId: null,
    selectedShapeId: null,
    multiSelectedElements: [],
  }),
  setSelectedShapeId: (id) => set({
    selectedShapeId: id,
    selectedSlotId: null,
    selectedTextId: null,
    selectedStickyId: null,
    selectedStickerId: null,
    multiSelectedElements: [],
  }),
  /** Ctrl+click 切换多选：
   *  首次多选时，将当前单选元素也加入 multiSelectedElements，再 toggle 新元素
   *  这样用户 Ctrl+click 第二个元素时，第一个不会丢失
   */
  toggleMultiSelect: (element) => {
    const state = get();
    let list = [...state.multiSelectedElements];

    // 若多选列表为空，先将当前单选元素加入（保证第一个选中的不丢失）
    if (list.length === 0) {
      if (state.selectedSlotId) list.push({ type: 'slot', id: state.selectedSlotId });
      else if (state.selectedTextId) list.push({ type: 'text', id: state.selectedTextId });
      else if (state.selectedStickyId) list.push({ type: 'sticky', id: state.selectedStickyId });
      else if (state.selectedStickerId) list.push({ type: 'sticker', id: state.selectedStickerId });
      else if (state.selectedShapeId) list.push({ type: 'shape', id: state.selectedShapeId });
    }

    // toggle 目标元素
    const idx = list.findIndex((e) => e.type === element.type && e.id === element.id);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(element);
    }

    // 若 toggle 后只剩 0 或 1 个元素，回退到单选模式
    if (list.length === 0) {
      set({ multiSelectedElements: [], selectedSlotId: null, selectedTextId: null, selectedStickyId: null, selectedStickerId: null, selectedShapeId: null });
    } else if (list.length === 1) {
      const only = list[0];
      const patch: Partial<SelectionSlice> = { multiSelectedElements: [] };
      if (only.type === 'slot') { patch.selectedSlotId = only.id; patch.selectedTextId = null; patch.selectedStickyId = null; patch.selectedStickerId = null; patch.selectedShapeId = null; }
      else if (only.type === 'text') { patch.selectedTextId = only.id; patch.selectedSlotId = null; patch.selectedStickyId = null; patch.selectedStickerId = null; patch.selectedShapeId = null; }
      else if (only.type === 'sticky') { patch.selectedStickyId = only.id; patch.selectedSlotId = null; patch.selectedTextId = null; patch.selectedStickerId = null; patch.selectedShapeId = null; }
      else if (only.type === 'sticker') { patch.selectedStickerId = only.id; patch.selectedSlotId = null; patch.selectedTextId = null; patch.selectedStickyId = null; patch.selectedShapeId = null; }
      else if (only.type === 'shape') { patch.selectedShapeId = only.id; patch.selectedSlotId = null; patch.selectedTextId = null; patch.selectedStickyId = null; patch.selectedStickerId = null; }
      set(patch);
    } else {
      // 多选模式：清空所有单选字段
      set({
        multiSelectedElements: list,
        selectedSlotId: null,
        selectedTextId: null,
        selectedStickyId: null,
        selectedStickerId: null,
        selectedShapeId: null,
        multiSelectedSlots: [],
      });
    }
  },
  setMultiSelectedElements: (elements) => set({
    multiSelectedElements: elements,
    selectedSlotId: null,
    selectedTextId: null,
    selectedStickyId: null,
    selectedStickerId: null,
    selectedShapeId: null,
    multiSelectedSlots: [],
  }),
  clearMultiSelect: () => set({ multiSelectedElements: [] }),
  clearSelection: () => set({
    multiSelectedSlots: [],
    multiSelectedElements: [],
    selectedSlotId: null,
    selectedPhotoId: null,
    selectedTextId: null,
    selectedStickyId: null,
    selectedStickerId: null,
    selectedShapeId: null,
  }),
});
