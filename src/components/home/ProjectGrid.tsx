import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  listProjects, saveProject, deleteProject,
  deleteProjects, duplicateProjects, loadPhotos,
} from '../../db';
import type { AlbumProject, AlbumSize, Photo } from '../../types';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT } from '../../types';
import { EmptyState } from './EmptyState';
import { PageThumbnail } from './PageThumbnail';
import { makeDirectPhotoUrl, readPhotoFromDB } from '../../engine/storage-engine';
import { SLOT_PALETTE } from '../../constants/templatePalette';
import { useUIStore } from '../../store';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';

/* ── 确认删除弹窗 ── */
function DeleteConfirmDialog({
  count, names, onCancel, onConfirm,
}: {
  count: number;
  names: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] p-6 max-w-md w-full mx-4 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[var(--color-error-light)] flex items-center justify-center shrink-0">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                   className="w-5 h-5 text-[var(--color-error)]">
                <path d="M10 2L2 18h16L10 2z" /><path d="M10 8v4" /><circle cx="10" cy="14" r="0.5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)]">
                {t('home.projectGrid.confirmDeleteTitle', { count })}
              </h3>
              <p className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] mt-1">
                {t('home.projectGrid.confirmDeleteDesc')}
              </p>
              <ul className="mt-3 space-y-1 max-h-[140px] overflow-y-auto text-[var(--text-body-sm)] text-[var(--color-gray-700)]">
                {names.map((name, i) => (
                  <li key={i} className="truncate">· {name}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--color-gray-700)]
                         bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                         hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              onClick={onCancel}
            >
              {t('home.projectGrid.cancel')}
            </button>
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] text-white
                         bg-[var(--color-error)] rounded-[var(--radius-md)]
                         hover:opacity-90 transition-opacity cursor-pointer"
              onClick={onConfirm}
            >
              {t('home.projectGrid.confirmDelete')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface ProjectGridProps {
  onOpenProject?: (project: AlbumProject) => void;
  onCreateNew?: () => void;
  refreshKey?: number | string;
  onProjectCountChange?: (count: number) => void;
}

export function ProjectGrid({ onOpenProject, onCreateNew, refreshKey, onProjectCountChange }: ProjectGridProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<AlbumProject[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sb = useScrollbarVisibility<HTMLDivElement>();

  /* 点击卡片外部关闭菜单 */
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-project-menu]')) return;
      setMenuOpenId(null);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [menuOpenId]);

  /* 多选模式 — 全局状态 */
  const multiSelectMode = useUIStore((s) => s.multiSelectMode);
  const selectedIds = useUIStore((s) => s.selectedProjectIds);
  const enterMultiSelect = useUIStore((s) => s.enterMultiSelect);
  const exitMultiSelect = useUIStore((s) => s.exitMultiSelect);
  const toggleProjectSelect = useUIStore((s) => s.toggleProjectSelect);
  const selectAll = useUIStore((s) => s.selectAll);
  const deselectAll = useUIStore((s) => s.deselectAll);
  const addToast = useUIStore((s) => s.addToast);

  /* 删除确认弹窗 */
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; names: string[] } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const SORT_KEY = 'membook-project-sort';
  const CUSTOM_ORDER_KEY = 'membook-project-custom-order';
  const [sortBy, setSortBy] = useState<'custom' | 'updatedAt' | 'createdAt' | 'name'>(() => {
    try { return (localStorage.getItem(SORT_KEY) as any) || 'custom'; } catch { return 'custom'; }
  });
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sortBy); } catch { /* ignore */ } }, [sortBy]);
  const [sortOpen, setSortOpen] = useState(false);

  const loadCustomOrder = useCallback((): string[] => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_ORDER_KEY) || '[]'); } catch { return []; }
  }, []);

  const saveCustomOrder = useCallback((order: string[]) => {
    try { localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  }, []);

  const load = useCallback(() => {
    setLoaded(false);
    Promise.all([
      listProjects(),
      loadPhotos(),
    ])
      .then(async ([projects, photos]) => {
        const processed = await Promise.all(
          photos.map(async (photo) => {
            if (photo.storageMode === 'direct') {
              const url = await makeDirectPhotoUrl(photo);
              if (url) return { ...photo, src: url };
            }
            // import 模式：从 IndexedDB 重建预览图 blob URL
            if (photo.storageMode === 'import') {
              const previewId = photo.previewBlobId || photo.blobId;
              if (previewId) {
                const url = await readPhotoFromDB(previewId);
                if (url) return { ...photo, src: url };
              }
            }
            return photo;
          })
        );
        setProjects(projects);
        setAllPhotos(processed);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    onProjectCountChange?.(projects.length);
  }, [projects.length, onProjectCountChange]);

  const realProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  /* Demo projects (built from i18n so names translate with locale) */
  const demoProjects = useMemo(() => makeDemoProjects(t), [t]);

  const filtered = searchQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects;

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'custom') {
      const customOrder = loadCustomOrder();
      list.sort((a, b) => {
        const ai = customOrder.indexOf(a.id);
        const bi = customOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } else if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'createdAt') {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return list;
  }, [filtered, sortBy, loadCustomOrder]);

  const hasRealProjects = projects.length > 0;
  const displayProjects = loaded
    ? (hasRealProjects ? sorted : demoProjects)
    : [];

  const noRealProjects = loaded && projects.length === 0 && !searchQuery;

  /* ── Keyboard shortcut: Ctrl+A in multi-select mode ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (multiSelectMode && (e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        if (selectedIds.length === realProjectIds.length) {
          deselectAll();
        } else {
          selectAll(realProjectIds);
        }
      }
      if (multiSelectMode && e.key === 'Escape') {
        exitMultiSelect();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [multiSelectMode, selectedIds, realProjectIds, selectAll, deselectAll, exitMultiSelect]);

  /* ── Drag to reorder (only real projects, not in multi-select) ── */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(projects, oldIndex, newIndex);
    setProjects(reordered);

    if (sortBy === 'custom') {
      const customOrder = reordered.map((p) => p.id);
      saveCustomOrder(customOrder);
    }

    const base = Date.now() - reordered.length * 1000;
    for (let i = 0; i < reordered.length; i++) {
      await saveProject({ ...reordered[i], updatedAt: new Date(base + i * 1000).toISOString() });
    }
  };

  /* ── Rename ── */
  const handleStartRename = (proj: AlbumProject) => {
    setEditingId(proj.id);
    setEditName(proj.name);
    setMenuOpenId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleConfirmRename = async () => {
    const id = editingId;
    if (!id || !editName.trim()) { setEditingId(null); return; }
    const proj = projects.find((p) => p.id === id);
    if (proj) {
      await saveProject({ ...proj, name: editName.trim() });
      load();
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirmRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  /* ── Duplicate (single) ── */
  const handleDuplicate = async (proj: AlbumProject) => {
    setMenuOpenId(null);
    try {
      await duplicateProjects([proj.id]);
      addToast({ message: t('home.projectGrid.duplicateToast', { name: proj.name }), type: 'success' });
    } catch {
      addToast({ message: t('home.projectGrid.duplicateFailed'), type: 'error' });
    }
    load();
  };

  /* ── Delete (single) ── */
  const handleDelete = async (proj: AlbumProject) => {
    setMenuOpenId(null);
    await deleteProject(proj.id);
    load();
  };

  /* ── Batch operations ── */
  const handleBatchDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteProjects(deleteConfirm.ids);
      addToast({ message: t('home.projectGrid.deleteToast', { count: deleteConfirm.ids.length }), type: 'success' });
    } catch {
      addToast({ message: t('home.projectGrid.deleteFailed'), type: 'error' });
    }
    setDeleteConfirm(null);
    exitMultiSelect();
    load();
  };

  const handleBatchDuplicate = async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    try {
      const copied = await duplicateProjects(ids);
      addToast({ message: t('home.projectGrid.batchDuplicateToast', { count: copied.length }), type: 'success' });
    } catch {
      addToast({ message: t('home.projectGrid.batchDuplicateFailed'), type: 'error' });
    }
    exitMultiSelect();
    load();
  };

  const handleBatchDeleteClick = () => {
    const ids = selectedIds;
    const names = ids
      .map((id) => projects.find((p) => p.id === id)?.name)
      .filter(Boolean) as string[];
    setDeleteConfirm({ ids, names });
  };

  const selectedRealCount = selectedIds.length;
  const totalRealCount = realProjectIds.length;
  const allSelected = selectedRealCount === totalRealCount && totalRealCount > 0;

  return (
    <div ref={sb.ref} className={`h-full overflow-y-auto p-6 ps-scroll ${sb.className}`} {...sb.handlers}>
      {noRealProjects && <EmptyState onCreateAlbum={onCreateNew || (() => {})} />}
      {!noRealProjects && (<>
      {/* Header — 多选模式时显示操作栏 */}
      {multiSelectMode ? (
        <div className="flex items-center gap-3 mb-6 py-2.5 px-4 bg-[image:var(--gradient-brand-soft)] rounded-[var(--radius-xl)] border border-[var(--color-primary-200)] shadow-[var(--shadow-soft)]">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-[500]
                       text-[var(--color-primary-600)] bg-white border border-[var(--color-primary-300)]
                       rounded-[var(--radius-md)] hover:bg-[var(--color-primary-50)]
                       transition-colors cursor-pointer"
            onClick={() => {
              if (allSelected) {
                deselectAll();
              } else {
                selectAll(realProjectIds);
              }
            }}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              {allSelected ? (
                <>
                  <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
                  <path d="M4.5 7l2 2 3-4" />
                </>
              ) : (
                <>
                  <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
                  <line x1="7" y1="4" x2="7" y2="10" />
                  <line x1="4" y1="7" x2="10" y2="7" />
                </>
              )}
            </svg>
            {allSelected ? t('home.projectGrid.deselectAll') : t('home.projectGrid.selectAll')}
          </button>

          <span className="text-[var(--text-body-sm)] text-[var(--color-primary-700)] font-[500]">
            {t('home.projectGrid.selected', { count: selectedRealCount })}
          </span>

          <div className="flex-1" />

          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-[500]
                        rounded-[var(--radius-md)] transition-colors cursor-pointer
                        ${selectedRealCount === 0
                          ? 'text-[var(--color-gray-400)] bg-gray-50 border border-gray-200 cursor-not-allowed'
                          : 'text-[var(--color-gray-700)] bg-white border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                        }`}
            disabled={selectedRealCount === 0}
            onClick={handleBatchDuplicate}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <rect x="2" y="2" width="10" height="10" rx="1.5" />
              <path d="M9.5 2.5v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v1" />
              <path d="M6.5 6.5h-1a1 1 0 0 0-1 1v1" />
              <path d="M7.5 6.5h1a1 1 0 0 1 1 1v1" />
            </svg>
            {t('home.projectGrid.copy')}({selectedRealCount})
          </button>

          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-[500]
                        rounded-[var(--radius-md)] transition-colors cursor-pointer
                        ${selectedRealCount === 0
                          ? 'text-[var(--color-gray-400)] bg-gray-50 border border-gray-200 cursor-not-allowed'
                          : 'text-[var(--color-error)] bg-white border border-[var(--color-error-light)] hover:bg-[var(--color-error-light)]'
                        }`}
            disabled={selectedRealCount === 0}
            onClick={handleBatchDeleteClick}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
              <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
            </svg>
            {t('home.projectGrid.delete')}({selectedRealCount})
          </button>

          <div className="w-px h-6 bg-[var(--color-primary-200)] mx-1" />

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-[500]
                       text-[var(--color-gray-600)] bg-white border border-[var(--color-border)]
                       rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)]
                       transition-colors cursor-pointer"
            onClick={exitMultiSelect}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M11 3L3 11" /><path d="M3 3l8 8" />
            </svg>
            {t('home.projectGrid.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4 mb-7">
          <div className="shrink-0">
            <h2 className="text-[1.875rem] font-[700] text-[var(--color-text-primary)] leading-tight tracking-tight">{t('home.projectGrid.myAlbums')}</h2>
            <p className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] mt-0.5">{t('home.projectGrid.subtitle')}</p>
          </div>
          <div className="flex-1" />
          <div className="relative max-w-[260px]">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-gray-400)]">
              <circle cx="6.5" cy="6.5" r="4" /><line x1="10" y1="10" x2="14" y2="14" />
            </svg>
            <input
              type="text"
              placeholder={t('home.projectGrid.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                         text-[var(--text-body-sm)] text-[var(--color-gray-800)]
                         placeholder:text-[var(--color-text-tertiary)]
                         outline-none hover:border-[var(--color-primary-300)] focus:border-[var(--color-brand)] focus:shadow-[0_0_0_4px_rgba(108,99,255,0.12)]
                         transition-all shadow-[var(--shadow-xs)]"
            />
          </div>

          {/* Sort */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[var(--color-border)]
                         rounded-[var(--radius-lg)] text-[var(--text-body-sm)] text-[var(--color-gray-600)]
                         hover:border-[var(--color-primary-300)] hover:text-[var(--color-brand)]
                         transition-all cursor-pointer shadow-[var(--shadow-xs)]"
              onClick={() => setSortOpen(!sortOpen)}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M3 3.5h8" /><path d="M4.5 7h5" /><path d="M6.5 10.5h1" />
              </svg>
              <span>
                {sortBy === 'custom' ? t('home.projectGrid.sortCustom') : sortBy === 'updatedAt' ? t('home.projectGrid.sortUpdatedAt') : sortBy === 'createdAt' ? t('home.projectGrid.sortCreatedAt') : t('home.projectGrid.sortName')}
              </span>
            </button>

            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute top-full right-0 mt-1.5 z-20 bg-white border border-[var(--color-border)]
                                rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] py-1.5 min-w-[140px] overflow-hidden">
                  {[
                    { key: 'custom' as const, label: t('home.projectGrid.sortCustom') },
                    { key: 'updatedAt' as const, label: t('home.projectGrid.sortUpdatedAt') },
                    { key: 'createdAt' as const, label: t('home.projectGrid.sortCreatedAt') },
                    { key: 'name' as const, label: t('home.projectGrid.sortNameAZ') },
                  ].map((option) => (
                    <button
                      key={option.key}
                      className={`w-full flex items-center gap-2 px-3.5 py-2 text-[var(--text-body-sm)]
                                 border-none bg-transparent cursor-pointer transition-colors
                                 ${sortBy === option.key
                                   ? 'text-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                                   : 'text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]'
                                 }`}
                      onClick={() => { setSortBy(option.key); setSortOpen(false); }}
                    >
                      {sortBy === option.key && (
                        <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3 shrink-0">
                          <path d="M10.5 3L5 9L2 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      <span className={sortBy === option.key ? '' : 'ml-[18px]'}>{option.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 选择按钮 — 进入多选模式 */}
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[var(--color-border)]
                       rounded-[var(--radius-lg)] text-[var(--text-body-sm)] text-[var(--color-gray-600)]
                       hover:border-[var(--color-primary-300)] hover:text-[var(--color-brand)]
                       transition-all cursor-pointer shadow-[var(--shadow-xs)]"
            onClick={() => enterMultiSelect()}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
              <line x1="4" y1="7" x2="10" y2="7" />
            </svg>
            {t('home.projectGrid.select')}
          </button>

          {/* 创建相册按钮 — 渐变主色调 */}
          <button
            data-onboarding="home-create-btn"
            className="flex items-center gap-2 px-5 py-2.5 bg-[image:var(--gradient-brand)] text-white
                       rounded-[var(--radius-lg)] text-[var(--text-body)] font-[600]
                       hover:shadow-[var(--shadow-md)] hover:-translate-y-px
                       transition-all duration-200 cursor-pointer"
            onClick={onCreateNew}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
              <circle cx="8" cy="8" r="6" />
              <line x1="8" y1="5" x2="8" y2="11" />
              <line x1="5" y1="8" x2="11" y2="8" />
            </svg>
            {t('home.projectGrid.createAlbum')}
          </button>
        </div>
      )}

      {/* Project Grid */}
      {!loaded ? (
        <div className="min-h-[200px]" />
      ) : displayProjects.length === 0 ? (
        <div className="col-span-full text-center py-10 text-[var(--color-text-tertiary)]">
          <p className="text-[var(--text-body-sm)]">{t('home.projectGrid.noMatch')}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={multiSelectMode ? [] : displayProjects.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5">
              {displayProjects.map((proj) => {
                const isDemo = displayProjects === demoProjects;
                const isReal = hasRealProjects && !isDemo;

                return (
                  <SortableCard
                    key={proj.id}
                    proj={proj}
                    photos={allPhotos}
                    isDemo={isDemo}
                    isSortable={!isDemo && isReal && !multiSelectMode}
                    isMultiSelect={multiSelectMode && !isDemo}
                    isSelected={selectedIds.includes(proj.id)}
                    editingId={editingId}
                    editName={editName}
                    menuOpenId={menuOpenId}
                    inputRef={inputRef}
                    onOpen={onOpenProject}
                    onStartRename={handleStartRename}
                    onConfirmRename={handleConfirmRename}
                    onRenameKeyDown={handleRenameKeyDown}
                    onEditNameChange={setEditName}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicate}
                    onToggleMenu={(id) => setMenuOpenId(menuOpenId === id ? null : id)}
                    onSelect={() => toggleProjectSelect(proj.id)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* 批量删除确认弹窗 */}
      {deleteConfirm && (
        <DeleteConfirmDialog
          count={deleteConfirm.ids.length}
          names={deleteConfirm.names}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleBatchDelete}
        />
      )}
      </>)}
      
    </div>
  );
}

/* ── Sortable Card ── */
function SortableCard({
  proj, photos, isDemo, isSortable, isMultiSelect, isSelected,
  editingId, editName, menuOpenId, inputRef,
  onOpen, onStartRename, onConfirmRename, onRenameKeyDown, onEditNameChange,
  onDelete, onDuplicate, onToggleMenu, onSelect,
}: {
  proj: AlbumProject;
  photos: Photo[];
  isDemo: boolean;
  isSortable: boolean;
  isMultiSelect: boolean;
  isSelected: boolean;
  editingId: string | null;
  editName: string;
  menuOpenId: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpen?: (p: AlbumProject) => void;
  onStartRename: (p: AlbumProject) => void;
  onConfirmRename: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onEditNameChange: (v: string) => void;
  onDelete: (p: AlbumProject) => void;
  onDuplicate: (p: AlbumProject) => void;
  onToggleMenu: (id: string) => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: proj.id, disabled: !isSortable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
  };

  const isEditing = editingId === proj.id;
  const isMenuOpen = menuOpenId === proj.id;
  const size: AlbumSize = proj.size ?? { id: 'a4-default', name: t('home.projectGrid.fallbackSizeName'), width: 210, height: 280, desc: '210×280 mm' };

  const handleCardClick = () => {
    if (isEditing) return;
    if (isMultiSelect) {
      onSelect();
    } else {
      onOpen?.(proj);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-project-card={proj.id}
      className={`
        bg-[image:var(--gradient-brand-soft)] border rounded-[var(--radius-2xl)] overflow-hidden
        transition-all duration-200 group shadow-[var(--shadow-soft)]
        ${isMultiSelect && isSelected
          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand-light)]'
          : isMenuOpen
            ? 'border-[var(--color-primary-300)] shadow-[var(--shadow-md)]'
            : 'border-[var(--color-border)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-primary-300)] hover:-translate-y-0.5'
        }
      `}
    >
      {/* Thumbnail — 统一 4:3 比例，所有卡片行高一致 */}
      <div
        className="aspect-[4/3] bg-[image:var(--gradient-surface)] p-3 relative cursor-pointer"
        onClick={handleCardClick}
        {...(isMultiSelect ? {} : attributes)}
        {...(isSortable && !isMultiSelect ? listeners : {})}
      >
        {/* Drag hint on hover */}
        {isSortable && !isMultiSelect && (
          <div className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center
                          bg-white/80 rounded-[var(--radius-md)] opacity-0 group-hover:opacity-100
                          text-[var(--color-gray-400)] transition-opacity pointer-events-none z-10 shadow-[var(--shadow-xs)]">
            <svg viewBox="0 0 10 10" fill="currentColor" className="w-3 h-3">
              <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="5" r="1.2" /><circle cx="7" cy="5" r="1.2" />
              <circle cx="3" cy="8" r="1.2" /><circle cx="7" cy="8" r="1.2" />
            </svg>
          </div>
        )}

        {/* 多选模式下的复选框 */}
        {isMultiSelect && (
          <div className={`absolute top-2 left-2 w-6 h-6 flex items-center justify-center rounded-full border-2 z-10
                          transition-all duration-150 shadow-[var(--shadow-xs)]
                          ${isSelected
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white'
                            : 'bg-white/90 border-[var(--color-gray-400)] text-transparent group-hover:border-[var(--color-brand)]'
                          }`}
          >
            {isSelected && (
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M2.5 6l2.5 2.5 4.5-5" />
              </svg>
            )}
          </div>
        )}

        {/* 封面缩略图 — 居中填满 */}
        <div className="absolute inset-[12px] flex items-center justify-center">
          <div
            className="relative"
            style={{
              aspectRatio: `${size.width} / ${size.height}`,
              maxWidth: '100%',
              maxHeight: '100%',
              ...(size.width / size.height > 4 / 3
                ? { width: '100%' }
                : { height: '100%' }),
            }}
          >
            {proj.pages && proj.pages.length > 0 ? (
              <PageThumbnail page={proj.pages[0]} photos={photos} albumSize={size} />
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-md)]"
                style={{ backgroundImage: SLOT_PALETTE[0] }}
              >
                <div className="w-12 h-12 rounded-full bg-white/60 flex items-center justify-center shadow-[var(--shadow-xs)]">
                  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-6 h-6 text-[var(--color-brand)]">
                    <rect x="4" y="4" width="24" height="24" rx="3" />
                    <circle cx="13" cy="12" r="3.5" />
                    <path d="M6 26l7-8 5 5 7-7 6 10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info — 统一高度，便于阅读 */}
      <div className="p-3.5 flex flex-col h-[78px] justify-between">
        {/* Name */}
        <div className="flex items-start gap-1.5 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onBlur={onConfirmRename}
              onKeyDown={onRenameKeyDown}
              maxLength={30}
              className="flex-1 text-[var(--text-body)] font-[600] text-[var(--color-gray-800)]
                         bg-[var(--color-primary-50)] border border-[var(--color-primary-300)]
                         rounded-[var(--radius-sm)] px-2 py-0.5 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)] truncate flex-1 min-w-0
                         cursor-pointer hover:text-[var(--color-brand)] transition-colors"
              onClick={(e) => { e.stopPropagation(); onStartRename(proj); }}
              title={t('home.projectGrid.clickToRename')}
            >
              {proj.name}
            </span>
          )}
          {isDemo && (
            <span className="text-[var(--text-nano)] text-[var(--color-primary-600)] bg-[var(--color-primary-50)] px-2 py-0.5 rounded-full shrink-0 mt-0.5 font-[500]">
              {t('home.projectGrid.demo')}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="text-[var(--text-caption)] text-[var(--color-gray-400)] truncate font-[500]">
            {t('home.projectGrid.pageCount', { count: proj.pages?.length || 0, size: proj.size?.desc || t('home.projectGrid.defaultSize') })}
          </div>
          <div className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
            {proj.updatedAt ? timeAgo(proj.updatedAt, t) : t('home.projectGrid.notEdited')}
          </div>
        </div>
      </div>

      {/* "..." menu (real projects only) — 在多选模式下隐藏 */}
      {!isDemo && !isMultiSelect && (
        <>
          <button
            data-project-menu
            className={`absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center
                       bg-white/90 border border-[var(--color-border)] rounded-full
                       text-[var(--color-gray-500)]
                       hover:bg-white hover:text-[var(--color-brand)] hover:border-[var(--color-primary-300)]
                       transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)]
                       ${isMenuOpen ? 'opacity-100 text-[var(--color-brand)] border-[var(--color-primary-300)]' : 'opacity-0 group-hover:opacity-100'}`}
            onClick={(e) => { e.stopPropagation(); onToggleMenu(proj.id); }}
            title={t('home.projectGrid.moreActions')}
          >
            <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5">
              <circle cx="7" cy="3" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="7" cy="11" r="1.2" />
            </svg>
          </button>

          {isMenuOpen && (
            <div data-project-menu className="absolute top-10 right-2.5 z-20 bg-white border border-[var(--color-border)]
                            rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] py-1.5 min-w-[130px] overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                             text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                             border-none bg-transparent cursor-pointer transition-colors"
                  onClick={(e) => { e.stopPropagation(); onStartRename(proj); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
                  </svg>
                  {t('home.projectGrid.rename')}
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                             text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                             border-none bg-transparent cursor-pointer transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDuplicate(proj); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <rect x="2" y="2" width="10" height="10" rx="1.5" />
                    <path d="M9.5 2.5v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v1" />
                    <path d="M6.5 6.5h-1a1 1 0 0 0-1 1v1" />
                    <path d="M7.5 6.5h1a1 1 0 0 1 1 1v1" />
                  </svg>
                  {t('home.projectGrid.copy')}
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                             text-[var(--color-error)] hover:bg-[var(--color-error-light)]
                             border-none bg-transparent cursor-pointer transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDelete(proj); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
                    <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
                  </svg>
                  {t('home.projectGrid.deleteAction')}
                </button>
              </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Demo fallback projects ── */
function makeDemoProjects(t: (key: string, options?: Record<string, unknown>) => string): AlbumProject[] {
  const now = Date.now();
  return [
    { id: 'demo-1', name: t('home.projectGrid.demoAlbum1Name'), margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'sq-210', name: t('home.projectGrid.demoSizeSquare'), width: 210, height: 210, desc: '210×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(now - 3 * 86400000 + 2 * 3600000).toISOString() },
    { id: 'demo-2', name: t('home.projectGrid.demoAlbum2Name'), margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'v-210', name: t('home.projectGrid.demoSizePortrait'), width: 210, height: 280, desc: '210×280 mm' }, pages: [], createdAt: '', updatedAt: new Date(now - 7 * 86400000 + 5 * 3600000 + 30 * 60000).toISOString() },
    { id: 'demo-3', name: t('home.projectGrid.demoAlbum3Name'), margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'h-297', name: t('home.projectGrid.demoSizeLandscape'), width: 297, height: 210, desc: '297×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(now - 14 * 86400000 + 8 * 3600000).toISOString() },
    { id: 'demo-4', name: t('home.projectGrid.demoAlbum4Name'), margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'sq-210', name: t('home.projectGrid.demoSizeSquare'), width: 210, height: 210, desc: '210×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(now - 30 * 86400000 + 12 * 3600000).toISOString() },
  ];
}

function timeAgo(iso: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (days === 0) return t('home.projectGrid.timeAgoToday', { time });
  if (days === 1) return t('home.projectGrid.timeAgoYesterday', { time });
  if (date.getFullYear() === now.getFullYear()) return t('home.projectGrid.timeAgoThisYear', { month: date.getMonth() + 1, day: date.getDate(), time });
  return t('home.projectGrid.timeAgoOtherYear', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), time });
}
