import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import exifr from 'exifr';
import { usePhotoStore, useUIStore } from '../../store';
import type { Photo } from '../../types';

export function PhotoPanel() {
  const photos = usePhotoStore((s) => s.photos);
  const addPhotos = usePhotoStore((s) => s.addPhotos);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── 加载 EXIF 日期 ──
  const loadExifDate = useCallback(async (file: File): Promise<Date | null> => {
    try {
      const dt: string | undefined = await exifr.parse(file, ['DateTimeOriginal']);
      if (dt) {
        // EXIF DateTimeOriginal string format: "YYYY:MM:DD HH:mm:ss"
        const normalized = dt.replace(/:/g, '-').replace(' ', 'T');
        return new Date(normalized);
      }
    } catch {
      // fallback to file lastModified
    }
    return new Date(file.lastModified);
  }, []);

  // ── 处理导入文件 ──
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
        const exifDate = await loadExifDate(file);
        const isoDate = exifDate ? exifDate.toISOString() : new Date(file.lastModified).toISOString();

        newPhotos.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          src,
          name: file.name.replace(/\.[^/.]+$/, ''),
          date: isoDate,
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
      // Sort by date ascending before adding
      newPhotos.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      addPhotos(newPhotos);

      // Auto-expand the groups of newly added photos
      const newGroups = new Set(expandedGroups);
      for (const p of newPhotos) {
        newGroups.add(formatGroupKey(p.date));
      }
      setExpandedGroups(newGroups);
      addToast({ type: 'success', message: `已导入 ${newPhotos.length} 张照片` });
    }
  }, [addPhotos, addToast, loadExifDate, expandedGroups]);

  // ── 按日期分组 ──
  const groupedPhotos = useMemo(() => {
    const groups = new Map<string, Photo[]>();
    // Sort by date descending (newest first)
    const sorted = [...photos].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const photo of sorted) {
      const key = formatGroupKey(photo.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(photo);
    }
    return groups;
  }, [photos]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-expand newest group on mount
  useEffect(() => {
    if (groupedPhotos.size > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set([groupedPhotos.keys().next().value as string]));
    }
  }, [groupedPhotos, expandedGroups]);

  const handleFileSelect = useCallback(() => fileInputRef.current?.click(), []);
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { handleFiles(e.target.files); e.target.value = ''; }
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  return (
    <div
      className="flex flex-col h-full select-none"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* ── 上传区 ── */}
      <div
        className={`
          mx-3 mt-3 mb-2 px-3 py-5 rounded-[var(--radius-md)] text-center cursor-pointer
          border-2 border-dashed transition-all duration-150
          ${isDragOver
            ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:bg-[var(--color-gray-25)]'
          }
        `}
        onClick={handleFileSelect}
      >
        <div className="flex justify-center mb-2">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-7 h-7 text-[var(--color-gray-400)]">
            <rect x="3" y="3" width="26" height="26" rx="4" strokeDasharray="3 3" />
            <circle cx="13" cy="12" r="2.5" fill="currentColor" stroke="none" />
            <path d="M5 25l8-8 5 5 7-7 7 10" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-[var(--text-body-sm)] text-[var(--color-gray-600)] font-[500]">
          拖拽或点击上传
        </p>
        <p className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-0.5">
          支持JPG/PNG/HEIC等格式
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </div>

      {/* ── 标题区 ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)]">照片</span>
        <span className="text-[var(--text-body-sm)] text-[var(--color-gray-500)]">
          总共{photos.length}张
        </span>
      </div>

      {/* ── 照片列表（按日期分组） ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {groupedPhotos.size === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-8 h-8 text-[var(--color-gray-300)] mb-2">
              <rect x="4" y="4" width="32" height="32" rx="4" strokeDasharray="3 3" />
              <circle cx="16" cy="15" r="2" fill="currentColor" stroke="none" />
              <path d="M6 32l10-10 5 5 6-6 7 10" strokeLinecap="round" />
            </svg>
            <p className="text-[var(--text-body-sm)] text-[var(--color-gray-400)]">
              暂无照片，点击上方导入
            </p>
          </div>
        ) : (
          Array.from(groupedPhotos.entries()).map(([key, groupPhotos]) => {
            const isExpanded = expandedGroups.has(key);
            const [year, month] = key.split('-');
            return (
              <div key={key} className="mb-3">
                {/* Group header */}
                <button
                  className="flex items-center gap-1.5 w-full text-left px-0.5 py-1.5 border-none bg-transparent cursor-pointer group"
                  onClick={() => toggleGroup(key)}
                >
                  <svg
                    viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`w-2.5 h-2.5 text-[var(--color-gray-500)] transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`}
                  >
                    <path d="M3 2l4 3-4 3" />
                  </svg>
                  <span className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]">
                    {year}年{month}月
                  </span>
                  <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
                    {groupPhotos.length}张
                  </span>
                </button>

                {/* Photo grid when expanded */}
                {isExpanded && (
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {groupPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        className="group/thumb relative aspect-square bg-[var(--color-gray-100)] rounded-[var(--radius-sm)]
                                   overflow-hidden border border-[var(--color-border-light)]
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
                        {/* Delete overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/15 transition-colors flex items-start justify-end p-0.5">
                          <button
                            className="w-4 h-4 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover/thumb:opacity-100
                                       text-white hover:bg-[var(--color-error)] transition-all text-[8px]"
                            onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }}
                            title="删除照片"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Get the formatted date group key: "YYYY-MM" */
function formatGroupKey(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Load image dimensions */
function loadImageDimensions(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
