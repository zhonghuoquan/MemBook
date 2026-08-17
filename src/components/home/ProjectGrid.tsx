import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
import { CoverPageCard } from './CoverPageCard';
import { BookPreviewOverlay } from '../editor/BookPreviewOverlay';
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
  // 主页相册卡片全屏查看：记录当前进入全屏的项目（退出后仍停留在相册主页）
  const [fullscreenProject, setFullscreenProject] = useState<AlbumProject | null>(null);

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
  const sortBtnRef = useRef<HTMLDivElement>(null);
  const [sortRect, setSortRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // 打开下拉时测量按钮位置（portal 定位用）
  useEffect(() => {
    if (!sortOpen) { setSortRect(null); return; }
    const el = sortBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSortRect({ top: r.top + r.height, left: r.right, width: r.width });
  }, [sortOpen]);

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
          <div ref={sortBtnRef} className="relative">
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
          </div>

          {/* 排序下拉 — 用 portal 渲染到 body，避免被相册卡片的 transform 叠加层遮挡（必定在最顶层） */}
          {sortOpen && sortRect && createPortal(
            <>
              <div className="fixed inset-0 z-[9999]" onClick={() => setSortOpen(false)} />
              <div
                className="fixed z-[10000] bg-white border border-[var(--color-border)]
                           rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] py-1.5 min-w-[140px] overflow-hidden"
                style={{ top: sortRect.top + 6, right: window.innerWidth - sortRect.left }}
              >
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
            </>,
            document.body,
          )}

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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-14 gap-y-12">
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
                    onFullscreen={() => setFullscreenProject(proj)}
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

      {/* 相册卡片左上角眼睛：进入「真实效果预览」（实物书翻页预览，退出后仍停留相册主页） */}
      {fullscreenProject && (
        <BookPreviewOverlay
          open
          onClose={() => setFullscreenProject(null)}
          pages={fullscreenProject.pages}
          photos={allPhotos}
          albumSize={fullscreenProject.size ?? null}
          topBarTitle={fullscreenProject.name}
        />
      )}
      
    </div>
  );
}

/* ── Sortable Card ── */
/** 封面高度上限（相对列宽的倍率）：封面高 ≤ 列宽 × 该值，避免过长相册撑爆行高 */
const MAX_COVER_RATIO = 1.5;
/** 封面最大宽度（px）：封面不超过该宽度，在列内居中，两侧留白更有呼吸感 */
const MAX_COVER_WIDTH = 200;

function SortableCard({
  proj, photos, isDemo, isSortable, isMultiSelect, isSelected,
  editingId, editName, menuOpenId, inputRef,
  onOpen, onStartRename, onConfirmRename, onRenameKeyDown, onEditNameChange,
  onDelete, onDuplicate, onToggleMenu, onSelect, onFullscreen,
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
  /** 左上角眼睛按钮 → 全屏查看该相册 */
  onFullscreen: () => void;
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

  // 封面自适应尺寸：按相册比例铺满，但高度不超过列宽 × MAX_COVER_RATIO（保持比例不拉伸）
  const coverAreaRef = useRef<HTMLDivElement>(null);
  const [coverSize, setCoverSize] = useState({ w: 0, h: 0 });
  const coverAspect = size.width / size.height;
  useEffect(() => {
    const el = coverAreaRef.current;
    if (!el) return;
    const update = () => {
      const aw = el.clientWidth;
      const ah = el.clientHeight;
      if (aw <= 0 || ah <= 0) return;
      const cap = aw * MAX_COVER_RATIO;
      let w = Math.min(aw, MAX_COVER_WIDTH);
      let h = w / coverAspect;
      // 高度超上限 → 等比缩小（按高度反向推宽），保持比例
      if (h > cap) { h = cap; w = h * coverAspect; }
      // 宽度仍不应超过区域宽度
      if (w > aw) { w = aw; h = w / coverAspect; }
      setCoverSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [coverAspect]);

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
      className="group relative flex flex-col"
    >
      {/* 封面区 — flex-1 按行内最高相册自适应高度，封面按真实比例居中 */}
      <div ref={coverAreaRef} className="relative flex-1 flex items-center justify-center">
        {/* 封面 — 悬浮放大作用于封面本身 */}
        <div
          className={`
            relative w-full cursor-pointer rounded-[7px]
            transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
            ${isMultiSelect && isSelected
              ? 'ring-2 ring-[var(--color-brand)] ring-offset-2 ring-offset-transparent'
              : ''}
            ${isMenuOpen
              ? 'shadow-[0_24px_48px_-12px_rgba(0,0,0,0.28)] -translate-y-1.5'
              : 'group-hover:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.28)] group-hover:-translate-y-1.5 group-hover:scale-[1.03]'}
          `}
          style={{
            width: coverSize.w || '100%',
            height: coverSize.h || 'auto',
            aspectRatio: `${size.width} / ${size.height}`,
          }}
          onClick={handleCardClick}
          {...(isMultiSelect ? {} : attributes)}
          {...(isSortable && !isMultiSelect ? listeners : {})}
        >
          {/* 左上角全屏查看按钮（眼睛图标，悬浮显示） */}
          {!isMultiSelect && proj.pages && proj.pages.length > 0 && (
            <button
              title={t('home.projectGrid.fullscreenView')}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onFullscreen(); }}
              className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center
                         rounded-full backdrop-blur shadow-[var(--shadow-xs)] z-10 cursor-pointer
                         bg-[var(--color-surface)]/85 border border-[var(--color-border)]
                         text-[var(--color-gray-500)] hover:text-[var(--color-brand)] hover:border-[var(--color-primary-300)]
                         opacity-0 group-hover:opacity-100 transition-all duration-150"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
                <circle cx="8" cy="8" r="2.3" />
              </svg>
            </button>
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

          {proj.pages && proj.pages.length > 0 ? (
            <CoverPageCard page={proj.pages[0]} photos={photos} albumSize={size} />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center rounded-[1px_2px_3px_1px]"
              style={{ backgroundImage: SLOT_PALETTE[0] }}
            >
              <div className="w-14 h-14 rounded-full bg-white/60 flex items-center justify-center shadow-[var(--shadow-xs)]">
                <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-7 h-7 text-[var(--color-brand)]">
                  <rect x="4" y="4" width="24" height="24" rx="3" />
                  <circle cx="13" cy="12" r="3.5" />
                  <path d="M6 26l7-8 5 5 7-7 6 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          )}

          {/* "..." menu (real projects only) — 在多选模式下隐藏 */}
          {!isDemo && !isMultiSelect && (
            <>
              <button
                data-project-menu
                className={`absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center
                           bg-[var(--color-surface)]/85 backdrop-blur border border-[var(--color-border)]
                           rounded-full text-[var(--color-gray-500)]
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
                <div data-project-menu className="absolute top-11 right-2.5 z-20 bg-white border border-[var(--color-border)]
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
      </div>

      {/* Info — 等高信息区，文字更小，内容居中 */}
      <div className="mt-2.5 h-[52px] px-0.5 flex flex-col items-center justify-between text-center">
        <div className="flex items-center justify-center gap-1.5 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onBlur={onConfirmRename}
              onKeyDown={onRenameKeyDown}
              maxLength={30}
              className="flex-1 min-w-0 text-[13px] font-[600] text-[var(--color-gray-800)]
                         bg-[var(--color-primary-50)] border border-[var(--color-primary-300)]
                         rounded-[var(--radius-sm)] px-2 py-0.5 outline-none text-center"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-[13px] font-[600] text-[var(--color-gray-800)] truncate max-w-full
                         cursor-pointer hover:text-[var(--color-primary-600)] transition-colors"
              onClick={(e) => { e.stopPropagation(); onStartRename(proj); }}
              title={t('home.projectGrid.clickToRename')}
            >
              {proj.name}
            </span>
          )}
          {isDemo && (
            <span className="text-[10px] text-[var(--color-primary-600)] bg-[var(--color-primary-50)] px-1.5 py-0.5 rounded-full shrink-0 font-[500]">
              {t('home.projectGrid.demo')}
            </span>
          )}
        </div>

        <div className="text-[11px] leading-snug text-[var(--color-text-tertiary)] truncate max-w-full">
          {t('home.projectGrid.pageCount', { count: proj.pages?.length || 0, size: proj.size?.desc || t('home.projectGrid.defaultSize') })}
        </div>
        <div className="text-[11px] leading-snug text-[var(--color-text-tertiary)]">
          {proj.updatedAt ? timeAgo(proj.updatedAt, t) : t('home.projectGrid.notEdited')}
        </div>
      </div>
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
