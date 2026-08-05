import { useState, useCallback } from 'react';
import { useEditorStore, usePhotoStore } from '../../store';
import { resolveTemplate, DEFAULT_SLOT_CORNER_RADIUS } from '../../types';
import { useTranslation } from 'react-i18next';

interface PreviewModalProps {
  onClose: () => void;
}

export function PreviewModal({ onClose }: PreviewModalProps) {
  const { t } = useTranslation();
  const pages = useEditorStore((s) => s.pages);
  const photos = usePhotoStore((s) => s.photos);
  const [currentPage, setCurrentPage] = useState(0);

  const handlePrev = useCallback(() => {
    setCurrentPage((p) => Math.max(0, p - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentPage((p) => Math.min(pages.length - 1, p + 1));
  }, [pages.length]);

  const page = pages[currentPage];
  const template = page ? resolveTemplate(page) : null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/85 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <div className="text-white/70 text-[var(--text-body-sm)]">
          {currentPage + 1} / {pages.length}
        </div>
        <div className="flex items-center gap-3">
          {pages.length > 1 && (
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-[var(--radius-md)]
                           text-white text-[var(--text-body-sm)] cursor-pointer
                           hover:bg-white/20 transition-colors disabled:opacity-30"
                onClick={handlePrev}
                disabled={currentPage === 0}
              >
                {t('editor.previewModal.prevPage')}
              </button>
              <button
                className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-[var(--radius-md)]
                           text-white text-[var(--text-body-sm)] cursor-pointer
                           hover:bg-white/20 transition-colors disabled:opacity-30"
                onClick={handleNext}
                disabled={currentPage >= pages.length - 1}
              >
                {t('editor.previewModal.nextPage')}
              </button>
            </div>
          )}
          <button
            className="w-8 h-8 flex items-center justify-center border border-white/20 rounded-[var(--radius-md)]
                       text-white/70 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={onClose}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className="shadow-2xl flex items-center justify-center"
          style={{
            width: 'min(420px, 80vw)',
            aspectRatio: '3 / 4',
            background: page?.background || '#fff',
            borderRadius: '4px',
            position: 'relative',
          }}
        >
          {/* Render template slots in preview */}
          {template && template.slots.map((slot) => {
            const placement = page?.placements.find((p) => p.slotId === slot.id);
            const photo = placement?.photoId
              ? photos.find((p) => p.id === placement.photoId)
              : null;

            return (
              <div
                key={slot.id}
                style={{
                  position: 'absolute',
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  width: `${slot.width}%`,
                  height: `${slot.height}%`,
                  background: photo ? undefined : (page?.background === '#FFFFFF' ? '#F1F3F5' : 'rgba(255,255,255,0.1)'),
                  borderRadius: `${page?.slotCornerRadius ?? DEFAULT_SLOT_CORNER_RADIUS}px`,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {photo ? (
                  <img
                    src={photo.src}
                    alt={photo.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom thumbnails */}
      <div className="flex items-center justify-center gap-2 pb-4">
        {pages.map((_, i) => (
          <button
            key={i}
            className={`
              w-10 h-12 rounded-[var(--radius-xs)] border-2 cursor-pointer transition-all
              ${i === currentPage
                ? 'border-[var(--color-brand)] opacity-100'
                : 'border-transparent opacity-50 hover:opacity-80'
              }
            `}
            style={{ background: pages[i]?.background || '#fff' }}
            onClick={() => setCurrentPage(i)}
          />
        ))}
      </div>
    </div>
  );
}
