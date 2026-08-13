import type { AlbumPage, SlotOverride, AlbumSize } from '../types';
import { resolveTemplate, isCoverPage, isBackCoverPage } from '../types';
import { useEditorStore } from '../store/editorStore';
import { usePhotoStore } from '../store/photoStore';
import { calcMarginOverrides, reclampPage } from '../store/editorStore/helpers';

/** mm → 像素转换因子（与 canvas/constants.ts 的 MM_TO_PX 保持一致） */
const MM_TO_PX = 2;

/**
 * 页面边距协调服务：把边距重算与照片约束逻辑中对 photoStore 的依赖下沉到服务层，
 * 使 editorStore 的 slice 不再直接/间接依赖 photoStore。
 */
export const pageMarginService = {
  /**
   * 计算指定页面应用当前边距/间距后的新 slotOverrides，并返回重新约束后的页面副本。
   * 不写入 Store，仅返回计算结果供调用方使用。
   *
   * 封面/封底页特殊处理：不应用 pageMargin，直接按模板百分比 × 整页像素生成 slotOverrides。
   * 原因：封面模板自带布局设计（含书脊 + 预设文字/形状），预设元素用整页尺寸转换（mm），
   * 若 slots 被 pageMargin 内缩会导致与预设元素坐标系不一致，位置错乱。
   */
  calcMarginForPage(
    pageIndex: number,
    pages: AlbumPage[],
  ): { overrides: Record<string, SlotOverride>; newPage: AlbumPage } | null {
    const editorState = useEditorStore.getState();
    const photos = usePhotoStore.getState().photos;
    const page = pages[pageIndex];
    if (!page || !editorState.albumSize) return null;

    // 封面/封底页：跳过 pageMargin，按整页像素直接转换
    if (isCoverPage(page) || isBackCoverPage(page)) {
      return calcCoverOverrides(page, editorState.albumSize);
    }

    const overrides = calcMarginOverrides(pageIndex, () => editorState, photos);
    if (!overrides) return null;

    const newPage = reclampPage({ ...page, slotOverrides: overrides }, () => editorState, photos);
    return { overrides, newPage };
  },

  /**
   * 直接对 Store 中的指定页面应用边距重算与约束。
   */
  applyMarginToPage(pageIndex: number): void {
    const { pages, setPages } = useEditorStore.getState();
    const result = this.calcMarginForPage(pageIndex, pages);
    if (!result) return;
    const newPages = [...pages];
    newPages[pageIndex] = result.newPage;
    setPages(newPages);
  },
};

/**
 * 封面/封底页的槽位坐标转换：按模板百分比 × 整页像素直接生成 slotOverrides。
 * 不应用 pageMargin，与预设文字/形状的坐标系（整页 mm × MM_TO_PX = 整页像素）保持一致。
 */
function calcCoverOverrides(
  page: AlbumPage,
  albumSize: AlbumSize,
): { overrides: Record<string, SlotOverride>; newPage: AlbumPage } | null {
  const template = resolveTemplate(page);
  if (!template) return null;
  const canvasW = albumSize.width * MM_TO_PX;
  const canvasH = albumSize.height * MM_TO_PX;
  const overrides: Record<string, SlotOverride> = {};
  for (const slot of template.slots) {
    overrides[slot.id] = {
      x: (slot.x / 100) * canvasW,
      y: (slot.y / 100) * canvasH,
      width: (slot.width / 100) * canvasW,
      height: (slot.height / 100) * canvasH,
    };
  }
  return { overrides, newPage: { ...page, slotOverrides: overrides } };
}
