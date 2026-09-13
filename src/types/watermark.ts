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

/** 默认开启时间水印（激活用户）；未激活走 license 强制关闭，不产生未授权显示。地点精细度默认「详细」。 */
export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  enabled: true,
  showDate: true,
  showLocation: true,
  includeModified: true,
  locationGranularity: 'detailed',
};