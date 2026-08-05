import { create } from 'zustand';
import type { Photo } from '../types';

/* ── Photo Store (照片库) ──
 * 注意：照片删除的跨域协调（清理页面引用、blob、IndexedDB）已下沉到 photoService。
 * Store 中仅保留本地状态更新，避免 Store 之间的双向依赖。
 *
 * P2-3：新增 photoMap 索引（Map<id, Photo>），与 photos 数组原子同步维护。
 *   - photos: Photo[] 仍为权威数据源，保持插入顺序，所有现有消费者无需改动
 *   - photoMap: Map<string, Photo> 为派生索引，提供 O(1) 按 ID 查找
 *   - 收益：PageCard 等高频消费者从 find O(n) 降为 get O(1)，
 *           100 页 × 3 照片 × 300 库存的 find 从 9 万次比较降为 300 次 Map 查找
 *   - 每次 mutation 原子更新两者，保证一致性
 */
interface PhotoState {
  photos: Photo[];
  /** O(1) 查找索引：id → Photo，与 photos 数组同步维护 */
  photoMap: Map<string, Photo>;
  /** 待持久化的脏照片 ID（新增/修改时标记，自动保存增量写入后清除） */
  dirtyIds: string[];
  addPhotos: (photos: Photo[]) => void;
  updatePhoto: (id: string, updates: Partial<Photo>) => void;
  /** 内部使用：直接移除照片并清理脏标记，不处理 blob/IndexedDB/页面引用 */
  _removePhotoLocal: (id: string) => void;
  /** 内部使用：批量直接移除照片并清理脏标记，不处理 blob/IndexedDB/页面引用 */
  _removePhotosLocal: (ids: string[]) => void;
  setPhotos: (photos: Photo[]) => void;
  /** 清除已持久化的脏标记（仅移除指定 ID，保存期间新产生的脏标记保留到下一轮） */
  clearDirtyIds: (ids: string[]) => void;
}

/** 从照片数组构建 Map 索引 */
function buildPhotoMap(photos: Photo[]): Map<string, Photo> {
  const map = new Map<string, Photo>();
  for (const p of photos) {
    map.set(p.id, p);
  }
  return map;
}

export const usePhotoStore = create<PhotoState>((set) => ({
  photos: [],
  photoMap: new Map(),
  dirtyIds: [],
  addPhotos: (photos) =>
    set((s) => {
      const newPhotos = [...s.photos, ...photos];
      // 增量更新 Map：仅添加新照片，避免全量重建
      const photoMap = new Map(s.photoMap);
      for (const p of photos) {
        photoMap.set(p.id, p);
      }
      return {
        photos: newPhotos,
        photoMap,
        dirtyIds: [...s.dirtyIds, ...photos.map((p) => p.id)],
      };
    }),
  updatePhoto: (id, updates) =>
    set((s) => {
      const existing = s.photoMap.get(id);
      if (!existing) return s;
      const updated = { ...existing, ...updates };
      // 数组仍需 map 替换以保持引用不可变性（触发订阅者更新）
      const photoMap = new Map(s.photoMap);
      photoMap.set(id, updated);
      return {
        photos: s.photos.map((p) => (p.id === id ? updated : p)),
        photoMap,
        dirtyIds: s.dirtyIds.includes(id) ? s.dirtyIds : [...s.dirtyIds, id],
      };
    }),
  _removePhotoLocal: (id) =>
    set((s) => {
      const photoMap = new Map(s.photoMap);
      photoMap.delete(id);
      return {
        photos: s.photos.filter((p) => p.id !== id),
        photoMap,
        dirtyIds: s.dirtyIds.filter((did) => did !== id),
      };
    }),
  _removePhotosLocal: (ids) => {
    const idSet = new Set(ids);
    set((s) => {
      const photoMap = new Map(s.photoMap);
      for (const id of ids) {
        photoMap.delete(id);
      }
      return {
        photos: s.photos.filter((p) => !idSet.has(p.id)),
        photoMap,
        dirtyIds: s.dirtyIds.filter((did) => !idSet.has(did)),
      };
    });
  },
  // 全量替换仅发生在"从 DB 加载/清空"场景，数据本身干净，直接重置脏标记
  setPhotos: (photos) =>
    set({
      photos,
      photoMap: buildPhotoMap(photos),
      dirtyIds: [],
    }),
  clearDirtyIds: (ids) =>
    set((s) => {
      const saved = new Set(ids);
      return { dirtyIds: s.dirtyIds.filter((id) => !saved.has(id)) };
    }),
}));
