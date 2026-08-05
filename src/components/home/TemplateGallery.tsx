import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TEMPLATES, registerCustomTemplates } from '../../types';
import type { AlbumSize, CustomTemplate, SlotLayout, PageMargin } from '../../types';
import { CreateDialog } from './CreateDialog';
import { CreateTemplateDialog } from './CreateTemplateDialog';
import { listCustomTemplates, deleteCustomTemplate, createCustomTemplate } from '../../db';
import { SLOT_PALETTE, SLOT_BORDER_COLORS } from '../../constants/templatePalette';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';

interface TemplateGalleryProps {
  onCreateFromTemplate: (templateId: string, name: string, size: AlbumSize, margin: PageMargin, albumType?: string, description?: string, cornerRadius?: number) => void;
}

/**
 * 照片数量分类
 * 1图 / 2图 / 3图 / 4图 / 多图 (>=5)
 */
type CountFilter = 'all' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | '9+';

const COUNT_FILTERS: { labelKey: string; value: CountFilter }[] = [
  { labelKey: 'home.templateGallery.countAll', value: 'all' },
  { labelKey: 'home.templateGallery.count1', value: 1 },
  { labelKey: 'home.templateGallery.count2', value: 2 },
  { labelKey: 'home.templateGallery.count3', value: 3 },
  { labelKey: 'home.templateGallery.count4', value: 4 },
  { labelKey: 'home.templateGallery.count5', value: 5 },
  { labelKey: 'home.templateGallery.count6', value: 6 },
  { labelKey: 'home.templateGallery.count7', value: 7 },
  { labelKey: 'home.templateGallery.count8', value: 8 },
  { labelKey: 'home.templateGallery.count9plus', value: '9+' },
];

type CategoryFilter = 'all' | 'classic' | 'creative' | 'personality' | 'custom';

const CATEGORY_FILTERS: { labelKey: string; value: CategoryFilter }[] = [
  { labelKey: 'home.templateGallery.categoryAll', value: 'all' },
  { labelKey: 'home.templateGallery.categoryClassic', value: 'classic' },
  { labelKey: 'home.templateGallery.categoryCreative', value: 'creative' },
  { labelKey: 'home.templateGallery.categoryPersonality', value: 'personality' },
  { labelKey: 'home.templateGallery.categoryCustom', value: 'custom' },
];

/** 统一模板卡片的数据结构（系统or自定义） */
interface FlatTemplate {
  id: string;
  name: string;
  slots: SlotLayout[];
  isBuiltIn: boolean;
  category?: string;
  rawCategory?: string; // 原始 category 值，用于筛选
  createdAt?: string;
}

export function TemplateGallery({ onCreateFromTemplate }: TemplateGalleryProps) {
  const { t } = useTranslation();
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [showTemplateMaker, setShowTemplateMaker] = useState(false);
  const sb = useScrollbarVisibility<HTMLDivElement>();

  // 加载自定义模板
  const loadCustomTemplates = useCallback(async () => {
    try {
      const list = await listCustomTemplates();
      const safe = Array.isArray(list) ? list : [];
      setCustomTemplates(safe);
      // 同步注册到全局注册表,供 resolveTemplate / pageSlice 等同步查询
      registerCustomTemplates(safe);
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
    const catMap: Record<string, string> = {
      classic: t('home.templateGallery.categoryClassicLabel'),
      creative: t('home.templateGallery.categoryCreativeLabel'),
      personality: t('home.templateGallery.categoryPersonalityLabel'),
    };
    const system: FlatTemplate[] = TEMPLATES
      .filter((tmpl): tmpl is NonNullable<typeof tmpl> => tmpl != null)
      .map((tmpl) => ({
        id: tmpl.id ?? '',
        name: tmpl.name ?? '',
        slots: Array.isArray(tmpl.slots) ? tmpl.slots : [],
        isBuiltIn: true,
        category: catMap[tmpl.category] || tmpl.category || '',
        rawCategory: tmpl.category,
      }));
    const custom: FlatTemplate[] = customTemplates
      .filter((ct): ct is NonNullable<typeof ct> => ct != null)
      .map((ct) => ({
        id: ct.id ?? '',
        name: ct.name ?? '',
        slots: Array.isArray(ct.slots) ? ct.slots : [],
        isBuiltIn: false,
        category: t('home.templateGallery.categoryCustomLabel'),
        createdAt: ct.createdAt,
      }));
    return [...system, ...custom];
  }, [customTemplates, t]);

  // ── 计数统计 ──
  const catCounts = useMemo(() => ({
    classic: TEMPLATES.filter((t) => t.category === 'classic').length,
    creative: TEMPLATES.filter((t) => t.category === 'creative').length,
    personality: TEMPLATES.filter((t) => t.category === 'personality').length,
    custom: customTemplates.length,
  }), [customTemplates]);

  const photoCounts = useMemo(() => {
    const count = (n: number) =>
      TEMPLATES.filter((t) => (t?.slots?.length ?? 0) === n).length
      + (customTemplates ?? []).filter((c) => (c?.slots?.length ?? 0) === n).length;
    return {
      all: allTemplates.length,
      1: count(1),
      2: count(2),
      3: count(3),
      4: count(4),
      5: count(5),
      6: count(6),
      7: count(7),
      8: count(8),
      '9+': TEMPLATES.filter((t) => (t?.slots?.length ?? 0) >= 9).length
            + (customTemplates ?? []).filter((c) => (c?.slots?.length ?? 0) >= 9).length,
    };
  }, [allTemplates.length, customTemplates]);

  // 按数量和分类联合筛选
  const filteredAll = useMemo(() => {
    return allTemplates.filter((t) => {
      // 数量筛选
      if (countFilter !== 'all') {
        const n = t.slots?.length ?? 0;
        if (countFilter === '9+') { if (n < 9) return false; }
        if (typeof countFilter === 'number' && n !== countFilter) return false;
      }
      // 分类筛选
      if (categoryFilter !== 'all') {
        if (categoryFilter === 'custom') {
          if (t.isBuiltIn) return false;
        } else {
          if (t.rawCategory !== categoryFilter) return false;
        }
      }
      return true;
    });
  }, [allTemplates, countFilter, categoryFilter]);

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

  const handleCreateFromDialog = (name: string, size: AlbumSize, margin: PageMargin, albumType?: string, description?: string, cornerRadius?: number) => {
    if (pendingTemplateId) {
      onCreateFromTemplate(pendingTemplateId, name, size, margin, albumType, description, cornerRadius);
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
    const suffix = t('home.templateGallery.copySuffix');
    if (tmpl.isBuiltIn) {
      // 系统模板 → 复制为自定义模板
      const sysTemplate = TEMPLATES.find((t) => t.id === tmpl.id);
      if (!sysTemplate) return;
      await createCustomTemplate(sysTemplate.name + suffix, Array.isArray(sysTemplate.slots) ? sysTemplate.slots : []);
    } else {
      const custom = customTemplates.find((c) => c.id === tmpl.id);
      if (!custom) return;
      await createCustomTemplate(custom.name + suffix, Array.isArray(custom.slots) ? custom.slots : []);
    }
    loadCustomTemplates();
  };

  return (
    <div ref={sb.ref} className={`h-full overflow-y-auto p-6 ps-scroll ${sb.className}`} {...sb.handlers}>
      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div className="shrink-0">
          <h2 className="text-[1.875rem] font-[700] text-[var(--color-text-primary)] leading-tight tracking-tight">
            {t('home.templateGallery.title')}
          </h2>
          <p className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] mt-0.5">
            {t('home.templateGallery.subtitle')}
          </p>
        </div>

        {/* Create Template Button */}
        <button
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[image:var(--gradient-brand)] text-white
                     rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                     border-none cursor-pointer transition-all duration-200
                     hover:shadow-[var(--shadow-md)] hover:-translate-y-px active:scale-[0.97]"
          onClick={() => setShowTemplateMaker(true)}
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
          {t('home.templateGallery.createTemplate')}
        </button>
      </div>

      {/* ── Category Filter ── */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
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
                {f.value === 'all' ? catCounts.classic + catCounts.creative + catCounts.personality + catCounts.custom :
                 f.value === 'classic' ? catCounts.classic :
                 f.value === 'creative' ? catCounts.creative :
                 f.value === 'personality' ? catCounts.personality :
                 catCounts.custom}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Photo Count Filter ── */}
      <div className="flex flex-wrap items-center gap-3 mb-7">
        <div className="flex items-center gap-1 p-1.5 bg-white rounded-[var(--radius-xl)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]">
          {COUNT_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`
                inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-lg)] text-[var(--text-caption)] font-[600]
                border-none cursor-pointer transition-all duration-200
                ${countFilter === f.value
                  ? 'bg-[image:var(--gradient-brand-soft)] text-[var(--color-brand)] shadow-[var(--shadow-sm)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)]'
                }
              `}
              onClick={() => setCountFilter(f.value)}
            >
              {t(f.labelKey)}
              <span className={`
                text-[var(--text-nano)] rounded-[var(--radius-full)] px-1.5 py-px min-w-[18px] text-center leading-snug
                ${countFilter === f.value
                  ? 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
                  : 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
                }
              `}>
                {f.value === 'all' ? photoCounts.all :
                 f.value === '9+' ? photoCounts['9+'] :
                 photoCounts[f.value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Flat Template Grid ── */}
      {displayTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
          <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[image:var(--gradient-brand-soft)] flex items-center justify-center mb-4">
            <svg viewBox="0 0 48 48" fill="none" stroke="var(--color-primary-400)" strokeWidth="1.5" className="w-8 h-8">
              <rect x="4" y="4" width="40" height="40" rx="4" strokeDasharray="4 4" />
              <line x1="16" y1="24" x2="32" y2="24" strokeWidth="1.5" />
              <line x1="24" y1="16" x2="24" y2="32" strokeWidth="1.5" />
            </svg>
          </div>
          <p className="text-[var(--text-body)] font-[600]">{t('home.templateGallery.noTemplate')}</p>
          <p className="text-[var(--text-caption)] mt-1">{t('home.templateGallery.tryOther')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
          {/* Create template entry — placed first */}
          <CreateTemplateCard onClick={() => setShowTemplateMaker(true)} />
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
        </div>
      )}

      {/* Create Album Dialog */}
      {pendingTemplateId && (
        <CreateDialog
          open={showCreateAlbum}
          onClose={handleCloseAlbumDialog}
          onCreate={handleCreateFromDialog}
          title={t('home.templateGallery.useTemplateCreate')}
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
          <div className="relative bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] p-6 w-[360px] animate-[modalFadeIn_0.15s_ease-out]"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] mb-2">{t('home.templateGallery.deleteTitle')}</h3>
            <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-5">
              {t('home.templateGallery.deleteConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]
                                 hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary-300)] cursor-pointer transition-all"
                      onClick={() => setDeleteTargetId(null)}>
                {t('home.templateGallery.cancel')}
              </button>
              <button className="px-4 py-2 bg-[var(--color-error)] text-white rounded-[var(--radius-lg)]
                                 text-[var(--text-body-sm)] font-[600] border-none
                                 hover:bg-[var(--color-error-dark)] hover:shadow-[var(--shadow-sm)] cursor-pointer transition-all"
                      onClick={() => handleDeleteTemplate(deleteTargetId)}>
                {t('home.templateGallery.delete')}
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
  const { t } = useTranslation();
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
      <div className="relative bg-white border border-[var(--color-border)] rounded-[var(--radius-2xl)] overflow-visible
                      hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-primary-300)] hover:-translate-y-0.5 hover:bg-[image:var(--gradient-surface)]
                      transition-all duration-200 group cursor-pointer shadow-[var(--shadow-soft)]">
        {/* Preview — click to create album */}
        <div className="aspect-[4/3] bg-[image:var(--gradient-brand-soft)] p-4 flex items-center justify-center rounded-t-[var(--radius-2xl)]"
             onClick={onCreate}>
          <div className="w-full h-full max-w-[140px] max-h-[105px]">
            <TemplateSlotPreview slots={template.slots} />
          </div>
        </div>

        {/* Info */}
        <div className="p-3.5">
          <div className="text-[var(--text-body)] font-[600] text-[var(--color-gray-800)] truncate"
               onClick={onCreate}>
            {template.name}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] font-[500]">
              {t('home.templateGallery.slotsCount', { count: template.slots?.length ?? 0, category: template.category || t('home.templateGallery.defaultCategory') })}
            </span>
            {canEdit && (
              <span className="text-[var(--text-nano)] px-1.5 py-px rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-[600]">
                {t('home.templateGallery.customBadge')}
              </span>
            )}
          </div>
        </div>

        {/* "..." menu button — hover to reveal */}
        <div className="absolute top-2.5 right-2.5" ref={menuRef}>
          <button
            className="w-8 h-8 flex items-center justify-center
                       bg-white/90 border border-[var(--color-border)] rounded-full
                       text-[var(--color-gray-500)] opacity-0 group-hover:opacity-100
                       hover:bg-white hover:text-[var(--color-brand)] hover:border-[var(--color-primary-300)]
                       transition-all duration-150 cursor-pointer shadow-[var(--shadow-xs)]"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title={t('home.templateGallery.moreActions')}
          >
            <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5">
              <circle cx="7" cy="3" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="7" cy="11" r="1.2" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div className="absolute top-10 right-0 z-20 bg-white border border-[var(--color-border)]
                            rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] py-1.5 min-w-[140px] overflow-hidden">
              <MenuBtn label={t('home.templateGallery.createAlbum')} icon={
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="w-3.5 h-3.5">
                  <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
                  <circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                  <path d="M1.5 9l3-2.5 2.5 2.5 1.5-1.5L12.5 11" />
                </svg>
              } onClick={() => { setMenuOpen(false); onCreate(); }} />
              <MenuBtn label={t('home.templateGallery.copy')} icon={
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <rect x="2" y="2.5" width="10" height="9" rx="1.5" />
                  <rect x="4.5" y="5" width="5" height="4" rx="0.5" />
                </svg>
              } onClick={() => { setMenuOpen(false); onCopy(); }} />
              {canEdit && (
                <MenuBtn label={t('home.templateGallery.editLayout')} icon={
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" />
                  </svg>
                } onClick={() => { setMenuOpen(false); setShowEdit(true); }} />
              )}
              {onDelete && (
                <div className="border-t border-[var(--color-border-light)] mt-1 pt-1">
                  <MenuBtn label={t('home.templateGallery.deleteLayout')} danger icon={
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
  const { t } = useTranslation();
  return (
    <div
      className="relative bg-white border-2 border-dashed border-[var(--color-primary-200)]
                 rounded-[var(--radius-2xl)] overflow-hidden
                 hover:border-[var(--color-primary-300)] hover:bg-[image:var(--gradient-brand-soft)]
                 transition-all duration-200 cursor-pointer shadow-[var(--shadow-soft)]
                 flex flex-col items-center justify-center min-h-[200px]
                 hover:-translate-y-0.5"
      onClick={onClick}
    >
      <div className="w-11 h-11 rounded-full bg-[image:var(--gradient-brand)] flex items-center justify-center mb-3 shadow-[var(--shadow-sm)]">
        <svg viewBox="0 0 18 18" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
          <line x1="9" y1="3" x2="9" y2="15" />
          <line x1="3" y1="9" x2="15" y2="9" />
        </svg>
      </div>
      <span className="text-[var(--text-body-sm)] font-[600] text-[var(--color-brand)]">
        {t('home.templateGallery.createTemplateCard')}
      </span>
      <span className="text-[var(--text-nano)] text-[var(--color-text-tertiary)] mt-0.5">
        {t('home.templateGallery.createTemplateDesc')}
      </span>
    </div>
  );
}

function TemplateSlotPreview({ slots }: { slots: SlotLayout[] }) {
  const safeSlots = Array.isArray(slots) ? slots : [];
  return (
    <div className="w-full h-full relative">
      {safeSlots.map((slot, i) => (
        <div
          key={slot.id}
          className="absolute rounded-[4px] shadow-[0_1px_3px_rgba(108,99,255,0.08)]"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.width}%`,
            height: `${slot.height}%`,
            backgroundImage: SLOT_PALETTE[i % SLOT_PALETTE.length],
            border: `1px solid ${SLOT_BORDER_COLORS[i % SLOT_BORDER_COLORS.length]}`,
          }}
        />
      ))}
    </div>
  );
}
