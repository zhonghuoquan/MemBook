export { useLicenseStore, getLicenseInfo, isActivated } from './licenseStore';
export { ActivationDialog } from './ActivationDialog';
export { useFeatureGuard } from './useFeatureGuard';
export {
  canCreateProject,
  isFeatureAvailable,
  getMachineId,
  verifyActivationCode,
  isValidCodeFormat,
  getTrialInfo,
  getTrialRemainingDays,
  isTrialActive,
  resetTrial,
} from './licenseService';
export type { LicenseFeature, LicenseState, ActivationResult } from './types';
export type { TrialInfo } from './licenseService';
