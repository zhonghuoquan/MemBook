/**
 * MemBook — IndexedDB 持久化层
 * 基于 Dexie.js 实现项目保存/加载/列表
 */
import Dexie, { type Table } from 'dexie';
import type { AlbumProject, AlbumPage, Photo, CustomTemplate, SlotLayout, PageMargin, AlbumGuideLine } from '../types';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT, isCoverPage } from '../types';
import { SPINE_GAP_MM, MM_TO_PX } from '../components/editor/canvas/constants';
import { logger } from '../utils/logger';
import { isTauri } from '../utils/tauri';
import { STORAGE_KEYS } from '../config/appConfig';
import { savePhotoBlob, getPhotoBlob, deletePhotoBlob } from '../engine/handle-store';

/**
 * P2-1：磁盘缩略图缓存记录。
 * 持久化页面缩略图 dataURL，跨重载复用，避免 100+ 页重新渲染。
 * key 为基于页面内容 + 照片尺寸的稳定哈希，内容变化自然产生新 key，
 * 旧 key 成为孤儿，由 saveThumbnail 保存新记录时按 pageId 清理。
 */
export interface ThumbnailRecord {
  /** 内容哈希键（稳定，跨重载一致） */
  key: string;
  /** 页面 ID，用于按页清理孤儿记录 */
  pageId: string;
  /** 缩略图 dataURL（PNG） */
  dataURL: string;
  /** 创建时间戳，用于全局 LRU 淘汰 */
  createdAt: number;
}

/**
 * 贴纸记录（用户上传的贴纸图片元数据）。
 * 图片 Blob 复用 MemBookStorage 的 blobs 表（与照片 Blob 共用存储），
 * 通过 blobId 关联，实现永久保存与跨重载复用。
 */
export interface StickerRecord {
  id: string;
  name: string;
  blobId: string;          // 关联 MemBookStorage.blobs 表中的图片 Blob
  category: string;        // 分类（目前固定为 'custom'，预留扩展）
  width: number;           // 图片原始像素宽度（用于计算默认尺寸的宽高比）
  height: number;          // 图片原始像素高度
  createdAt: string;
  favorite?: boolean;      // 是否收藏（用户标记）
}

class MemBookDB extends Dexie {
  projects!: Table<AlbumProject, string>;
  photos!: Table<Photo, string>;
  customTemplates!: Table<CustomTemplate, string>;
  thumbnails!: Table<ThumbnailRecord, string>;
  stickers!: Table<StickerRecord, string>;

  constructor() {
    super('MemBookDB');
    this.version(3).stores({
      projects: 'id, name, createdAt, updatedAt',
      photos: 'id, albumId, date',
      customTemplates: 'id, name, createdAt',
    }).upgrade((tx) => {
      // 迁移：将没有 albumId 的照片标记为需要重新关联，实际关联在加载项目时完成
      const photosTable = tx.table('photos');
      return photosTable.toCollection().modify((photo) => {
        if (!photo.albumId) {
          photo.albumId = '';
        }
      });
    });
    // P2-1：新增缩略图持久化表（仅声明新表，已有表保持不变）
    this.version(4).stores({
      thumbnails: 'key, pageId, createdAt',
    });
    // 新增贴纸表（仅声明新表，已有表保持不变）
    this.version(5).stores({
      stickers: 'id, name, createdAt, category',
    });
    // 新增 favorite 索引（支持按收藏筛选）
    this.version(6).stores({
      stickers: 'id, name, createdAt, category, favorite',
    });
  }
}

let db: MemBookDB | null = null;

/** 是否已尝试申请持久化存储，避免重复调用 */
let persistentStorageRequested = false;

/** 向浏览器申请持久化存储权限，降低 IndexedDB 被自动清理的风险（仅需调用一次） */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;

    // 若已经是持久化状态，无需再次申请
    const alreadyPersisted = await navigator.storage.persisted().catch(() => false);
    if (alreadyPersisted) {
      logger.info('[db] IndexedDB 已处于持久化状态');
      return;
    }

    const granted = await navigator.storage.persist().catch(() => false);
    if (granted) {
      logger.info('[db] 持久化存储申请成功');
    } else {
      // 仅在首次拒绝时提示，避免每次启动都刷屏
      logger.warn('[db] 持久化存储申请被拒绝，浏览器可能在空间不足时清理数据');
    }
  } catch {
    // 部分浏览器/环境不支持，静默忽略
  }
}

function getDB(): MemBookDB {
  if (!db) {
    db = new MemBookDB();
    if (!persistentStorageRequested) {
      persistentStorageRequested = true;
      requestPersistentStorage();
    }
  }
  return db;
}

/* ── 当前项目 ID（收口管理，替代各处直接读写 localStorage） ── */

const CURRENT_PROJECT_KEY = STORAGE_KEYS.CURRENT_PROJECT_ID;
let currentProjectId: string | null = null;

/** 读取当前项目 ID（优先内存值，回退 localStorage 以兼容页面刷新） */
export function getCurrentProjectId(): string | null {
  if (currentProjectId) return currentProjectId;
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

/** 设置当前项目 ID（内存 + localStorage 双写，供刷新后恢复） */
export function setCurrentProjectId(id: string | null): void {
  currentProjectId = id;
  try {
    if (id) {
      localStorage.setItem(CURRENT_PROJECT_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  } catch { /* ignore */ }
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

/** 批量删除项目 */
export async function deleteProjects(ids: string[]): Promise<void> {
  const db = getDB();
  await db.projects.bulkDelete(ids);
}

/** 生成新的项目/照片 ID */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 批量复制项目（深拷贝项目 + 复制关联照片，名称加"(副本)"） */
export async function duplicateProjects(ids: string[]): Promise<AlbumProject[]> {
  const db = getDB();
  const projects = await db.projects.bulkGet(ids);
  const now = new Date().toISOString();
  const copies: AlbumProject[] = [];
  const photosToSave: Photo[] = [];

  for (const proj of projects) {
    if (!proj) continue;

    const newProjectId = generateId('project');
    const photoIdMap = new Map<string, string>();

    // 复制关联照片：共享 blob，但生成新 ID 并指向新项目
    const originalPhotos = await db.photos.where('albumId').equals(proj.id).toArray();
    const copiedPhotos: Photo[] = [];
    for (const photo of originalPhotos) {
      const newPhotoId = generateId('photo');
      photoIdMap.set(photo.id, newPhotoId);
      copiedPhotos.push({
        ...cleanPhotoForStorage(photo),
        id: newPhotoId,
        albumId: newProjectId,
      });
    }
    photosToSave.push(...copiedPhotos);

    // 深拷贝页面并把其中所有 photoId 替换为新照片 ID
    const newPages = structuredClone(proj.pages).map((page) =>
      replacePhotoIdsInPage(page, photoIdMap)
    );

    const copy: AlbumProject = {
      ...proj,
      pages: newPages,
      id: newProjectId,
      name: `${proj.name} (副本)`,
      createdAt: now,
      updatedAt: now,
    };
    copies.push(copy);
  }

  if (copies.length > 0) {
    await db.projects.bulkPut(copies);
  }
  if (photosToSave.length > 0) {
    await db.photos.bulkPut(photosToSave);
  }
  return copies;
}

/** 替换页面中所有对旧 photoId 的引用（placements 与智能排版相关字段） */
function replacePhotoIdsInPage(
  page: AlbumProject['pages'][number],
  photoIdMap: Map<string, string>,
): AlbumProject['pages'][number] {
  const nextId = (id: string | null) => (id ? photoIdMap.get(id) || id : id);

  const placements = page.placements.map((placement) => ({
    ...placement,
    photoId: nextId(placement.photoId),
  }));

  const googlePhotosMmLayout = page.googlePhotosMmLayout?.map((item) => ({
    ...item,
    photoId: photoIdMap.get(item.photoId) || item.photoId,
  }));

  const googlePhotosBaseMmLayout = page.googlePhotosBaseMmLayout?.map((item) => ({
    ...item,
    photoId: photoIdMap.get(item.photoId) || item.photoId,
  }));

  const googlePhotosInternalRows = page.googlePhotosInternalRows?.map((row) => ({
    ...row,
    photoIds: row.photoIds.map((id) => photoIdMap.get(id) || id),
  }));

  return {
    ...page,
    placements,
    googlePhotosMmLayout,
    googlePhotosBaseMmLayout,
    googlePhotosInternalRows,
  };
}

export async function listProjects(): Promise<AlbumProject[]> {
  const db = getDB();
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

/** 封面间距迁移标记（localStorage），一次性执行后不再重复 */
const COVER_GAP_MIGRATED_KEY = 'membook_cover_spine_gap_migrated';
/**
 * 一次性迁移：旧版封面页的书脊与封面正面之间含 SPINE_GAP_MM 视觉间隙（内容整体右移 书脊+间隙 ），
 * 新版改为印刷一体连续（内容仅右移书脊宽）。对已存在的封面页把封面正面内容左移间隙量，保证与导出一致。
 */
export async function migrateCoverSpineGapOnce(): Promise<void> {
  try {
    const win = typeof window !== 'undefined' ? window : null;
    if (win && win.localStorage.getItem(COVER_GAP_MIGRATED_KEY)) return;
    const db = getDB();
    const projects = await db.projects.toArray();
    let migratedAny = false;
    for (const proj of projects) {
      let changed = false;
      const pages = (proj.pages || []).map((p): AlbumPage => {
        if (!isCoverPage(p) || !(p.spineWidth ?? 0)) return p;
        const spineWidth = p.spineWidth ?? 0;
        const gapPx = SPINE_GAP_MM * MM_TO_PX;
        const np: AlbumPage = {
          ...p,
          textElements: (p.textElements || []).map((el) => (el.x >= spineWidth ? { ...el, x: el.x - SPINE_GAP_MM } : el)),
          shapeElements: (p.shapeElements || []).map((sh) => (sh.x >= spineWidth ? { ...sh, x: sh.x - SPINE_GAP_MM } : sh)),
          stickerElements: (p.stickerElements || []).map((st) => (st.x >= spineWidth ? { ...st, x: st.x - SPINE_GAP_MM } : st)),
          brushStrokes: (p.brushStrokes || []).map((s) => ({
            ...s,
            points: s.points.map((v, i) => (i % 2 === 0 ? v - SPINE_GAP_MM : v)),
          })),
          slotOverrides: p.slotOverrides
            ? (Object.fromEntries(
                Object.entries(p.slotOverrides).map(([id, o]) => [id, { ...o, x: o.x - gapPx }]),
              ) as AlbumPage['slotOverrides'])
            : undefined,
        };
        changed = true;
        return np;
      });
      if (changed) {
        await db.projects.update(proj.id, { pages, updatedAt: proj.updatedAt });
        migratedAny = true;
      }
    }
    if (migratedAny && win) win.localStorage.setItem(COVER_GAP_MIGRATED_KEY, '1');
  } catch (err) {
    logger.warn('[migrate] 封面间距迁移失败', err);
  }
}

export async function saveCurrentProject(data: {
  pages: AlbumProject['pages'];
  albumSize: AlbumProject['size'];
  projectName: string;
}): Promise<string> {
  const { pages, albumSize, projectName } = data;
  const id = `project-${Date.now()}`;
  const project: AlbumProject = {
    id,
    name: projectName || '我的相册',
    size: albumSize || { id: 'v-210', name: '竖版', width: 210, height: 280, desc: '210×280 mm · 标准竖版' },
    margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT },
    pages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveProject(project);
  setCurrentProjectId(id);
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
  margin?: PageMargin,
  albumType?: AlbumProject['albumType'],
  description?: AlbumProject['description'],
): Promise<string> {
  const id = `project-${Date.now()}`;
  const now = new Date().toISOString();
  const project: AlbumProject = {
    id,
    name: name || '未命名相册',
    size,
    margin: margin || { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT },
    pages,
    createdAt: now,
    updatedAt: now,
    albumType,
    description: description?.trim() || undefined,
  };
  await saveProject(project);
  setCurrentProjectId(id);
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
  const t = await db.customTemplates.get(id);
  return t ? normalizeCustomTemplate(t) : undefined;
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = getDB();
  await db.customTemplates.delete(id);
}

/* 兼容旧数据：DB 中可能存在缺 slots/name 的脏记录，读取时统一归一化 */
function normalizeCustomTemplate(t: CustomTemplate): CustomTemplate {
  return {
    ...t,
    name: t.name ?? '未命名布局',
    slots: Array.isArray(t.slots) ? t.slots : [],
  };
}

export async function listCustomTemplates(): Promise<CustomTemplate[]> {
  const db = getDB();
  const list = await db.customTemplates.orderBy('createdAt').reverse().toArray();
  return list.filter((t) => t != null).map(normalizeCustomTemplate);
}

export async function createCustomTemplate(
  name: string,
  slots: SlotLayout[],
): Promise<string> {
  const id = `custom-template-${Date.now()}`;
  const now = new Date().toISOString();
  const template: CustomTemplate = {
    id,
    name: name || '未命名布局',
    slots,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await saveCustomTemplate(template);
  return id;
}

/* ── Photo CRUD ── */

/** 清理照片对象中不能持久化的 blob URL */
function cleanPhotoForStorage(p: Photo): Photo {
  // 封面预设照片：src 为打包静态资源（coverLandscape），直接持久化保留，重新进入时无需 blob 恢复
  if (p.isCoverPreset) return p;
  if (p.storageMode === 'direct' && p.relativePath) {
    return { ...p, src: p.relativePath };
  }
  if (p.storageMode === 'import') {
    return { ...p, src: '' };
  }
  return p;
}

export async function savePhotos(photos: Photo[], projectId: string): Promise<void> {
  const db = getDB();
  if (!projectId) throw new Error('savePhotos 需要提供 projectId');
  // 安全：先写新数据再删旧数据，避免写入失败导致数据丢失
  const cleanPhotos = photos.map((p) => cleanPhotoForStorage({ ...p, albumId: projectId }));
  if (cleanPhotos.length > 0) {
    await db.photos.bulkPut(cleanPhotos);
  }
  // 写入成功后，删除不属于当前项目的旧照片
  const newIds = new Set(cleanPhotos.map((p) => p.id));
  const oldPhotos = await db.photos.where('albumId').equals(projectId).toArray();
  const toDelete = oldPhotos.filter((p) => !newIds.has(p.id)).map((p) => p.id);
  if (toDelete.length > 0) {
    await db.photos.bulkDelete(toDelete);
  }
  // 验证写入成功
  const saved = await db.photos.where('albumId').equals(projectId).count();
  if (saved !== cleanPhotos.length) {
    logger.warn(`savePhotos: 期望 ${cleanPhotos.length} 条，实际写入 ${saved} 条`);
  }
}

/** 增量保存：只写入新增/变更的照片，不清除 */
export async function savePhotoChanges(photos: Photo[], projectId?: string): Promise<void> {
  const db = getDB();
  if (photos.length === 0) return;
  const cleanPhotos = photos.map((p) => {
    const withId = projectId ? { ...p, albumId: projectId } : p;
    return cleanPhotoForStorage(withId);
  });
  await db.photos.bulkPut(cleanPhotos);
}

/** 批量删除照片记录 */
export async function deletePhotos(ids: string[]): Promise<void> {
  const db = getDB();
  if (ids.length === 0) return;
  await db.photos.bulkDelete(ids);
}

export async function loadPhotos(projectId?: string): Promise<Photo[]> {
  const db = getDB();
  if (!projectId) {
    return db.photos.toArray();
  }
  // 优先加载属于当前项目的照片；为空时降级加载无 albumId 的旧数据（迁移兼容）
  const projectPhotos = await db.photos.where('albumId').equals(projectId).toArray();
  if (projectPhotos.length > 0) return projectPhotos;
  const legacyPhotos = await db.photos.where('albumId').equals('').toArray();
  if (legacyPhotos.length > 0) {
    // 将旧数据关联到当前项目并写回
    const migrated = legacyPhotos.map((p) => ({ ...p, albumId: projectId }));
    await db.photos.bulkPut(migrated);
    return migrated;
  }
  return [];
}

/** 清空所有数据表（projects / photos / customTemplates） */
export async function clearAll(): Promise<void> {
  const db = getDB();
  await db.projects.clear();
  await db.photos.clear();
  await db.customTemplates.clear();
  await db.thumbnails.clear();
  await db.stickers.clear();
}

/* ── Sticker CRUD ── */

/**
 * 保存贴纸：将图片 Blob 写入 MemBookStorage.blobs，元数据写入 Dexie stickers 表。
 * @returns 新贴纸 ID
 */
export async function saveSticker(sticker: {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  category?: string;
}): Promise<string> {
  const db = getDB();
  const blobId = `sticker-blob-${sticker.id}`;
  await savePhotoBlob(blobId, sticker.blob);
  const record: StickerRecord = {
    id: sticker.id,
    name: sticker.name,
    blobId,
    category: sticker.category ?? 'custom',
    width: sticker.width,
    height: sticker.height,
    createdAt: new Date().toISOString(),
  };
  await db.stickers.put(record);
  return sticker.id;
}

/** 更新贴纸记录（部分字段），用于收藏切换、重命名等 */
export async function updateSticker(id: string, patch: Partial<StickerRecord>): Promise<void> {
  const db = getDB();
  const rec = await db.stickers.get(id);
  if (!rec) return;
  await db.stickers.put({ ...rec, ...patch });
}

/** 重命名贴纸 */
export async function renameSticker(id: string, name: string): Promise<void> {
  await updateSticker(id, { name });
}

/** 切换贴纸收藏状态 */
export async function toggleStickerFavorite(id: string): Promise<boolean> {
  const db = getDB();
  const rec = await db.stickers.get(id);
  if (!rec) return false;
  const next = !rec.favorite;
  await db.stickers.put({ ...rec, favorite: next });
  return next;
}

/** 获取所有贴纸（按创建时间倒序） */
export async function listStickers(): Promise<StickerRecord[]> {
  const db = getDB();
  const list = await db.stickers.orderBy('createdAt').reverse().toArray();
  return list.filter((s) => s != null);
}

/** 删除贴纸（同时删除关联的图片 Blob，并清理所有页面中引用该贴纸的孤儿元素）
 *
 * 修复 P1-4：原实现只删除 stickers 表记录和 blob，未扫描 projects 表的
 *  stickerElements 数组，导致引用该贴纸的页面元素残留，显示空白虚线框。
 *  现在在删除贴纸记录后，遍历所有项目所有页面，filter 掉孤儿引用。
 *
 *  注意：此函数直接操作 DB，不经过 zustand store，因此调用方需要在删除后
 *  通知 store 重新加载页面，或在 store 层封装调用。当前调用方（StickerPanel/
 *  StickerGallery）删除后只刷新贴纸列表，不重载页面——为避免 UI 残留，
 *  调用方应在删除后若当前编辑器打开着引用该贴纸的项目，需触发页面重载。
 *  这里通过返回受影响的项目 ID 列表，让调用方决定是否重载。
 */
export async function deleteSticker(id: string): Promise<string[]> {
  const db = getDB();
  const rec = await db.stickers.get(id);
  if (rec?.blobId) {
    await deletePhotoBlob(rec.blobId);
  }
  await db.stickers.delete(id);

  // 扫描所有项目，清理引用该贴纸的孤儿 stickerElements
  const affectedProjectIds: string[] = [];
  const allProjects = await db.projects.toArray();
  for (const project of allProjects) {
    if (!project.pages?.length) continue;
    let modified = false;
    const newPages = project.pages.map((page) => {
      if (!page.stickerElements?.length) return page;
      const filtered = page.stickerElements.filter((s) => s.stickerId !== id);
      if (filtered.length !== page.stickerElements.length) {
        modified = true;
        return { ...page, stickerElements: filtered };
      }
      return page;
    });
    if (modified) {
      await db.projects.put({ ...project, pages: newPages, updatedAt: new Date().toISOString() });
      affectedProjectIds.push(project.id);
    }
  }
  return affectedProjectIds;
}

/** 读取贴纸图片为 object URL（供 <img>/Konva.Image 使用） */
export async function readStickerBlobUrl(blobId: string): Promise<string | null> {
  const blob = await getPhotoBlob(blobId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/* ── P2-1: Thumbnail 持久化缓存 CRUD ── */

/** 磁盘缩略图缓存全局条目上限，超出时按 createdAt 淘汰最旧条目 */
const THUMBNAIL_DB_MAX_ENTRIES = 400;

/** 读取单条缩略图缓存 */
export async function getThumbnail(key: string): Promise<string | null> {
  try {
    const db = getDB();
    const rec = await db.thumbnails.get(key);
    return rec?.dataURL ?? null;
  } catch (err) {
    logger.warn('[db] getThumbnail 失败:', err);
    return null;
  }
}

/**
 * 保存缩略图缓存。
 * 同时清理同一 pageId 的孤儿记录（内容变化产生的旧 key），
 * 以及全局超出上限时的最旧条目。
 */
export async function saveThumbnail(
  key: string,
  pageId: string,
  dataURL: string,
): Promise<void> {
  try {
    const db = getDB();
    await db.transaction('rw', db.thumbnails, async () => {
      await db.thumbnails.put({ key, pageId, dataURL, createdAt: Date.now() });
      // 清理同 pageId 的孤儿记录（key 不同的旧版本）
      const stale = await db.thumbnails
        .where('pageId')
        .equals(pageId)
        .and((r) => r.key !== key)
        .primaryKeys();
      if (stale.length > 0) {
        await db.thumbnails.bulkDelete(stale);
      }
      // 全局上限淘汰：超出时按 createdAt 升序删除最旧条目
      const total = await db.thumbnails.count();
      if (total > THUMBNAIL_DB_MAX_ENTRIES) {
        const overflow = total - THUMBNAIL_DB_MAX_ENTRIES;
        const oldest = await db.thumbnails.orderBy('createdAt').limit(overflow).primaryKeys();
        if (oldest.length > 0) {
          await db.thumbnails.bulkDelete(oldest);
        }
      }
    });
  } catch (err) {
    logger.warn('[db] saveThumbnail 失败:', err);
  }
}

/** 清空全部缩略图缓存（模板色板变更等全局失效时调用） */
export async function clearAllThumbnails(): Promise<void> {
  try {
    const db = getDB();
    await db.thumbnails.clear();
  } catch (err) {
    logger.warn('[db] clearAllThumbnails 失败:', err);
  }
}

/* ── Auto-save helper ── */

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** 自动保存数据提供者（由调用方注入，避免 DB 层逆向依赖 store） */
type AutoSaveDataProvider = () => {
  pages: AlbumProject['pages'];
  photos: Photo[];
  /** 相册级参考线（随自动保存持久化） */
  guideLines: AlbumGuideLine[];
  /** 待持久化的脏照片 ID（增量保存，避免每次全量写 photos 表） */
  dirtyPhotoIds: string[];
  /** 保存成功后清除已持久化的脏标记（仅清除本次快照的 ID） */
  clearDirtyPhotoIds: (ids: string[]) => void;
};

let autoSaveProvider: AutoSaveDataProvider | null = null;

/** 自动保存状态回调（由 UI 层注入：连续失败时提示用户，恢复成功时清除提示） */
type AutoSaveStatusHandler = (failing: boolean, error?: unknown) => void;

let autoSaveStatusHandler: AutoSaveStatusHandler | null = null;
let consecutiveFailures = 0;

/** 注册自动保存状态回调（在编辑器初始化时调用一次） */
export function setAutoSaveStatusHandler(handler: AutoSaveStatusHandler | null): void {
  autoSaveStatusHandler = handler;
  if (!handler) consecutiveFailures = 0;
}

/** 注册自动保存的数据提供者（在编辑器初始化时调用一次） */
export function setAutoSaveProvider(provider: AutoSaveDataProvider | null): void {
  autoSaveProvider = provider;
}

/* ── Tauri 桌面端：自动保存成功后写一份 JSON 快照到应用数据目录，作为灾难恢复兜底 ── */

const SNAPSHOT_INTERVAL_MS = 60_000;
let lastSnapshotAt = 0;

async function writeProjectSnapshot(projectId: string, project: AlbumProject, photos: Photo[]): Promise<void> {
  try {
    if (!isTauri()) return;
    const now = Date.now();
    if (now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotAt = now;
    const [{ appDataDir }, { mkdir, writeFile }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const dir = `${await appDataDir()}backups`;
    await mkdir(dir, { recursive: true });
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      project,
      photos,
    });
    await writeFile(`${dir}/${projectId}.snapshot.json`, new TextEncoder().encode(payload));
  } catch (err) {
    logger.warn('[snapshot] 写入项目快照失败:', err);
  }
}

export function scheduleAutoSave(delayMs = 5000): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      if (!autoSaveProvider) return;
      const { pages, photos, guideLines, dirtyPhotoIds, clearDirtyPhotoIds } = autoSaveProvider();
      if (pages.length > 0) {
        const projectId = getCurrentProjectId();
        if (projectId) {
          const existing = await loadProject(projectId);
          const updated: AlbumProject | null = existing
            ? { ...existing, pages, guideLines, updatedAt: new Date().toISOString() }
            : null;
          if (updated) {
            await saveProject(updated);
          }
          // 照片增量保存：只写脏记录，避免每次全量写 photos 表。
          // 删除由 removePhoto 即时持久化；全量兜底由手动保存/返回主页的 savePhotos 完成。
          if (dirtyPhotoIds.length > 0) {
            const dirtySet = new Set(dirtyPhotoIds);
            const dirtyPhotos = photos.filter((p) => dirtySet.has(p.id));
            if (dirtyPhotos.length > 0) {
              await savePhotoChanges(dirtyPhotos, projectId);
            }
            clearDirtyPhotoIds(dirtyPhotoIds);
          }
          // 保存成功：清零失败计数、恢复 UI 提示，并异步写灾难恢复快照
          if (consecutiveFailures > 0) {
            consecutiveFailures = 0;
            autoSaveStatusHandler?.(false);
          }
          if (updated) {
            void writeProjectSnapshot(projectId, updated, photos.map((p) => cleanPhotoForStorage(p)));
          }
        }
      }
    } catch (err) {
      // 自动保存失败不中断用户操作；连续失败时通知 UI 层提示用户手动备份
      consecutiveFailures += 1;
      logger.warn(`[autoSave] 自动保存失败（连续 ${consecutiveFailures} 次）:`, err);
      if (consecutiveFailures >= 3) {
        autoSaveStatusHandler?.(true, err);
      }
    }
  }, delayMs);
}
