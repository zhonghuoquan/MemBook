import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { TEMPLATES } from '../../types';
import type { AlbumSize, CustomTemplate, SlotLayout, PageMargin } from '../../types';
import { CreateDialog } from './CreateDialog';
import { CreateTemplateDialog } from './CreateTemplateDialog';
import { listCustomTemplates, deleteCustomTemplate, createCustomTemplate } from '../../db';

interface TemplateGalleryProps {
  onCreateFromTemplate: (templateId: string, name: string, size: AlbumSize) => void;
}

/** 
 * 照片数量分类
 * 1图 / 2图 / 3图 / 4图 / 多图 (>=5)
 */
type CountFilter = 'all' | 1 | 2 | 3 | 4 | 5;

const COUNT_FILTERS: { label: string; value: CountFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '1图', value: 1 },
  { label: '2图', value: 2 },
  { label: '3图', value: 3 },
  { label: '4图', value: 4 },
  { label: '多图', value: 5 },
];

/** 统一模板卡片的数据结构（系统or自定义） */
interface FlatTemplate {
  id: string;
  name: string;
  slots: SlotLayout[];
  isBuiltIn: boolean;
  category?: string;
  createdAt?: string;
}

export function TemplateGallery({ onCreateFromTemplate }: TemplateGalleryProps) {
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [showTemplateMaker, setShowTemplateMaker] = useState(false);

  // 加载自定义模板
  const loadCustomTemplates = useCallback(async () => {
    try {
      const list = await listCustomTemplates();
      setCustomTemplates(list);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadCustomTemplates();
  }, [loadCustomTemplates]);

  // 模板创建成功后刷新
  const handleTemplateCreated = () => {
    loadCustomTemplates();
  };

  // 合并系统模板 + 自定义模板为 FlatTemplate[]
  const allTemplates: FlatTemplate[] = useMemo(() => {
    const system: FlatTemplate[] = TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      slots: t.slots,
      isBuiltIn: true,
      category: t.category === 'classic' ? '经典布局' : '创意布局',
    }));
    const custom: FlatTemplate[] = customTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      slots: t.slots,
      isBuiltIn: false,
      category: '自定义',
      createdAt: t.createdAt,
    }));
    return [...system, ...custom];
  }, [customTemplates]);

  // 按数量筛选
  const filteredAll = useMemo(() => {
    return allTemplates.filter((t) => {
      if (countFilter === 'all') return true;
      const n = t.slots.length;
      if (countFilter === 5) return n >= 5;
      return n === countFilter;
    });
  }, [allTemplates, countFilter]);

  // 渲染全部模板为平面网格
  const displayTemplates = filteredAll;

  // 创建相册弹窗
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  // 编辑模板 — 改为每个 TemplateCard 自己管理，这里移除父级状态
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleTemplateClick = (templateId: string) => {
    setPendingTemplateId(templateId);
    setShowCreateAlbum(true);
  };

  const handleCreateFromDialog = (name: string, size: AlbumSize, margin: PageMargin) => {
    if (pendingTemplateId) {
      onCreateFromTemplate(pendingTemplateId, name, size);
    }
    setPendingTemplateId(null);
  };

  const handleCloseAlbumDialog = () => {
    setShowCreateAlbum(false);
    setPendingTemplateId(null);
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteCustomTemplate(id);
    loadCustomTemplates();
    setDeleteTargetId(null);
  };

  const handleCopyTemplate = async (tmpl: FlatTemplate) => {
    if (tmpl.isBuiltIn) {
      // 系统模板 → 复制为自定义模板
      const sysTemplate = TEMPLATES.find((t) => t.id === tmpl.id);
      if (!sysTemplate) return;
      await createCustomTemplate(sysTemplate.name + '(副本)', sysTemplate.slots);
    } else {
      const custom = customTemplates.find((c) => c.id === tmpl.id);
      if (!custom) return;
      await createCustomTemplate(custom.name + '(副本)', custom.slots);
    }
    loadCustomTemplates();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <h2 className="text-[2.25rem] font-[600] text-[var(--color-text-primary)] shrink-0 leading-tight">
            模板库
          </h2>
          <span className="text-[var(--text-body-sm)] text-[var(--color-text-tertiary)] hidden sm:inline">
            选择一个模板开始制作你的专属相册
          </span>
        </div>

        {/* Create Template Button */}
        <button
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--color-primary-600)] text-white
                     rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[500]
                     border-none cursor-pointer transition-all duration-150
                     hover:bg-[var(--color-primary-700)] active:scale-[0.97]
                     shadow-[var(--shadow-xs)]"
          onClick={() => setShowTemplateMaker(true)}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
          创建模板
        </button>
      </div>

      {/* ── Photo Count Filter ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1 p-1 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)]">
          {COUNT_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`
                px-3 py-1.5 rounded-[var(--radius-md)] text-[var(--text-caption)] font-[500]
                border-none cursor-pointer transition-all duration-150
                ${countFilter === f.value
                  ? 'bg-white text-[var(--color-brand)] shadow-[var(--shadow-xs)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
                }
              `}
              onClick={() => setCountFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Flat Template Grid ── */}
      {displayTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-12 h-12 mb-3 text-[var(--color-gray-300)]">
            <rect x="4" y="4" width="40" height="40" rx="4" strokeDasharray="4 4" />
            <line x1="16" y1="24" x2="32" y2="24" strokeWidth="1.5" />
            <line x1="24" y1="16" x2="24" y2="32" strokeWidth="1.5" />
          </svg>
          <p className="text-[var(--text-body)]">该分类暂无模板</p>
          <p className="text-[var(--text-caption)] mt-1">试试其他筛选条件</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {displayTemplates.map((tmpl) => {
            // 找到对应的自定义模板原始数据（用于编辑）
            const customData = tmpl.isBuiltIn ? undefined : customTemplates.find((c) => c.id === tmpl.id);
            return (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                customData={customData}
                onCreate={() => handleTemplateClick(tmpl.id)}
                onCopy={() => handleCopyTemplate(tmpl)}
                onDelete={tmpl.isBuiltIn ? undefined : () => setDeleteTargetId(tmpl.id)}
                onModified={loadCustomTemplates}
              />
            );
          })}
          {/* Create template entry */}
          <CreateTemplateCard onClick={() => setShowTemplateMaker(true)} />
        </div>
      )}

      {/* Create Album Dialog */}
      {pendingTemplateId && (
        <CreateDialog
          open={showCreateAlbum}
          onClose={handleCloseAlbumDialog}
          onCreate={handleCreateFromDialog}
          title="使用模板创建相册"
        />
      )}

      {/* Create Template Dialog */}
      <CreateTemplateDialog
        open={showTemplateMaker}
        onClose={() => setShowTemplateMaker(false)}
        onCreated={handleTemplateCreated}
      />

      {/* Delete Confirmation */}
      {deleteTargetId && (
        <div className="fixed inset-0 flex items-center justify-center z-[var(--z-overlay)]" onClick={() => setDeleteTargetId(null)}>
          <div className="absolute inset-0 bg-[var(--color-surface-overlay)]" />
          <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] p-6 w-[360px] animate-[modalFadeIn_0.15s_ease-out]"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-h3)] font-[600] text-[var(--color-gray-800)] mb-2">删除模板</h3>
            <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-5">
              确定要删除此模板吗？此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-md)]
                                 text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)]
                                 hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                      onClick={() => setDeleteTargetId(null)}>
                取消
              </button>
              <button className="px-4 py-2 bg-[var(--color-error)] text-white rounded-[var(--radius-md)]
                                 text-[var(--text-body-sm)] font-[500] border-none
                                 hover:bg-[var(--color-error-dark)] cursor-pointer transition-colors"
                      onClick={() => handleDeleteTemplate(deleteTargetId)}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Template Card ── */
function TemplateCard({
  template,
  customData,
  onCreate,
  onCopy,
  onDelete,
  onModified,
}: {
  template: FlatTemplate;
  customData?: CustomTemplate;
  onCreate: () => void;
  onCopy: () => void;
  onDelete?: () => void;
  onModified: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const canEdit = !!customData;

  return (
    <>
      <div className="relative bg-white border border-[var(--color-border)] rounded-[var(--radius-xl)] overflow-visible
                      hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-border-hover)]
                      transition-all duration-150 group cursor-pointer">
        {/* Preview — click to create album */}
        <div className="aspect-[4/3] bg-[var(--color-gray-50)] p-4 flex items-center justify-center rounded-t-[var(--radius-xl)]"
             onClick={onCreate}>
          <div className="w-full h-full max-w-[140px] max-h-[105px]">
            <TemplateSlotPreview slots={template.slots} />
          </div>
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)] truncate"
               onClick={onCreate}>
            {template.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
              {template.slots.length}位 · {template.category || '模板'}
            </span>
            {canEdit && (
              <span className="text-[var(--text-nano)] px-1 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-[500]">
                自定义
              </span>
            )}
          </div>
        </div>

        {/* "..." menu button — hover to reveal */}
        <div className="absolute top-2 right-2" ref={menuRef}>
          <button
            className="w-7 h-7 flex items-center justify-center
                       bg-white/80 border border-[var(--color-border)] rounded-full
                       text-[var(--color-gray-500)] opacity-0 group-hover:opacity-100
                       hover:bg-white hover:text-[var(--color-gray-700)]
                       transition-all duration-150 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="更多操作"
          >
            <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5">
              <circle cx="7" cy="3" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="7" cy="11" r="1.2" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div className="absolute top-8 right-0 z-20 bg-white border border-[var(--color-border)]
                            rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1 min-w-[130px]">
              <MenuBtn label="创建相册" icon={
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
                  <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
                  <circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                  <path d="M1.5 9l3-2.5 2.5 2.5 1.5-1.5L12.5 11" />
                </svg>
              } onClick={() => { setMenuOpen(false); onCreate(); }} />
              <MenuBtn label="复制" icon={
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <rect x="2" y="2.5" width="10" height="9" rx="1.5" />
                  <rect x="4.5" y="5" width="5" height="4" rx="0.5" />
                </svg>
              } onClick={() => { setMenuOpen(false); onCopy(); }} />
              {canEdit && (
                <MenuBtn label="编辑模板" icon={
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
                  </svg>
                } onClick={() => { setMenuOpen(false); setShowEdit(true); }} />
              )}
              {onDelete && (
                <div className="border-t border-[var(--color-border-light)] mt-1 pt-1">
                  <MenuBtn label="删除模板" danger icon={
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <path d="M2 3.5h10" /><path d="M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
                      <path d="M11 3.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8" />
                    </svg>
                  } onClick={() => { setMenuOpen(false); onDelete(); }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 编辑弹窗 — 每个卡片独立管理，避免父级状态传递问题 */}
      {canEdit && (
        <CreateTemplateDialog
          key={customData.id}
          open={showEdit}
          editTemplate={{ id: customData.id, name: customData.name, slots: customData.slots }}
          onClose={() => setShowEdit(false)}
          onCreated={() => { setShowEdit(false); onModified(); }}
        />
      )}
    </>
  );
}

/** Dropdown menu button */
function MenuBtn({ label, icon, danger, onClick }: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-2 text-[var(--text-body-sm)] border-none bg-transparent cursor-pointer
        transition-colors ${danger ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/5' : 'text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)]'}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

/** Empty state create-card */
/* ── "+ 创建模板" card ── */
function CreateTemplateCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="relative bg-white border-2 border-dashed border-[var(--color-border)]
                 rounded-[var(--radius-xl)] overflow-hidden
                 hover:border-[var(--color-primary-400)] hover:bg-[var(--color-surface-hover)]
                 transition-all duration-200 cursor-pointer
                 flex flex-col items-center justify-center min-h-[200px]"
      onClick={onClick}
    >
      <div className="w-10 h-10 rounded-full bg-[var(--color-primary-50)] flex items-center justify-center mb-2">
        <svg viewBox="0 0 18 18" fill="none" stroke="var(--color-primary-600)" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
          <line x1="9" y1="3" x2="9" y2="15" />
          <line x1="3" y1="9" x2="15" y2="9" />
        </svg>
      </div>
      <span className="text-[var(--text-body-sm)] font-[500] text-[var(--color-primary-600)]">
        创建新模板
      </span>
      <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] mt-0.5">
        从零开始设计布局
      </span>
    </div>
  );
}

/* ── Slot Preview ── */
function TemplateSlotPreview({ slots }: { slots: SlotLayout[] }) {
  return (
    <div className="w-full h-full relative">
      {slots.map((slot, i) => (
        <div
          key={slot.id}
          className="absolute rounded-[2px] border border-white/30"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.width}%`,
            height: `${slot.height}%`,
            backgroundColor: `hsl(250, ${50 + (i * 5) % 30}%, ${65 + (i * 3) % 20}%)`,
          }}
        />
      ))}
    </div>
  );
}
