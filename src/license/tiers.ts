/**
 * MemBook — 版本阶梯（Free / Pro）
 *
 * 在原有的「试用 7 天 → 锁高级功能」基础上，补充**版本心智**：
 * - Free（免费版）：试用期内全功能可用；试用期结束后，限制为免费档能力
 * - Pro（专业版）：激活后解锁全部能力
 *
 * 让用户清楚「为什么要付费、付费能多得到什么」，而不是一刀切锁死。
 * 该模块为纯描述性数据 + 查询函数，不引入副作用，便于测试与复用。
 */

import type { LicenseFeature } from './types';

/** 版本档位 */
export type LicenseTier = 'free' | 'pro';

/** 单条功能说明 */
export interface TierFeature {
  /** 功能标识 */
  key: string;
  /** 功能名称 */
  label: string;
  /** Free 版描述 */
  freeLabel: string;
  /** Pro 版描述 */
  proLabel: string;
  /** 是否属于 Pro 专属（Free 不可用） */
  proOnly: boolean;
}

/**
 * 版本阶梯功能对照表。
 *
 * Free 版核心能力：创建相册、导入照片、基础编辑、基础导出。
 * Pro 专属能力：智能排版、高清导出、打印、高级布局、去水印等。
 */
export const TIER_FEATURES: TierFeature[] = [
  {
    key: 'createProject',
    label: '创建相册',
    freeLabel: '最多 10 个',
    proLabel: '不限数量',
    proOnly: false,
  },
  {
    key: 'dataImport',
    label: '数据导入 / 迁移',
    freeLabel: '基础导入',
    proLabel: '完整迁移',
    proOnly: false,
  },
  {
    key: 'smartLayout',
    label: '智能一键排版',
    freeLabel: '受 Pro 限制',
    proLabel: '永久可用',
    proOnly: true,
  },
  {
    key: 'layoutSwitch',
    label: '版式切换',
    freeLabel: '基础版式',
    proLabel: '全部版式',
    proOnly: true,
  },
  {
    key: 'layoutAdjust',
    label: '版式微调',
    freeLabel: '—',
    proLabel: '完整微调',
    proOnly: true,
  },
  {
    key: 'exportFile',
    label: '导出 / PDF / 打印',
    freeLabel: '标清导出',
    proLabel: '高清无限制',
    proOnly: false,
  },
  {
    key: 'photoShuffle',
    label: '照片随机重排',
    freeLabel: '—',
    proLabel: '可用',
    proOnly: true,
  },
  {
    key: 'timeWatermark',
    label: '时间水印',
    freeLabel: '—',
    proLabel: '可用',
    proOnly: true,
  },
  {
    key: 'faceCluster',
    label: '人脸识别 / 按人归档',
    freeLabel: '查看识别结果',
    proLabel: '合并归档 / 删除',
    proOnly: true,
  },
  {
    key: 'similar',
    label: '相似照片分析',
    freeLabel: '查看相似结果',
    proLabel: '批量标记 / 删除',
    proOnly: true,
  },
  {
    key: 'convert',
    label: '格式转换',
    freeLabel: '—',
    proLabel: '可用',
    proOnly: true,
  },
  {
    key: 'exifBatch',
    label: 'EXIF 批量修改',
    freeLabel: '查看',
    proLabel: '批量修改 + GPS',
    proOnly: true,
  },
];

/** 功能标识 → 是否 Pro 专属 */
const PRO_ONLY_FEATURES = new Set<string>(
  TIER_FEATURES.filter((f) => f.proOnly).map((f) => f.key),
);

/**
 * 判断某功能在当前（试用期/激活）状态下的可用性。
 *
 * @param isActivated 是否已激活（Pro）或处于试用期内
 * @param feature 功能标识
 * @returns 是否可用
 */
export function isFeatureAvailableForTier(isActivated: boolean, feature: LicenseFeature): boolean {
  // 已激活（Pro）或试用期内 → 全功能可用
  if (isActivated) return true;
  // 未激活且不在试用期 → Free 档，Pro 专属不可用
  return !PRO_ONLY_FEATURES.has(feature);
}

/**
 * 获取当前用户所属版本档位。
 *
 * @param isActivated 是否已激活或处于试用期内
 * @returns 'pro' 表示全功能；'free' 表示免费档（受 Pro 专属限制）
 */
export function getTier(isActivated: boolean): LicenseTier {
  return isActivated ? 'pro' : 'free';
}
