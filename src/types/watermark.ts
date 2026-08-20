/* ============================================================
   MemBook — 水印设置类型
   ============================================================ */

/* ── 水印设置 ── */
export type LocationGranularity = 'coarse' | 'standard' | 'detailed';

export type WatermarkSettings = {
  enabled: boolean;
  showDate: boolean;
  showLocation: boolean;
  includeModified: boolean;
  /** 地点显示精细度：coarse=仅城市，standard=城市+区县，detailed=完整层级 */
  locationGranularity: LocationGranularity;
};

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  enabled: false,
  showDate: true,
  showLocation: true,
  includeModified: true,
  locationGranularity: 'standard',
};