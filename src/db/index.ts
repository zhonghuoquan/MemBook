/**
 * MemBook — IndexedDB 持久化层
 * 基于 Dexie.js 实现项目保存/加载/列表
 */
import Dexie, { type Table } from 'dexie';
import type { AlbumProject, Photo, CustomTemplate, SlotLayout } from '../types';

class MemBookDB extends Dexie {
  projects!: Table<AlbumProject, string>;
  photos!: Table<Photo, string>;
  customTemplates!: Table<CustomTemplate, string>;

  constructor() {
    super('MemBookDB');
    this.version(2).stores({
      projects: 'id, name, createdAt, updatedAt',
      photos: 'id, albumId, date',
      customTemplates: 'id, name, createdAt',
    });
  }
}

let db: MemBookDB | null = null;

function getDB(): MemBookDB {
  if (!db) {
    db = new MemBookDB();
  }
  return db;
}

/* ── Project CRUD ── */

export async function saveProject(project: AlbumProject): Promise<void> {
  const db = getDB();
  await db.projects.put({
    ...project,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadProject(id: string): Promise<AlbumProject | undefined> {
  const db = getDB();
  return db.projects.get(id);
}

export async function deleteProject(id: string): Promise<void> {
  const db = getDB();
  await db.projects.delete(id);
}

export async function listProjects(): Promise<AlbumProject[]> {
  const db = getDB();
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function saveCurrentProject(): Promise<string> {
  const { useEditorStore } = await import('../store');
  const { pages } = useEditorStore.getState();
  const id = `project-${Date.now()}`;
  const project: AlbumProject = {
    id,
    name: '我的相册',
    size: { id: 'v-210', name: '竖版', width: 210, height: 280, desc: '210×280 mm · 标准竖版' },
    pages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveProject(project);
  localStorage.setItem('membook_current_project_id', id);
  return id;
}

/**
 * 创建新项目并持久化
 * @returns 项目 ID
 */
export async function createAndSaveProject(
  name: string,
  size: AlbumProject['size'],
  pages: AlbumProject['pages'],
): Promise<string> {
  const id = `project-${Date.now()}`;
  const now = new Date().toISOString();
  const project: AlbumProject = {
    id,
    name: name || '未命名相册',
    size,
    pages,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(project);
  localStorage.setItem('membook_current_project_id', id);
  return id;
}

/* ── Custom Template CRUD ── */

export async function saveCustomTemplate(template: CustomTemplate): Promise<void> {
  const db = getDB();
  await db.customTemplates.put({
    ...template,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadCustomTemplate(id: string): Promise<CustomTemplate | undefined> {
  const db = getDB();
  return db.customTemplates.get(id);
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = getDB();
  await db.customTemplates.delete(id);
}

export async function listCustomTemplates(): Promise<CustomTemplate[]> {
  const db = getDB();
  return db.customTemplates.orderBy('createdAt').reverse().toArray();
}

export async function createCustomTemplate(
  name: string,
  slots: SlotLayout[],
): Promise<string> {
  const id = `custom-template-${Date.now()}`;
  const now = new Date().toISOString();
  const template: CustomTemplate = {
    id,
    name: name || '未命名模板',
    slots,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await saveCustomTemplate(template);
  return id;
}

/* ── Photo CRUD ── */

export async function savePhotos(photos: Photo[]): Promise<void> {
  const db = getDB();
  // 清除旧照片再写入
  await db.photos.clear();
  if (photos.length > 0) {
    await db.photos.bulkPut(photos);
  }
}

export async function loadPhotos(): Promise<Photo[]> {
  const db = getDB();
  return db.photos.toArray();
}

/* ── Auto-save helper ── */

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutoSave(delayMs = 5000): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      const { useEditorStore } = await import('../store');
      const { pages } = useEditorStore.getState();
      if (pages.length > 0) {
        const projectId = localStorage.getItem('membook_current_project_id');
        if (projectId) {
          const existing = await loadProject(projectId);
          if (existing) {
            await saveProject({ ...existing, pages, updatedAt: new Date().toISOString() });
          }
        }
      }
    } catch {
      // silent auto-save failure
    }
  }, delayMs);
}
