import type { AlbumPage, SlotOverride } from '../types';
import { useEditorStore } from '../store/editorStore';
import { usePhotoStore } from '../store/photoStore';
import { calcMarginOverrides, reclampPage } from '../store/editorStore/helpers';

/**
 * 页面边距协调服务：把边距重算与照片约束逻辑中对 photoStore 的依赖下沉到服务层，
 * 使 editorStore 的 slice 不再直接/间接依赖 photoStore。
 */
export const pageMarginService = {
  /**
   * 计算指定页面应用当前边距/间距后的新 slotOverrides，并返回重新约束后的页面副本。
   * 不写入 Store，仅返回计算结果供调用方使用。
   */
  calcMarginForPage(
    pageIndex: number,
    pages: AlbumPage[],
  ): { overrides: Record<string, SlotOverride>; newPage: AlbumPage } | null {
    const editorState = useEditorStore.getState();
    const photos = usePhotoStore.getState().photos;
    const page = pages[pageIndex];
    if (!page || !editorState.albumSize) return null;

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
