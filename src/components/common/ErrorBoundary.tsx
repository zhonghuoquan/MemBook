import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '../../utils/sentry';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 全局错误边界：捕获子组件渲染异常，防止白屏。
 * 默认回退页显示错误摘要 + 返回主页按钮。
 * 捕获的错误会同步上报到 Sentry（仅生产环境）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
    // 上报到 Sentry（生产环境生效，开发环境静默）
    captureError(error, {
      componentStack: info.componentStack ?? '',
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-[var(--color-surface)] text-center">
      <div className="w-16 h-16 rounded-[var(--radius-2xl)] bg-[var(--color-error-light)] flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5" className="w-8 h-8">
          <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-[var(--text-h2)] font-[700] text-[var(--color-gray-800)] mb-2">{t('common.errorBoundary.title')}</h2>
      <p className="text-[var(--text-body)] text-[var(--color-text-secondary)] mb-1 max-w-md">
        {t('common.errorBoundary.description')}
      </p>
      {import.meta.env.DEV && (
        <pre className="mt-3 mb-4 p-3 bg-[var(--color-gray-100)] rounded-[var(--radius-md)] text-[11px] text-left max-w-lg overflow-auto text-[var(--color-error)]">
          {error.message}
          {error.stack && '\n' + error.stack.slice(0, 500)}
        </pre>
      )}
      <div className="flex items-center gap-3 mt-5">
        <button
          className="px-5 py-2.5 rounded-[var(--radius-lg)] bg-[var(--color-brand)] text-white text-[var(--text-body-sm)] font-[600] border-none cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors"
          onClick={() => { reset(); window.location.reload(); }}
        >
          {t('common.errorBoundary.reload')}
        </button>
        <button
          className="px-5 py-2.5 rounded-[var(--radius-lg)] bg-white text-[var(--color-gray-700)] text-[var(--text-body-sm)] font-[600] border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => {
            reset();
            try { sessionStorage.removeItem('membook-session-page'); } catch { /* ignore */ }
            window.location.href = isTauri ? window.location.origin : '/';
          }}
        >
          {t('common.errorBoundary.backHome')}
        </button>
      </div>
    </div>
  );
}
