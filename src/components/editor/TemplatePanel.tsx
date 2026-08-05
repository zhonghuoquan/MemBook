import { useState, useCallback, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useEditorStore, useUIStore, usePhotoStore } from '../../store';
import { TEMPLATES, findTemplateById, registerCustomTemplates } from '../../types';
import type { Template, CustomTemplate } from '../../types';
import { listCustomTemplates } from '../../db';
import { useScrollbarVisibility } from '../../hooks/useScrollbarVisibility';
import { TemplateSwitchDialog } from './TemplateSwitchDialog';
import { SLOT_PALETTE, SLOT_BORDER_COLORS } from '../../constants/templatePalette';
import { useTranslation } from 'react-i18next';

type CountFilter = 'all' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | '9+';

const COUNT_FILTERS: { labelKey: string; value: CountFilter }[] = [
  { labelKey: 'editor.templatePanel.filterAll', value: 'all' },
  { labelKey: 'editor.templatePanel.filter1', value: 1 },
  { labelKey: 'editor.templatePanel.filter2', value: 2 },
  { labelKey: 'editor.templatePanel.filter3', value: 3 },
  { labelKey: 'editor.templatePanel.filter4', value: 4 },
  { labelKey: 'editor.templatePanel.filter5', value: 5 },
  { labelKey: 'editor.templatePanel.filter6', value: 6 },
  { labelKey: 'editor.templatePanel.filter7', value: 7 },
  { labelKey: 'editor.templatePanel.filter8', value: 8 },
  { labelKey: 'editor.templatePanel.filter9plus', value: '9+' },
];

/** 根据 countFilter 判断模板是否匹配 */
function matchCountFilter(slotCount: number, filter: CountFilter): boolean {
  if (filter === 'all') return true;
  if (filter === '9+') return slotCount >= 9;
  return slotCount === filter;
}

export function TemplatePanel() {
  const { t } = useTranslation();
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const pages = useEditorStore((s) => s.pages);
  const setPageTemplate = useEditorStore((s) => s.setPageTemplate);
  const addToast = useUIStore((s) => s.addToast);
  const photos = usePhotoStore((s) => s.photos);

  // 加载自定义模板并注册到全局注册表(供 resolveTemplate / pageSlice 等同步查询)
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    listCustomTemplates().then((list) => {
      if (cancelled) return;
      setCustomTemplates(list);
      registerCustomTemplates(list);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  // 容器宽度测量（用于 Justified 自适应布局，与照片面板一致）
  const contentRef = useRef<HTMLDivElement>(null);
  const sb = useScrollbarVisibility<HTMLDivElement>({ externalRef: contentRef });
  const [contentWidth, setContentWidth] = useState(0);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => { setContentWidth(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 模板切换弹窗状态
  const [switchDialog, setSwitchDialog] = useState<{
    targetTemplateId: string;
    filledPhotos: { id: string; src: string; name: string }[];
  } | null>(null);

  // 照片数量筛选
  const [countFilter, setCountFilter] = useState<CountFilter>('all');

  const currentPage = pages[currentPageIndex];

  // 计数统计(内置 + 自定义),用于筛选器徽标
  const countStats = useMemo(() => {
    const all = TEMPLATES.length + customTemplates.length;
    const count = (n: number) =>
      TEMPLATES.filter((t) => t.slots.length === n).length
      + customTemplates.filter((c) => c.slots.length === n).length;
    return {
      all,
      1: count(1), 2: count(2), 3: count(3), 4: count(4),
      5: count(5), 6: count(6), 7: count(7), 8: count(8),
      '9+': TEMPLATES.filter((t) => t.slots.length >= 9).length
            + customTemplates.filter((c) => c.slots.length >= 9).length,
    } as Record<CountFilter, number>;
  }, [customTemplates]);

  const handleSelect = useCallback((templateId: string) => {
    if (pages.length === 0) {
      addToast({ type: 'info', message: t('editor.templatePanel.noPage') });
      return;
    }

    const page = pages[currentPageIndex];
    if (!page) return;

    // 获取已填充的照片
    const filledPlacements = page.placements.filter((p) => p.photoId !== null);
    const N = filledPlacements.length;
    const targetTemplate = findTemplateById(templateId);
    if (!targetTemplate) return;
    const M = targetTemplate.slots.length;

    if (N > M) {
      // 场景 2：新模板更少 → 弹出选择对话框
      const filledPhotoList = filledPlacements
        .map((p) => {
          const photo = photos.find((ph) => ph.id === p.photoId);
          return photo ? { id: photo.id, src: photo.src, name: photo.name } : null;
        })
        .filter(Boolean) as { id: string; src: string; name: string }[];

      setSwitchDialog({ targetTemplateId: templateId, filledPhotos: filledPhotoList });
    } else {
      // 场景 1 & 3：N ≤ M → 直接切换，已有照片按序迁移
      setPageTemplate(currentPageIndex, templateId);
      addToast({ type: 'success', message: t('editor.templatePanel.switchedTo', { name: targetTemplate.name }) });
    }
  }, [pages, currentPageIndex, setPageTemplate, addToast, photos, t]);

  const handleSwitchConfirm = useCallback((selectedIds: string[]) => {
    if (switchDialog) {
      setPageTemplate(currentPageIndex, switchDialog.targetTemplateId, selectedIds);
      const targetTemplate = findTemplateById(switchDialog.targetTemplateId);
      addToast({ type: 'success', message: t('editor.templatePanel.switchedTo', { name: targetTemplate?.name }) });
    }
    setSwitchDialog(null);
  }, [switchDialog, currentPageIndex, setPageTemplate, addToast, t]);

  const handleSwitchCancel = useCallback(() => {
    setSwitchDialog(null);
  }, []);

  const classicTemplates = useMemo(() => TEMPLATES.filter((tmpl) => {
    if (tmpl.category !== 'classic') return false;
    return matchCountFilter(tmpl.slots.length, countFilter);
  }), [countFilter]);
  const creativeTemplates = useMemo(() => TEMPLATES.filter((tmpl) => {
    if (tmpl.category !== 'creative') return false;
    return matchCountFilter(tmpl.slots.length, countFilter);
  }), [countFilter]);
  const personalityTemplates = useMemo(() => TEMPLATES.filter((tmpl) => {
    if (tmpl.category !== 'personality') return false;
    return matchCountFilter(tmpl.slots.length, countFilter);
  }), [countFilter]);
  // 自定义模板分组(转 Template 形态,复用 TemplateGroup 渲染)
  const customTemplateList = useMemo<Template[]>(() =>
    customTemplates
      .map((ct) => ({
        id: ct.id, name: ct.name, category: 'personality' as const,
        slots: ct.slots,
        preview: ct.slots.length <= 1 ? 'full' : ct.slots.length === 2 ? 'dual' : ct.slots.length === 3 ? 'triple' : ct.slots.length === 4 ? 'quad' : 'collage',
      }))
      .filter((tmpl) => matchCountFilter(tmpl.slots.length, countFilter)),
    [customTemplates, countFilter]);

  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">{t('editor.templatePanel.title')}</span>
      </div>

      {/* Template Grid */}
      <div ref={sb.ref} className={`flex-1 overflow-y-auto ps-scroll pl-3 pr-1 py-3 space-y-5 ${sb.className}`} {...sb.handlers}>
        {/* Count Filter — 自动换行 Chip 筛选，缩窄面板也能完整显示 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {COUNT_FILTERS.map((f) => {
            const active = countFilter === f.value;
            const count = countStats[f.value];
            return (
              <button
                key={f.value}
                onClick={() => setCountFilter(f.value)}
                className={`
                  flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-[500]
                  border cursor-pointer transition-colors duration-150
                  ${active
                    ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)] shadow-[0_1px_3px_rgba(108,99,255,0.2)]'
                    : 'bg-white border-[var(--color-border)] text-[var(--color-gray-600)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]'
                  }
                `}
              >
                <span>{t(f.labelKey)}</span>
                <span className={`text-[11px] font-[400] rounded-full px-1.5 py-0 min-w-[18px] text-center leading-tight ${active ? 'bg-white/20 text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)]'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <TemplateGroup
          title={t('editor.templatePanel.classicGroup', { count: classicTemplates.length })}
          templates={classicTemplates}
          currentPageIndex={currentPageIndex}
          pages={pages}
          onSelect={handleSelect}
          containerWidth={contentWidth}
        />
        <TemplateGroup
          title={t('editor.templatePanel.creativeGroup', { count: creativeTemplates.length })}
          templates={creativeTemplates}
          currentPageIndex={currentPageIndex}
          pages={pages}
          onSelect={handleSelect}
          containerWidth={contentWidth}
        />
        <TemplateGroup
          title={t('editor.templatePanel.personalityGroup', { count: personalityTemplates.length })}
          templates={personalityTemplates}
          currentPageIndex={currentPageIndex}
          pages={pages}
          onSelect={handleSelect}
          containerWidth={contentWidth}
        />
        {customTemplateList.length > 0 && (
          <TemplateGroup
            title={t('editor.templatePanel.customGroup', { count: customTemplateList.length })}
            templates={customTemplateList}
            currentPageIndex={currentPageIndex}
            pages={pages}
            onSelect={handleSelect}
            containerWidth={contentWidth}
          />
        )}
      </div>

      {/* 模板切换选择对话框（N > M） */}
      {switchDialog && currentPage && (
        <TemplateSwitchDialog
          open
          currentPage={currentPage}
          targetTemplateId={switchDialog.targetTemplateId}
          filledPhotos={switchDialog.filledPhotos.map((fp) => {
            const full = photos.find((p) => p.id === fp.id);
            return full || { ...fp, date: '', width: 0, height: 0, orientation: 'square' as const };
          })}
          onConfirm={handleSwitchConfirm}
          onCancel={handleSwitchCancel}
        />
      )}
    </aside>
  );
}

/* ── Justified 布局常量（与照片面板 TARGET_ROW_HEIGHT / ITEM_GAP 保持一致）── */
const TARGET_ROW_H = 100;
const GAP = 8;
const ITEM_ASPECT = 3 / 4; // 模板预览 3:4 宽高比
const MAX_PER_ROW = 5;

function TemplateGroup({
  title,
  templates,
  currentPageIndex,
  pages,
  onSelect,
  containerWidth,
}: {
  title: string;
  templates: Template[];
  currentPageIndex: number;
  pages: { templateId: string }[];
  onSelect: (id: string) => void;
  containerWidth: number;
}) {
  // 根据容器宽度计算最佳每行数量和行高
  const { rows, itemW, itemH } = useMemo(() => {
    if (containerWidth <= 0 || templates.length === 0) {
      return { rows: [] as Template[][], itemW: 0, itemH: 0 };
    }
    // 计算每行最优模板数（使行高接近 TARGET_ROW_H，与照片面板一致）
    let n = Math.round((containerWidth + GAP) / (ITEM_ASPECT * TARGET_ROW_H + GAP));
    n = Math.min(Math.max(n, 2), MAX_PER_ROW);
    const h = (containerWidth - (n - 1) * GAP) / (n * ITEM_ASPECT);
    const w = h * ITEM_ASPECT;
    // 按行分组
    const grouped: Template[][] = [];
    for (let i = 0; i < templates.length; i += n) {
      grouped.push(templates.slice(i, i + n));
    }
    return { rows: grouped, itemW: w, itemH: h };
  }, [templates, containerWidth]);

  return (
    <div>
      <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-500)] mb-2.5">{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: `${GAP}px`, height: `${itemH}px` }}>
            {row.map((tmpl) => {
              const isActive = pages[currentPageIndex]?.templateId === tmpl.id;
              return (
                <div
                  key={tmpl.id}
                  title={tmpl.name}
                  style={{ width: `${itemW}px`, height: `${itemH}px` }}
                  className={`
                    bg-white rounded-[var(--radius-lg)] overflow-hidden cursor-pointer
                    transition-all duration-150
                    ${isActive
                      ? 'ring-2 ring-[var(--color-brand)] ring-offset-1'
                      : 'border border-[var(--color-border)] hover:border-[var(--color-primary-400)] hover:shadow-[var(--shadow-xs)] active:border-[var(--color-primary-600)]'
                    }
                  `}
                  onClick={() => onSelect(tmpl.id)}
                >
                  <div className="w-full h-full p-1.5">
                    <TemplateMiniPreview templateId={tmpl.id} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Minimal template slot preview — dynamically renders from actual slot positions */
function TemplateMiniPreview({ templateId }: { templateId: string }) {
  const template = findTemplateById(templateId);
  if (!template || template.slots.length === 0) {
    return <div className="w-full h-full rounded-[2px] bg-[var(--color-gray-200)]" />;
  }
  return (
    <div className="w-full h-full relative bg-[var(--color-gray-50)] rounded-[2px] overflow-hidden">
      {template.slots.map((slot, i) => (
        <div
          key={slot.id}
          className="absolute rounded-[2px] shadow-[0_1px_3px_rgba(108,99,255,0.08)]"
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
