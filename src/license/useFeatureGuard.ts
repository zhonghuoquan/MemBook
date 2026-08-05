/**
 * MemBook — 功能权限守卫 Hook
 *
 * 用于在 React 组件中快速判断某功能是否可用，并在不可用时弹出激活窗。
 */

import { useCallback, useState } from 'react';
import { useLicenseStore } from './licenseStore';
import type { LicenseFeature } from './types';

interface UseFeatureGuardResult {
  available: boolean;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  check: (callback: () => void) => void;
  hint?: string;
}

export function useFeatureGuard(feature: LicenseFeature, hint?: string): UseFeatureGuardResult {
  const isFeatureAvailable = useLicenseStore((s) => s.isFeatureAvailable);
  const available = isFeatureAvailable(feature);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const check = useCallback(
    (callback: () => void) => {
      if (available) {
        callback();
      } else {
        setDialogOpen(true);
      }
    },
    [available],
  );

  return { available, dialogOpen, openDialog, closeDialog, check, hint };
}
