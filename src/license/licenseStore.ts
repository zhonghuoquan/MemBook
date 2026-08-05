/**
 * MemBook — 许可证状态管理（Zustand）
 */

import { create } from 'zustand';
import {
  loadStoredLicense,
  clearStoredLicense,
  activateLicense,
  isActivated,
  getLicenseInfo,
  canCreateProject,
  isFeatureAvailable,
  getMachineId,
  getTrialInfo,
  initLicenseService,
  type StoredLicense,
  type TrialInfo,
} from './licenseService';
import type { LicenseFeature, ActivationResult } from './types';

interface LicenseState {
  isActivated: boolean;
  activatedCode: string | null;
  activatedAt: string | null;
  machineId: string;
  dialogOpen: boolean;
  dialogHint: string | undefined;
  /** 许可证服务是否已完成初始化 */
  initialized: boolean;

  /* 试用期 */
  trial: TrialInfo;
  /** 是否真正持有有效许可证（不含试用期） */
  hasLicense: boolean;

  /* Actions */
  init: () => Promise<void>;
  refresh: () => void;
  activate: (code: string, signature: string) => Promise<ActivationResult>;
  clear: () => void;
  canCreateProject: (count: number) => boolean;
  isFeatureAvailable: (feature: LicenseFeature) => boolean;
  openDialog: (hint?: string) => void;
  closeDialog: () => void;
  checkFeature: (feature: LicenseFeature, hint?: string) => boolean;
}

function buildState(license: StoredLicense | null): Pick<LicenseState, 'isActivated' | 'activatedCode' | 'activatedAt' | 'hasLicense'> {
  return {
    isActivated: isActivated(),
    activatedCode: license?.activatedCode ?? null,
    activatedAt: license?.activatedAt ?? null,
    hasLicense: license?.isActivated === true,
  };
}

export const useLicenseStore = create<LicenseState>((set) => ({
  ...buildState(loadStoredLicense()),
  machineId: getMachineId(),
  dialogOpen: false,
  dialogHint: undefined,
  trial: getTrialInfo(),
  initialized: false,

  init: async () => {
    await initLicenseService();
    const license = loadStoredLicense();
    set({
      ...buildState(license),
      machineId: getMachineId(),
      trial: getTrialInfo(),
      initialized: true,
    });
  },

  refresh: () => {
    const license = loadStoredLicense();
    set({
      ...buildState(license),
      machineId: getMachineId(),
      trial: getTrialInfo(),
    });
  },

  activate: async (code: string, signature: string) => {
    const result = await activateLicense(code, signature);
    if (result.success) {
      set({
        ...buildState(loadStoredLicense()),
        trial: getTrialInfo(),
      });
    }
    return result;
  },

  clear: () => {
    clearStoredLicense();
    set({
      isActivated: isActivated(),
      activatedCode: null,
      activatedAt: null,
      hasLicense: false,
      trial: getTrialInfo(),
    });
  },

  canCreateProject: (count: number) => canCreateProject(count),
  isFeatureAvailable: (feature: LicenseFeature) => isFeatureAvailable(feature),

  openDialog: (hint?: string) => set({ dialogOpen: true, dialogHint: hint }),
  closeDialog: () => set({ dialogOpen: false }),

  checkFeature: (feature: LicenseFeature, hint?: string) => {
    const available = isFeatureAvailable(feature);
    if (!available) {
      set({ dialogOpen: true, dialogHint: hint });
    }
    return available;
  },
}));

export { isActivated, getLicenseInfo };
