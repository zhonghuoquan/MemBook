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
 *   "version": "1.2.3",
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
/** 曾检测到过的最新版本号（localStorage 持久化，用于「重装低版本」时放行冷却） */
const KNOWN_VERSION_KEY = 'membook-update-known-version';

/** 比较 x.y.z 版本号：a>b 返回正数，a<b 返回负数，相等返回 0 */
function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0);
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** 记录曾检测到的最新版本（取历史最高值），供重装低版本时判断是否放行检查 */
function recordKnownVersion(v: string): void {
  try {
    const prev = localStorage.getItem(KNOWN_VERSION_KEY);
    if (!prev || compareVersions(v, prev) > 0) {
      localStorage.setItem(KNOWN_VERSION_KEY, v);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 已下载/待安装的 Update 句柄。
 * checkForUpdate 检测到新版后即暂存于此，供后台下载与稍后安装复用，
 * 避免「检查 → 下载 → 安装」多次重复 check 请求。
 */
let pendingUpdate: Update | null = null;

function toInfo(update: Update): UpdateInfo {
  return {
    version: update.version,
    currentVersion: APP_VERSION,
    date: update.date,
    body: update.body,
  };
}

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
 *
 * 多端点说明（国内优先 cnb，失败回退 GitHub）：
 * - tauri.conf.json 的 plugins.updater.endpoints 数组按顺序请求；
 * - Tauri 只有在前一个端点返回非 2XX 或请求失败时才尝试下一个；
 * - cnb 的清单内 url 指向 cnb 安装包，GitHub 的清单 url 指向 GitHub 安装包，
 *   从而让国内用户自动走 cnb 下载、海外用户走 GitHub。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  try {
    const update = await check({ timeout: 30000 });
    if (!update) {
      logger.info('[updater] 当前已是最新版本');
      return null;
    }
    // 暂存句柄，供后台下载 / 稍后安装复用
    if (pendingUpdate && pendingUpdate !== update) {
      pendingUpdate.close().catch(() => {});
    }
    pendingUpdate = update;
    recordKnownVersion(update.version);
    logger.info(`[updater] 发现新版本 ${update.version}（当前 ${APP_VERSION}）`);
    return toInfo(update);
  } catch (e) {
    logger.warn('[updater] 检查更新失败:', e);
    return null;
  }
}

/**
 * 取当前暂存（待下载/已下载）更新的展示信息，无则返回 null */
export function getPendingUpdateInfo(): UpdateInfo | null {
  return pendingUpdate ? toInfo(pendingUpdate) : null;
}

/** 手动检查的三种结果：无更新 / 有更新（可下载）/ 检查失败（网络等） */
export type ManualCheckResult =
  | { status: 'latest' }
  | { status: 'update'; info: UpdateInfo }
  | { status: 'error'; message: string };

/**
 * 手动检查是否有更新（用户主动触发，规避冷却期）。
 * 与 checkForUpdate 不同：返回结果能区分「无更新 / 有更新 / 检查失败」，
 * 供「关于」弹窗据实提示，避免把网络错误误报成「已是最新」。
 * 非桌面端返回 error。
 */
export async function manualCheckForUpdate(): Promise<ManualCheckResult> {
  if (!isTauri) return { status: 'error', message: '仅桌面端支持' };
  try {
    const update = await check({ timeout: 30000 });
    if (!update) {
      logger.info('[updater] 手动检查：当前已是最新版本');
      return { status: 'latest' };
    }
    if (pendingUpdate && pendingUpdate !== update) {
      pendingUpdate.close().catch(() => {});
    }
    pendingUpdate = update;
    recordKnownVersion(update.version);
    logger.info(`[updater] 手动检查：发现新版本 ${update.version}（当前 ${APP_VERSION}）`);
    return { status: 'update', info: toInfo(update) };
  } catch (e) {
    logger.warn('[updater] 手动检查更新失败:', e);
    return { status: 'error', message: (e as Error)?.message || String(e) };
  }
}

/**
 * 检查更新是否在冷却期内（避免频繁弹窗打扰用户）。
 */
export function isWithinCheckCooldown(): boolean {
  try {
    // 规则：若当前版本低于「曾检测到过的新版本」（如重装低版本），即使冷却期内也放行检查
    const known = localStorage.getItem(KNOWN_VERSION_KEY);
    if (known && compareVersions(APP_VERSION, known) < 0) {
      return false;
    }
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
 * 后台下载已检测到的新版更新包（只下载，不安装）。
 * 下载完成后调用 installPrepared() 才会真正安装并重启。
 * @param onProgress 下载进度回调
 */
export async function startAutoDownload(
  onProgress?: (p: UpdateProgress) => void,
): Promise<UpdateInfo | null> {
  if (!isTauri || !pendingUpdate) return null;

  try {
    const update = pendingUpdate;
    let total = 0;
    let downloaded = 0;

    await update.download((event: DownloadEvent) => {
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
          onProgress?.({ phase: 'done', downloaded: total, total });
          break;
      }
    });

    return toInfo(update);
  } catch (e) {
    logger.warn('[updater] 后台下载失败:', e);
    throw e;
  }
}

/**
 * 安装已下载好的更新并重启应用。
 * 应在 startAutoDownload 成功后用户确认时调用。
 */
export async function installPrepared(): Promise<void> {
  if (!isTauri) throw new Error('自动更新仅在桌面端可用');
  if (!pendingUpdate) throw new Error('没有已下载的更新');

  const update = pendingUpdate;
  try {
    await update.install();
  } catch (e) {
    logger.error('[updater] 安装更新失败:', e);
    throw e;
  } finally {
    pendingUpdate.close().catch(() => {});
    pendingUpdate = null;
  }
  await relaunchApp();
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

/** 导出 Update 类型供组件使用 */
export type { Update };
