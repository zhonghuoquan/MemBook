/**
 * CanvasPageThumbnail — 基于 Canvas 2D 的页面缩略图通用组件
 *
 * 使用 renderPageThumbnailInWorker 渲染所有元素类型
 * （照片、文本、便签、贴纸、画笔笔触），与编辑器画布渲染保持一致。
 * 内置 LRU + IDB 二级缓存，重复渲染同内容页面时即时返回。
 *
 * 用于 BottomNav 与 Home 项目封面，替代原先仅渲染照片的 CSS 缩略图。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store';
import {
  getCachedThumbnailUrl,
  preloadPagePhotos,
  preloadStickers,
  releaseStickerImages,
  renderPageThumbnailInWorker,
} from '../../utils/gridThumbnailRenderer';
import type { AlbumPage, Photo, AlbumSize } from '../../types';

interface CanvasPageThumbnailProps {
  page: AlbumPage;
  photos: Photo[];
  /** 容器像素宽 */
  width: number;
  /** 容器像素高 */
  height: number;
  className?: string;
  /** 缓存后缀，避免与网格缩略图缓存冲突（如 'nav' / 'home'） */
  cacheSuffix?: string;
  /** 缩放倍率，默认 1 */
  scale?: number;
  /** P0-fix: 传入相册尺寸，优先于全局 store。
   *  主页相册封面需要渲染不同项目的缩略图，全局 store 只有一个 albumSize，
   *  从编辑器返回主页时全局 albumSize 可能不匹配当前相册。 */
  albumSize?: AlbumSize;
}

const CanvasPageThumbnail = memo(function CanvasPageThumbnail({
  page,
  photos,
  width,
  height,
  className,
  cacheSuffix,
  scale = 1,
  albumSize: albumSizeProp,
}: CanvasPageThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderRef = useRef(0);
  const retryRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const globalAlbumSize = useEditorStore((s) => s.albumSize);
  // 优先使用传入的 albumSize，回退到全局 store
  const albumSize = albumSizeProp ?? globalAlbumSize;

  useEffect(() => {
    let cancelled = false;
    const rid = ++renderRef.current;
    retryRef.current = 0;

    const render = async () => {
      const options = { noCache: false, cacheSuffix, albumSize };

      // 先查缓存（LRU 内存 → IDB 磁盘），命中则跳过预加载和渲染
      const cached = await getCachedThumbnailUrl(page, photos, scale, options);
      if (cancelled || rid !== renderRef.current) return;
      if (cached) {
        urlRef.current = cached;
        setThumbnailUrl(cached);
        setLoading(false);
        return;
      }

      try {
        // 照片与贴纸并行预加载
        const [imgs, stickers] = await Promise.all([
          preloadPagePhotos(page, photos),
          preloadStickers(page),
        ]);
        if (cancelled || rid !== renderRef.current) {
          // 已被新渲染取代：立即释放本次预加载的位图，避免内存堆积
          for (const img of imgs.values()) {
            try {
              if (img instanceof ImageBitmap) img.close();
            } catch { /* ignore */ }
          }
          releaseStickerImages(stickers);
          return;
        }
        // renderPageThumbnailInWorker 内部消耗 imgs 和 stickers（transfer 或 release），调用方无需再释放
        const url = await renderPageThumbnailInWorker(page, photos, scale, imgs, options, stickers);
        if (!cancelled && rid === renderRef.current) {
          urlRef.current = url;
          setThumbnailUrl(url);
          setLoading(false);
          // P0-fix: 渲染返回 null（albumSize 未就绪或照片 preload 失败）时延迟重试
          if (url === null && retryRef.current < 2) {
            retryRef.current++;
            setTimeout(() => {
              if (!cancelled && rid === renderRef.current && urlRef.current === null) {
                render();
              }
            }, 800);
          }
        }
      } catch {
        // 渲染失败：置空 thumbnailUrl，显示白色兜底背景
        if (!cancelled && rid === renderRef.current) {
          urlRef.current = null;
          setThumbnailUrl(null);
          setLoading(false);
        }
      }
    };

    render();
    return () => { cancelled = true; };
  }, [page, photos, scale, cacheSuffix, albumSize]);

  return (
    <div
      className={className}
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: loading ? '#f0f0f2' : (thumbnailUrl ? 'transparent' : '#FFFFFF'),
      }}
    >
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
          draggable={false}
        />
      )}
    </div>
  );
});

export default CanvasPageThumbnail;
