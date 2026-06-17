import { useRef, useCallback, useState } from 'react';
import { usePhotoStore, useUIStore } from '../../store';
import type { Photo } from '../../types';

export function PhotoPanel() {
  const photos = usePhotoStore((s) => s.photos);
  const addPhotos = usePhotoStore((s) => s.addPhotos);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbSize, setThumbSize] = useState(56);
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback(async (files: FileList) => {
    const newPhotos: Photo[] = [];
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      addToast({ type: 'warning', message: '未选择有效的图片文件' });
      return;
    }

    for (const file of imageFiles) {
      try {
        const src = URL.createObjectURL(file);
        const img = await loadImageDimensions(src);
        newPhotos.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src,
          name: file.name,
          date: new Date(file.lastModified).toISOString().split('T')[0],
          width: img.width,
          height: img.height,
          orientation: img.width > img.height ? 'landscape' : img.width < img.height ? 'portrait' : 'square',
          file,
        });
      } catch {
        // skip failed images
      }
    }

    if (newPhotos.length > 0) {
      addPhotos(newPhotos);
      addToast({ type: 'success', message: `已导入 ${newPhotos.length} 张照片` });
    }
  }, [addPhotos, addToast]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const sortedPhotos = [...photos].sort((a, b) => {
    if (sortBy === 'date') return b.date.localeCompare(a.date);
    return a.name.localeCompare(b.name);
  });

  return (
    <aside className="w-[var(--layout-panel-width)] bg-[var(--color-surface-panel)] border-r border-[var(--color-border)]
                      flex flex-col shrink-0 overflow-hidden"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
          照片 {photos.length > 0 && <span className="text-[var(--color-gray-400)] font-[400]">({photos.length})</span>}
        </span>
        <div className="flex items-center gap-2">
          <select
            className="text-[var(--text-caption)] text-[var(--color-gray-600)] bg-transparent border border-[var(--color-border)]
                       rounded-[var(--radius-xs)] px-1.5 py-0.5 outline-none cursor-pointer"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'name')}
          >
            <option value="date">按日期</option>
            <option value="name">按名称</option>
          </select>
          <input
            type="range"
            className="w-14 h-1 accent-[var(--color-primary-600)]"
            min="40" max={80} value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            title="缩略图大小"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {sortedPhotos.length === 0 ? (
          /* Empty state with drag zone */
          <div
            className={`
              text-center py-10 px-3 rounded-[var(--radius-lg)]
              border-2 border-dashed transition-colors duration-150
              ${isDragOver
                ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]'
                : 'border-[var(--color-border)]'
              }
            `}
          >
            <div className="flex justify-center mb-3">
              <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-[var(--color-gray-300)]">
                <rect x="4" y="4" width="32" height="32" rx="4" strokeDasharray="3 3" />
                <circle cx="17" cy="16" r="3" fill="currentColor" stroke="none" />
                <path d="M6 30l10-10 6 6 8-8 10 12" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[var(--text-body-sm)] text-[var(--color-text-tertiary)]">
              {isDragOver ? '释放以导入照片' : '拖拽照片到此处'}
            </p>
            <p className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-1">或</p>
            <button
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary-600)] text-white
                         border-none rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500] cursor-pointer
                         hover:bg-[var(--color-primary-700)] transition-colors"
              onClick={handleFileSelect}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
                <line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" />
              </svg>
              导入照片
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
          </div>
        ) : (
          /* Photo grid */
          <>
            {/* Add more button */}
            <div className="mb-3">
              <button
                className="w-full py-2 flex items-center justify-center gap-1.5 border border-dashed border-[var(--color-border)]
                           rounded-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-500)]
                           bg-transparent cursor-pointer hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)]
                           transition-colors"
                onClick={handleFileSelect}
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                  <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
                </svg>
                添加照片
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleInputChange}
              />
            </div>

            {/* Photo grid */}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
              {sortedPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative aspect-square bg-[var(--color-gray-100)] rounded-[var(--radius-md)]
                             overflow-hidden border border-[var(--color-border)]
                             hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-card-hover)]
                             transition-all duration-150 cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', photo.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <img
                    src={photo.src}
                    alt={photo.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />

                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end justify-end p-1">
                    <button
                      className="w-5 h-5 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100
                                 text-white hover:bg-[var(--color-error)] transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto(photo.id);
                      }}
                      title="删除照片"
                    >
                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
                        <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                      </svg>
                    </button>
                  </div>

                  {/* Photo name tooltip */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/40 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[var(--text-nano)] text-white truncate block">{photo.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/** Load image and return its natural dimensions */
function loadImageDimensions(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
