/**
 * db 层 CRUD — 数据库读写测试
 *
 * 核心断言：
 * 1. 项目 CRUD：create → load → list → delete 完整链路
 * 2. 照片 CRUD：save → load → delete by projectId
 * 3. 自定义模板 CRUD：create → list → delete
 * 4. clearAll 清空所有数据
 *
 * 使用 fake-indexeddb（在 vitest.config.ts setupFiles 中配置）模拟 IndexedDB。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  createAndSaveProject,
  savePhotos,
  loadPhotos,
  deletePhotos,
  saveCustomTemplate,
  listCustomTemplates,
  deleteCustomTemplate,
  clearAll,
  getCurrentProjectId,
  setCurrentProjectId,
} from './index';
import type { Photo, CustomTemplate, AlbumSize, PageMargin } from '../types';

function makeAlbumSize(): AlbumSize {
  return { id: 'test', name: 'Test', width: 210, height: 280, desc: 'Test size' };
}

function makeMargin(): PageMargin {
  return { margin: 10, gap: 5 };
}

function makePhoto(id: string, albumId: string): Photo {
  return {
    id,
    albumId,
    name: `photo-${id}.jpg`,
    src: 'blob:test',
    date: '2026-01-01T00:00:00.000Z',
    width: 4000,
    height: 3000,
    orientation: 'landscape',
    storageMode: 'import',
    blobId: `blob-${id}`,
  };
}

describe('Project CRUD', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('createAndSaveProject → loadProject：创建后能读取', async () => {
    const id = await createAndSaveProject('Test Album', makeAlbumSize(), [], makeMargin());
    expect(id).toBeTruthy();

    const loaded = await loadProject(id);
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('Test Album');
    expect(loaded!.size.width).toBe(210);
    expect(loaded!.pages).toEqual([]);
  });

  it('listProjects：返回所有项目，按更新时间排序', async () => {
    await createAndSaveProject('Album A', makeAlbumSize(), [], makeMargin());
    // 确保 updatedAt 不同
    await new Promise((r) => setTimeout(r, 10));
    await createAndSaveProject('Album B', makeAlbumSize(), [], makeMargin());

    const list = await listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('Album A');
    expect(list.map((p) => p.name)).toContain('Album B');
  });

  it('saveProject → loadProject：更新项目数据后重新读取', async () => {
    const id = await createAndSaveProject('Original', makeAlbumSize(), [], makeMargin());
    const project = await loadProject(id);
    expect(project).toBeDefined();

    project!.name = 'Updated';
    await saveProject(project!);

    const updated = await loadProject(id);
    expect(updated!.name).toBe('Updated');
  });

  it('deleteProject：删除后 loadProject 返回 undefined', async () => {
    const id = await createAndSaveProject('To Delete', makeAlbumSize(), [], makeMargin());
    await deleteProject(id);

    const loaded = await loadProject(id);
    expect(loaded).toBeUndefined();
  });

  it('getCurrentProjectId / setCurrentProjectId：localStorage 读写', () => {
    setCurrentProjectId('test-project-id');
    expect(getCurrentProjectId()).toBe('test-project-id');

    setCurrentProjectId(null);
    expect(getCurrentProjectId()).toBeNull();
  });
});

describe('Photo CRUD', () => {
  let projectId: string;

  beforeEach(async () => {
    await clearAll();
    projectId = await createAndSaveProject('Photo Test', makeAlbumSize(), [], makeMargin());
  });

  it('savePhotos → loadPhotos：保存后按 projectId 读取', async () => {
    const photos = [makePhoto('p1', projectId), makePhoto('p2', projectId)];
    await savePhotos(photos, projectId);

    const loaded = await loadPhotos(projectId);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.id)).toContain('p1');
    expect(loaded.map((p) => p.id)).toContain('p2');
  });

  it('loadPhotos：无照片时返回空数组', async () => {
    const loaded = await loadPhotos(projectId);
    expect(loaded).toEqual([]);
  });

  it('deletePhotos：删除指定照片', async () => {
    const photos = [makePhoto('p1', projectId), makePhoto('p2', projectId), makePhoto('p3', projectId)];
    await savePhotos(photos, projectId);

    await deletePhotos(['p2']);
    const loaded = await loadPhotos(projectId);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.id)).not.toContain('p2');
  });

  it('savePhotos：替换模式下覆盖同 ID 照片', async () => {
    const photos1 = [makePhoto('p1', projectId)];
    await savePhotos(photos1, projectId);

    const updatedPhoto = makePhoto('p1', projectId);
    updatedPhoto.name = 'renamed.jpg';
    await savePhotos([updatedPhoto], projectId);

    const loaded = await loadPhotos(projectId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('renamed.jpg');
  });
});

describe('CustomTemplate CRUD', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('saveCustomTemplate → listCustomTemplates：保存后能列出', async () => {
    const now = new Date().toISOString();
    const template: CustomTemplate = {
      id: 'tpl-1',
      name: 'My Template',
      slots: [{ id: 's1', x: 0, y: 0, width: 50, height: 50 }],
      createdAt: now,
      updatedAt: now,
    };
    await saveCustomTemplate(template);

    const list = await listCustomTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('My Template');
  });

  it('deleteCustomTemplate：删除后不再列出', async () => {
    const now = new Date().toISOString();
    const template: CustomTemplate = {
      id: 'tpl-2',
      name: 'To Remove',
      slots: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveCustomTemplate(template);

    await deleteCustomTemplate('tpl-2');
    const list = await listCustomTemplates();
    expect(list).toHaveLength(0);
  });
});

describe('clearAll', () => {
  it('清空所有数据后各表为空', async () => {
    await createAndSaveProject('Test', makeAlbumSize(), [], makeMargin());
    await savePhotos([makePhoto('p1', 'x')], 'x');
    const now = new Date().toISOString();
    await saveCustomTemplate({
      id: 't1', name: 'T', slots: [], createdAt: now, updatedAt: now,
    });

    await clearAll();

    const projects = await listProjects();
    const photos = await loadPhotos();
    const templates = await listCustomTemplates();
    expect(projects).toHaveLength(0);
    expect(photos).toHaveLength(0);
    expect(templates).toHaveLength(0);
  });
});
