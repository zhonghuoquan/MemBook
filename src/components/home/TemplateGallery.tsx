import { useState, useMemo } from 'react';
import { TEMPLATES, ALBUM_SIZES } from '../../types';
import type { AlbumSize } from '../../types';
import { CreateDialog } from './CreateDialog';

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

export function TemplateGallery({ onCreateFromTemplate }: TemplateGalleryProps) {
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 从 PRD 规格列表中提取显示用的尺寸筛选（排除「自定义」）
  const sizeFilters = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...ALBUM_SIZES.filter((s) => s.id !== 'custom').map((s) => ({
        label: s.name,
        value: s.id,
      })),
    ],
    [],
  );

  // 按数量筛选模板
  const filteredTemplates = useMemo(() => {
    return TEMPLATES.filter((t) => {
      if (countFilter === 'all') return true;
      const n = t.slots.length;
      if (countFilter === 5) return n >= 5;
      return n === countFilter;
    });
  }, [countFilter]);

  // 按数量分组以显示段落标题
  const grouped = useMemo(() => {
    const groups: { title: string; templates: typeof TEMPLATES }[] = [];
    const countCategories: { label: string; min: number; max: number }[] = [
      { label: '单图布局', min: 1, max: 1 },
      { label: '双图布局', min: 2, max: 2 },
      { label: '三图布局', min: 3, max: 3 },
      { label: '四图布局', min: 4, max: 4 },
      { label: '多图布局', min: 5, max: Infinity },
    ];

    // 如果选了具体数量，只显示对应组
    if (countFilter !== 'all') {
      const cat = countCategories.find((c) => c.min <= countFilter && c.max >= (countFilter === 5 ? Infinity : countFilter));
      if (cat && filteredTemplates.length > 0) {
        groups.push({ title: cat.label, templates: filteredTemplates });
      }
    } else {
      // 全部模式下按组展示
      for (const cat of countCategories) {
        const tms = TEMPLATES.filter((t) => t.slots.length >= cat.min && t.slots.length <= cat.max);
        if (tms.length > 0) {
          groups.push({ title: cat.label, templates: tms });
        }
      }
    }
    return groups;
  }, [countFilter, filteredTemplates]);

  const [showCreate, setShowCreate] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const handleTemplateClick = (templateId: string) => {
    setPendingTemplateId(templateId);
    setShowCreate(true);
  };

  const handleCreateFromDialog = (name: string, size: AlbumSize) => {
    if (pendingTemplateId) {
      onCreateFromTemplate(pendingTemplateId, name, size);
    }
    setPendingTemplateId(null);
  };

  const handleCloseDialog = () => {
    setShowCreate(false);
    setPendingTemplateId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-5">
        <h2 className="text-[2.25rem] font-[600] text-[var(--color-text-primary)] shrink-0 leading-tight">模板库</h2>
        <span className="text-[var(--text-body-sm)] text-[var(--color-text-tertiary)] hidden sm:inline">
          选择一个模板开始制作你的专属相册
        </span>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Photo count filter */}
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

        {/* Size filter */}
        <div className="flex items-center gap-1 p-1 bg-[var(--color-gray-50)] rounded-[var(--radius-lg)] border border-[var(--color-border-light)]">
          {sizeFilters.map((f) => (
            <button
              key={f.value}
              className={`
                px-3 py-1.5 rounded-[var(--radius-md)] text-[var(--text-caption)] font-[500]
                border-none cursor-pointer transition-all duration-150
                ${sizeFilter === f.value
                  ? 'bg-white text-[var(--color-brand)] shadow-[var(--shadow-xs)]'
                  : 'bg-transparent text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
                }
              `}
              onClick={() => setSizeFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Template Groups ── */}
      {grouped.length === 0 ? (
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
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.title}>
              <h3 className="text-[var(--text-body)] font-[500] text-[var(--color-gray-600)] mb-3">
                {group.title}
                <span className="text-[var(--text-caption)] text-[var(--color-gray-400)] ml-2">
                  {group.templates.length} 套
                </span>
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {group.templates.map((tmpl) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    isHovered={hoveredId === tmpl.id}
                    onHover={setHoveredId}
                    onClick={() => handleTemplateClick(tmpl.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog — pre-fills with the selected template */}
      {pendingTemplateId && (
        <CreateDialog
          open={showCreate}
          onClose={handleCloseDialog}
          onCreate={handleCreateFromDialog}
          title="使用模板创建相册"
        />
      )}
    </div>
  );
}

/* ── Template Card ── */
function TemplateCard({
  template,
  isHovered,
  onHover,
  onClick,
}: {
  template: (typeof TEMPLATES)[number];
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  return (
    <div
      className="relative bg-white border border-[var(--color-border)] rounded-[var(--radius-xl)] overflow-hidden
                 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-border-hover)]
                 transition-all duration-200 group cursor-pointer"
      onMouseEnter={() => onHover(template.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      {/* Preview area */}
      <div className="aspect-[4/3] bg-[var(--color-gray-50)] p-4 flex items-center justify-center">
        <div className="w-full h-full max-w-[140px] max-h-[105px]">
          <TemplateSlotPreview templateId={template.id} slots={template.slots} />
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">
            {template.name}
          </span>
          <span className="text-[var(--text-nano)] text-[var(--color-gray-400)] bg-[var(--color-gray-50)] px-1.5 py-0.5 rounded-full">
            {template.slots.length}位
          </span>
        </div>
        <div className="text-[var(--text-caption)] text-[var(--color-text-tertiary)]">
          {template.category === 'classic' ? '经典布局' : '创意布局'}
        </div>
      </div>

      {/* Hover overlay — "使用此模板创建" button */}
      <div
        className={`
          absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent
          flex items-end justify-center pb-5
          transition-opacity duration-200
          ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-white rounded-full
                         text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-800)]
                         shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)]
                         transition-shadow duration-150 active:scale-[0.97]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <circle cx="6" cy="6.5" r="1.5" />
            <path d="M1.5 10l3.5-3 3 3 2-2 4.5 4.5" />
          </svg>
          使用此模板创建
        </span>
      </div>
    </div>
  );
}

/* ── Slot Preview (renders simplified slot layout inside card) ── */
function TemplateSlotPreview({ templateId, slots }: { templateId: string; slots: { id: string; x: number; y: number; width: number; height: number }[] }) {
  const palette: Record<string, string> = {
    single: '#6C63FF',
    dual: '#6C63FF',
    triple: '#6C63FF',
    quad: '#6C63FF',
    full: '#6C63FF',
    'top-bottom': '#6C63FF',
    collage: '#6C63FF',
    circle: '#6C63FF',
    overlap: '#6C63FF',
  };

  const baseColor = palette[templateId] || '#6C63FF';

  // Generate shades for each slot
  const shades = slots.map((_, i) => {
    const lighten = 15 + (i * 8) % 30;
    return `${baseColor}${Math.min(lighten + 30, 99).toString(16)}`;
  });

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
            backgroundColor: shades[i],
          }}
        />
      ))}
    </div>
  );
}
