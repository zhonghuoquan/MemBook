/**
 * 字体选择下拉（自定义，替代原生 <select>）
 *
 * 设计：解决原生 select 的样式不可控 + 几百个本机字体下拉溢出右侧面板的问题。
 * - 触发器：显示当前字体名并以该字体预览 + 下拉箭头，样式与应用面板一致。
 * - 弹出面板：fixed 定位锚定在按钮下方，**最大高度内部滚动**、**宽度固定 260px**，
 *   并按可视区边界 clamp（右侧不够则右对齐、底部不够则向上翻），保证不溢出面板/窗口。
 * - 分组：内置艺术 / 系统可用 / 本机全部；组间小标题。
 * - 每项以自身字体渲染（所见即所得）；顶部搜索框按名过滤。
 * - 交互：点击外部 / Esc 关闭；展开时回调 onOpen（用于触发加载本机字体）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store';
import { isBundledFont } from '../../../utils/availableFonts';

const PANEL_WIDTH = 260;
/** 最小高度兜底：空间再小也至少可读几条 */
const PANEL_MIN_HEIGHT = 160;
/** 最大高度上限（实际高度由可用空间 clamp 决定，空间大则取大、长列表用滚动条容纳） */
const PANEL_MAX_HEIGHT = 640;
const GAP = 4;

interface FontFamilySelectProps {
  value: string;
  fontList: string[];
  /** 本机枚举到的字体（用于分组），不在列表内会被忽略 */
  localFonts: string[];
  onChange: (family: string) => void;
  /** 面板展开时触发（用户手势，用于 queryLocalFonts 加载本机字体） */
  onOpen?: () => void;
}

interface Position { top: number; left: number; height: number; }

export function FontFamilySelect({ value, fontList, localFonts, onChange, onOpen }: FontFamilySelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const localFontsOnOpenRef = useRef(onOpen);
  localFontsOnOpenRef.current = onOpen;
  /** 底部缩略导航栏高度（90–280，用户可拖拽），下拉高度需预留该空间避免遮挡 */
  const bottomNavHeight = useUIStore((s) => s.bottomNavHeight);

  const grouped = useMemo(() => {
    const localSet = new Set(localFonts);
    const bundled: string[] = [];
    const system: string[] = [];
    const local: string[] = [];
    for (const f of fontList) {
      if (isBundledFont(f)) bundled.push(f);
      else if (localSet.has(f)) local.push(f);
      else system.push(f);
    }
    const q = query.trim().toLowerCase();
    const match = (list: string[]) => (!q ? list : list.filter((f) => f.toLowerCase().includes(q)));
    const groups: { title: string; items: string[] }[] = [];
    if (bundled.length) groups.push({ title: t('editor.tools.fontGroupBundled'), items: match(bundled) });
    if (system.length) groups.push({ title: t('editor.tools.fontGroupSystem'), items: match(system) });
    if (local.length) groups.push({ title: t('editor.tools.fontGroupLocal'), items: match(local) });
    return groups;
  }, [fontList, localFonts, query, t]);

  const openPanel = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const winW = window.innerWidth;
    // 有效下边界 = 窗口底 - 底部缩略导航栏高度（避免下拉遮挡缩略导航）
    const viewBottom = window.innerHeight - bottomNavHeight;
    let left = r.left;
    if (left + PANEL_WIDTH > winW - 8) left = Math.max(8, winW - PANEL_WIDTH - 8);
    // 高度自适应：取"下方可用空间"或"上方可用空间"中较大的一侧，clamp 到 [min, max]
    const below = viewBottom - r.bottom - GAP;
    const above = r.top - GAP;
    let height = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, Math.max(below, above)));
    let top: number;
    if (below >= above) {
      height = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, below));
      top = r.bottom + GAP;
    } else {
      height = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, above));
      top = r.top - GAP - height;
    }
    top = Math.max(8, top);
    // 兜底：面板底边绝不越过有效下边界（避免遮挡底部缩略导航栏）
    if (top + height > viewBottom) height = Math.max(0, viewBottom - top);
    setPos({ top, left, height });
    setOpen(true);
    setQuery('');
    localFontsOnOpenRef.current?.();
  };

  const closePanel = () => setOpen(false);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (panelRef.current?.contains(tgt) || triggerRef.current?.contains(tgt)) return;
      closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 打开后聚焦搜索框
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const select = (f: string) => {
    closePanel();
    if (f !== value) onChange(f);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closePanel() : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full h-7 px-2 flex items-center justify-between gap-1 border border-[var(--color-border)] rounded-lg text-[11px] bg-white cursor-pointer outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
      >
        <span className="truncate" style={{ fontFamily: value }}>{value || ''}</span>
        <span className="shrink-0 text-[var(--color-gray-400)] text-[8px]" style={{ lineHeight: 1 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="listbox"
          className="fixed z-[var(--z-dropdown)] bg-white rounded-xl shadow-[var(--shadow-lg)] border border-[var(--color-border)] flex flex-col overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.height }}
        >
          {/* 搜索框 */}
          <div className="p-1.5 border-b border-[var(--color-border-light)]">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('editor.tools.fontSearchPlaceholder')}
              className="w-full h-6 px-2 border border-[var(--color-border)] rounded-md text-[11px] bg-white outline-none focus:border-[var(--color-brand)]"
            />
          </div>

          {/* 列表（高度自适应 + 样式化滚动条） */}
          <div
            className="overflow-y-auto flex-1 py-1"
            style={{
              maxHeight: Math.max(120, pos.height - 44),
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--color-gray-300) transparent',
            }}
          >
            {grouped.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-[var(--color-gray-400)]">{t('editor.tools.fontNoMatch')}</div>
            )}
            {grouped.map((g) => (
              <div key={g.title}>
                {g.items.length > 0 && (
                  <div className="px-3 pt-2 pb-0.5 text-[9px] font-[600] text-[var(--color-gray-400)] uppercase tracking-wide">{g.title}</div>
                )}
                {g.items.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="option"
                    aria-selected={f === value}
                    onClick={() => select(f)}
                    className={`block w-full text-left px-3 py-1 text-[12px] leading-5 truncate cursor-pointer border-none
                      ${f === value ? 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'}`}
                    style={{ fontFamily: f }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}