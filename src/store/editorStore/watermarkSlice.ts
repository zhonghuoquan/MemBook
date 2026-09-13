import { DEFAULT_WATERMARK_SETTINGS } from '../../types';
import type { WatermarkSettings } from '../../types';
import { pushSnapshot } from './helpers';
import type { EditorSlice, WatermarkSlice } from './types';

/* ── 水印设置持久化键 ── */
const WATERMARK_SETTINGS_KEY = 'membook_watermark_settings';

/** 启动时从 localStorage 恢复用户保存过的时间水印设置；无保存记录则用默认值 */
function loadWatermarkSettings(): WatermarkSettings {
  try {
    const raw = localStorage.getItem(WATERMARK_SETTINGS_KEY);
    if (!raw) return DEFAULT_WATERMARK_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WATERMARK_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_WATERMARK_SETTINGS;
  }
}

/* ── 水印 slice ── */
export const createWatermarkSlice: EditorSlice<WatermarkSlice> = (set, get) => ({
  /* ── 水印设置 ── */
  watermarkSettings: loadWatermarkSettings(),
  setWatermarkSettings: (settings) => {
    set({ watermarkSettings: settings });
    // 持久化全局水印设置，重启后可恢复用户最后一次的配置
    try {
      localStorage.setItem(WATERMARK_SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
  },

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
