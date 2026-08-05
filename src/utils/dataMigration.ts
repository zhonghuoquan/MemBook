/**
 * MemBook — 数据迁移工具
 *
 * 把 IndexedDB 中的所有数据（项目、照片、模板、照片 blob）打包成 zip
 * 文件；同样支持从 zip 恢复。支持合并导入与路径选择保存。
 *
 * 备份 zip 结构：
 *   manifest.json
 *   projects/*.json
 *   photos/*.json          （不含 file 字段；direct 模式照片在 Tauri 下会额外标记 backupBlobId）
 *   customTemplates/*.json
 *   blobs/<id>.bin         （照片二进制）
 */
import JSZip from 'jszip';
import { listProjects, saveProject, listCustomTemplates, saveCustomTemplate, loadPhotos, savePhotoChanges } from '../db';
import { getPhotoBlob, savePhotoBlob } from '../engine/handle-store';
import { isTauri } from '../engine/storage-engine';
import { APP_VERSION } from '../version';
import type { AlbumProject, AlbumSize, Photo, CustomTemplate } from '../types';
import { logger } from './logger';

const MANIFEST_VERSION = 2;

interface Manifest {
  version: number;
  exportedAt: string;
  appVersion: string;
  counts: {
    projects: number;
    photos: number;
    customTemplates: number;
    blobs: number;
  };
  /** 备份中包含的 direct 模式照片原文件（Tauri 桌面端） */
  directPhotoBackups?: string[];
  /** 导出时的兼容性警告（如浏览器 direct 模式照片无法备份原文件） */
  warnings?: string[];
}

/* ============================================================
   导出
   ============================================================ */

export interface ExportProgress {
  phase: 'projects' | 'photos' | 'templates' | 'blobs' | 'finalize';
  current: number;
  total: number;
  message?: string;
}

export interface ExportOptions {
  /** 仅导出指定项目及其关联照片；不传则导出全部数据（含模板） */
  projectIds?: string[];
  onProgress?: (p: ExportProgress) => void;
}

export interface ExportResult {
  blob: Blob;
  warnings: string[];
}

/** 导出全部或指定项目数据为 zip Blob */
export async function exportAllData(opts: ExportOptions = {}): Promise<ExportResult> {
  const { projectIds, onProgress } = opts;
  const zip = new JSZip();

  // 主页硬编码的占位示例项目 ID，即使被错误写入数据库也不应导出/恢复
  const HARDCODED_DEMO_IDS = new Set(['demo-1', 'demo-2', 'demo-3', 'demo-4']);

  const hasProjectFilter = projectIds && projectIds.length > 0;
  const allProjects = (await listProjects()).filter((p) => !HARDCODED_DEMO_IDS.has(p.id));
  const projects = hasProjectFilter
    ? allProjects.filter((p) => projectIds!.includes(p.id))
    : allProjects;

  // 单项目备份仅包含该项目引用的照片；全局备份包含所有照片
  const allPhotos = await listAllPhotos();
  const relatedPhotoIds = new Set<string>();
  if (hasProjectFilter) {
    for (const proj of projects) {
      for (const page of proj.pages) {
        for (const pl of page.placements) {
          if (pl.photoId) relatedPhotoIds.add(pl.photoId);
        }
      }
    }
  }
  const photos = hasProjectFilter
    ? allPhotos.filter((p) => relatedPhotoIds.has(p.id))
    : allPhotos;

  // 模板是全局资源，仅在全局备份时导出
  const templates = hasProjectFilter ? [] : await listCustomTemplates();

  /* ── 写入 manifest ── */
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts: { projects: projects.length, photos: photos.length, customTemplates: templates.length, blobs: 0 },
    directPhotoBackups: [],
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  /* ── 写入项目 ── */
  const projFolder = zip.folder('projects')!;
  for (let i = 0; i < projects.length; i++) {
    onProgress?.({ phase: 'projects', current: i + 1, total: projects.length, message: `打包项目 ${i + 1}/${projects.length}` });
    projFolder.file(`${safeId(projects[i].id)}.json`, JSON.stringify(projects[i], null, 2));
  }

  /* ── 写入模板 ── */
  const tplFolder = zip.folder('customTemplates')!;
  for (let i = 0; i < templates.length; i++) {
    onProgress?.({ phase: 'templates', current: i + 1, total: templates.length, message: `打包布局 ${i + 1}/${templates.length}` });
    tplFolder.file(`${safeId(templates[i].id)}.json`, JSON.stringify(templates[i], null, 2));
  }

  /* ── 收集需要写入的 blob ── */
  const blobEntries: { id: string; blob: Blob }[] = [];
  const directBackupIds: string[] = [];
  const directWarnings: string[] = [];

  // import 模式照片 blob
  for (const p of photos) {
    if (p.storageMode === 'import') {
      if (p.previewBlobId) blobEntries.push({ id: p.previewBlobId, blob: null! });
      if (p.originalBlobId) blobEntries.push({ id: p.originalBlobId, blob: null! });
      if (p.blobId) blobEntries.push({ id: p.blobId, blob: null! });
    }
  }

  // 去重并按 ID 读取实际 blob
  const blobIdSet = new Map<string, Blob>();
  for (const { id } of blobEntries) {
    if (blobIdSet.has(id)) continue;
    const b = await getPhotoBlob(id);
    if (b) blobIdSet.set(id, b);
  }

  // Tauri 桌面端：尝试把 direct 模式照片的原文件也打包进备份
  if (isTauri()) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    for (const p of photos) {
      if (p.storageMode !== 'direct' || !p.relativePath) continue;
      try {
        const bytes = await readFile(p.relativePath);
        const blob = new Blob([bytes]);
        const backupId = `direct-${p.id}`;
        blobIdSet.set(backupId, blob);
        directBackupIds.push(backupId);
      } catch {
        directWarnings.push(p.name || p.relativePath);
      }
    }
  }

  /* ── 写入照片元数据（在 blob 收集之后，以便写入 backupBlobId） ── */
  const photoFolder = zip.folder('photos')!;
  const photoBackupMap = new Map<string, string>();
  for (const id of directBackupIds) {
    const photo = photos.find((p) => p.storageMode === 'direct' && `direct-${p.id}` === id);
    if (photo) photoBackupMap.set(photo.id, id);
  }

  for (let i = 0; i < photos.length; i++) {
    onProgress?.({ phase: 'photos', current: i + 1, total: photos.length, message: `打包照片 ${i + 1}/${photos.length}` });
    const p = photos[i];
    const { src, file, ...rest } = p as Photo & { file?: unknown };
    void file;
    const backupId = photoBackupMap.get(p.id);

    // 仅对临时的 blob URL 清空 src；保留 data URL、相对路径等持久化可复用的地址
    const isBlobUrl = typeof src === 'string' && src.startsWith('blob:');
    const preservedSrc = isBlobUrl ? '' : (src || '');

    const photoToSave: Photo & { backupBlobId?: string } = backupId
      ? ({ ...rest, backupBlobId: backupId, src: '' } as Photo & { backupBlobId?: string })
      : ({ ...rest, src: preservedSrc } as Photo & { backupBlobId?: string });
    photoFolder.file(`${safeId(p.id)}.json`, JSON.stringify(photoToSave, null, 2));
  }

  /* ── 写入 blob ── */
  const blobFolder = zip.folder('blobs')!;
  const finalBlobEntries = [...blobIdSet.entries()];
  for (let i = 0; i < finalBlobEntries.length; i++) {
    const [id, blob] = finalBlobEntries[i];
    onProgress?.({ phase: 'blobs', current: i + 1, total: finalBlobEntries.length, message: `打包图片 ${i + 1}/${finalBlobEntries.length}` });
    const ext = blob.type?.split('/')[1] || 'jpg';
    blobFolder.file(`${id}.${ext}`, blob);
  }

  manifest.counts.blobs = finalBlobEntries.length;
  manifest.directPhotoBackups = directBackupIds;
  manifest.warnings = [];
  if (directWarnings.length > 0) {
    manifest.counts.photos = Math.max(0, manifest.counts.photos - directWarnings.length);
    manifest.warnings.push(`${directWarnings.length} 张 direct 模式照片原文件未能读取，备份中仅保留引用`);
  }
  if (!isTauri() && photos.some((p) => p.storageMode === 'direct')) {
    manifest.warnings.push('浏览器环境下 direct 模式照片未包含原文件，请在 Tauri 桌面端重新导出以完整备份');
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  onProgress?.({ phase: 'finalize', current: 1, total: 1, message: '正在生成压缩包...' });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, warnings: manifest.warnings || [] };
}

/** 选择保存路径并把 zip 写入磁盘（Tauri）；浏览器环境回退到下载 */
export async function saveBackupFile(blob: Blob, filename: string): Promise<{ path?: string; downloaded: boolean }> {
  try {
    if (isTauri()) {
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        defaultPath: filename,
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
      });
      if (!path) return { downloaded: false };
      const buf = await blob.arrayBuffer();
      await writeFile(path, new Uint8Array(buf));
      return { path, downloaded: true };
    }
  } catch { /* fallback to browser download */ }

  downloadBlob(blob, filename);
  return { downloaded: true };
}

/* ============================================================
   导入
   ============================================================ */

export type MergeMode = 'skip' | 'overwrite' | 'rename';

export interface ImportResult {
  projects: { added: number; skipped: number; overwritten: number };
  photos: { added: number; skipped: number; overwritten: number };
  customTemplates: { added: number; skipped: number; overwritten: number };
  blobs: number;
  errors: string[];
  warnings: string[];
}

export interface ImportProgress {
  phase: 'reading' | 'projects' | 'templates' | 'blobs' | 'photos';
  current: number;
  total: number;
  message?: string;
}

export interface ImportOptions {
  mergeMode?: MergeMode;
  onProgress?: (p: ImportProgress) => void;
}

/** 从 zip Blob 恢复数据，支持合并导入 */
export async function importAllData(zipBlob: Blob, opts: ImportOptions = {}): Promise<ImportResult> {
  const { mergeMode = 'skip', onProgress } = opts;
  const zip = await JSZip.loadAsync(zipBlob);

  onProgress?.({ phase: 'reading', current: 1, total: 1, message: '读取备份文件...' });

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('无效的备份文件：缺少 manifest.json');
  const manifest: Manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.version !== MANIFEST_VERSION) {
    logger.warn(`备份文件版本 ${manifest.version} 与当前 ${MANIFEST_VERSION} 不同，尝试兼容导入`);
  }

  const result: ImportResult = {
    projects: { added: 0, skipped: 0, overwritten: 0 },
    photos: { added: 0, skipped: 0, overwritten: 0 },
    customTemplates: { added: 0, skipped: 0, overwritten: 0 },
    blobs: 0,
    errors: [],
    warnings: [],
  };

  /* ── 预读取当前数据库状态，用于冲突检测 ── */
  const [existingProjects, existingPhotos, existingTemplates] = await Promise.all([
    listProjects().then((arr) => new Map(arr.map((p) => [p.id, p]))),
    loadPhotos().then((arr) => new Map(arr.map((p) => [p.id, p]))),
    listCustomTemplates().then((arr) => new Map(arr.map((t) => [t.id, t]))),
  ]);

  /* ── 辅助：安全读取 zip 文件夹内直接子级 .json 文件 ── */
  async function readFolderFiles<T>(folderName: string): Promise<Array<{ name: string; data: T }>> {
    const folder = zip.folder(folderName);
    if (!folder) return [];
    // JSZip.folder() 仅设置 root，其 .files 仍包含整个 zip 的内容，且 filter()
    // 不会自动按目录前缀过滤。必须显式筛选：
    //   1. 非目录
    //   2. 路径为 folderName/<文件名>.json（直接子级，不含子目录）
    // 否则 manifest.json、photos/*.json 等会被误读为项目，导致空项目。
    const prefix = `${folderName}/`;
    const files = folder.filter((_, file) => {
      if (file.dir) return false;
      if (!file.name.startsWith(prefix)) return false;
      const rest = file.name.slice(prefix.length);
      if (rest.includes('/')) return false;
      return rest.endsWith('.json');
    });
    const entries: Array<{ name: string; data: T }> = [];
    for (const file of files) {
      try {
        const text = await file.async('string');
        entries.push({ name: file.name, data: JSON.parse(text) });
      } catch (e) {
        result.errors.push(`${folderName}/${file.name}: ${(e as Error).message}`);
      }
    }
    return entries;
  }

  /* ── 辅助：校验对象是否为合法项目结构 ── */
  function isValidProject(value: unknown): value is AlbumProject {
    if (!value || typeof value !== 'object') return false;
    const proj = value as Partial<AlbumProject>;
    if (typeof proj.id !== 'string' || proj.id.length === 0) return false;
    if (typeof proj.name !== 'string') return false;
    if (!Array.isArray(proj.pages)) return false;
    if (!proj.size || typeof proj.size !== 'object') return false;
    const size = proj.size as Partial<AlbumSize>;
    if (typeof size.width !== 'number' || typeof size.height !== 'number') return false;
    return true;
  }

  /* ── 通用冲突处理 ── */
  function resolveId<T extends { id: string }>(id: string, name: string, existing: Map<string, T>): { id: string; action: 'add' | 'skip' | 'overwrite' } {
    if (!existing.has(id)) return { id, action: 'add' };
    if (mergeMode === 'skip') return { id, action: 'skip' };
    if (mergeMode === 'overwrite') return { id, action: 'overwrite' };
    // rename：生成新 ID
    const base = id.replace(/-[a-z0-9]+$/, '') || name || id;
    let newId = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    while (existing.has(newId)) {
      newId = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return { id: newId, action: 'add' };
  }

  /* ── 恢复项目 ── */
  // 主页硬编码的占位示例项目 ID，不应从备份恢复（它们不是真实数据）
  const HARDCODED_DEMO_IDS = new Set(['demo-1', 'demo-2', 'demo-3', 'demo-4']);
  // 记录旧项目 ID → 新项目 ID 的映射，用于同步照片 albumId
  const projectIdMap = new Map<string, string>();

  const projEntries = await readFolderFiles<AlbumProject>('projects');
  for (let i = 0; i < projEntries.length; i++) {
    const { data: proj } = projEntries[i];
    onProgress?.({ phase: 'projects', current: i + 1, total: projEntries.length, message: `恢复项目 ${i + 1}/${projEntries.length}` });

    // 跳过硬编码示例项目，避免恢复后出现不可删除的占位卡片
    if (HARDCODED_DEMO_IDS.has(proj.id)) {
      result.projects.skipped++;
      continue;
    }

    // 防御性校验：确保读取到的 JSON 真的是项目结构，避免把照片/模板等误当项目导入
    if (!isValidProject(proj)) {
      result.warnings.push(`跳过非项目文件：${projEntries[i].name}`);
      result.projects.skipped++;
      continue;
    }

    const { id, action } = resolveId(proj.id, proj.name, existingProjects);
    if (action === 'skip') {
      result.projects.skipped++;
      continue;
    }
    try {
      const toSave = { ...proj, id, updatedAt: new Date().toISOString() };
      await saveProject(toSave);
      existingProjects.set(id, toSave);
      projectIdMap.set(proj.id, id);
      if (action === 'overwrite') result.projects.overwritten++;
      else result.projects.added++;
    } catch (e) {
      result.errors.push(`项目 ${proj.name}: ${(e as Error).message}`);
    }
  }

  /* ── 恢复自定义模板 ── */
  const tplEntries = await readFolderFiles<CustomTemplate>('customTemplates');
  for (let i = 0; i < tplEntries.length; i++) {
    const { data: tpl } = tplEntries[i];
    onProgress?.({ phase: 'templates', current: i + 1, total: tplEntries.length, message: `恢复布局 ${i + 1}/${tplEntries.length}` });
    const { id, action } = resolveId(tpl.id, tpl.name, existingTemplates);
    if (action === 'skip') {
      result.customTemplates.skipped++;
      continue;
    }
    try {
      const toSave = { ...tpl, id, updatedAt: new Date().toISOString() };
      await saveCustomTemplate(toSave);
      existingTemplates.set(id, toSave);
      if (action === 'overwrite') result.customTemplates.overwritten++;
      else result.customTemplates.added++;
    } catch (e) {
      result.errors.push(`布局 ${tpl.name}: ${(e as Error).message}`);
    }
  }

  /* ── 恢复照片 blob ── */
  const blobFolder = zip.folder('blobs');
  const restoredBlobIds = new Set<string>();
  if (blobFolder) {
    const files = blobFolder.filter((_, file) => !file.dir);
    const prefix = 'blobs/';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.({ phase: 'blobs', current: i + 1, total: files.length, message: `恢复图片 ${i + 1}/${files.length}` });
      const relativeName = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name;
      const id = relativeName.replace(/\.[^.]+$/, '');
      try {
        const blob = await file.async('blob');
        await savePhotoBlob(id, blob);
        restoredBlobIds.add(id);
        result.blobs++;
      } catch (e) {
        result.errors.push(`图片 ${file.name}: ${(e as Error).message}`);
      }
    }
  }

  /* ── 恢复照片记录 ── */
  const photoEntries = await readFolderFiles<Photo & { backupBlobId?: string }>('photos');
  const photosToSave: Photo[] = [];
  for (let i = 0; i < photoEntries.length; i++) {
    const { data: p } = photoEntries[i];
    onProgress?.({ phase: 'photos', current: i + 1, total: photoEntries.length, message: `恢复照片 ${i + 1}/${photoEntries.length}` });

    const { id, action } = resolveId(p.id, p.name, existingPhotos);
    if (action === 'skip') {
      result.photos.skipped++;
      continue;
    }

    let finalPhoto: Photo = { ...p, id };

    // 若项目被重命名，同步照片的 albumId 指向新项目，否则打开项目后看不到照片
    if (finalPhoto.albumId && projectIdMap.has(finalPhoto.albumId)) {
      finalPhoto.albumId = projectIdMap.get(finalPhoto.albumId);
    }

    // direct 模式照片在备份中有原文件：转为 import 模式并关联 blob
    if (finalPhoto.storageMode === 'direct' && (p as Photo & { backupBlobId?: string }).backupBlobId) {
      const backupId = (p as Photo & { backupBlobId?: string }).backupBlobId!;
      if (restoredBlobIds.has(backupId)) {
        finalPhoto = {
          ...finalPhoto,
          storageMode: 'import',
          src: '',
          blobId: backupId,
          originalBlobId: backupId,
          previewBlobId: backupId,
          relativePath: undefined,
        };
      } else {
        result.warnings.push(`照片 ${p.name} 的备份图片未找到，将尝试按原路径引用`);
      }
    }

    // import 模式照片：校验 blob 是否存在
    if (finalPhoto.storageMode === 'import') {
      const neededIds = [finalPhoto.previewBlobId, finalPhoto.originalBlobId, finalPhoto.blobId].filter(Boolean) as string[];
      const missing = neededIds.filter((bid) => !restoredBlobIds.has(bid));
      if (missing.length > 0) {
        result.warnings.push(`照片 ${p.name} 缺少图片数据，可能无法显示`);
      }
    }

    // 清理运行时状态
    finalPhoto.src = finalPhoto.storageMode === 'import' ? '' : (finalPhoto.relativePath || finalPhoto.src);
    delete (finalPhoto as Partial<{ backupBlobId?: string }>).backupBlobId;

    photosToSave.push(finalPhoto);
    existingPhotos.set(id, finalPhoto);
    if (action === 'overwrite') result.photos.overwritten++;
    else result.photos.added++;
  }

  if (photosToSave.length > 0) {
    try {
      await savePhotoChanges(photosToSave);
    } catch (e) {
      result.errors.push(`保存照片记录失败: ${(e as Error).message}`);
    }
  }

  return result;
}

/* ============================================================
   工具
   ============================================================ */

async function listAllPhotos(): Promise<Photo[]> {
  const { loadPhotos } = await import('../db');
  return loadPhotos();
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 弹出文件选择并读取为 Blob；用户取消时返回 null */
export async function pickZipFile(): Promise<File | null> {
  // Tauri 桌面端使用原生对话框
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
      });
      if (!selected) return null;
      const path = Array.isArray(selected) ? selected[0] : selected;
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(path);
      const fileName = path.replace(/\\/g, '/').split('/').pop() || 'backup.zip';
      return new File([bytes], fileName, { type: 'application/zip' });
    } catch (e) {
      logger.warn('Tauri 文件选择失败，回退到浏览器选择', e);
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    let resolved = false;

    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      input.remove();
    };

    const onChange = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(input.files?.[0] || null);
    };

    const onFocus = () => {
      // 浏览器在取消选择后会让窗口重新获得焦点；短暂延迟等待 onchange 是否触发
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(null);
      }, 300);
    };

    input.addEventListener('change', onChange);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
