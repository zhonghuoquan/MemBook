/**
 * MemBook — 应用配置常量集中管理
 *
 * 将散落在各文件中的硬编码配置值统一到此处，
 * 方便修改参数、切换环境。
 */

/** 逆地理编码 API */
export const GEOCODE_API_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
export const GEOCODE_TIMEOUT_MS = 10000;

/** 照片导入并发控制 */
export const IMPORT_CONCURRENCY = 4;
export const EXIF_CONCURRENCY = 12;
export const GEOCODE_CONCURRENCY = 6;
export const SAVE_BATCH_SIZE = 20;

/** HEIC 转换 */
export const HEIC_CONCURRENCY = 2;
export const HEIC_CONVERT_TIMEOUT_MS = 30000;

/** 导出预加载并发 */
export const EXPORT_PRELOAD_CONCURRENCY = 6;

/** 底部导航栏高度范围 (px) */
export const MIN_NAV_HEIGHT = 90;
export const MAX_NAV_HEIGHT = 280;

/** 左侧面板宽度范围 (px) */
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 640;

/** 正常用户项目数量限制 */
export const NORMAL_PROJECT_LIMIT = 3;

/** 自动保存延迟 (ms) */
export const AUTO_SAVE_DELAY_MS = 5000;

/** 照片预览最大宽度 (px) */
export const MAX_PREVIEW_WIDTH = 2400;

/** localStorage 键名 */
export const STORAGE_KEYS = {
  CURRENT_PROJECT_ID: 'membook_current_project_id',
  BOTTOM_NAV_HEIGHT: 'membook-bottom-nav-height',
  PANEL_WIDTH: 'membook-panel-width',
  LICENSE: 'membook-license-v1',
  MACHINE_ID: 'membook-machine-id',
  THEME: 'membook-theme',
  FLYOUT_COLLAPSED: 'membook_flyout_collapsed',
  /** 照片整理：已打开的路径标签（仅元信息，用于跨页面恢复） */
  ORGANIZE_TABS: 'membook-organize-tabs-v1',
  /** 照片整理：最近打开过的路径历史（最多 10 个，用于快捷重开） */
  ORGANIZE_HISTORY: 'membook-organize-history-v1',
} as const;
