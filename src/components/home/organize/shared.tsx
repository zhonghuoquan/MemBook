/**
 * 整理工具共享组件与工具函数
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoFileInfo, ToolProgress, DataSourceMode } from '../../../photo-tools';
import { formatBytes } from '../../../photo-tools';

// ── 常量 ────────────────────────────────────────────────

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.livp', '.gif', '.bmp', '.tiff', '.tif',
]);
export const CONVERTIBLE_EXTS = new Set(['.livp', '.heic', '.heif', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']);

/**
 * 统计照片列表中各格式的数量
 * @returns 排序后的 { ext, count } 数组（按数量降序，同数量按 ext 字母序）
 */
export function countByExt(photos: PhotoFileInfo[]): Array<{ ext: string; count: number }> {
  const map = new Map<string, number>();
  for (const p of photos) {
    map.set(p.ext, (map.get(p.ext) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
}

/**
 * 预估格式转换为 JPG 后的文件大小
 *
 * 估算规则（基于经验压缩比，仅用于预览提示，非精确值）：
 * - .heic/.heif：压缩比 1:4（HEIC 效率高，转 JPG 通常变大）
 * - .livp：压缩比 1:4（Live Photo 包含视频，提取静帧后类似 HEIC）
 * - .png：压缩比 1:3（PNG 无损，JPG 有损压缩更小）
 * - .webp：压缩比 1:2（WebP 效率接近 HEIC）
 * - .bmp/.tiff/.tif：压缩比 1:10（无压缩位图，JPG 压缩率极高）
 * - .gif：压缩比 1:2（动图静帧）
 * - .jpg/.jpeg：保持原大小（已是 JPG）
 *
 * @param originalSize 原文件大小（字节）
 * @param ext 原文件扩展名（带点，如 '.heic'）
 * @param quality 转换质量 0-1（默认 0.95），质量越低文件越小
 * @returns 预估大小（字节）
 */
export function estimateJpgSize(originalSize: number, ext: string, quality = 0.95): number {
  // 质量因子：0.95 ≈ 1.0，0.8 ≈ 0.75，0.6 ≈ 0.5（非线性映射）
  const qualityFactor = 0.5 + quality * 0.5;
  const ratio = JPG_COMPRESSION_RATIO[ext] ?? 1;
  return Math.round(originalSize * ratio * qualityFactor);
}

/** 各格式转 JPG 的压缩比（原大小 : 转换后大小） */
const JPG_COMPRESSION_RATIO: Record<string, number> = {
  '.heic': 4,    // HEIC 效率高，转 JPG 通常变大 4 倍
  '.heif': 4,
  '.livp': 4,    // Live Photo 静帧
  '.png': 1 / 3, // PNG → JPG 通常压缩到 1/3
  '.webp': 1 / 2,
  '.bmp': 1 / 10,
  '.tiff': 1 / 10,
  '.tif': 1 / 10,
  '.gif': 1 / 2,
  '.jpg': 1,     // 已是 JPG
  '.jpeg': 1,
};
export const JPEG_EXTS = new Set(['.jpg', '.jpeg']);

/** 支持 EXIF 写入的格式（JPEG / PNG / WebP） */
export { EXIF_WRITABLE_EXTS } from '../../../photo-tools';

// ── 辅助函数 ────────────────────────────────────────────

export { formatBytes };

export function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot).toLowerCase();
}

export function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.heic': 'image/heic', '.heif': 'image/heif', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.livp': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

/** Web 端下载 Blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 共享类型 ────────────────────────────────────────────

export interface ToolProps {
  photos: PhotoFileInfo[];
  /** Tauri 文件夹根路径（Web 模式为 null） */
  rootPath: string | null;
  /** 数据来源模式：'folder' = 文件夹扫描，'library' = 项目库内照片 */
  sourceMode: DataSourceMode;
  /** 读取照片数据（统一入口，屏蔽 Tauri/Web/库内 差异） */
  readPhotoData: (photo: PhotoFileInfo, length?: number) => Promise<ArrayBuffer | null>;
  /** 更新照片列表（删除/转换后刷新） */
  onPhotosUpdate: (updater: (prev: PhotoFileInfo[]) => PhotoFileInfo[]) => void;
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void;
  /** 重新扫描当前文件夹（归类完成后刷新文件列表） */
  onRescan?: () => Promise<void>;
  /** 当前标签 ID（用于工具异步操作定位正确的 tab，避免切换标签后数据写错） */
  tabId?: string;
  /** 工具执行状态变化通知（按工具名汇总，任一 busy 即锁定标签切换） */
  onBusyChange?: (toolName: string, busy: boolean) => void;
}

// ── 共享 UI 组件 ────────────────────────────────────────

export type ToolColor = 'brand' | 'orange' | 'green' | 'blue' | 'purple';

/**
 * 马卡龙色系（柔和粉彩）：
 * - peach  桃粉  → 照片去重
 * - sky    天空蓝 → 按时间归类
 * - mint   抹茶绿 → 批量改 EXIF
 * - lavender 薰衣草紫 → 格式转换
 */
const COLOR_STYLES: Record<ToolColor, { cardBg: string; bg: string; text: string; ring: string }> = {
  brand: {
    cardBg: 'bg-[var(--color-brand-bg)]',
    bg: 'bg-[var(--color-brand-bg)]',
    text: 'text-[var(--color-brand)]',
    ring: 'hover:border-[var(--color-brand)]',
  },
  // 桃粉
  orange: {
    cardBg: 'bg-[#FFF1EB]',
    bg: 'bg-[#FFD9C7]',
    text: 'text-[#C95A4D]',
    ring: 'hover:border-[#FFB59A]',
  },
  // 抹茶绿
  green: {
    cardBg: 'bg-[#E9F4ED]',
    bg: 'bg-[#C5E5CE]',
    text: 'text-[#4A9C6B]',
    ring: 'hover:border-[#95D3A4]',
  },
  // 天空蓝
  blue: {
    cardBg: 'bg-[#E9F4FB]',
    bg: 'bg-[#C5E0F4]',
    text: 'text-[#4A8FCC]',
    ring: 'hover:border-[#8FC4ED]',
  },
  // 薰衣草紫
  purple: {
    cardBg: 'bg-[#F1E9F8]',
    bg: 'bg-[#D7C5EC]',
    text: 'text-[#8B6BB0]',
    ring: 'hover:border-[#C4A5E0]',
  },
};

export function ToolCard({
  title,
  description,
  icon,
  children,
  disabled,
  disabledReason,
  color = 'brand',
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  color?: ToolColor;
}) {
  const colors = COLOR_STYLES[color];
  return (
    <div className={`rounded-2xl border p-5 transition-all duration-200 flex flex-col ${
      disabled
        ? 'border-[var(--color-border)] bg-[var(--color-gray-50)] opacity-60'
        : `border-transparent ${colors.cardBg} hover:shadow-[var(--shadow-md)] ${colors.ring}`
    }`}>
      <div className="flex items-start gap-4 mb-4 shrink-0">
        <div className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${
          disabled ? 'bg-[var(--color-gray-200)]' : colors.bg
        }`}>
          <span className={`${disabled ? 'text-[var(--color-gray-400)]' : colors.text}`}>
            {icon}
          </span>
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <h3 className="text-base font-[700] text-[var(--color-gray-800)] tracking-tight">{title}</h3>
          <p className="text-[var(--text-body-sm)] text-[var(--color-text-secondary)] mt-1 leading-relaxed">
            {disabledReason || description}
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}

/** 马卡龙色扩展（含更深一档的图标背景），供空状态特色卡片使用 */
export const FEATURE_COLORS: Record<'peach' | 'sky' | 'mint' | 'lavender', {
  cardBg: string;
  iconBg: string;
  text: string;
}> = {
  peach:   { cardBg: 'bg-[#FFF1EB]', iconBg: 'bg-[#FFD9C7]', text: 'text-[#C95A4D]' },
  sky:     { cardBg: 'bg-[#E9F4FB]', iconBg: 'bg-[#C5E0F4]', text: 'text-[#4A8FCC]' },
  mint:    { cardBg: 'bg-[#E9F4ED]', iconBg: 'bg-[#C5E5CE]', text: 'text-[#4A9C6B]' },
  lavender:{ cardBg: 'bg-[#F1E9F8]', iconBg: 'bg-[#D7C5EC]', text: 'text-[#8B6BB0]' },
};

export function ProgressBar({ progress }: { progress: ToolProgress | null }) {
  if (!progress) return null;
  const totalUnknown = !progress.total || progress.total === 0;
  const pct = totalUnknown ? 0 : Math.round((progress.current / progress.total) * 100);
  return (
    <div className="mt-3">
      <div className="flex justify-between mb-1.5">
        <span className="text-xs text-[var(--color-text-secondary)]">{progress.message}</span>
        <span className="text-xs text-[var(--color-gray-500)] font-mono">
          {totalUnknown ? progress.current : `${pct}%`}
        </span>
      </div>
      <div className="h-2 bg-[var(--color-brand-bg)] rounded-full overflow-hidden">
        {totalUnknown ? (
          // 不确定进度：渐变光带（透明边缘）从左滑入、柔和扫过、右侧淡出
          <div
            className="h-full w-2/5 rounded-full animate-[progress-indeterminate_1.8s_ease-in-out_infinite]"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, var(--color-brand) 35%, var(--color-brand) 65%, transparent 100%)',
            }}
          />
        ) : (
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background:
                'linear-gradient(90deg, var(--color-primary-400, var(--color-brand)), var(--color-brand))',
            }}
          />
        )}
      </div>
    </div>
  );
}

/** 主操作按钮 */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  variant = 'brand',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'brand' | 'danger' | 'ghost';
}) {
  const { t } = useTranslation();
  const colors = {
    brand: 'bg-[var(--color-brand)] hover:opacity-90 text-white',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    ghost: 'border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-gray-700)]',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-4 py-2 rounded-lg text-sm font-[600] border-none cursor-pointer transition-all
                  disabled:opacity-40 disabled:cursor-not-allowed ${colors[variant]}`}
    >
      {loading ? t('home.organize.shared.processing') : children}
    </button>
  );
}
