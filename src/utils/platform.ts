/**
 * 平台检测工具（Tauri 环境）
 * ──────────────────────────────────────────────────
 * 用于在运行时区分 Windows / macOS / Linux，决定 UI 适配（如窗口控件、交通灯让位）。
 * Tauri 注入的 __TAURI_INTERNALS__ 不直接暴露平台，但可用 navigator.platform / userAgent 检测。
 */

/** 是否 macOS（运行时检测，SSR 安全） */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.platform 在新版浏览器被废弃，但 Tauri WebView2/WKWebView 仍支持
  const platform = navigator.platform || '';
  if (platform.toLowerCase().includes('mac')) return true;
  // 兜底用 userAgent
  const ua = navigator.userAgent || '';
  return /Mac OS X/i.test(ua);
}

/** 是否 Windows */
export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  if (platform.toLowerCase().includes('win')) return true;
  const ua = navigator.userAgent || '';
  return /Windows/i.test(ua);
}

/**
 * macOS 交通灯按钮宽度（左红黄绿三个按钮 + 右侧间距）
 * 用于标题栏左侧 padding 让位，避免按钮遮挡内容。
 * 3 个按钮（每个 12px）+ 间距 + 左边距 20px ≈ 68px，padding 设 72px 留 4px 间距
 */
export const MAC_TRAFFIC_LIGHTS_WIDTH = 72;
