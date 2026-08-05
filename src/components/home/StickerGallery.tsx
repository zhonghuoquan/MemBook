/**
 * 主页贴纸展示页
 * 类似 TemplateGallery 的网格布局，展示用户上传的所有贴纸。
 * 支持上传、删除贴纸，按分类（全部/自定义）筛选。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadStickersFromFiles, listStickers, deleteSticker, toggleStickerFavorite, renameSticker } from '../../services/stickerService';
import type { StickerRecord } from '../../db';
import { useStickerSrc } from '../../hooks/useStickerSrc';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { useUIStore } from '../../store';

type CategoryFilter = 'all' | 'custom' | 'favorite';

const CATEGORY_FILTERS: { labelKey: string; value: CategoryFilter }[] = [
  { labelKey: 'home.stickers.filterAll', value: 'all' },
  { labelKey: 'home.stickers.filterCustom', value: 'custom' },
  { labelKey: 'home.stickers.filterFavorite', value: 'favorite' },
];

export function StickerGallery() {
  const { t } = useTranslation();
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // 多选删除状态
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiDeleteConfirm, setMultiDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
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
    // 清空 input，允许重复选择同一文件
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
      const next = await toggleStickerFavorite(id);
      await loadStickers();
      addToast({ type: 'success', message: next ? t('home.stickers.favorited') : t('home.stickers.unfavorited') });
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  };

  const handleStartRename = (sticker: StickerRecord) => {
    setEditingId(sticker.id);
    setEditName(sticker.name);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  const handleConfirmRename = async () => {
    const id = editingId;
    if (!id || !editName.trim()) { setEditingId(null); return; }
    try {
      await renameSticker(id, editName.trim());
      await loadStickers();
      addToast({ type: 'success', message: t('home.stickers.renamed') });
    } catch {
      addToast({ type: 'error', message: t('home.stickers.renameFailed') });
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirmRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  const filteredStickers = stickers.filter((s) => {
    if (categoryFilter === 'custom') return s.category === 'custom';
    if (categoryFilter === 'favorite') return s.favorite === true;
    return true;
  });

  const customCount = stickers.filter((s) => s.category === 'custom').length;
  const favoriteCount = stickers.filter((s) => s.favorite === true).length;

  // ── 多选删除 ──
  const enterMultiSelect = () => {
    setMultiSelectMode(true);
    setSelectedIds(new Set());
  };
  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredStickers.map((s) => s.id)));
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
  };
  const handleMultiDelete = async () => {
    setDeleting(true);
    try {
      let ok = 0;
      let fail = 0;
      for (const id of selectedIds) {
        try {
          await deleteSticker(id);
          ok++;
        } catch {
          fail++;
        }
      }
      await loadStickers();
      if (fail === 0) {
        addToast({ type: 'success', message: t('home.stickers.deletedCount', { count: ok }) });
      } else if (ok === 0) {
        addToast({ type: 'error', message: t('home.stickers.deleteMultiFailed') });
      } else {
        addToast({ type: 'warning', message: `${t('home.stickers.deletedCount', { count: ok })} (${fail} failed)` });
      }
      setMultiDeleteConfirm(false);
      exitMultiSelect();
    } catch {
      addToast({ type: 'error', message: t('home.stickers.deleteMultiFailed') });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={sb.ref} className={`h-full overflow-y-auto p-6 ps-scroll ${sb.className}`} {...sb.handlers}>
      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div className="shrink-0">
          <h2 className="text-[1.875rem] font-[700] text-[var(--color-text-primary)] leading-tight tracking-tight">
            {t('home.stickers.galleryTitle')}
          </h2>
          <p className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] mt-0.5">
            {t('home.stickers.gallerySubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 多选按钮 */}
          {stickers.length > 0 && !multiSelectMode && (
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white text-[var(--color-gray-600)]
                         rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                         border border-[var(--color-border)] cursor-pointer transition-all duration-200
                         hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary-300)] active:scale-[0.97]"
              onClick={enterMultiSelect}
              title={t('home.stickers.multiSelect')}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M5 8h6M8 5v6" />
              </svg>
              {t('home.stickers.multiSelect')}
            </button>
          )}
          {/* 多选模式：取消按钮 */}
          {multiSelectMode && (
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white text-[var(--color-gray-600)]
                         rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                         border border-[var(--color-border)] cursor-pointer transition-all duration-200
                         hover:bg-[var(--color-surface-hover)] active:scale-[0.97]"
              onClick={exitMultiSelect}
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[image:var(--gradient-brand)] text-white
                       rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                       border-none cursor-pointer transition-all duration-200
                       hover:shadow-[var(--shadow-md)] hover:-translate-y-px active:scale-[0.97]"
            onClick={handleUploadClick}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M7 2v8M3 6l4-4 4 4" />
              <path d="M2 12h10" />
            </svg>
            {t('editor.sticker.upload')}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* ── Category Filter ── */}
      <div className="flex flex-wrap items-center gap-3 mb-7">
        <div className="flex items-center gap-1 p-1.5 bg-white rounded-[var(--radius-xl)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`
                inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                border-none cursor-pointer transition-all duration-200
                ${categoryFilter === f.value
                  ? 'bg-[image:var(--gradient-brand-soft)] text-[var(--color-brand)] shadow-[var(--shadow-sm)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)]'
                }
              `}
              onClick={() => setCategoryFilter(f.value)}
            >
              {t(f.labelKey)}
              <span className={`
                text-[var(--text-nano)] rounded-[var(--radius-full)] px-1.5 py-px min-w-[18px] text-center leading-snug
                ${categoryFilter === f.value
                  ? 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
                  : 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
                }
              `}>
                {f.value === 'all' ? stickers.length : f.value === 'custom' ? customCount : favoriteCount}
              </span>
            </button>
          ))}
        </div>

        {/* 多选操作栏 */}
        {multiSelectMode && filteredStickers.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[var(--text-caption)] text-[var(--color-text-secondary)] font-[600]">
              {t('home.stickers.selectedCount', { count: selectedIds.size })}
            </span>
            <button
              className="px-2.5 py-1 text-[var(--text-nano)] font-[600] rounded-[var(--radius-md)]
                         bg-white border border-[var(--color-border)] text-[var(--color-gray-600)]
                         hover:bg-[var(--color-surface-hover)] cursor-pointer transition-all"
              onClick={selectAllFiltered}
            >
              {t('home.stickers.selectAll')}
            </button>
            <button
              className="px-2.5 py-1 text-[var(--text-nano)] font-[600] rounded-[var(--radius-md)]
                         bg-white border border-[var(--color-border)] text-[var(--color-gray-600)]
                         hover:bg-[var(--color-surface-hover)] cursor-pointer transition-all"
              onClick={deselectAll}
              disabled={selectedIds.size === 0}
            >
              {t('home.stickers.deselectAll')}
            </button>
            <button
              className="inline-flex items-center gap-1 px-3 py-1 text-[var(--text-nano)] font-[600] rounded-[var(--radius-md)]
                         bg-[var(--color-error)] text-white border-none
                         hover:bg-[var(--color-error-dark)] cursor-pointer transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setMultiDeleteConfirm(true)}
              disabled={selectedIds.size === 0 || deleting}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
                <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
              </svg>
              {t('home.stickers.deleteSelected')}
            </button>
          </div>
        )}
      </div>

      {/* ── Sticker Grid ── */}
      {filteredStickers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
          <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[image:var(--gradient-brand-soft)] flex items-center justify-center mb-4">
            <svg viewBox="0 0 48 48" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" className="w-8 h-8">
              <rect x="8" y="8" width="32" height="32" rx="6" strokeDasharray="4 4" />
              <circle cx="24" cy="24" r="7" />
              <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <p className="text-[var(--text-body)] font-[600]">
            {stickers.length === 0 ? t('home.stickers.empty') : t('home.stickers.emptyFiltered')}
          </p>
          <p className="text-[var(--text-caption)] mt-1">
            {stickers.length === 0 ? t('home.stickers.emptyHint') : t('home.stickers.emptyFilteredHint')}
          </p>
          {stickers.length === 0 && (
            <button
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-[image:var(--gradient-brand)] text-white
                         rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                         border-none cursor-pointer transition-all duration-200
                         hover:shadow-[var(--shadow-md)] hover:-translate-y-px active:scale-[0.97]"
              onClick={handleUploadClick}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                <line x1="7" y1="2" x2="7" y2="12" />
                <line x1="2" y1="7" x2="12" y2="7" />
              </svg>
              {t('editor.sticker.upload')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
          {filteredStickers.map((sticker) => (
            <StickerCard
              key={sticker.id}
              sticker={sticker}
              onDelete={() => setDeleteTargetId(sticker.id)}
              onToggleFavorite={handleToggleFavorite}
              editingId={editingId}
              editName={editName}
              renameInputRef={renameInputRef}
              onEditNameChange={setEditName}
              onStartRename={handleStartRename}
              onConfirmRename={handleConfirmRename}
              onRenameKeyDown={handleRenameKeyDown}
              multiSelectMode={multiSelectMode}
              isSelected={selectedIds.has(sticker.id)}
              onToggleSelect={() => toggleSelect(sticker.id)}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTargetId && (
        <div className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]" onClick={() => setDeleteTargetId(null)}>
          <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
          <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-6 w-[360px] animate-[modalFadeIn_0.15s_ease-out]"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] mb-2">{t('editor.sticker.deleteTitle')}</h3>
            <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-5">
              {t('editor.sticker.deleteConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]
                                 hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary-300)] cursor-pointer transition-all"
                      onClick={() => setDeleteTargetId(null)}>
                {t('common.cancel')}
              </button>
              <button className="px-4 py-2 bg-[var(--color-error)] text-white rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] border-none
                                 hover:bg-[var(--color-error-dark)] hover:shadow-[var(--shadow-sm)] cursor-pointer transition-all"
                      onClick={() => handleDelete(deleteTargetId)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量删除确认 */}
      {multiDeleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]" onClick={() => !deleting && setMultiDeleteConfirm(false)}>
          <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
          <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-6 w-[380px] animate-[modalFadeIn_0.15s_ease-out]"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] mb-2">
              {t('home.stickers.deleteMultiTitle')}
            </h3>
            <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-5">
              {t('home.stickers.deleteMultiConfirm', { count: selectedIds.size })}
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]
                                 hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary-300)] cursor-pointer transition-all
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={deleting}
                      onClick={() => setMultiDeleteConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button className="px-4 py-2 bg-[var(--color-error)] text-white rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] border-none
                                 hover:bg-[var(--color-error-dark)] hover:shadow-[var(--shadow-sm)] cursor-pointer transition-all
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={deleting}
                      onClick={handleMultiDelete}>
                {deleting ? t('common.delete') + '...' : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 贴纸卡片 ── */
interface StickerCardProps {
  sticker: StickerRecord;
  onDelete: () => void;
  onToggleFavorite: (id: string) => void;
  editingId: string | null;
  editName: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onEditNameChange: (value: string) => void;
  onStartRename: (sticker: StickerRecord) => void;
  onConfirmRename: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

function StickerCard({
  sticker,
  onDelete,
  onToggleFavorite,
  editingId,
  editName,
  renameInputRef,
  onEditNameChange,
  onStartRename,
  onConfirmRename,
  onRenameKeyDown,
  multiSelectMode = false,
  isSelected = false,
  onToggleSelect,
}: StickerCardProps) {
  const { t } = useTranslation();
  const src = useStickerSrc(sticker.blobId);
  const isEditing = editingId === sticker.id;
  const isFavorite = sticker.favorite === true;

  return (
    <div
      className={`relative bg-white border rounded-[var(--radius-2xl)] overflow-visible
                  hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5
                  transition-all duration-200 group shadow-[var(--shadow-soft)]
                  ${isSelected
                    ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/30'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary-300)]'
                  }
                  ${multiSelectMode ? 'cursor-pointer' : ''}`}
      onClick={multiSelectMode ? onToggleSelect : undefined}
    >
      {/* 多选模式：左上角选择框 */}
      {multiSelectMode && (
        <div className={`absolute top-2.5 left-2.5 w-6 h-6 flex items-center justify-center rounded-full border-2 z-20 transition-all
                          ${isSelected
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white'
                            : 'bg-white/90 border-[var(--color-border)] text-transparent'
                          }`}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <path d="M3 8l3 3 7-7" />
          </svg>
        </div>
      )}
      {/* 预览区：透明棋盘格背景，突出贴纸主体 */}
      <div className="aspect-square p-4 flex items-center justify-center rounded-t-[var(--radius-2xl)]
                      bg-[image:var(--gradient-brand-soft)]"
           style={{
             backgroundImage:
               'repeating-conic-gradient(rgba(108,99,255,0.04) 0% 25%, transparent 0% 50%) 50% / 16px 16px',
           }}>
        {src ? (
          <img
            src={src}
            alt={sticker.name}
            className="max-w-full max-h-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
            draggable={false}
          />
        ) : (
          <div className="w-8 h-8 border-[2.5px] border-[var(--color-primary-200)] border-t-[var(--color-primary-500)] rounded-full animate-spin" />
        )}
      </div>

      {/* 信息 */}
      <div className="p-3">
        {isEditing ? (
          <input
            ref={renameInputRef}
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onBlur={onConfirmRename}
            onKeyDown={onRenameKeyDown}
            maxLength={30}
            className="w-full text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-800)]
                       px-1.5 py-0.5 outline-none border border-[var(--color-primary-300)]
                       rounded-[var(--radius-sm)] bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-800)] truncate cursor-pointer hover:text-[var(--color-brand)] transition-colors"
            title={t('home.stickers.clickToRename')}
            onClick={(e) => { e.stopPropagation(); if (!multiSelectMode) onStartRename(sticker); }}
          >
            {sticker.name}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] font-[500]">
            {sticker.width}×{sticker.height}
          </span>
          <span className="text-[var(--text-nano)] px-1.5 py-px rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-[600]">
            {t('home.stickers.customBadge')}
          </span>
        </div>
      </div>

      {/* 喜欢按钮 — 左上角，尺寸与删除按钮一致，仅 hover 显示（多选模式下隐藏） */}
      {!multiSelectMode && (
      <button
        className={`absolute top-2.5 left-2.5 w-8 h-8 flex items-center justify-center z-10
                    bg-white/90 border border-[var(--color-border)] rounded-full
                    opacity-0 group-hover:opacity-100
                    transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)]
                    ${isFavorite
                      ? 'text-[var(--color-brand)] border-[var(--color-primary-300)] bg-[var(--color-primary-50)] hover:bg-[var(--color-primary-100)]'
                      : 'text-[var(--color-gray-400)] hover:text-[var(--color-brand)] hover:border-[var(--color-primary-300)]'
                    }`}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(sticker.id); }}
        onMouseDown={(e) => e.stopPropagation()}
        title={isFavorite ? t('home.stickers.unfavorited') : t('home.stickers.favorited')}
      >
        {isFavorite ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="w-4 h-4">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        )}
      </button>
      )}

      {/* 删除按钮 — hover 显示（多选模式下隐藏） */}
      {!multiSelectMode && (
      <button
        className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center
                   bg-white/90 border border-[var(--color-border)] rounded-full
                   text-[var(--color-gray-500)] opacity-0 group-hover:opacity-100
                   hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]
                   transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)]"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title={t('editor.sticker.delete')}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
          <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
        </svg>
      </button>
      )}
    </div>
  );
}
