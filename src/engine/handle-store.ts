/**
 * MemBook — 持久化存储句柄 & 照片 Blob
 *
 * - FileSystemDirectoryHandle 无法直接存入 localStorage，
 *   因此使用 IndexedDB 提供的 IDBFS-like 存储。
 * - 照片 Blob 也存入 IndexedDB 供 import 模式使用。
 */

import type { FSADirectoryHandle } from './storage/fsa-types';

const DB_NAME = 'MemBookStorage';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result;
      if (!store.objectStoreNames.contains('handles')) {
        store.createObjectStore('handles', { keyPath: 'key' });
      }
      if (!store.objectStoreNames.contains('blobs')) {
        store.createObjectStore('blobs', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/* ── Directory Handle ── */

/** 保存目录句柄 (用 IndexedDB 持久化) */
export async function setDirectHandle(handle: FSADirectoryHandle): Promise<void> {
  const d = await openDB();
  const tx = d.transaction('handles', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = tx.objectStore('handles').put({
      key: 'directory',
      handle,
      timestamp: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 读取已保存的目录句柄 */
export async function getDirectHandle(): Promise<FSADirectoryHandle | null> {
  try {
    const d = await openDB();
    const tx = d.transaction('handles', 'readonly');
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('handles').get('directory');
      req.onsuccess = () => resolve(req.result?.handle ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/* ── Photo Blobs (Import 模式) ── */

/** 保存照片 Blob 到 IndexedDB */
export async function savePhotoBlob(id: string, blob: Blob): Promise<void> {
  await savePhotoBlobs([{ id, blob }]);
}

/** 批量保存照片 Blob 到 IndexedDB（同一事务，性能更好） */
export async function savePhotoBlobs(items: { id: string; blob: Blob }[]): Promise<void> {
  if (items.length === 0) return;
  const d = await openDB();
  const tx = d.transaction('blobs', 'readwrite');
  return new Promise((resolve, reject) => {
    const now = Date.now();
    for (const { id, blob } of items) {
      tx.objectStore('blobs').put({ id, blob, createdAt: now });
    }
    // 必须在事务提交后才 resolve，否则后续读取可能看不到数据
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 读取已保存的照片 Blob */
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    const d = await openDB();
    const tx = d.transaction('blobs', 'readonly');
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => resolve(req.result?.blob ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** 删除一张照片 Blob */
export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    const d = await openDB();
    const tx = d.transaction('blobs', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('blobs').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}
