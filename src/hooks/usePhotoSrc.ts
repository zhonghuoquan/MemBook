/**
 * P1-1 LOD（Level of Detail）照片 src 解析 Hook
 *
 * 根据视图级别选择最合适的图片档位，降低内存占用：
 * - 'thumb'：256px，用于网格缩略图、PageCard、照片面板小图。单张位图 ~2MB。
 * - 'preview'：1200px，用于编辑器画布、全屏预览。单张位图 ~10MB。
 * - 'full'：4096px 原图，仅用于导出。
 *
 * 解析顺序（以 preview 为例）：
 *   1. photo.src（已加载的 blob URL 或 asset:// URL）
 *   2. previewBlobId → readPhotoFromDB（带 blobUrlCache）
 *   3. 失败回退到下一档
 *
 * 向后兼容：旧照片可能没有 thumbBlobId，自动回退到 previewBlobId 或 photo.src。
 */

import { useState, useEffect, useRef } from 'react';
import type { Photo } from '../types';
import { readPhotoFromDB, readDirectPhoto, acquirePhotoUrl, releasePhotoUrl, isBlobUrlAlive } from '../engine/storage-engine';
import { isTauri } from '../utils/tauri';

export type LODLevel = 'thumb' | 'preview' | 'full';

export interface UsePhotoSrcOptions {
  /** 期望的 LOD 级别 */
  level?: LODLevel;
  /** 是否在背景预加载（不触发组件重渲染，仅填充 blobUrlCache） */
  preload?: boolean;
}

/** 根据 LOD 级别选择 photo 上的 blobId 字段 */
function pickBlobId(photo: Photo, level: LODLevel): string | undefined {
  switch (level) {
    case 'thumb':
      // thumb 档回退链：thumb → preview → original → blobId
      return photo.thumbBlobId ?? photo.previewBlobId ?? photo.originalBlobId ?? photo.blobId;
    case 'preview':
      return photo.previewBlobId ?? photo.originalBlobId ?? photo.blobId;
    case 'full':
      return photo.originalBlobId ?? photo.blobId ?? photo.previewBlobId;
  }
}

/**
 * 解析照片的可加载 src URL。
 *
 * P0-fix-3: 统一使用 acquirePhotoUrl 获取 refCounted blob URL，不再直接使用 photo.src。
 *   之前 import 模式直接使用 photo.src（refCount=0 的 blob URL），LRU 淘汰后 10s 被 revoke，
 *   但 photo.src 字符串不变 → useEffect 不重新执行 → src 状态指向已失效 URL → 照片永久空白。
 *   修复后所有模式都通过 acquirePhotoUrl pin 住 URL（refCount+1），卸载时 release 释放。
 *   即使 blobUrlCache LRU 淘汰，refCount>0 的 URL 不会被 revoke。
 */
export function usePhotoSrc(photo: Photo, options: UsePhotoSrcOptions = {}): string | null {
  const { level = 'preview', preload = false } = options;
  // P0-fix-3: 初始值不再使用 photo.src（可能是 refCount=0 的 blob URL，随时被 LRU 回收）。
  //   统一交由 useEffect 通过 acquirePhotoUrl 获取 refCounted URL。
  const [src, setSrc] = useState<string | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let acquiredBlobId: string | null = null;
    retryRef.current = 0;

    const resolve = async () => {
      // 所有模式统一逻辑：优先通过 acquirePhotoUrl 获取 refCounted blob URL
      // P0-fix-3: 不再直接使用 photo.src（refCount=0，可能被 LRU 回收）
      const blobId = pickBlobId(photo, level);
      if (blobId) {
        const url = await acquirePhotoUrl(blobId);
        if (cancelled) { releasePhotoUrl(blobId); return; }
        if (url) {
          acquiredBlobId = blobId;
          setSrc(url);
          return;
        }
      }

      // acquirePhotoUrl 失败（无 blobId 或 IDB 无 blob），回退到 photo.src
      if (photo.src && isBlobUrlAlive(photo.src)) {
        if (!cancelled) setSrc(photo.src);
        return;
      }

      // direct 模式：从文件系统读取
      if (photo.storageMode === 'direct' && photo.relativePath) {
        const url = await readDirectPhoto(photo.relativePath);
        if (!cancelled && url) {
          setSrc(url);
          return;
        }
        // Tauri 环境兜底
        if (isTauri()) {
          const { makeDirectPhotoUrl } = await import('../engine/storage-engine');
          const tauriUrl = await makeDirectPhotoUrl(photo);
          if (!cancelled && tauriUrl) {
            setSrc(tauriUrl);
            return;
          }
        }
      }

      if (!cancelled) setSrc(null);
    };

    if (!preload) {
      resolve();
    } else {
      // 预加载模式：仅填充缓存，不触发重渲染
      resolve().catch(() => {});
    }

    // P1: 卸载时释放引用计数，让 blobUrlCache 可回收 URL
    return () => {
      cancelled = true;
      if (acquiredBlobId) releasePhotoUrl(acquiredBlobId);
    };
    // P0-fix: 移除 photo.src 依赖。
    //   photo.src 变化（如 P2 后台任务生成 preview 后更新 photo.src）会触发 effect 重跑：
    //   release 旧 blobId → acquire 同一 blobId → 得到相同 URL → setSrc 相同值。
    //   这种无意义的 acquire/release 风暴加剧 blob URL 生命周期不稳定，
    //   且 release 后的延迟回收窗口内若再次 acquire 会取消回收（正确但浪费）。
    //   主路径已通过 blobId 字段（thumbBlobId/previewBlobId/originalBlobId/blobId）管理 URL，
    //   photo.src 仅作为 acquirePhotoUrl 失败时的回退（isBlobUrlAlive 守卫），无需响应其变化。
  }, [photo.id, photo.storageMode, photo.relativePath, photo.thumbBlobId, photo.previewBlobId, photo.originalBlobId, photo.blobId, level, preload]);

  return src;
}

/**
 * 预加载指定级别照片到 blobUrlCache（不返回 src，不触发重渲染）。
 * 用于 PhotoPreview 预加载相邻 ±2 张。
 *
 * P1-2: 修复预加载失效——之前 `if (photo.src) return` 导致所有已导入照片（photo.src 非空）
 *   预加载变成空操作，相邻照片切换时无缓存，每次都要从 IndexedDB 读取。
 *   现在无论 photo.src 是否为空，都通过 readPhotoFromDB 预热 blobUrlCache，
 *   确保相邻照片切换时零延迟。
 */
export async function preloadPhotoSrc(photo: Photo, level: LODLevel = 'preview'): Promise<void> {
  // 预热 blobUrlCache：即使 photo.src 非空，也通过 readPhotoFromDB 确保缓存命中
  const blobId = pickBlobId(photo, level);
  if (blobId) {
    await readPhotoFromDB(blobId).catch(() => {});
    return;
  }
  // 无 blobId 时（direct 模式无 previewBlobId 的旧数据），从文件系统预读
  if (photo.storageMode === 'direct' && photo.relativePath) {
    await readDirectPhoto(photo.relativePath).catch(() => {});
  }
}
