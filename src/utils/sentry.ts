/**
 * Sentry 错误监控初始化
 *
 * 仅在生产环境 + Tauri 桌面端初始化，开发环境完全跳过。
 * DSN 通过 Vite 环境变量 VITE_SENTRY_DSN 注入（写入 .env.production）。
 *
 * 隐私策略：
 * - 不收集用户照片、相册内容等业务数据
 * - 仅上报错误堆栈、应用版本、操作系统信息
 * - 用户可在「关于」页面查看监控状态
 *
 * 配置方式：
 * 1. 在 Sentry 官网创建项目，获取 DSN
 * 2. 在项目根目录创建 .env.production 文件：
 *    VITE_SENTRY_DSN=https://xxx@sentry.io/xxx
 * 3. 构建时会自动注入
 *
 * 如不配置 DSN，则 Sentry 不初始化，不影响应用正常运行。
 */

import * as Sentry from '@sentry/react';
import { APP_VERSION } from '../version';
import { logger } from './logger';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const isDev = import.meta.env.DEV;
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let initialized = false;

/**
 * 初始化 Sentry。仅在生产环境且配置了 DSN 时生效。
 * 必须在 React 渲染前调用（main.tsx 中）。
 */
export function initSentry(): void {
  if (isDev) {
    logger.info('[sentry] 开发环境，跳过初始化');
    return;
  }

  if (!SENTRY_DSN) {
    logger.info('[sentry] 未配置 DSN，跳过初始化');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `membook@${APP_VERSION}`,
    environment: isTauri ? 'desktop' : 'web',
    // 采样率：桌面端崩溃事件量不大，全量上报
    sampleRate: 1.0,
    // tracesSampleRate: 0 — 不收集性能数据，仅收集错误
    tracesSampleRate: 0,
    integrations: [
      // 自动捕获 console.error
      Sentry.captureConsoleIntegration({
        levels: ['error'],
      }),
    ],
    // 过滤掉非关键错误（如 ResizeObserver、网络请求失败等）
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      // Tauri IPC 偶发超时
      'channel disconnected',
    ],
    beforeSend(event) {
      // 脱敏：移除可能包含文件路径的 URL 参数
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          url.search = '';
          event.request.url = url.toString();
        } catch {
          /* ignore */
        }
      }
      return event;
    },
  });

  initialized = true;
  logger.info('[sentry] 初始化完成');
}

/**
 * 手动上报错误到 Sentry。
 * 在非初始化环境下静默丢弃，不影响业务逻辑。
 */
export function captureError(error: Error | string, context?: Record<string, unknown>): void {
  if (!initialized) {
    logger.error('[sentry] (未初始化) 错误:', error, context);
    return;
  }
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, { value });
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/** 添加面包屑（breadcrumb），用于追踪错误发生前的用户操作链路。
 */
export function addBreadcrumb(
  message: string,
  category: string = 'ui',
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!initialized) return;
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    timestamp: Date.now() / 1000,
  });
}

/** Sentry 是否已初始化 */
export function isSentryInitialized(): boolean {
  return initialized;
}
