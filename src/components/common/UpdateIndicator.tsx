import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store';

/**
 * 自动更新指示器：主页顶栏右上角。
 * - 后台下载中：外圈「能量圈」按进度描弧 + 中间下载动效图标，只读展示、不响应点击。
 * - 下载完成：变为「更新」按钮（图标 + 文字），点击打开更新弹窗。
 * 无更新流程时不渲染任何内容。
 */
export function UpdateIndicator() {
  const { t } = useTranslation();
  const autoUpdate = useUIStore((s) => s.autoUpdate);
  const readyUpdate = useUIStore((s) => s.readyUpdate);
  const setUpdateDialog = useUIStore((s) => s.setUpdateDialog);

  // 无更新流程 → 不渲染
  if (!autoUpdate && !readyUpdate) return null;

  // 下载完成 → 「更新」按钮
  if (readyUpdate) {
    return (
      <button
        data-no-drag
        type="button"
        onClick={() => setUpdateDialog(readyUpdate)}
        title={t('updater.update')}
        className="group ml-auto flex items-center gap-1.5 px-3 h-8 rounded-full
                   border border-[var(--color-border)] bg-[var(--color-card)]
                   text-[var(--color-primary-600)] text-[var(--text-body-sm)] font-[600]
                   hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-50)]
                   hover:shadow-[0_0_0_4px_var(--color-primary-100)] transition-all cursor-pointer
                   animate-[updatePulse_2.4s_ease-in-out_infinite]"
      >
        {/* 下载完成图标 */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M12 3v10" />
          <path d="M7.5 9.5 12 14l4.5-4.5" />
          <path d="M4 19v-2.6a1.4 1.4 0 0 1 1.4-1.4h13.2a1.4 1.4 0 0 1 1.4 1.4V19" />
        </svg>
        <span>{t('updater.update')}</span>
      </button>
    );
  }

  // 走到这里说明有下载流程在跑；兜底防御 autoUpdate 为空（保持类型收窄）
  if (!autoUpdate) return null;

  // 后台下载中 → 圆形进度环 + 下载动效
  const total = autoUpdate.progress?.total ?? 0;
  const downloaded = autoUpdate.progress?.downloaded ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const R = 12;
  const CIRC = 2 * Math.PI * R;
  const dash = (pct / 100) * CIRC;

  return (
    <div data-no-drag title={t('updater.autoDownloading', { version: autoUpdate.version })} className="ml-auto">
      <div className="relative w-10 h-10 flex items-center justify-center">
        {/* 外圈「能量圈」：按进度描弧 */}
        <svg viewBox="0 0 32 32" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="16" cy="16" r={R} fill="none" stroke="var(--color-surface-raised)" strokeWidth="3" />
          <circle
            cx="16" cy="16" r={R} fill="none"
            stroke="var(--color-primary-500)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRC - dash}`}
            className="transition-[stroke-dasharray] duration-200 ease-out"
          />
        </svg>
        {/* 中心下载动效 */}
        <div className="flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 animate-[downloadBounce_1.4s_ease-in-out_infinite]">
            <path d="M12 5v8" />
            <path d="M8.5 10 12 13.5 15.5 10" />
            <path d="M5 19h14" />
          </svg>
        </div>
      </div>
    </div>
  );
}