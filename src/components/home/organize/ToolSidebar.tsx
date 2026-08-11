/**
 * ToolSidebar — 照片整理左侧功能导航栏
 *
 * 按 3 个类别组织所有工具/视图：
 * - 智能整理：照片去重 / 照片归类 / 人脸识别 / 相似分析
 * - 元数据：Exif修改 / 批量重命名 / 格式转换
 * - 浏览查看：时间线 / 日历
 *
 * 每个按钮：色块图标 + 标题 + 简要说明，选中态高亮。
 */

import { useTranslation } from 'react-i18next';
import type { ToolColor } from './shared';

/** 工具标识（取代原 viewMode，支持单个工具精确定位） */
export type ToolId =
  | 'dedupe'
  | 'organize'
  | 'faceCluster'
  | 'similar'
  | 'exif'
  | 'rename'
  | 'convert'
  | 'timeline'
  | 'calendar';

/** 工具分类 */
export type ToolCategory = 'smart' | 'metadata' | 'browse';

export interface ToolMeta {
  id: ToolId;
  /** 用于侧栏按钮展示的颜色（与工具卡片头部颜色一致） */
  color: ToolColor;
  /** i18n key 后缀，对应 home.organize.<group>.title */
  titleKey: string;
  /** i18n key 后缀，对应 home.organize.<group>.sidebarDesc（精简说明） */
  descKey: string;
  /** SVG 图标节点（24x24 viewBox） */
  icon: React.ReactNode;
}

/** 色块映射：每种颜色对应的图标背景 + 图标文字色 + 选中态背景 + 选中态左侧色条 */
const COLOR_BLOCK: Record<ToolColor, { iconBg: string; iconText: string; activeBg: string; activeBar: string }> = {
  brand:   { iconBg: 'bg-[var(--color-brand-bg)]',   iconText: 'text-[var(--color-brand)]',   activeBg: 'bg-[var(--color-brand-bg)]',   activeBar: 'bg-[var(--color-brand)]' },
  orange:  { iconBg: 'bg-[#FFD9C7]',                 iconText: 'text-[#C95A4D]',              activeBg: 'bg-[#FFF1EB]',                 activeBar: 'bg-[#E8836A]' },
  green:   { iconBg: 'bg-[#C5E5CE]',                 iconText: 'text-[#4A9C6B]',              activeBg: 'bg-[#E9F4ED]',                 activeBar: 'bg-[#6BB58A]' },
  blue:    { iconBg: 'bg-[#C5E0F4]',                 iconText: 'text-[#4A8FCC]',              activeBg: 'bg-[#E9F4FB]',                 activeBar: 'bg-[#6BA8D8]' },
  purple:  { iconBg: 'bg-[#D7C5EC]',                 iconText: 'text-[#8B6BB0]',              activeBg: 'bg-[#F1E9F8]',                 activeBar: 'bg-[#A887D0]' },
};

/** 工具元信息列表（按分类顺序排列） */
export const TOOL_LIST: { category: ToolCategory; tools: ToolMeta[] }[] = [
  {
    category: 'smart',
    tools: [
      {
        id: 'dedupe',
        color: 'orange',
        titleKey: 'home.organize.dedupe.title',
        descKey: 'home.organize.dedupe.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M9 2a7 7 0 105.293 11.707l3.707 3.707" />
            <path d="M15 15l3 3" />
            <line x1="18" y1="9" x2="12" y2="15" />
          </svg>
        ),
      },
      {
        id: 'organize',
        color: 'blue',
        titleKey: 'home.organize.organize.title',
        descKey: 'home.organize.organize.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <rect x="3" y="4" width="14" height="13" rx="1" />
            <line x1="3" y1="8" x2="17" y2="8" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="12" y1="2" x2="12" y2="6" />
          </svg>
        ),
      },
      {
        id: 'faceCluster',
        color: 'purple',
        titleKey: 'home.organize.faceCluster.title',
        descKey: 'home.organize.faceCluster.sidebarDesc',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <circle cx="12" cy="12" r="10" />
            <circle cx="9" cy="10" r="0.8" fill="currentColor" />
            <circle cx="15" cy="10" r="0.8" fill="currentColor" />
            <path d="M8 15c1 1 2.5 1.5 4 1.5s3-0.5 4-1.5" />
          </svg>
        ),
      },
      {
        id: 'similar',
        color: 'orange',
        titleKey: 'home.organize.similar.title',
        descKey: 'home.organize.similar.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <rect x="2" y="4" width="11" height="11" rx="2" />
            <rect x="7" y="7" width="11" height="11" rx="2" />
          </svg>
        ),
      },
    ],
  },
  {
    category: 'metadata',
    tools: [
      {
        id: 'exif',
        color: 'green',
        titleKey: 'home.organize.exif.title',
        descKey: 'home.organize.exif.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <rect x="3" y="3" width="14" height="14" rx="2" />
            <line x1="7" y1="7" x2="13" y2="7" />
            <line x1="7" y1="10" x2="13" y2="10" />
            <line x1="7" y1="13" x2="10" y2="13" />
          </svg>
        ),
      },
      {
        id: 'rename',
        color: 'green',
        titleKey: 'home.organize.rename.title',
        descKey: 'home.organize.rename.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M3 14l5-5 3 3-5 5H3v-3z" />
            <path d="M13 4l2-2 3 3-2 2" />
            <line x1="11" y1="6" x2="14" y2="9" />
          </svg>
        ),
      },
      {
        id: 'convert',
        color: 'purple',
        titleKey: 'home.organize.convert.title',
        descKey: 'home.organize.convert.sidebarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M4 4h12v12H4z" />
            <path d="M4 14l4-4 3 3 5-5" />
          </svg>
        ),
      },
    ],
  },
  {
    category: 'browse',
    tools: [
      {
        id: 'timeline',
        color: 'blue',
        titleKey: 'home.organize.sidebar.timeline',
        descKey: 'home.organize.sidebar.timelineDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <line x1="4" y1="4" x2="4" y2="16" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" />
            <circle cx="4" cy="11" r="1.5" fill="currentColor" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="8" y1="14" x2="12" y2="14" />
          </svg>
        ),
      },
      {
        id: 'calendar',
        color: 'blue',
        titleKey: 'home.organize.sidebar.calendar',
        descKey: 'home.organize.sidebar.calendarDesc',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <rect x="3" y="4" width="14" height="13" rx="1" />
            <line x1="3" y1="8" x2="17" y2="8" />
            <line x1="7" y1="2" x2="7" y2="6" />
            <line x1="13" y1="2" x2="13" y2="6" />
          </svg>
        ),
      },
    ],
  },
];

/** 分类标题 i18n key */
const CATEGORY_TITLE_KEY: Record<ToolCategory, string> = {
  smart: 'home.organize.sidebar.categorySmart',
  metadata: 'home.organize.sidebar.categoryMetadata',
  browse: 'home.organize.sidebar.categoryBrowse',
};

/** 工具运行状态 */
export type ToolStatus = 'idle' | 'running' | 'done';

export function ToolSidebar({
  activeTool,
  onSelect,
  toolStatuses,
}: {
  activeTool: ToolId;
  onSelect: (id: ToolId) => void;
  /** 各工具的运行状态（由父组件追踪，用于按钮上显示状态指示） */
  toolStatuses?: Map<ToolId, ToolStatus>;
}) {
  const { t } = useTranslation();

  return (
    <nav className="w-[210px] shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
      {TOOL_LIST.map(({ category, tools }) => (
        <div key={category} className="space-y-0.5">
          {/* 分类标题 */}
          <div className="px-2 pb-1 text-[11px] font-[700] uppercase tracking-wider text-[var(--color-gray-400)]">
            {t(CATEGORY_TITLE_KEY[category])}
          </div>
          {/* 工具按钮列表 */}
          {tools.map((tool) => {
            const isActive = tool.id === activeTool;
            const cb = COLOR_BLOCK[tool.color];
            const status = toolStatuses?.get(tool.id) ?? 'idle';
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelect(tool.id)}
                className={`group relative w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left transition-all border-none cursor-pointer ${
                  isActive
                    ? `${cb.activeBg} shadow-sm`
                    : 'bg-transparent hover:bg-[var(--color-surface-hover)]'
                }`}
                title={t(tool.titleKey)}
              >
                {/* 选中态左侧色条 */}
                {isActive && (
                  <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${cb.activeBar}`} />
                )}
                {/* 色块图标 + 状态指示 */}
                <span className="relative shrink-0">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cb.iconBg} ${cb.iconText}`}>
                    {tool.icon}
                  </span>
                  {/* 状态指示徽章：右上角小圆点 */}
                  {status === 'running' && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center">
                      <svg className="w-2 h-2 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="4" />
                        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                  {status === 'done' && !isActive && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white flex items-center justify-center">
                      <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2 h-2">
                        <path d="M2 6l3 3 5-6" />
                      </svg>
                    </span>
                  )}
                </span>
                {/* 标题 + 简要说明 */}
                <span className="flex-1 min-w-0 pt-0.5">
                  <span className={`block text-[13px] font-[700] leading-tight truncate ${
                    isActive ? 'text-[var(--color-gray-800)]' : 'text-[var(--color-gray-700)]'
                  }`}>
                    {t(tool.titleKey)}
                  </span>
                  <span className="block text-[11px] text-[var(--color-gray-500)] leading-tight mt-0.5 line-clamp-2">
                    {status === 'running'
                      ? t('home.organize.sidebar.statusRunning', '扫描中...')
                      : status === 'done' && !isActive
                        ? t('home.organize.sidebar.statusDone', '已完成，点击查看')
                        : t(tool.descKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
