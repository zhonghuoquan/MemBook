import { memo, useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore, usePhotoStore } from '../../store';
import { invalidatePageThumbnail, preloadPagePhotos, renderPageThumbnailInWorker, getCachedThumbnailUrl, preloadStickers, releaseStickerImages } from '../../utils/gridThumbnailRenderer';
import type { AlbumPage, Photo } from '../../types';

interface PageCardProps {
  page: AlbumPage;
  index: number;
  cardWidth: number;
  cardHeight: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  gridZoom: number;
}

export const PageCard = memo(function PageCard({
  page,
  index,
  cardWidth,
  cardHeight,
  isSelected,
  isMultiSelected,
  gridZoom,
}: PageCardProps) {
  const { t } = useTranslation();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderRef = useRef(0);

  // ── 精细订阅优化（P0-2 + P2-3）──
  // 旧实现：usePhotoStore((s) => s.photos) 订阅整个 photos 数组，任意照片元数据更新
  //         （如 GPS 逆地理编码完成）都会触发 100+ 个 PageCard 重新渲染缩略图。
  // 新实现：只订阅本页 placements 中实际用到的照片。
  //         zustand v5 默认 hook 不支持 equalityFn 第二参数，改用 useShallow：
  //         对返回数组做浅比较（逐个元素 Object.is），只有当本页用到的照片对象本身
  //         引用变化时才触发重渲染，避免数组容器每次新建导致的无效重渲染。
  // P2-3：使用 photoMap.get(id) O(1) 查找替代 photos.find O(n)，
  //         100 页 × 3 照片 × 300 库存场景 selector 重组从 9 万次比较降为 300 次
  const pagePhotoIds = page.placements
    .filter((pl) => pl.photoId)
    .map((pl) => pl.photoId as string);

  const pagePhotos = usePhotoStore(
    useShallow((s) => pagePhotoIds.map((id) => s.photoMap.get(id)).filter(Boolean) as Photo[]),
  );

  // 渲染缩略图
  // 依赖项：page（引用变化即代表页面数据变化，store 所有 mutation 都会创建新 page 对象）、
  //         pagePhotos（仅本页用到的照片）、gridZoom
  // 不再需要 heartbeat 和 subscribe + JSON.stringify 比较
  useEffect(() => {
    let cancelled = false;
    const rid = ++renderRef.current;

    const render = async () => {
      setLoading(true);
      const size = useEditorStore.getState().albumSize;
      if (!size) { setLoading(false); return; }

      // P2-1: 先查缓存（LRU 内存 → IDB 磁盘），命中则跳过预加载和渲染
      const cached = await getCachedThumbnailUrl(page, pagePhotos, gridZoom);
      if (cancelled || rid !== renderRef.current) return;
      if (cached) {
        setThumbnailUrl(cached);
        setLoading(false);
        return;
      }

      // 缓存未命中：页面数据变化时主动失效本页 LRU 内存缓存
      invalidatePageThumbnail(page.id);

      // P0-2: 移除同步渲染占位（renderPageThumbnail 阻塞主线程，100+ 页滚动时卡顿）
      // 异步预加载照片后渲染（P1-5：优先走 Worker，PNG 编码不阻塞主线程）
      try {
        // 照片与贴纸并行预加载，避免串行等待
        const [imgs, stickers] = await Promise.all([
          preloadPagePhotos(page, pagePhotos),
          preloadStickers(page),
        ]);
        if (cancelled || rid !== renderRef.current) {
          // 已被新渲染取代：立即释放本次预加载的位图，避免内存堆积
          for (const img of imgs.values()) {
            try {
              if (img instanceof ImageBitmap) img.close();
              else img.src = '';
            } catch { /* ignore */ }
          }
          releaseStickerImages(stickers);
          return;
        }
        // renderPageThumbnailInWorker 会内部消耗 imgs 和 stickers（transfer 或 release），调用方无需再释放
        const hqUrl = await renderPageThumbnailInWorker(page, pagePhotos, gridZoom, imgs, undefined, stickers);
        if (!cancelled && rid === renderRef.current && hqUrl) {
          setThumbnailUrl(hqUrl);
        }
        if (!cancelled && rid === renderRef.current) {
          setLoading(false);
        }
      } catch {
        // catch 分支显式置空 thumbnailUrl，避免永久空白
        if (!cancelled && rid === renderRef.current) {
          setThumbnailUrl(null);
          setLoading(false);
        }
      }
    };

    render();
    return () => { cancelled = true; };
  }, [page, pagePhotos, gridZoom]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // 右键菜单由父组件 GridView 统一处理
  }, []);

  // 圆角随卡片宽度自适应，避免缩放后视觉上圆角过大或过小
  const borderRadius = Math.max(4, Math.round(cardWidth * 0.08));

  const cardStyle: React.CSSProperties = {
    width: cardWidth,
    height: cardHeight,
    backgroundColor: page.background || '#FFFFFF',
    borderRadius,
    boxSizing: 'border-box',
    overflow: 'hidden',
    cursor: 'pointer',
    border: isMultiSelected
      ? '2px solid var(--color-brand)'
      : isSelected
        ? '2px solid var(--color-primary-500)'
        : '2px solid var(--color-border)',
    boxShadow: isSelected || isMultiSelected
      ? '0 4px 16px rgba(108,99,255,0.22)'
      : '0 2px 8px rgba(108,99,255,0.06)',
    transform: isSelected ? 'scale(1.02)' : undefined,
    transition: 'border-color 150ms, box-shadow 150ms, transform 150ms',
    position: 'relative',
  };

  return (
    <div style={cardStyle} onContextMenu={handleContextMenu}>
      {loading && !thumbnailUrl && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f8f9fa',
          }}
        >
          <div
              style={{
                width: 20,
                height: 20,
                border: '2px solid var(--color-primary-200)',
                borderTopColor: 'var(--color-brand)',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite',
              }}
            />
        </div>
      )}
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt={t('editor.pageCard.pageNumber', { n: index + 1 })}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            opacity: loading ? 0.6 : 1,
            transition: 'opacity 200ms',
          }}
          draggable={false}
        />
      )}
    </div>
  );
});

export function AddPageCard({
  cardWidth,
  cardHeight,
  onClick,
}: {
  cardWidth: number;
  cardHeight: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onClick}
      style={{
        width: cardWidth,
        height: cardHeight,
        borderRadius: Math.max(4, Math.round(cardWidth * 0.08)),
        boxSizing: 'border-box',
        border: '2px dashed var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-gray-400)',
        transition: 'all 150ms',
        gap: 6,
      }}
      className="hover:border-[var(--color-primary-400)] hover:text-[var(--color-brand)] hover:bg-[image:var(--gradient-brand-soft)]"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 28, height: 28 }}>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{t('editor.pageCard.addPage')}</span>
    </div>
  );
}
