/**
 * MemBook — 激活码校验服务
 *
 * 采用 RSA-PKCS1-v1_5 + SHA-256 离线验签。
 * 激活码格式：MBK-XXXX-XXXX-XXXX-XXXX（16 位随机字符，去除 I/O/0/1）。
 *
 * 试用期机制：
 * - 首次启动通过 Rust 后端读取 Windows MachineGuid 生成真实机器指纹
 * - 试用期记录持久化到 appDataDir 的 trial.json（普通卸载不会清除该目录）
 * - 同时写入注册表锚点 HKCU\Software\MemBook\TrialStart 作为冗余锚点，
 *   即使卸载时勾选「删除应用数据」或手动清除 AppData 目录，锚点仍在
 * - 文件与注册表双锚点任一存在即可识别本机已试用过，防止卸载重装无限白嫖
 * - 7 天试用期内所有功能开放，试用期满后限制高级功能
 */

import { invoke } from '@tauri-apps/api/core';
import { LICENSE_PUBLIC_KEY } from './publicKey';
import type { ActivationResult, LicenseFeature, TrialRecord } from './types';
import { isFeatureAvailableForTier } from './tiers';
import { logger } from '../utils/logger';
import i18n from '../i18n';

const LICENSE_STORAGE_KEY = 'membook-license-v1';
const MACHINE_ID_KEY = 'membook-machine-id';
const TRIAL_START_KEY = 'membook-trial-start';

/** 试用期天数 */
const TRIAL_DAYS = 7;

/** 机器码与试用期缓存（初始化后保持同步读取） */
let _machineId: string | null = null;
let _trialRecord: TrialRecord | null = null;
let _initialized = false;

export interface StoredLicense {
  isActivated: boolean;
  activatedAt: string;
  activatedCode: string;
  signature: string;
  machineId?: string;
}

export interface TrialInfo {
  /** 试用开始时间（ISO 字符串） */
  startDate: string;
  /** 试用剩余天数（0 = 已到期） */
  remainingDays: number;
  /** 是否在试用期内 */
  isActive: boolean;
}

/* ── 许可证持久化 ── */

/** 从 storage 读取已保存的许可证 */
export function loadStoredLicense(): StoredLicense | null {
  try {
    const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(atob(raw)) as StoredLicense;
  } catch {
    return null;
  }
}

/** 保存许可证到 storage（简单 base64 混淆） */
export function saveStoredLicense(license: StoredLicense): void {
  try {
    localStorage.setItem(LICENSE_STORAGE_KEY, btoa(JSON.stringify(license)));
  } catch (err) {
    logger.error('[license] 保存许可证失败:', err);
  }
}

/** 清除许可证 */
export function clearStoredLicense(): void {
  try {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch (err) {
    logger.warn('[license] 清除许可证失败:', err);
  }
}

/* ── Rust 命令包装 ── */

async function getMachineFingerprint(): Promise<string> {
  try {
    return await invoke<string>('get_machine_fingerprint');
  } catch (err) {
    logger.error('[license] 获取机器指纹失败:', err);
    return 'unknown';
  }
}

async function loadTrialRecord(): Promise<TrialRecord | null> {
  try {
    return await invoke<TrialRecord | null>('load_trial_record');
  } catch (err) {
    logger.error('[license] 读取试用期记录失败:', err);
    return null;
  }
}

async function saveTrialRecord(record: TrialRecord): Promise<void> {
  try {
    await invoke('save_trial_record', { record });
  } catch (err) {
    logger.error('[license] 保存试用期记录失败:', err);
  }
}

/** 读取注册表锚点（HKCU\Software\MemBook\TrialStart），作为试用期的第二持久化锚点 */
async function loadTrialAnchor(): Promise<string | null> {
  try {
    return await invoke<string | null>('load_trial_anchor');
  } catch (err) {
    logger.error('[license] 读取试用期锚点失败:', err);
    return null;
  }
}

/** 写入注册表锚点，与 trial.json 互为冗余，防止清除 AppData 后无限重置 */
async function saveTrialAnchor(start: string): Promise<void> {
  try {
    await invoke('save_trial_anchor', { start });
  } catch (err) {
    logger.error('[license] 保存试用期锚点失败:', err);
  }
}

/* ── 初始化 ── */

/**
 * 初始化许可证服务。
 * 必须在应用启动后尽早调用，完成机器码与试用期记录的加载。
 */
export async function initLicenseService(): Promise<void> {
  if (_initialized) return;

  const machineId = await getMachineFingerprint();

  // 老版本迁移：如果 localStorage 中有旧的随机机器码，且当前 license 绑定的是旧机器码，
  // 则把 license 的 machineId 更新为新的真实机器码，避免老用户需要重新激活。
  const oldMachineId = localStorage.getItem(MACHINE_ID_KEY);
  const license = loadStoredLicense();
  if (license && oldMachineId && license.machineId === oldMachineId && machineId !== 'unknown') {
    license.machineId = machineId;
    saveStoredLicense(license);
  }

  let record = await loadTrialRecord();
  const anchor = await loadTrialAnchor();

  if (record && record.machine_id !== machineId) {
    // 机器码变化（例如更换硬件或重装系统）：保留原试用期，防止换硬件重新白嫖
    record = {
      machine_id: machineId,
      trial_start: record.trial_start,
      trial_used: record.trial_used,
    };
    await saveTrialRecord(record);
    await saveTrialAnchor(record.trial_start);
  } else if (!record && anchor) {
    // AppData 被清除（卸载时勾选「删除应用数据」或手动删除），但注册表锚点仍在：
    // 据此恢复试用期起点，防止卸载重装无限白嫖
    record = {
      machine_id: machineId,
      trial_start: anchor,
      trial_used: true,
    };
    await saveTrialRecord(record);
  } else if (!record && !anchor) {
    // 真正的首次运行：尝试从旧版本 localStorage 迁移，否则发放一次 7 天试用
    const legacyStart = localStorage.getItem(TRIAL_START_KEY);
    const start = legacyStart ?? new Date().toISOString();
    record = {
      machine_id: machineId,
      trial_start: start,
      trial_used: true,
    };
    await saveTrialRecord(record);
    await saveTrialAnchor(start);
  } else if (record && !anchor) {
    // 文件记录存在、注册表锚点缺失（老用户升级）：补写锚点，强化持久化
    await saveTrialAnchor(record.trial_start);
  }
  // record && anchor && 同机器：无需处理

  _machineId = machineId;
  _trialRecord = record;
  _initialized = true;
}

/* ── 机器指纹 ── */

/** 获取机器指纹（需先调用 initLicenseService） */
export function getMachineId(): string {
  return _machineId ?? localStorage.getItem(MACHINE_ID_KEY) ?? 'unknown';
}

/* ── 试用期管理 ── */

function getTrialStartDate(): string {
  return _trialRecord?.trial_start ?? localStorage.getItem(TRIAL_START_KEY) ?? new Date().toISOString();
}

/** 计算试用期剩余天数 */
export function getTrialRemainingDays(): number {
  const start = new Date(getTrialStartDate()).getTime();
  const now = Date.now();
  const elapsedDays = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  return Math.max(0, TRIAL_DAYS - elapsedDays);
}

/** 试用期是否仍然有效 */
export function isTrialActive(): boolean {
  return getTrialRemainingDays() > 0;
}

/** 获取完整的试用期信息 */
export function getTrialInfo(): TrialInfo {
  const startDate = getTrialStartDate();
  const remainingDays = getTrialRemainingDays();
  return {
    startDate,
    remainingDays,
    isActive: remainingDays > 0,
  };
}

/** 重置试用期（仅供调试用） */
export function resetTrial(): void {
  const machineId = _machineId ?? localStorage.getItem(MACHINE_ID_KEY) ?? 'unknown';
  const start = new Date().toISOString();
  _trialRecord = null;
  localStorage.removeItem(TRIAL_START_KEY);
  // 同时重置 appDataDir 的 trial.json 与注册表锚点，保持双锚点一致
  saveTrialRecord({
    machine_id: machineId,
    trial_start: start,
    trial_used: true,
  }).catch(() => {});
  saveTrialAnchor(start).catch(() => {});
}

/* ── 激活码校验 ── */

/** 导入公钥 */
async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    LICENSE_PUBLIC_KEY,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/** 将 base64url 转为 ArrayBuffer */
function base64UrlToBuffer(input: string): ArrayBuffer {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 构建待签名字节（支持可选机器码绑定） */
function buildSignedData(code: string, machineId?: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const payload = machineId ? `${code}:${machineId}` : code;
  const encoded = encoder.encode(payload);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

/** 校验激活码与签名 */
export async function verifyActivationCode(
  code: string,
  signatureBase64: string,
  machineId?: string,
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey();
    const data = buildSignedData(code, machineId);
    const signature = base64UrlToBuffer(signatureBase64);
    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      data,
    );
  } catch {
    return false;
  }
}

/** 校验激活码格式 */
export function isValidCodeFormat(code: string): boolean {
  return /^MBK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
}

/** 尝试激活 */
export async function activateLicense(code: string, signature: string): Promise<ActivationResult> {
  if (!isValidCodeFormat(code)) {
    return { success: false, error: i18n.t('license.service.invalidCodeFormat') };
  }
  const machineId = getMachineId();
  if (!machineId || machineId === 'unknown') {
    return { success: false, error: i18n.t('license.service.noMachineId') };
  }
  // 仅接受绑定当前机器指纹的签名，防止激活码跨机器复制使用
  const valid = await verifyActivationCode(code, signature, machineId);
  if (!valid) {
    return { success: false, error: i18n.t('license.service.invalidCodeOrSignature') };
  }
  const license: StoredLicense = {
    isActivated: true,
    activatedAt: new Date().toISOString(),
    activatedCode: code,
    signature,
    machineId,
  };
  saveStoredLicense(license);
  return { success: true };
}

/* ── 权限检查 ── */

/**
 * 当前是否已激活（同时校验机器码是否一致，防止授权被复制）。
 * 试用期内也视为已激活，试用期结束后必须有有效许可证。
 */
export function isActivated(): boolean {
  const license = loadStoredLicense();
  if (!license || license.isActivated !== true) {
    // 未激活 — 检查是否在试用期内
    return isTrialActive();
  }
  // 已激活 — 校验机器码
  if (license.machineId && license.machineId !== getMachineId()) return false;
  return true;
}

/** 普通用户（未激活）最多可创建的相册数量 */
const FREE_USER_PROJECT_LIMIT = 10;

/** 普通用户是否可以继续创建项目 */
export function canCreateProject(currentProjectCount: number): boolean {
  // 已激活 → 不限制
  if (isActivated()) return true;
  // 未激活（含试用期内外）→ 最多创建 FREE_USER_PROJECT_LIMIT 个
  return currentProjectCount < FREE_USER_PROJECT_LIMIT;
}

/** 检查某功能是否可用 */
export function isFeatureAvailable(feature: LicenseFeature): boolean {
  // 已激活（Pro）或试用期内 → 所有功能可用
  // 试用期结束且未激活 → Free 档：Pro 专属功能不可用，基础功能仍可用
  return isFeatureAvailableForTier(isActivated(), feature);
}

/** 获取许可证信息（用于 UI 展示） */
export function getLicenseInfo(): { activated: boolean; code: string | null; activatedAt: string | null } {
  const license = loadStoredLicense();
  return {
    activated: license?.isActivated ?? false,
    code: license?.activatedCode ?? null,
    activatedAt: license?.activatedAt ?? null,
  };
}
