import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import exifr from 'exifr';
import { usePhotoStore, useUIStore } from '../../store';
import { importFilesByMode, makeDirectPhotoUrl, pickPhotoDirectory, restoreDirectoryHandle } from '../../engine/storage-engine';
import type { Photo } from '../../types';
import { StoragePickerDialog } from './StoragePickerDialog';

export function PhotoPanel() {
  const photos = usePhotoStore((s) => s.photos);
  const addPhotos = usePhotoStore((s) => s.addPhotos);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const storageMode = useUIStore((s) => s.storageMode);
  const setStorageMode = useUIStore((s) => s.setStorageMode);
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showStoragePicker, setShowStoragePicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ── 加载 EXIF 日期 ──
  const loadExifDate = useCallback(async (file: File): Promise<Date | null> => {
    try {
      const dt: string | undefined = await exifr.parse(file, ['DateTimeOriginal']);
      if (dt) {
        const normalized = dt.replace(/:/g, '-').replace(' ', 'T');
        return new Date(normalized);
      }
    } catch { /* fallback */ }
    return new Date(file.lastModified);
  }, []);

  // ── 批量读取 EXIF 日期 ──
  const batchLoadExif = useCallback(async (files: File[]): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    const batch = files.slice(0, 50); // 限制批量大小
    await Promise.allSettled(
      batch.map(async (file) => {
        const d = await loadExifDate(file);
        map.set(file.name, d ? d.toISOString() : new Date(file.lastModified).toISOString());
      }),
    );
    // 剩余文件用 lastModified
    for (const file of files.slice(50)) {
      map.set(file.name, new Date(file.lastModified).toISOString());
    }
    return map;
  }, [loadExifDate]);

  // ── 执行导入 ──
  const doImport = useCallback(async (files: File[], mode: 'direct' | 'import') => {
    setIsImporting(true);
    try {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));

      if (mode === 'direct') {
        // 直接访问模式：先选文件夹
        const dirOk = await pickPhotoDirectory();
        if (!dirOk) {
          setIsImporting(false);
          return;
        }
      }

      const exifDates = await batchLoadExif(imageFiles);
      const results = await importFilesByMode(imageFiles, mode, exifDates);

      const newPhotos: Photo[] = results.map((r) => ({
        id: r.id,
        src: r.src,
        name: r.name,
        date: r.date,
        width: r.width,
        height: r.height,
        orientation: r.orientation,
        storageMode: r.storageMode,
      }));

      if (newPhotos.length > 0) {
        // 对于 direct 模式，需要生成 blob URL 供显示
        if (mode === 'direct') {
          await restoreDirectoryHandle();
          for (const photo of newPhotos) {
            const url = await makeDirectPhotoUrl(photo);
            if (url) photo.src = url;
          }
        }
        newPhotos.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        addPhotos(newPhotos);

        const newGroups = new Set(expandedGroups);
        for (const p of newPhotos) {
          newGroups.add(formatGroupKey(p.date));
        }
        setExpandedGroups(newGroups);
        addToast({ type: 'success', message: `已导入 ${newPhotos.length} 张照片` });
      }
    } catch (err) {
      addToast({ type: 'error', message: '导入失败: ' + (err as Error)?.message });
    }
    setIsImporting(false);
    setPendingFiles(null);
  }, [addPhotos, addToast, batchLoadExif, expandedGroups]);

  // ── 处理导入文件（入口） ──
  const handleFiles = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      addToast({ type: 'warning', message: '未选择有效的图片文件' });
      return;
    }

    // 如果尚未选择存储模式，弹出选择对话框
    if (!storageMode) {
      setPendingFiles(imageFiles);
      setShowStoragePicker(true);
      return;
    }

    await doImport(imageFiles, storageMode);
  }, [storageMode, doImport, addToast]);

  // ── 存储选择回调 ──
  const handleStorageSelect = useCallback(async (mode: 'direct' | 'import') => {
    setShowStoragePicker(false);
    setStorageMode(mode);
    if (pendingFiles && pendingFiles.length > 0) {
      await doImport(pendingFiles, mode);
    }
  }, [setStorageMode, pendingFiles, doImport]);

  const handleStorageCancel = useCallback(() => {
    setShowStoragePicker(false);
    setPendingFiles(null);
  }, []);

  // ── 按日期分组 ──
  const groupedPhotos = useMemo(() => {
    const groups = new Map<string, Photo[]>();
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
    <>
      <div
        className="flex flex-col h-full select-none"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* ── 存储模式提示 ── */}
        {storageMode && (
          <div className="flex items-center gap-1.5 mx-3 mt-2 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--color-primary-50)] text-[10px] text-[var(--color-primary-700)]">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              {storageMode === 'direct' ? (
                <path d="M2 4V3a1 1 0 0 1 1-1h2l1 1h3a1 1 0 0 1 1 1v1" />
              ) : (
                <path d="M6 1v7M4 5l2 2 2-2M1 9v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" />
              )}
            </svg>
            <span>{storageMode === 'direct' ? '直接访问模式' : '导入存储模式'}</span>
          </div>
        )}

        {/* ── 上传区 ── */}
        <div
          className={`
            mx-3 mt-3 mb-2 px-3 py-5 rounded-[var(--radius-md)] text-center cursor-pointer
            border-2 border-dashed transition-all duration-150
            ${isImporting ? 'opacity-50 pointer-events-none' : ''}
            ${isDragOver
              ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]'
              : 'border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:bg-[var(--color-gray-25)]'
            }
          `}
          onClick={isImporting ? undefined : handleFileSelect}
        >
          {isImporting ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-[var(--color-primary-400)] border-t-transparent rounded-full animate-spin" />
              <p className="text-[var(--text-body-sm)] text-[var(--color-gray-500)]">正在导入照片...</p>
            </div>
          ) : (
            <>
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
            </>
          )}
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

        {/* ── 照片列表 ── */}
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
                  <button
                    className="flex items-center gap-1.5 w-full text-left px-0.5 py-1.5 border-none bg-transparent cursor-pointer group"
                    onClick={() => toggleGroup(key)}
                  >
                    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                      className={`w-2.5 h-2.5 text-[var(--color-gray-500)] transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`}>
                      <path d="M3 2l4 3-4 3" />
                    </svg>
                    <span className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]">
                      {year}年{month}月
                    </span>
                    <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
                      {groupPhotos.length}张
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-3 gap-1.5 mt-1">
                      {groupPhotos.map((photo) => (
                        <div key={photo.id}
                          className="group/thumb relative bg-[var(--color-gray-100)] rounded-[var(--radius-sm)]
                                     overflow-hidden border border-[var(--color-border-light)]
                                     hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-card-hover)]
                                     transition-all duration-150 cursor-grab active:cursor-grabbing"
                          style={{ aspectRatio: photo.width / photo.height }}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', photo.id);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                        >
                          <img src={photo.src} alt={photo.name} className="w-full h-full object-cover" draggable={false} />
                          <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/15 transition-colors flex items-start justify-end p-0.5">
                            <button
                              className="w-4 h-4 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover/thumb:opacity-100
                                         text-white hover:bg-[var(--color-error)] transition-all text-[8px]"
                              onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }}
                              title="删除照片"
                            >✕</button>
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

      {/* ── 存储模式选择对话框 ── */}
      {showStoragePicker && (
        <StoragePickerDialog
          onSelect={handleStorageSelect}
          onCancel={handleStorageCancel}
        />
      )}
    </>
  );
}

function formatGroupKey(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
