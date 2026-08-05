/**
 * Tauri 自动更新服务
 *
 * 基于 @tauri-apps/plugin-updater，负责：
 * - 启动后静默检查更新（仅 Tauri 桌面端生效）
 * - 下载更新包并校验签名
 * - 安装并重启
 *
 * 更新服务器需返回 JSON：
 * {
 *   "version": "1.1.0",
 *   "pub_date": "2026-07-23T10:00:00Z",
 *   "notes": "更新说明",
 *   "platforms": {
 *     "windows-x86_64": { "signature": "...", "url": "https://.../*.nsis.zip" }
 *   }
 * }
 *
 * 签名密钥对已生成在 .tauri/ 目录：
 * - membook-updater.key（私钥，仅 CI 构建时使用，不提交）
 * - membook-updater.key.pub（公钥，已写入 tauri.conf.json）
 *
 * 构建签名包需设置环境变量：
 *   TAURI_SIGNING_PRIVATE_KEY=<私钥内容或路径>
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密码，无密码则省略>
 */

import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { APP_VERSION } from '../version';
import { logger } from './logger';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 24 小时内已检查过的更新不再重复弹窗（避免频繁打扰） */
const CHECK_COOLDOWN_KEY = 'membook-update-last-check';
const CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type UpdateProgress = {
  phase: 'downloading' | 'installing' | 'done' | 'error';
  downloaded?: number;
  total?: number;
  message?: string;
};

/**
 * 检查是否有可用更新（不下载，不安装）。
 * 非桌面端直接返回 null。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  try {
    const update = await check();
    if (!update) {
      logger.info('[updater] 当前已是最新版本');
      return null;
    }
    logger.info(`[updater] 发现新版本 ${update.version}（当前 ${APP_VERSION}）`);
    return {
      version: update.version,
      currentVersion: APP_VERSION,
      date: update.date,
      body: update.body,
    };
  } catch (e) {
    logger.warn('[updater] 检查更新失败:', e);
    return null;
  }
}

/**
 * 检查更新是否在冷却期内（避免频繁弹窗打扰用户）。
 */
export function isWithinCheckCooldown(): boolean {
  try {
    const last = localStorage.getItem(CHECK_COOLDOWN_KEY);
    if (!last) return false;
    return Date.now() - parseInt(last, 10) < CHECK_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * 标记「已检查更新」时间戳，启动冷却计时。
 */
export function markChecked(): void {
  try {
    localStorage.setItem(CHECK_COOLDOWN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * 下载并安装更新。
 * @param onProgress 下载进度回调
 */
export async function downloadAndInstall(
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  if (!isTauri) throw new Error('自动更新仅在桌面端可用');

  const update = await check();
  if (!update) throw new Error('没有可用更新');

  let total = 0;
  let downloaded = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0;
        onProgress?.({ phase: 'downloading', downloaded: 0, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: 'downloading', downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ phase: 'installing', downloaded: total, total });
        break;
    }
  });

  onProgress?.({ phase: 'done' });
}

/**
 * 安装完成后重启应用以应用更新。
 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri) return;
  try {
    await relaunch();
  } catch (e) {
    logger.error('[updater] 重启失败:', e);
    throw e;
  }
}

/**
 * 从 Update 对象直接下载安装（用于已有 Update 引用的场景）。
 * 保留 downloadAndInstall 作为简化版本，此方法暴露完整控制。
 */
export async function installUpdate(
  update: Update,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  let total = 0;
  let downloaded = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0;
        onProgress?.({ phase: 'downloading', downloaded: 0, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: 'downloading', downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ phase: 'installing', downloaded: total, total });
        break;
    }
  });

  onProgress?.({ phase: 'done' });
}

/** 导出 Update 类型供组件使用 */
export type { Update };
