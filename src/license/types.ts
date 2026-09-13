/**
 * MemBook — 激活码/许可证类型定义
 */

/** 受保护的功能标识 */
export type LicenseFeature =
  | 'createProject'
  | 'dataImport'
  | 'smartLayout'
  | 'exportFile'
  | 'timeWatermark'
  | 'layoutSwitch'
  | 'layoutAdjust'
  | 'photoShuffle'
  | 'faceCluster'
  | 'similar'
  | 'convert'
  | 'exifBatch';

/** 激活状态 */
export interface LicenseState {
  isActivated: boolean;
  activatedAt: string | null;
  activatedCode: string | null;
  signature: string | null;
  machineId: string | null;
}

/** 激活码校验结果 */
export interface ActivationResult {
  success: boolean;
  error?: string;
}

/** 试用期持久化记录 */
export interface TrialRecord {
  machine_id: string;
  trial_start: string;
  trial_used: boolean;
  /** P0-fix（时钟回拨）：上次启动见到的系统时间（ms）；旧版本记录无此字段 */
  last_seen_ms?: number;
}

/** 生成器使用的密钥对（JWK） */
export interface LicenseKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}
