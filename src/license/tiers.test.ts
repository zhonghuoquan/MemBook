/**
 * 版本阶梯（Free / Pro）单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  TIER_FEATURES,
  isFeatureAvailableForTier,
  getTier,
  type LicenseTier,
} from './tiers';

describe('getTier', () => {
  it('已激活 → pro', () => {
    expect(getTier(true)).toBe<LicenseTier>('pro');
  });
  it('未激活 → free', () => {
    expect(getTier(false)).toBe<LicenseTier>('free');
  });
});

describe('isFeatureAvailableForTier', () => {
  it('已激活时所有功能可用', () => {
    for (const f of ['createProject', 'smartLayout', 'exportFile', 'timeWatermark'] as const) {
      expect(isFeatureAvailableForTier(true, f)).toBe(true);
    }
  });

  it('Free 档：Pro 专属功能不可用', () => {
    // smartLayout / exportFile / timeWatermark 为 Pro 专属
    expect(isFeatureAvailableForTier(false, 'smartLayout')).toBe(false);
    expect(isFeatureAvailableForTier(false, 'exportFile')).toBe(false);
    expect(isFeatureAvailableForTier(false, 'timeWatermark')).toBe(false);
  });

  it('Free 档：基础功能仍可用', () => {
    // createProject / dataImport 为免费基础能力
    expect(isFeatureAvailableForTier(false, 'createProject')).toBe(true);
    expect(isFeatureAvailableForTier(false, 'dataImport')).toBe(true);
  });
});

describe('TIER_FEATURES', () => {
  it('功能对照表非空且包含 Pro 专属项', () => {
    expect(TIER_FEATURES.length).toBeGreaterThan(0);
    expect(TIER_FEATURES.some((f) => f.proOnly)).toBe(true);
  });

  it('每个功能标识唯一', () => {
    const keys = TIER_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
