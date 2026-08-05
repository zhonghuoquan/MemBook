import { describe, it, expect, beforeEach } from 'vitest';
import { usePhotoStore } from './photoStore';
import type { Photo } from '../types';

function makePhoto(id: string, name: string = id): Photo {
  return {
    id,
    src: `blob:${id}`,
    name,
    date: '2026-01-01T00:00:00.000Z',
    width: 100,
    height: 100,
    orientation: 'landscape',
    fileSize: 1024,
    storageMode: 'import',
  };
}

describe('photoStore', () => {
  beforeEach(() => {
    // 每个用例前重置 store
    usePhotoStore.getState().setPhotos([]);
  });

  it('初始状态：空数组 + 空 Map + 空脏标记', () => {
    const s = usePhotoStore.getState();
    expect(s.photos).toEqual([]);
    expect(s.photoMap.size).toBe(0);
    expect(s.dirtyIds).toEqual([]);
  });

  it('addPhotos：追加照片，同步 photoMap，标记为脏', () => {
    const p1 = makePhoto('p1');
    const p2 = makePhoto('p2');
    usePhotoStore.getState().addPhotos([p1, p2]);
    const s = usePhotoStore.getState();
    expect(s.photos).toHaveLength(2);
    expect(s.photoMap.get('p1')).toBe(p1);
    expect(s.photoMap.get('p2')).toBe(p2);
    expect(s.dirtyIds).toEqual(['p1', 'p2']);
  });

  it('addPhotos：保留已有照片，不替换', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    const p2 = makePhoto('p2');
    usePhotoStore.getState().addPhotos([p2]);
    const s = usePhotoStore.getState();
    expect(s.photos).toEqual([p1, p2]);
    expect(s.photoMap.size).toBe(2);
    expect(s.dirtyIds).toEqual(['p1', 'p2']);
  });

  it('updatePhoto：更新字段，photoMap 与 photos 同步', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    usePhotoStore.getState().updatePhoto('p1', { name: 'updated' });
    const s = usePhotoStore.getState();
    expect(s.photos[0].name).toBe('updated');
    expect(s.photoMap.get('p1')?.name).toBe('updated');
    // 引用不可变：photoMap 中的对象与 photos 中的应是同一对象
    expect(s.photoMap.get('p1')).toBe(s.photos[0]);
  });

  it('updatePhoto：不存在的 ID 返回原状态', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    const before = usePhotoStore.getState();
    usePhotoStore.getState().updatePhoto('not-exist', { name: 'x' });
    const after = usePhotoStore.getState();
    // 状态应不变（同一个引用）
    expect(after).toBe(before);
  });

  it('updatePhoto：重复更新同一 ID 只标记一次脏', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    // dirtyIds 已含 p1
    usePhotoStore.getState().updatePhoto('p1', { name: 'a' });
    usePhotoStore.getState().updatePhoto('p1', { name: 'b' });
    const s = usePhotoStore.getState();
    expect(s.dirtyIds.filter((id) => id === 'p1')).toHaveLength(1);
  });

  it('_removePhotoLocal：移除照片，清理 photoMap 与脏标记', () => {
    const p1 = makePhoto('p1');
    const p2 = makePhoto('p2');
    usePhotoStore.getState().addPhotos([p1, p2]);
    usePhotoStore.getState()._removePhotoLocal('p1');
    const s = usePhotoStore.getState();
    expect(s.photos).toHaveLength(1);
    expect(s.photos[0].id).toBe('p2');
    expect(s.photoMap.has('p1')).toBe(false);
    expect(s.photoMap.get('p2')).toBe(p2);
    expect(s.dirtyIds).toEqual(['p2']);
  });

  it('_removePhotoLocal：不存在的 ID 无副作用', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    usePhotoStore.getState()._removePhotoLocal('not-exist');
    const s = usePhotoStore.getState();
    expect(s.photos).toHaveLength(1);
    expect(s.photoMap.size).toBe(1);
  });

  it('_removePhotosLocal：批量移除', () => {
    const p1 = makePhoto('p1');
    const p2 = makePhoto('p2');
    const p3 = makePhoto('p3');
    usePhotoStore.getState().addPhotos([p1, p2, p3]);
    usePhotoStore.getState()._removePhotosLocal(['p1', 'p3']);
    const s = usePhotoStore.getState();
    expect(s.photos).toEqual([p2]);
    expect(s.photoMap.size).toBe(1);
    expect(s.photoMap.has('p1')).toBe(false);
    expect(s.photoMap.has('p3')).toBe(false);
    expect(s.dirtyIds).toEqual(['p2']);
  });

  it('_removePhotosLocal：空数组无副作用', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    usePhotoStore.getState()._removePhotosLocal([]);
    expect(usePhotoStore.getState().photos).toHaveLength(1);
  });

  it('setPhotos：全量替换，重建 photoMap，清空脏标记', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    const p2 = makePhoto('p2');
    const p3 = makePhoto('p3');
    usePhotoStore.getState().setPhotos([p2, p3]);
    const s = usePhotoStore.getState();
    expect(s.photos).toEqual([p2, p3]);
    expect(s.photoMap.size).toBe(2);
    expect(s.photoMap.get('p2')).toBe(p2);
    expect(s.photoMap.get('p3')).toBe(p3);
    expect(s.photoMap.has('p1')).toBe(false);
    expect(s.dirtyIds).toEqual([]);
  });

  it('setPhotos：空数组清空一切', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    usePhotoStore.getState().setPhotos([]);
    const s = usePhotoStore.getState();
    expect(s.photos).toEqual([]);
    expect(s.photoMap.size).toBe(0);
    expect(s.dirtyIds).toEqual([]);
  });

  it('clearDirtyIds：仅移除指定 ID', () => {
    const p1 = makePhoto('p1');
    const p2 = makePhoto('p2');
    const p3 = makePhoto('p3');
    usePhotoStore.getState().addPhotos([p1, p2, p3]);
    usePhotoStore.getState().clearDirtyIds(['p1', 'p3']);
    expect(usePhotoStore.getState().dirtyIds).toEqual(['p2']);
  });

  it('clearDirtyIds：保存期间新产生的脏标记保留', () => {
    const p1 = makePhoto('p1');
    usePhotoStore.getState().addPhotos([p1]);
    // 模拟保存开始
    const savingIds = [...usePhotoStore.getState().dirtyIds];
    // 保存期间又产生了新的脏标记
    const p2 = makePhoto('p2');
    usePhotoStore.getState().addPhotos([p2]);
    // 保存完成，仅清除保存开始时记录的 ID
    usePhotoStore.getState().clearDirtyIds(savingIds);
    expect(usePhotoStore.getState().dirtyIds).toEqual(['p2']);
  });

  it('photoMap 与 photos 一致性：add + update + remove 混合操作后仍保持同步', () => {
    const p1 = makePhoto('p1');
    const p2 = makePhoto('p2');
    usePhotoStore.getState().addPhotos([p1, p2]);
    usePhotoStore.getState().updatePhoto('p1', { width: 200 });
    usePhotoStore.getState()._removePhotoLocal('p2');
    const p3 = makePhoto('p3');
    usePhotoStore.getState().addPhotos([p3]);
    const s = usePhotoStore.getState();
    // photos 与 photoMap 必须一致
    expect(s.photos.map((p) => p.id)).toEqual(['p1', 'p3']);
    for (const p of s.photos) {
      expect(s.photoMap.get(p.id)).toBe(p);
    }
    expect(s.photoMap.size).toBe(s.photos.length);
  });
});
