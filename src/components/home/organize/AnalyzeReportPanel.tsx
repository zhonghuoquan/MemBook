/**
 * 一键分析结果报告页
 *
 * 照片整理"一键分析"（去重 → 人脸识别 → 相似照片 → 截图识别）全部完成后，
 * 展示各工具的结果汇总，让用户直观看到"整理的价值"，并可一键跳转到对应工具处理。
 *
 * v2 全新设计：
 * - 品牌渐变头部横幅 + 装饰圆点
 * - 自定义"分析完成"渐变图标（带脉冲动画光环）
 * - 4 张多彩渐变统计卡片（每张带图标 + 数值 + 轻量动效）
 * - 工具结果卡片带渐变图标底、进度占比、状态徽章与 hover 上浮动效
 */
import { useTranslation } from 'react-i18next';
import type { ToolResultSummary } from '../../../photo-tools';

/** 每个工具的主题色（渐变背景 + 图标色） */
const TOOL_THEME: Record<string, { bg: string; icon: string; bar: string; ring: string }> = {
  dedupe: {
    bg: 'linear-gradient(135deg, #FFE5DC 0%, #FFD6CB 100%)',
    icon: '#E85D3F',
    bar: 'linear-gradient(90deg, #FF8A65 0%, #F4511E 100%)',
    ring: '#FF8A65',
  },
  faceCluster: {
    bg: 'linear-gradient(135deg, #E8DFFF 0%, #D9C8FF 100%)',
    icon: '#7C4DFF',
    bar: 'linear-gradient(90deg, #9575CD 0%, #7C4DFF 100%)',
    ring: '#9575CD',
  },
  similar: {
    bg: 'linear-gradient(135deg, #FFF3D6 0%, #FFE8A8 100%)',
    icon: '#E6A700',
    bar: 'linear-gradient(90deg, #FFC107 0%, #FF9800 100%)',
    ring: '#FFB300',
  },
  screenshot: {
    bg: 'linear-gradient(135deg, #D6F5EF 0%, #C0EDE4 100%)',
    icon: '#0FA88E',
    bar: 'linear-gradient(90deg, #26A69A 0%, #00897B 100%)',
    ring: '#26A69A',
  },
  organize: {
    bg: 'linear-gradient(135deg, #DFE9FF 0%, #C9D9FF 100%)',
    icon: '#3D77D6',
    bar: 'linear-gradient(90deg, #64B5F6 0%, #1E88E5 100%)',
    ring: '#42A5F5',
  },
  exif: {
    bg: 'linear-gradient(135deg, #E1F7E6 0%, #C8F0D4 100%)',
    icon: '#2E8B57',
    bar: 'linear-gradient(90deg, #66BB6A 0%, #2E7D32 100%)',
    ring: '#4CAF50',
  },
  rename: {
    bg: 'linear-gradient(135deg, #D6F5EF 0%, #C0EDE4 100%)',
    icon: '#0FA88E',
    bar: 'linear-gradient(90deg, #26A69A 0%, #00897B 100%)',
    ring: '#26A69A',
  },
  convert: {
    bg: 'linear-gradient(135deg, #FCE1EF 0%, #F9CCE3 100%)',
    icon: '#D81B60',
    bar: 'linear-gradient(90deg, #F06292 0%, #C2185B 100%)',
    ring: '#EC407A',
  },
  timeline: {
    bg: 'linear-gradient(135deg, #E3E8FF 0%, #D0D8FF 100%)',
    icon: '#4F5BD5',
    bar: 'linear-gradient(90deg, #7986CB 0%, #3949AB 100%)',
    ring: '#5C6BC0',
  },
  calendar: {
    bg: 'linear-gradient(135deg, #DBF6F8 0%, #C4EEF1 100%)',
    icon: '#1498A8',
    bar: 'linear-gradient(90deg, #26C6DA 0%, #0097A7 100%)',
    ring: '#26C6DA',
  },
};

/** 每个工具的图标（SVG 线条风格） */
const TOOL_ICON: Record<string, React.ReactNode> = {
  dedupe: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <rect x="3" y="4" width="6" height="6" rx="1" />
      <rect x="11" y="10" width="6" height="6" rx="1" />
      <path d="M9 9l2 1M15 5l1 2" />
    </svg>
  ),
  faceCluster: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3 2.5-5 6-5s6 2 6 5" />
    </svg>
  ),
  similar: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <circle cx="6" cy="10" r="3" />
      <circle cx="14" cy="10" r="3" />
    </svg>
  ),
  screenshot: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <rect x="2" y="4" width="16" height="12" rx="1.5" />
      <path d="M7 10l2 2 4-4" />
    </svg>
  ),
  organize: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M3 4h6l2 2h6v10H3z" />
    </svg>
  ),
  exif: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <circle cx="10" cy="10" r="6" />
      <path d="M10 6v4l3 2" />
    </svg>
  ),
  rename: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M12 3l5 5-8 8H4v-5z" />
      <path d="M10 5l5 5" />
    </svg>
  ),
  convert: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M6 3L2 7l4 4" />
      <path d="M2 7h9a5 5 0 014.5 3" />
      <path d="M14 17l4-4-4-4" />
      <path d="M18 13H9a5 5 0 01-4.5-3" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M2 10h16" />
      <circle cx="6" cy="10" r="2" />
      <circle cx="14" cy="10" r="2" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2v4M13 2v4" />
      <circle cx="7" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/** 完成对勾图标（渐变圆 + 白勾 + 外环脉冲） */
function CheckIcon({ size = 40 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* 脉冲光环 */}
      <div
        className="absolute inset-0 rounded-full animate-ping opacity-20"
        style={{ background: '#4CAF50', animationDuration: '2.5s' }}
      />
      {/* 渐变圆底 */}
      <div
        className="absolute inset-0 rounded-full flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, #A8E6A8 0%, #6CC46C 50%, #3DAF4E 100%)',
          boxShadow: '0 4px 16px rgba(76, 175, 80, 0.35)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: size * 0.5, height: size * 0.5 }}
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>
  );
}

export function AnalyzeReportPanel({
  report,
  onJump,
  onReanalyze,
}: {
  report: ToolResultSummary[];
  onJump: (tool: string) => void;
  onReanalyze?: () => void;
}) {
  const { t } = useTranslation();

  if (report.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[image:var(--gradient-brand-soft)] p-10 text-center">
        <div className="flex items-center justify-center mb-4">
          <CheckIcon size={56} />
        </div>
        <h3 className="text-lg font-[700] text-[var(--color-gray-800)] mb-1.5">
          {t('organize.analyzeReport.emptyTitle', '智能分析报告')}
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('organize.analyzeReport.emptyHint', '暂无可展示的分析结果，请先点击"一键分析"')}
        </p>
      </div>
    );
  }

  // 统计指标
  const totalTools = report.length;
  const hasIssueCount = report.filter((s) => s.hasResult).length;
  const cleanCount = report.filter((s) => !s.hasResult).length;
  const totalIssues = report.reduce((s, r) => s + (r.hasResult ? r.count : 0), 0);
  const cleanRate = totalTools > 0 ? Math.round((cleanCount / totalTools) * 100) : 0;

  return (
    <div className="w-full py-2 animate-[fadeIn_0.4s_ease]">
      {/* ═══ 头部横幅 ═══ */}
      <div
        className="relative overflow-hidden rounded-2xl mb-5 p-6"
        style={{
          background: 'linear-gradient(135deg, #E8FFE0 0%, #D0FFC8 45%, #BCFFB0 100%)',
          boxShadow: '0 8px 32px rgba(76, 175, 80, 0.15)',
        }}
      >
        {/* 装饰圆点 */}
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/25 pointer-events-none" />
        <div className="absolute -bottom-12 -right-2 w-40 h-40 rounded-full bg-white/15 pointer-events-none" />
        <div className="absolute top-4 right-16 w-4 h-4 rounded-full bg-white/40 pointer-events-none" />
        <div className="absolute bottom-8 right-28 w-2 h-2 rounded-full bg-white/40 pointer-events-none" />

        <div className="relative flex items-center gap-5">
          {/* 完成图标 */}
          <div className="shrink-0">
            <CheckIcon size={52} />
          </div>

          {/* 标题 + 副标题 */}
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-[800] text-[var(--color-gray-800)] tracking-tight">
              {t('organize.analyzeReport.title', '智能分析报告')}
            </h3>
            <p className="text-sm text-[var(--color-gray-600)] mt-0.5">
              {t('organize.analyzeReport.subtitle', '以下是本次整理发现的结果，点击即可跳转处理')}
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            {onReanalyze && (
              <button
                type="button"
                onClick={onReanalyze}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-[700] cursor-pointer
                  bg-white text-[#3DAF4E] border border-white/60 shadow-sm hover:shadow-[var(--shadow-md)]
                  hover:-translate-y-px active:scale-95 transition-all"
                title={t('organize.analyzeReport.reanalyze', '重新分析')}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" />
                  <path d="M13.5 3v3h-3" />
                </svg>
                {t('organize.analyzeReport.reanalyze', '重新分析')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 总览统计：4 张渐变卡片 ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label={t('organize.analyzeReport.totalTools', '分析工具')}
          value={totalTools}
          gradient="linear-gradient(135deg, #E0DEFF 0%, #C4C0FF 100%)"
          textColor="#5A4FD8"
          icon={
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M3 4h14M3 10h14M3 16h8" />
            </svg>
          }
        />
        <StatCard
          label={t('organize.analyzeReport.hasIssue', '发现可处理项')}
          value={hasIssueCount}
          gradient="linear-gradient(135deg, #E0F4FF 0%, #C6E9FF 100%)"
          textColor="#3D8FD6"
          icon={
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 7v4" />
              <path d="M10 14v.5" />
            </svg>
          }
        />
        <StatCard
          label={t('organize.analyzeReport.clean', '无需处理')}
          value={cleanCount}
          gradient="linear-gradient(135deg, #D6F5E8 0%, #B8EDD6 100%)"
          textColor="#2E8B57"
          icon={
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M5 10l3 3 7-7" />
              <circle cx="10" cy="10" r="7" />
            </svg>
          }
        />
        <StatCard
          label={t('organize.analyzeReport.totalCount', '累计问题数')}
          value={totalIssues}
          gradient="linear-gradient(135deg, #FFF3D6 0%, #FFE8A8 100%)"
          textColor="#AC8313"
          icon={
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <circle cx="8" cy="8" r="4.5" />
              <path d="M13 13l4 4" />
            </svg>
          }
        />
      </div>

      {/* ═══ 干净率进度条 ═══ */}
      <div className="rounded-xl border border-[var(--color-border)]/60 bg-white/70 p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-[600] text-[var(--color-text-secondary)]">
            {t('organize.analyzeReport.cleanRate', '整理完成度')}
          </span>
          <span className="text-sm font-[800] text-[var(--color-brand)]">{cleanRate}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-[var(--color-gray-100)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.max(cleanRate, 8)}%`,
              background: 'linear-gradient(90deg, #8C85FF 0%, #6C63FF 60%, #5046E5 100%)',
              boxShadow: '0 0 8px rgba(108, 99, 255, 0.4)',
            }}
          />
        </div>
      </div>

      {/* ═══ 各工具结果卡片 ═══ */}
      <div className="space-y-3">
        {report.map((item, index) => {
          const theme = TOOL_THEME[item.tool] ?? {
            bg: 'linear-gradient(135deg, #F1F3F5 0%, #E9ECEF 100%)',
            icon: '#6C757D',
            bar: 'linear-gradient(90deg, #ADB5BD 0%, #868E96 100%)',
            ring: '#868E96',
          };
          const hasResult = item.hasResult;

          return (
            <div
              key={item.tool}
              className="group flex items-center gap-4 rounded-xl border border-[var(--color-border)]/60 bg-white/70 p-4 transition-all duration-200
                hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/40 animate-[fadeIn_0.3s_ease]"
              style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'backwards' }}
            >
              {/* 渐变图标底 */}
              <div
                className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                style={{
                  background: theme.bg,
                  color: theme.icon,
                  boxShadow: `0 2px 8px ${hasResult ? theme.ring : '#ADB5BD'}22`,
                }}
              >
                {TOOL_ICON[item.tool] ?? null}
              </div>

              {/* 信息区 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-[700] ${hasResult ? 'text-[var(--color-gray-800)]' : 'text-[var(--color-gray-400)]'}`}>
                    {item.label}
                  </span>
                  {/* 状态徽章 */}
                  {hasResult ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-[700]"
                      style={{
                        background: `${theme.ring}1A`,
                        color: theme.icon,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: theme.icon }}
                      />
                      {t('organize.analyzeReport.foundBadge', '已发现')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-[700] bg-[var(--color-success-light)] text-[var(--color-success)]">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                        <path d="M3 8l3 3 7-7" />
                      </svg>
                      {t('organize.analyzeReport.cleanBadge', '无需处理')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">
                  {hasResult
                    ? t('organize.analyzeReport.jumpHint', '发现 {{count}} 项{{sub}}', {
                        count: item.count,
                        sub: item.subCount ? t('organize.analyzeReport.subCount', '（涉及 {{sub}}）', { sub: item.subCount }) : '',
                      })
                    : t('organize.analyzeReport.cleanHint', '该项无需处理')}
                </p>
              </div>

              {/* 操作按钮 */}
              {hasResult && (
                <button
                  type="button"
                  onClick={() => onJump(item.targetTool)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-[600] cursor-pointer
                    text-white hover:-translate-y-px active:scale-95 transition-all shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${theme.ring}E6 0%, ${theme.icon} 100%)`,
                    boxShadow: `0 2px 8px ${theme.ring}33`,
                  }}
                >
                  {t('organize.analyzeReport.handle', '去处理')}
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 统计卡片组件：渐变背景 + 图标 + 数值 */
function StatCard({
  label,
  value,
  gradient,
  textColor,
  icon,
}: {
  label: string;
  value: number;
  gradient: string;
  textColor: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-3.5 transition-all duration-200
        hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)]"
      style={{
        background: gradient,
      }}
    >
      <div className="absolute -bottom-6 -right-6 w-16 h-16 rounded-full bg-white/20 pointer-events-none" />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-2xl font-[800] tracking-tight" style={{ color: textColor }}>
            {value}
          </div>
          <div className="text-[11px] font-[500] mt-0.5" style={{ color: `${textColor}CC` }}>
            {label}
          </div>
        </div>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,0.55)',
            color: textColor,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
