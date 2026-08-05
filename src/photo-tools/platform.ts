/**
 * 平台检测与环境适配
 *
 * 判断当前运行环境是 Web 浏览器还是 Tauri 桌面端，
 * 并提供对应的能力接口。
 */

import type { PlatformCapability } from './types';

/** 检测是否在 Tauri 环境中运行 */
export function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

/** 获取当前平台能力标识 */
export function getPlatform(): PlatformCapability {
  return isTauri() ? 'tauri' : 'web';
}

/** 是否支持真实文件系统操作（移动、删除文件等）
 *
 * - Tauri：是（通过 plugin-fs）
 * - Web + FileSystemDirectoryHandle (readwrite)：部分支持（受限）
 * - Web + import 模式：否
 */
export function supportsFileSystemWrite(): boolean {
  return isTauri();
}

/** 是否支持调用外部命令（Python 脚本等）
 *
 * 仅 Tauri 通过 plugin-shell 支持
 */
export function supportsShellCommand(): boolean {
  return isTauri();
}

/**
 * 获取用户数据目录下脚本的基础路径（Tauri 端用）
 * 用于定位 Python 整理脚本的位置
 */
export async function getScriptsBasePath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { appDataDir, sep } = await import('@tauri-apps/api/path');
    const dataDir = await appDataDir();
    // 默认在用户数据目录下的 scripts 子目录
    return `${dataDir}${sep}scripts`;
  } catch {
    return null;
  }
}
