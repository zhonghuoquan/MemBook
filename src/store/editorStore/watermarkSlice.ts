import { DEFAULT_WATERMARK_SETTINGS } from '../../types';
import { pushSnapshot } from './helpers';
import type { EditorSlice, WatermarkSlice } from './types';

/* ── 水印 slice ── */
export const createWatermarkSlice: EditorSlice<WatermarkSlice> = (set, get) => ({
  /* ── 水印设置 ── */
  watermarkSettings: DEFAULT_WATERMARK_SETTINGS,
  setWatermarkSettings: (settings) => set({ watermarkSettings: settings }),

  /* ── 单页水印覆盖 ── */
  setPageWatermarkTextOverride: (pageIndex, text) => {
    set((s) => {
      const pages = [...s.pages];
      const page = pages[pageIndex];
      if (!page) return s;
      pages[pageIndex] = { ...page, watermarkTextOverride: text };
      return { pages };
    });
    pushSnapshot(get);
  },
  resetPageWatermark: (pageIndex) => {
    set((s) => {
      const pages = [...s.pages];
      const page = pages[pageIndex];
      if (!page) return s;
      pages[pageIndex] = { ...page, watermarkTextOverride: null };
      return { pages };
    });
    pushSnapshot(get);
  },
  setPageWatermarkHidden: (pageIndex, hidden) => {
    set((s) => {
      const pages = [...s.pages];
      const page = pages[pageIndex];
      if (!page) return s;
      pages[pageIndex] = { ...page, watermarkHidden: hidden };
      return { pages };
    });
    pushSnapshot(get);
  },
});
