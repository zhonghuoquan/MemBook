import type { Photo } from '../types';
import { usePhotoStore } from '../store/photoStore';
import { useEditorStore } from '../store/editorStore';
import { deletePhotoBlob } from '../engine/handle-store';
import { invalidateBlobUrlCache, revokeAllBlobUrls } from '../engine/storage/import-store';
import { evictDirectPhotoUrl, clearAllDirectPhotoUrls } from '../engine/storage/direct-access';
import { imageCache } from '../components/editor/canvas/CanvasPhotoRenderer';
import { clearThumbUrlCache } from '../components/editor/BottomNav';
import { clearThumbnailMemoryCache } from '../utils/gridThumbnailRenderer';
import { clearBitmapCache } from '../utils/imageBitmapLoader';
import { terminateWorkerPool } from '../engine/storage/image-compressor';
import { deletePhotos as deletePhotosFromDB } from '../db';
import { invalidatePhotoContentCache, clearPhotoContentCache } from '../engine/content-aware';
import { clearThumbCache, evictFromCache } from '../components/home/organize/thumbCache';

function cleanupPhotoBlobs(photo: Photo): void {
  // P1-1: 补全 thumbBlobId，并清理 blobUrlCache（之前仅删 IndexedDB，缓存残留导致内存泄漏）
  const blobIds = new Set([
    photo.previewBlobId,
    photo.originalBlobId,
    photo.blobId,
    photo.thumbBlobId,
  ].filter(Boolean)) as Set<string>;
  // 先失效 blobUrlCache（revoke URL + 清注册表），再删 IndexedDB
  for (const blobId of blobIds) {
    invalidateBlobUrlCache(blobId);
    deletePhotoBlob(blobId).catch(() => {});
  }
  // photo.src 若是裸 blob URL（未进缓存的旧数据），兜底 revoke
  if (photo.src && photo.src.startsWith('blob:')) {
    URL.revokeObjectURL(photo.src);
  }
  // P0: 清理其他模块级缓存——之前删除照片后这些缓存未清，导致内存不释放
  //   1. imageCache（最严重）：释放解码后的 ImageBitmap/HTMLImageElement 位图内存（~5-10MB/张）
  //      revoke URL 不会释放位图，必须 evict 触发 img.close()/src='' 才能释放
  if (photo.src) {
    imageCache.evict(photo.src);
  }
  //   2. directUrlCache：清理 direct 模式按 filePath 缓存的 blob URL（浏览器 FSA 模式）
  if (photo.storageMode === 'direct' && photo.relativePath) {
    evictDirectPhotoUrl(photo.relativePath);
  }
  //   3. 内容感知缓存（photoContentCache/pendingAnalysis/failedAnalysisCache）：按照片 ID 失效，
  //      否则被删照片的 contentInfo/分析中间态永久驻留（此前无任何删除路径清理，属泄漏）
  invalidatePhotoContentCache(photo.id);
  //   4. 整理工具缩略图缓存：同时清掉普通 + 人脸裁剪前缀条目，释放 blob URL
  evictFromCache(photo.id);
}

function removePhotoFromPages(id: string): boolean {
  const { pages, setPages } = useEditorStore.getState();
  let changed = false;
  const newPages = pages.map((page) => {
    const newPlacements = page.placements.map((pl) => {
      if (pl.photoId === id) {
        changed = true;
        return { ...pl, photoId: null };
      }
      return pl;
    });
    return changed ? { ...page, placements: newPlacements } : page;
  });
  if (changed) {
    setPages(newPages);
  }
  return changed;
}

/**
 * 照片跨域协调服务：统一处理照片库删除、页面引用清理、blob/IndexedDB 清理。
 * 将原本分散在 photoStore 与 editorStore 之间的双向依赖下沉到服务层。
 */
export const photoService = {
  removePhoto(id: string): void {
    const photo = usePhotoStore.getState().photoMap.get(id);
    if (photo) {
      cleanupPhotoBlobs(photo);
      deletePhotosFromDB([id]).catch(() => {});
    }

    removePhotoFromPages(id);

    usePhotoStore.getState()._removePhotoLocal(id);
  },

  removePhotos(ids: string[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const photosToRemove = ids
      .map((id) => usePhotoStore.getState().photoMap.get(id))
      .filter((p): p is Photo => !!p);

    for (const photo of photosToRemove) {
      cleanupPhotoBlobs(photo);
    }
    deletePhotosFromDB(ids).catch(() => {});

    const { pages, setPages } = useEditorStore.getState();
    let changed = false;
    const newPages = pages.map((page) => {
      const newPlacements = page.placements.map((pl) => {
        if (pl.photoId && idSet.has(pl.photoId)) {
          changed = true;
          return { ...pl, photoId: null };
        }
        return pl;
      });
      return changed ? { ...page, placements: newPlacements } : page;
    });
    if (changed) {
      setPages(newPages);
    }

    usePhotoStore.getState()._removePhotosLocal(ids);
  },

  /**
   * 项目级资源清理：退出编辑器/切换项目时调用。
   * 统一清理所有模块级缓存，释放 blob URL 和解码位图内存。
   *
   * P0: 之前项目切换时不清理任何模块级缓存，导致：
   *   - blobUrlRegistry 200 条 blob URL 残留（~100-200MB）
   *   - imageCache 40 条 ImageBitmap 残留（~232MB）
   *   - directUrlCache 30 条原文件 blob URL 残留（~150-300MB）
   *   - thumbUrlCache 120 条缩略图 URL 残留
   *   - thumbnailCache 80 条网格缩略图 dataURL 残留
   *   退出编辑器返回主页、新建空项目后内存仍 1.7GB 不释放。
   */
  cleanupProjectResources(): void {
    // 1. 清理所有 blob URL（import 模式的 preview/original/thumb）
    revokeAllBlobUrls();
    // 2. 清理 direct 模式原文件 blob URL（立即 revoke，不走延迟队列）
    clearAllDirectPhotoUrls();
    // 3. 清理编辑器画布 ImageBitmap 缓存（触发 evictImage → img.close()）
    imageCache.clear();
    // 4. 清理底部导航缩略图 URL 缓存
    clearThumbUrlCache();
    // 5. 清理网格视图缩略图内存缓存（保留 IDB 持久化缓存，跨项目安全复用）
    clearThumbnailMemoryCache();
    // 6. 清理 ImageBitmap 加载缓存（容量 100，每条 5-10MB，全屏/网格视图填充，~500MB-1GB）
    //   P0-fix: 之前遗漏此缓存，是退出编辑器后内存不释放的最大单一泄漏源。
    clearBitmapCache();
    // 7. 终止压缩 Worker 池（8 个 Worker 常驻 160-400MB，导入完成后不再需要）
    terminateWorkerPool();
    // 8. 内容感知分析缓存（photoContentCache 仅在主内存，跨项目无保留价值）
    clearPhotoContentCache();
    // 9. 整理工具缩略图缓存（含 HEIC 转换缓存）
    clearThumbCache();
  },

  /** 轻量缓存清理：不 revoke blob URL，清 imageCache。
   *  用于 EditorView 因条件渲染重新挂载时（如智能编排完成返回）。
   *  - 清 imageCache：EditorView 重新挂载后 Konva Stage 是全新实例，imageCache 中的旧
   *    ImageBitmap 在旧 Stage 上下文中创建，可能已失效（P2 后台任务 evict close 了它们）
   *    或与新 Stage 不兼容 → 画布空白。清空后 CanvasPhotoRenderer 用 usePhotoSrc + retry
   *    回退链重新加载（photo.src → IndexedDB → 文件系统），确保位图在新 Stage 上创建。
   *  - 保留 blobUrlCache/directUrlCache：photo.src 仍有效，避免裂图。
   *  - 清 thumbUrlCache/thumbnailCache：底部缩略图和网格缩略图有完整 LOD 回退逻辑，
   *    清空后会自动重建，不影响显示。 */
  clearRuntimeBitmapCache(): void {
    imageCache.clear();
    clearThumbUrlCache();
    clearThumbnailMemoryCache();
  },
};
