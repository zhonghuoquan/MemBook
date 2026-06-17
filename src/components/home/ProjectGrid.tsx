import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { listProjects, saveProject, deleteProject } from '../../db';
import type { AlbumProject } from '../../types';
import { PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT } from '../../types';
import { EmptyState } from './EmptyState';
import { templatePreview } from '../../utils/templatePreview';

interface ProjectGridProps {
  onOpenProject?: (project: AlbumProject) => void;
  onCreateNew?: () => void;
}

export function ProjectGrid({ onOpenProject, onCreateNew }: ProjectGridProps) {
  const [projects, setProjects] = useState<AlbumProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'name'>('updatedAt');
  const [sortOpen, setSortOpen] = useState(false);

  const load = useCallback(() => {
    setLoaded(false);
    listProjects()
      .then((data) => { setProjects(data); setLoaded(true); })
      .catch(() => { setLoaded(true); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = searchQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects;

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'createdAt') {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return list;
  }, [filtered, sortBy]);

  const hasRealProjects = projects.length > 0;
  // 只有在 Dexie 查询完成后、且没有真实项目时，才显示示例数据
  const displayProjects = loaded
    ? (hasRealProjects ? sorted : demoProjects)
    : [];

  const noRealProjects = loaded && projects.length === 0 && !searchQuery;

  if (noRealProjects) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <EmptyState onCreateAlbum={onCreateNew || (() => {})} />
      </div>
    );
  }

  /* ── Drag to reorder (only real projects) ── */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(projects, oldIndex, newIndex);
    setProjects(reordered);

    // Persist new order by saving each project with a sequenced updatedAt
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

/* ── Duplicate ── */
  const handleDuplicate = async (proj: AlbumProject) => {
    setMenuOpenId(null);
    const now = new Date().toISOString();
    const copy: AlbumProject = {
      ...JSON.parse(JSON.stringify(proj)),
      id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${proj.name} (副本)`,
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(copy);
    load();
  };

  /* ── Delete ── */
  const handleDelete = async (proj: AlbumProject) => {
    setMenuOpenId(null);
    await deleteProject(proj.id);
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-[2.25rem] font-[600] text-[var(--color-text-primary)] shrink-0 leading-tight">我的相册</h2>
        <div className="relative flex-1 max-w-[240px]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
               className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-gray-400)]">
            <circle cx="6.5" cy="6.5" r="4" /><line x1="10" y1="10" x2="14" y2="14" />
          </svg>
          <input
            type="text"
            placeholder="搜索相册…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                       text-[var(--text-body-sm)] text-[var(--color-gray-800)]
                       placeholder:text-[var(--color-text-tertiary)]
                       outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_rgba(108,99,255,0.15)]
                       transition-all"
          />
        </div>

        {/* Sort */}
        <div className="relative">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[var(--color-border)]
                       rounded-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-600)]
                       hover:border-[var(--color-border-hover)] hover:text-[var(--color-gray-800)]
                       transition-all cursor-pointer"
            onClick={() => setSortOpen(!sortOpen)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M3 3.5h8" /><path d="M4.5 7h5" /><path d="M6.5 10.5h1" />
            </svg>
            <span>
              {sortBy === 'updatedAt' ? '最近更新' : sortBy === 'createdAt' ? '创建时间' : '名称'}
            </span>
          </button>

          {sortOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-20 bg-white border border-[var(--color-border)]
                              rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1 min-w-[130px]">
                {[
                  { key: 'updatedAt' as const, label: '最近更新' },
                  { key: 'createdAt' as const, label: '创建时间' },
                  { key: 'name' as const, label: '名称 A-Z' },
                ].map((option) => (
                  <button
                    key={option.key}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
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
      </div>

      {/* Project Grid with drag & drop */}
      {!loaded ? (
        /* Loading — 不渲染任何内容，避免闪烁 */
        <div className="min-h-[200px]" />
      ) : displayProjects.length === 0 ? (
        <div className="col-span-full text-center py-10 text-[var(--color-text-tertiary)]">
          <p className="text-[var(--text-body-sm)]">没有找到匹配的相册</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayProjects.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
              {displayProjects.map((proj) => {
                const isDemo = !proj.id.startsWith('project-');
                const isReal = hasRealProjects && !(displayProjects === demoProjects);

                return (
                  <SortableCard
                    key={proj.id}
                    proj={proj}
                    isDemo={isDemo}
                    isSortable={!isDemo && isReal}
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
                    onCloseMenu={() => setMenuOpenId(null)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/* ── Sortable Card ── */
function SortableCard({
  proj, isDemo, isSortable,
  editingId, editName, menuOpenId, inputRef,
  onOpen, onStartRename, onConfirmRename, onRenameKeyDown, onEditNameChange,
  onDelete, onDuplicate, onToggleMenu, onCloseMenu,
}: {
  proj: AlbumProject;
  isDemo: boolean;
  isSortable: boolean;
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
  onCloseMenu: () => void;
}) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-[var(--color-border)] rounded-[var(--radius-xl)] overflow-hidden
                 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-border-hover)]
                 transition-all duration-150 group"
    >
      {/* Thumbnail — drag handle */}
      <div
        className="aspect-[3/2] bg-[var(--color-gray-50)] p-3 cursor-pointer relative"
        onClick={() => { if (!isEditing) onOpen?.(proj); }}
        {...attributes}
        {...(isSortable ? listeners : {})}
      >
        {/* Drag hint on hover */}
        {isSortable && (
          <div className="absolute top-1.5 left-1.5 w-5 h-5 flex items-center justify-center
                          bg-white/70 rounded-[var(--radius-xs)] opacity-0 group-hover:opacity-100
                          text-[var(--color-gray-400)] transition-opacity pointer-events-none">
            <svg viewBox="0 0 10 10" fill="currentColor" className="w-3 h-3">
              <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="5" r="1.2" /><circle cx="7" cy="5" r="1.2" />
              <circle cx="3" cy="8" r="1.2" /><circle cx="7" cy="8" r="1.2" />
            </svg>
          </div>
        )}

        <div className="w-full h-full relative">
          {proj.pages && proj.pages.length > 0 ? (
            templatePreview(proj.pages[0].templateId)
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[var(--color-gray-50)]">
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-8 h-8 text-[var(--color-gray-300)]">
                <rect x="4" y="4" width="24" height="24" rx="3" />
                <circle cx="13" cy="12" r="3.5" />
                <path d="M6 26l7-8 5 5 7-7 6 10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        {/* Name */}
        <div className="flex items-center gap-1.5 min-h-[1.5em]">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onBlur={onConfirmRename}
              onKeyDown={onRenameKeyDown}
              maxLength={30}
              className="flex-1 text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]
                         bg-[var(--color-primary-50)] border border-[var(--color-primary-300)]
                         rounded-[var(--radius-xs)] px-1.5 py-0.5 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)] truncate
                         cursor-pointer hover:text-[var(--color-brand)] transition-colors flex-1"
              onClick={(e) => { e.stopPropagation(); onStartRename(proj); }}
              title="点击重命名"
            >
              {proj.name}
            </span>
          )}
          {isDemo && (
            <span className="text-[var(--text-nano)] text-[var(--color-primary-500)] bg-[var(--color-primary-50)] px-1.5 py-0.5 rounded-full shrink-0">
              示例
            </span>
          )}
        </div>

        <div className="text-[var(--text-caption)] text-[var(--color-text-secondary)]">
          {proj.pages?.length || 0} 页 · {proj.size?.desc || '210×280 mm'}
        </div>
        <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
          {proj.updatedAt ? timeAgo(proj.updatedAt) : '未编辑'}
        </div>
      </div>

      {/* "..." menu (real projects only) */}
      {!isDemo && (
        <>
          <button
            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center
                       bg-white/80 border border-[var(--color-border)] rounded-full
                       text-[var(--color-gray-500)] opacity-0 group-hover:opacity-100
                       hover:bg-white hover:text-[var(--color-gray-700)]
                       transition-all duration-150 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(proj.id); }}
            title="更多操作"
          >
            <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5">
              <circle cx="7" cy="3" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="7" cy="11" r="1.2" />
            </svg>
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={onCloseMenu} />
              <div className="absolute top-9 right-2 z-20 bg-white border border-[var(--color-border)]
                              rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1 min-w-[120px]">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)]
                             text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]
                             border-none bg-transparent cursor-pointer transition-colors"
                  onClick={(e) => { e.stopPropagation(); onStartRename(proj); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
                  </svg>
                  重命名
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
                  复制
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
                  删除
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Demo fallback projects ── */
const demoProjects: AlbumProject[] = [
  { id: 'demo-1', name: '我的家庭相册', margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'sq-210', name: '正方形', width: 210, height: 210, desc: '210×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(Date.now() - 3 * 86400000 + 2 * 3600000).toISOString() },
  { id: 'demo-2', name: '宝宝成长记录', margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'v-210', name: '竖版', width: 210, height: 280, desc: '210×280 mm' }, pages: [], createdAt: '', updatedAt: new Date(Date.now() - 7 * 86400000 + 5 * 3600000 + 30 * 60000).toISOString() },
  { id: 'demo-3', name: '2025 年度旅行', margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'h-297', name: '横版', width: 297, height: 210, desc: '297×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(Date.now() - 14 * 86400000 + 8 * 3600000).toISOString() },
  { id: 'demo-4', name: '婚礼纪念册', margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT }, size: { id: 'sq-210', name: '正方形', width: 210, height: 210, desc: '210×210 mm' }, pages: [], createdAt: '', updatedAt: new Date(Date.now() - 30 * 86400000 + 12 * 3600000).toISOString() },
];

function timeAgo(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
