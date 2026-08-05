/**
 * 编辑器左侧贴纸面板
 *
 * 功能：
 * 1. 网格展示所有已上传贴纸
 * 2. 顶部支持上传贴纸
 * 3. 支持鼠标拖拽贴纸到画布工作区（使用自定义 sticker-drag 系统）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadStickersFromFiles, listStickers, deleteSticker, toggleStickerFavorite } from '../../services/stickerService';
import type { StickerRecord } from '../../db';
import { useStickerSrc, getCachedStickerSrc, preloadStickerSrc } from '../../hooks/useStickerSrc';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useUIStore } from '../../store';
import { startStickerDrag, updateStickerDrag, endStickerDrag, isStickerDragging } from '../../engine/sticker-drag';

export function StickerPanel() {
  const { t } = useTranslation();
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'favorite'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sb = useScrollbarVisibility<HTMLDivElement>();
  const addToast = useUIStore((s) => s.addToast);

  const loadStickers = useCallback(async () => {
    try {
      const list = await listStickers();
      setStickers(Array.isArray(list) ? list : []);
    } catch {
      setStickers([]);
    }
  }, []);

  useEffect(() => {
    loadStickers();
  }, [loadStickers]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const uploaded = await uploadStickersFromFiles(files);
      if (uploaded.length > 0) {
        addToast({ type: 'success', message: t('editor.sticker.uploadedCount', { count: uploaded.length }) });
        await loadStickers();
      } else {
        addToast({ type: 'warning', message: t('editor.sticker.uploadNone') });
      }
    } catch {
      addToast({ type: 'error', message: t('editor.sticker.uploadFailed') });
    }
    e.target.value = '';
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSticker(id);
      await loadStickers();
      addToast({ type: 'success', message: t('editor.sticker.deleted') });
    } catch {
      addToast({ type: 'error', message: t('editor.sticker.deleteFailed') });
    }
    setDeleteTargetId(null);
  };

  const handleToggleFavorite = async (id: string) => {
    try {
      await toggleStickerFavorite(id);
      await loadStickers();
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  };

  const filteredStickers = stickers.filter((s) => {
    if (categoryFilter === 'favorite') return s.favorite === true;
    return true;
  });

  return (
    <div ref={sb.ref} className={`h-full overflow-y-auto ps-scroll ${sb.className}`} {...sb.handlers}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-light)] sticky top-0 bg-white z-10">
        <h3 className="text-[var(--text-body)] font-[700] text-[var(--color-gray-800)]">{t('editor.sticker.title')}</h3>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[image:var(--gradient-brand)] text-white
                     rounded-[var(--radius-md)] text-[var(--text-caption)] font-[600]
                     border-none cursor-pointer transition-all duration-200
                     hover:shadow-[var(--shadow-sm)] hover:-translate-y-px active:scale-[0.97]"
          onClick={handleUploadClick}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M7 2v8M3 6l4-4 4 4" />
            <path d="M2 12h10" />
          </svg>
          {t('editor.sticker.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Sticker Grid */}
      {stickers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-tertiary)]">
          <div className="w-14 h-14 rounded-[var(--radius-xl)] bg-[image:var(--gradient-brand-soft)] flex items-center justify-center mb-3">
            <svg viewBox="0 0 48 48" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" className="w-7 h-7">
              <rect x="8" y="8" width="32" height="32" rx="6" strokeDasharray="4 4" />
              <circle cx="24" cy="24" r="7" />
              <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <p className="text-[var(--text-caption)] font-[600]">{t('editor.sticker.empty')}</p>
          <p className="text-[var(--text-nano)] mt-1">{t('editor.sticker.emptyHint')}</p>
          <button
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[image:var(--gradient-brand)] text-white
                       rounded-[var(--radius-md)] text-[var(--text-caption)] font-[600]
                       border-none cursor-pointer transition-all duration-200
                       hover:shadow-[var(--shadow-sm)] active:scale-[0.97]"
            onClick={handleUploadClick}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" />
              <line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            {t('editor.sticker.upload')}
          </button>
        </div>
      ) : (
        <>
          {/* 筛选条 */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-border-light)]">
            {[
              { labelKey: 'editor.sticker.filterAll', value: 'all' as const },
              { labelKey: 'editor.sticker.filterFavorite', value: 'favorite' as const },
            ].map((f) => (
              <button
                key={f.value}
                className={`px-2.5 py-1 text-[11px] font-[600] rounded-[var(--radius-md)] border-none cursor-pointer transition-all
                  ${categoryFilter === f.value
                    ? 'bg-[image:var(--gradient-brand-soft)] text-[var(--color-brand)]'
                    : 'bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                onClick={() => setCategoryFilter(f.value)}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>

          {filteredStickers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-tertiary)]">
              <div className="w-12 h-12 rounded-[var(--radius-xl)] bg-[image:var(--gradient-brand-soft)] flex items-center justify-center mb-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" strokeLinejoin="round" className="w-6 h-6">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.5-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                </svg>
              </div>
              <p className="text-[var(--text-caption)] font-[600]">{t('editor.sticker.filterFavorite')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 p-4">
              {filteredStickers.map((sticker) => (
                <StickerGridItem
                  key={sticker.id}
                  sticker={sticker}
                  onDelete={() => setDeleteTargetId(sticker.id)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 拖拽提示 */}
      <div className="px-4 pb-3 text-[var(--text-nano)] text-[var(--color-text-tertiary)] text-center">
        {t('editor.sticker.dragHint')}
      </div>

      {/* Delete Confirmation */}
      {deleteTargetId && (
        <div className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]" onClick={() => setDeleteTargetId(null)}>
          <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
          <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-6 w-[360px]"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] mb-2">{t('editor.sticker.deleteTitle')}</h3>
            <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-5">
              {t('editor.sticker.deleteConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]
                                 hover:bg-[var(--color-surface-hover)] cursor-pointer transition-all"
                      onClick={() => setDeleteTargetId(null)}>
                {t('common.cancel')}
              </button>
              <button className="px-4 py-2 bg-[var(--color-error)] text-white rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] border-none
                                 hover:bg-[var(--color-error-dark)] cursor-pointer transition-all"
                      onClick={() => handleDelete(deleteTargetId)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 贴纸网格项（支持拖拽 + 视口懒加载） ── */
// P0-fix 性能：贴纸数量可能很多（几十到几百），原实现全部一次性加载 <img> 解码，
//   内存占用高且首次渲染慢。复用 PhotoPanel 的 IntersectionObserver 方案：
//   - 未进入视口：不挂载 <img>，显示占位背景
//   - 进入视口：挂载 <img> 加载贴纸图
//   - 离开视口：回收 <img> 释放解码位图，再次进入时重新加载
function StickerGridItem({
  sticker, onDelete, onToggleFavorite,
}: {
  sticker: StickerRecord;
  onDelete: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const { t } = useTranslation();
  const src = useStickerSrc(sticker.blobId);
  const itemRef = useRef<HTMLDivElement>(null);
  const dragStartedRef = useRef(false);
  /** 是否进入视口（IntersectionObserver），未进入时不挂载 <img>，避免大量图像同时解码 */
  const [inView, setInView] = useState(false);

  // 进入/离开视口监听：rootMargin 200px 预加载，避免滚动时出现空白。
  // 离开视口时 inView=false → <img> 卸载 → 浏览器释放解码位图，与 useStickerSrc 的缓存协同控制内存。
  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // 只响应左键
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    // 确保 dataURL 已缓存（拖拽预览需要即时取到）
    const dataURL = getCachedStickerSrc(sticker.blobId) || await preloadStickerSrc(sticker.blobId) || '';
    if (!dataURL) return;

    startStickerDrag(
      sticker.id,
      sticker.blobId,
      dataURL,
      sticker.width,
      sticker.height,
      e.clientX,
      e.clientY,
      offsetX,
      offsetY,
    );
    dragStartedRef.current = true;

    const onMove = (me: MouseEvent) => {
      if (!isStickerDragging()) return;
      updateStickerDrag(me.clientX, me.clientY);
    };

    const onUp = (_me: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragStartedRef.current) {
        endStickerDrag();
        dragStartedRef.current = false;
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sticker.id, sticker.blobId, sticker.width, sticker.height]);

  return (
    <div
      ref={itemRef}
      className="relative aspect-square bg-[image:var(--gradient-brand-soft)] rounded-[var(--radius-lg)]
                 border border-[var(--color-border)] overflow-hidden
                 hover:shadow-[var(--shadow-sm)] hover:border-[var(--color-primary-300)]
                 transition-all duration-150 cursor-grab active:cursor-grabbing
                 group select-none"
      onMouseDown={handleMouseDown}
      style={{
        backgroundImage:
          'repeating-conic-gradient(rgba(108,99,255,0.04) 0% 25%, transparent 0% 50%) 50% / 12px 12px',
      }}
    >
      {inView && src ? (
        <img
          src={src}
          alt={sticker.name}
          className="w-full h-full object-contain p-2 pointer-events-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
          draggable={false}
        />
      ) : inView ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-6 h-6 border-[2px] border-[var(--color-primary-200)] border-t-[var(--color-primary-500)] rounded-full animate-spin" />
        </div>
      ) : null}
      {/* 喜欢按钮 — 左上角，仅 hover 显示 */}
      <button
        className={`absolute top-1 left-1 w-6 h-6 flex items-center justify-center
                   bg-white/90 border border-[var(--color-border)] rounded-full
                   opacity-0 group-hover:opacity-100
                   transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)] z-20
                   ${sticker.favorite === true
                     ? 'text-[var(--color-brand)] border-[var(--color-primary-300)] bg-[var(--color-primary-50)] hover:bg-[var(--color-primary-100)]'
                     : 'text-[var(--color-gray-400)] hover:text-[var(--color-brand)] hover:border-[var(--color-primary-300)]'
                   }`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(sticker.id); }}
        title={t('editor.sticker.filterFavorite')}
      >
        {sticker.favorite === true ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="w-3 h-3">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        )}
      </button>

      {/* 删除按钮 — 右上角 hover 显示 */}
      <button
        className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center
                   bg-white/90 border border-[var(--color-border)] rounded-full
                   text-[var(--color-gray-500)] opacity-0 group-hover:opacity-100
                   hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]
                   transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)] z-20"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title={t('editor.sticker.delete')}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
          <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
          <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
        </svg>
      </button>
    </div>
  );
}
