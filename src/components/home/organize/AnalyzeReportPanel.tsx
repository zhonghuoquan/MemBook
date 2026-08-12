/**
 * 一键分析结果报告页
 *
 * 照片整理“一键分析”（去重 → 人脸识别 → 相似照片 → 截图识别）全部完成后，
 * 展示各工具的结果汇总，让用户直观看到“整理的价值”，并可一键跳转到对应工具处理。
 */
import { useTranslation } from 'react-i18next';
import type { ToolResultSummary } from '../../../photo-tools';

/** 每个工具的跳转目标映射 */
const TOOL_COLOR: Record<string, { bg: string; text: string }> = {
  dedupe: { bg: 'bg-[#FFC9BA]', text: 'text-[#D1513B]' },
  faceCluster: { bg: 'bg-[#D8C2F1]', text: 'text-[#8A5FC4]' },
  similar: { bg: 'bg-[#FFE6A0]', text: 'text-[#AC8313]' },
  screenshot: { bg: 'bg-[#B4E3DD]', text: 'text-[#23847A]' },
  organize: { bg: 'bg-[#BFD9F3]', text: 'text-[#3C83C7]' },
  exif: { bg: 'bg-[#BCE4C9]', text: 'text-[#3C9258]' },
  rename: { bg: 'bg-[#B4E3DD]', text: 'text-[#23847A]' },
  convert: { bg: 'bg-[#F8C9DC]', text: 'text-[#C04B7C]' },
  timeline: { bg: 'bg-[#C7CFF5]', text: 'text-[#4B57B8]' },
  calendar: { bg: 'bg-[#B8E8EA]', text: 'text-[#178A9C]' },
};

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
};

export function AnalyzeReportPanel({
  report,
  onClose,
  onJump,
}: {
  report: ToolResultSummary[];
  onClose: () => void;
  onJump: (tool: string) => void;
}) {
  const { t } = useTranslation();

  if (report.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-white/70 p-8 text-center">
        <div className="text-4xl mb-3">📊</div>
        <h3 className="text-base font-[700] text-[var(--color-gray-800)] mb-1">
          {t('organize.analyzeReport.emptyTitle', '分析报告')}
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('organize.analyzeReport.emptyHint', '暂无可展示的分析结果，请先点击“一键分析”')}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white/70 p-6">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[var(--color-brand)]/10 text-[var(--color-brand)] flex items-center justify-center text-xl">
            📊
          </div>
          <div>
            <h3 className="text-base font-[700] text-[var(--color-gray-800)]">
              {t('organize.analyzeReport.title', '一键分析完成')}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              {t('organize.analyzeReport.subtitle', '以下是本次整理发现的结果，点击即可跳转处理')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer
            border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-gray-600)]
            hover:bg-[var(--color-surface-hover)] transition-all"
          title={t('common.close', '关闭')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          {t('common.close', '关闭')}
        </button>
      </div>

      {/* 总览统计 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <SummaryStat
          label={t('organize.analyzeReport.totalTools', '分析工具')}
          value={report.length}
          color="text-[var(--color-brand)]"
        />
        <SummaryStat
          label={t('organize.analyzeReport.hasIssue', '发现可处理项')}
          value={report.filter((s) => s.hasResult).length}
          color="text-amber-500"
        />
        <SummaryStat
          label={t('organize.analyzeReport.clean', '无需处理')}
          value={report.filter((s) => !s.hasResult).length}
          color="text-green-500"
        />
        <SummaryStat
          label={t('organize.analyzeReport.totalCount', '累计问题数')}
          value={report.reduce((s, r) => s + (r.hasResult ? r.count : 0), 0)}
          color="text-red-500"
        />
      </div>

      {/* 各工具结果卡片 */}
      <div className="space-y-3">
        {report.map((item) => {
          const color = TOOL_COLOR[item.tool] ?? { bg: 'bg-[var(--color-gray-100)]', text: 'text-[var(--color-gray-600)]' };
          return (
            <div
              key={item.tool}
              className="flex items-center gap-4 rounded-xl border border-[var(--color-border)]/60 bg-white/60 p-4 transition-all hover:shadow-[var(--shadow-md)] hover:border-[var(--color-brand)]/40"
            >
              <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${color.bg} ${color.text}`}>
                {TOOL_ICON[item.tool] ?? null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-[700] ${item.hasResult ? 'text-[var(--color-gray-800)]' : 'text-[var(--color-gray-400)]'}`}>
                    {item.label}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {item.hasResult
                    ? t('organize.analyzeReport.jumpHint', '发现 {{count}} 项{{sub}}', {
                        count: item.count,
                        sub: item.subCount ? t('organize.analyzeReport.subCount', '（涉及 {{sub}}）', { sub: item.subCount }) : '',
                      })
                    : t('organize.analyzeReport.cleanHint', '该项无需处理')}
                </p>
              </div>
              {item.hasResult && (
                <button
                  type="button"
                  onClick={() => onJump(item.targetTool)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-[600] cursor-pointer
                    bg-[var(--color-brand)] text-white hover:opacity-90 active:scale-95 transition-all shadow-sm"
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

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)]/50 bg-white/60 p-3 text-center">
      <div className={`text-2xl font-[700] ${color}`}>{value}</div>
      <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{label}</div>
    </div>
  );
}
