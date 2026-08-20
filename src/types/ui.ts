/* ============================================================
   MemBook — 编辑器状态 / 存储 / 历史 / Toast 类型
   ============================================================ */

import type { AlbumPage } from './photo';

/* ── 编辑器状态 ── */
export type ViewMode = 'single' | 'grid' | 'fullscreen';
export type PanelTab = 'photos' | 'templates' | 'theme' | 'tools' | 'market' | 'stickers' | 'covers';
export type EditTab = 'crop' | 'adjust' | 'filter' | 'rotate';
export type HomeTab = 'create' | 'albums' | 'templates' | 'organize' | 'stickers' | 'covers';

export type BottomNavState = 'expanded' | 'collapsed';

/* ── 存储模式 (PRD 1.4 双轨策略) ── */
export type StorageMode = 'direct' | 'import';
export const STORAGE_MODE_KEY = 'membook-storage-mode';
export const STORAGE_HANDLE_KEY = 'membook-direct-handle';
export const DEFAULT_SLOT_CORNER_RADIUS = 5; // 默认槽位圆角 px

/* ── 历史状态 ── */
export type HistoryEntry = {
  timestamp: number;
  pages: AlbumPage[];
  selectedSlotId: string | null;
};

/* ── Toast ── */
export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type Toast = {
  id: string;
  type: ToastType;
  message: string;
};