/**
 * 整理工具共享组件与工具函数
 */

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoFileInfo, ToolProgress, DataSourceMode } from '../../../photo-tools';
import { formatBytes, isTauri } from '../../../photo-tools';
import { getThumbUrl, evictFromCache, type ThumbSize } from './thumbCache';

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

export type ToolColor =
  | 'coral' | 'blue' | 'violet' | 'amber' | 'green'
  | 'teal' | 'pink' | 'indigo' | 'cyan';

/**
 * 照片整理 9 个功能的统一色块色板（马卡龙柔和粉彩）。
 *
 * 每个功能使用**唯一且彼此可清晰区分**的色相，杜绝重复/接近色：
 * - coral   珊瑚红（红橙） → 照片去重
 * - blue    天蓝（蓝）     → 照片归类
 * - violet  葡萄紫（紫）   → 人脸识别
 * - amber   金黄（黄）     → 相似照片分析
 * - green   薄荷绿（绿）   → Exif 修改
 * - teal    青绿（蓝绿）   → 批量重命名
 * - pink    玫粉（红紫）   → 格式转换
 * - indigo  靛蓝（蓝紫）   → 时间线
 * - cyan    青色（青蓝绿） → 日历
 *
 * 该色板同时用于：左侧导航（ToolSidebar）、工具卡片头（ToolCard）、
 * 空状态功能卡（FeatureCard），保证三处颜色一致。
 */
const COLOR_STYLES: Record<ToolColor, { cardBg: string; bg: string; text: string; ring: string }> = {
  // 珊瑚红（红橙）
  coral: {
    cardBg: 'bg-[#FFEBE6]',
    bg: 'bg-[#FFC9BA]',
    text: 'text-[#D1513B]',
    ring: 'hover:border-[#F2A08D]',
  },
  // 天蓝
  blue: {
    cardBg: 'bg-[#E8F2FC]',
    bg: 'bg-[#BFD9F3]',
    text: 'text-[#3C83C7]',
    ring: 'hover:border-[#8FC2E8]',
  },
  // 葡萄紫
  violet: {
    cardBg: 'bg-[#F1EAFB]',
    bg: 'bg-[#D8C2F1]',
    text: 'text-[#8A5FC4]',
    ring: 'hover:border-[#C5A6E6]',
  },
  // 金黄（黄）
  amber: {
    cardBg: 'bg-[#FFF6DF]',
    bg: 'bg-[#FFE6A0]',
    text: 'text-[#AC8313]',
    ring: 'hover:border-[#F0CE6E]',
  },
  // 薄荷绿
  green: {
    cardBg: 'bg-[#E6F5EA]',
    bg: 'bg-[#BCE4C9]',
    text: 'text-[#3C9258]',
    ring: 'hover:border-[#8CCF9E]',
  },
  // 青绿（蓝绿）
  teal: {
    cardBg: 'bg-[#DFF3F0]',
    bg: 'bg-[#B4E3DD]',
    text: 'text-[#23847A]',
    ring: 'hover:border-[#85CFC6]',
  },
  // 玫粉（红紫）
  pink: {
    cardBg: 'bg-[#FDEDF4]',
    bg: 'bg-[#F8C9DC]',
    text: 'text-[#C04B7C]',
    ring: 'hover:border-[#EFA8C5]',
  },
  // 靛蓝（蓝紫）
  indigo: {
    cardBg: 'bg-[#EBEDFC]',
    bg: 'bg-[#C7CFF5]',
    text: 'text-[#4B57B8]',
    ring: 'hover:border-[#A3ACE8]',
  },
  // 青色（青蓝绿）
  cyan: {
    cardBg: 'bg-[#E3F7F8]',
    bg: 'bg-[#B8E8EA]',
    text: 'text-[#178A9C]',
    ring: 'hover:border-[#8AD6DC]',
  },
};

export function ToolCard({
  title,
  description,
  icon,
  children,
  disabled,
  disabledReason,
  color = 'blue',
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
    <div className={`relative rounded-2xl border p-5 transition-all duration-200 flex flex-col ${
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

/**
 * 马卡龙色扩展（含更深一档的图标背景），供空状态特色卡片使用。
 * 与 COLOR_STYLES / ToolSidebar.COLOR_BLOCK 共用同一套 9 色色板，
 * 保证每个功能的色块颜色唯一且一致。
 */
export const FEATURE_COLORS: Record<ToolColor, { cardBg: string; iconBg: string; text: string }> = {
  coral:  { cardBg: 'bg-[#FFEBE6]', iconBg: 'bg-[#FFC9BA]', text: 'text-[#D1513B]' },
  blue:   { cardBg: 'bg-[#E8F2FC]', iconBg: 'bg-[#BFD9F3]', text: 'text-[#3C83C7]' },
  violet: { cardBg: 'bg-[#F1EAFB]', iconBg: 'bg-[#D8C2F1]', text: 'text-[#8A5FC4]' },
  amber:  { cardBg: 'bg-[#FFF6DF]', iconBg: 'bg-[#FFE6A0]', text: 'text-[#AC8313]' },
  green:  { cardBg: 'bg-[#E6F5EA]', iconBg: 'bg-[#BCE4C9]', text: 'text-[#3C9258]' },
  teal:   { cardBg: 'bg-[#DFF3F0]', iconBg: 'bg-[#B4E3DD]', text: 'text-[#23847A]' },
  pink:   { cardBg: 'bg-[#FDEDF4]', iconBg: 'bg-[#F8C9DC]', text: 'text-[#C04B7C]' },
  indigo: { cardBg: 'bg-[#EBEDFC]', iconBg: 'bg-[#C7CFF5]', text: 'text-[#4B57B8]' },
  cyan:   { cardBg: 'bg-[#E3F7F8]', iconBg: 'bg-[#B8E8EA]', text: 'text-[#178A9C]' },
};

export function ProgressBar({
  progress,
  onCancel,
  cancelLabel,
}: {
  progress: ToolProgress | null;
  /** 提供后会在进度条右侧显示一个放大的取消按钮 */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  if (!progress) return null;
  const totalUnknown = !progress.total || progress.total === 0;
  const pct = totalUnknown ? 0 : Math.min(100, Math.round((progress.current / progress.total) * 100));
  return (
    <div className="mt-3 rounded-xl border border-[var(--color-border)]/60 bg-white/60 backdrop-blur-sm px-3.5 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-[var(--color-text-secondary)] truncate pr-2">{progress.message}</span>
        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-mono font-[600] text-[var(--color-brand)]">
          {!totalUnknown && (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 8l2.5-2.5" />
            </svg>
          )}
          {totalUnknown ? progress.current : `${pct}%`}
        </span>
      </div>
      {/* 进度条轨道 + 取消按钮：取消按钮统一放在进度条右侧并放大 */}
      <div className="flex items-center gap-2.5">
      <div className="flex-1 h-2.5 bg-[var(--color-gray-100)] rounded-full overflow-hidden relative ring-1 ring-inset ring-[var(--color-border)]/40">
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
          <>
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out relative overflow-hidden"
              style={{
                width: `${Math.max(pct, 2)}%`,
                background:
                  'linear-gradient(90deg, var(--color-primary-400, var(--color-brand)), var(--color-brand))',
              }}
            >
              {/* 高光扫过动效 */}
              <div className="absolute inset-0 animate-[progress-shine_2s_ease-in-out_infinite]"
                style={{ background: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)' }} />
            </div>
          </>
        )}
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-[600] cursor-pointer
            border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-gray-600)]
            hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] hover:border-[var(--color-brand)]/50
            active:scale-95 transition-all shadow-sm"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          {cancelLabel ?? t('common.cancel', '取消')}
        </button>
      )}
      </div>
      {/* 细粒度格点刻度（仅确定进度时显示） */}
      {!totalUnknown && (
        <div className="flex justify-between mt-1.5 px-0.5 text-[9px] font-mono text-[var(--color-gray-400)]">
          <span>0</span>
          <span>{Math.round(progress.total / 2)}</span>
          <span>{progress.total}</span>
        </div>
      )}
    </div>
  );
}

/** 统一取消按钮 */
export function CancelButton({
  onClick,
  label,
  className = '',
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-[600] cursor-pointer
        border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-gray-600)]
        hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-800)] hover:border-[var(--color-brand)]/40
        transition-all ${className}`}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
      {label ?? t('common.cancel', '取消')}
    </button>
  );
}

/**
 * 双滑块区间选择器 — 用单个控件同时设置最小/最大值
 *
 * 通过两个重叠的 range 滑块实现（上层滑块透明），
 * 保证 min ≤ max 始终成立。
 */
export function DualRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChange,
  step = 1,
  disabled = false,
  accent = 'var(--color-brand)',
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (min: number, max: number) => void;
  step?: number;
  disabled?: boolean;
  accent?: string;
}) {
  const range = Math.max(1, max - min);
  const leftPct = ((valueMin - min) / range) * 100;
  const rightPct = ((valueMax - min) / range) * 100;

  const handleMinChange = (v: number) => {
    const next = Math.min(Math.round(v), valueMax - step);
    onChange(Math.max(min, next), valueMax);
  };
  const handleMaxChange = (v: number) => {
    const next = Math.max(Math.round(v), valueMin + step);
    onChange(valueMin, Math.min(max, next));
  };

  // 共享的滑块样式：输入本身不拦截点击（pointer-events-none），仅 thumb 可拖动
  // 高度 h-6 (24px) 让 thumb 有空间垂直居中于 8px 轨道上，避免圆点偏离
  const baseSlider =
    'pointer-events-none absolute top-0 left-0 w-full h-6 rounded-full appearance-none bg-transparent';

  return (
    <div className={`relative w-full pt-5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* 数值标签：悬浮于对应 thumb 上方，随滑块位置移动，确保数值与调整条位置对应 */}
      <div className="absolute top-0 left-0 w-full h-5 pointer-events-none">
        {/* 最小值标签（左对齐避免溢出容器） */}
        <span
          className="absolute -translate-x-1/2 text-[11px] font-mono font-[600] text-[var(--color-gray-700)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5 shadow-sm whitespace-nowrap"
          style={{ left: `clamp(0%, ${leftPct}%, 100%)` }}
        >
          {valueMin}
        </span>
        {/* 最大值标签（右对齐避免溢出容器） */}
        <span
          className="absolute -translate-x-1/2 text-[11px] font-mono font-[600] text-[var(--color-gray-700)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5 shadow-sm whitespace-nowrap"
          style={{ left: `clamp(0%, ${rightPct}%, 100%)` }}
        >
          {valueMax}
        </span>
      </div>

      {/* 轨道容器：h-6 与输入等高，轨道垂直居中，保证 thumb 圆点居中在控制条上 */}
      <div className="relative h-6">
        {/* 轨道背景 */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-2 rounded-full bg-[var(--color-gray-100)] ring-1 ring-inset ring-[var(--color-border)]/40" />
        {/* 选中区间高亮 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full"
          style={{
            left: `${leftPct}%`,
            width: `${rightPct - leftPct}%`,
            background: `linear-gradient(90deg, ${accent}, ${accent})`,
            opacity: 0.9,
          }}
        />
        {/* 最小值滑块（下层 thumb 可拖动） */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          onChange={(e) => handleMinChange(parseFloat(e.target.value))}
          className={`${baseSlider} z-20`}
          style={{
            ['--range-accent' as string]: accent,
          }}
          aria-label="min"
        />
        {/* 最大值滑块（上层 thumb 可拖动） */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          onChange={(e) => handleMaxChange(parseFloat(e.target.value))}
          className={`${baseSlider} z-30`}
          style={{
            ['--range-accent' as string]: accent,
          }}
          aria-label="max"
        />
      </div>

      <style>{`
        input[type='range']::-webkit-slider-runnable-track {
          background: transparent;
          border: none;
        }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          margin-top: -5px;
          border-radius: 9999px;
          background: #fff;
          border: 3px solid var(--range-accent, var(--color-brand));
          box-shadow: 0 1px 5px rgba(0,0,0,0.22);
          cursor: grab;
          pointer-events: auto;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        input[type='range']::-webkit-slider-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 2px 9px rgba(0,0,0,0.28);
        }
        input[type='range']::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #fff;
          border: 3px solid var(--range-accent, var(--color-brand));
          box-shadow: 0 1px 5px rgba(0,0,0,0.22);
          cursor: grab;
          pointer-events: auto;
        }
        input[type='range']::-moz-range-track {
          background: transparent;
        }
      `}</style>
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

/**
 * 统一“加入相册”浮动按钮
 *
 * 用于各个整理工具（人脸聚类 / 相似分析 / 时间线 / 日历等），
 * 固定在卡片右上角，样式全局统一。使用品牌色渐变 + 图标 + 计数，
 * 未选择照片时置灰并禁用。
 */
export function AddToAlbumButton({
  count,
  disabled,
  onClick,
  label,
}: {
  count: number;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t('home.organize.albumBridge.buttonLabel');
  const canAdd = count > 0 && !disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canAdd}
      title={!canAdd ? t('home.organize.albumBridge.selectPhotosFirst') : text}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-[600] transition-all cursor-pointer
        shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50 ${
        canAdd
          ? 'bg-gradient-to-b from-[var(--color-brand)] to-[var(--color-brand-dark)] text-white hover:shadow-[var(--shadow-md)] hover:brightness-110 active:brightness-95'
          : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] cursor-not-allowed shadow-none'
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M8 3v10M3 8h10" />
      </svg>
      {text}
      {canAdd && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/25 text-[11px] leading-none">
          {count}
        </span>
      )}
    </button>
  );
}

// ── 共享缩略图组件 ────────────────────────────────────────

/**
 * 共享缩略图组件（性能优化版）
 *
 * 性能优化：
 * - **IntersectionObserver 懒加载**：只在进入视口（提前 200px）才触发加载，
 *   避免一次性加载几百张照片
 * - **Canvas 缩小**：通过 thumbCache 用 createImageBitmap + Canvas 缩小到目标尺寸，
 *   原始大数据立即释放，blob URL 只持有缩小后的小图（几 KB）
 * - **全局 LRU 缓存**：同一照片同一尺寸只生成一次，跨组件复用
 * - **并发去重**：同一照片并发请求只发起一次 IO
 *
 * @param photo 照片信息
 * @param onPreview 点击预览按钮回调（不传则不显示预览按钮）
 * @param readPhotoData 读取照片二进制（统一入口）
 * @param aspect 宽高比，默认 'square'
 * @param size 缩略图尺寸分级，默认 'small'（128px）。日历格子用 'tiny'，网格用 'medium'，大图预览用 'full'
 * @param lazy 是否启用 IntersectionObserver 懒加载，默认 true
 */
export function ThumbImage({
  photo,
  onPreview,
  readPhotoData,
  aspect = 'square',
  size = 'small',
  lazy = true,
}: {
  photo: PhotoFileInfo;
  onPreview?: () => void;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  aspect?: 'square' | '4/3' | 'video';
  size?: ThumbSize;
  lazy?: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!photo.thumbUrl);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(!lazy);
  const [retryCount, setRetryCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver 懒加载：进入视口（提前 400px）才触发加载
  useEffect(() => {
    if (!lazy || inView) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazy, inView]);

  // 进入视口后加载缩略图（通过 thumbCache，带缓存 + 并发去重）
  // 失败时自动重试最多 2 次（间隔 500ms）
  useEffect(() => {
    if (!inView) return;
    if (photo.thumbUrl) return; // Web 模式已有 thumbUrl
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const u = await getThumbUrl(photo, size, readPhotoData);
        if (cancelled) return;
        if (u) {
          setUrl(u);
          setLoading(false);
        } else {
          // 加载失败，重试（最多 2 次）
          if (retryCount < 2) {
            timer = setTimeout(() => setRetryCount((c) => c + 1), 500);
          } else {
            setFailed(true);
            setLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          if (retryCount < 2) {
            timer = setTimeout(() => setRetryCount((c) => c + 1), 500);
          } else {
            setFailed(true);
            setLoading(false);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [inView, photo, size, readPhotoData, retryCount]);

  const src = photo.thumbUrl || url;
  const aspectCls = aspect === '4/3' ? 'aspect-[4/3]' : aspect === 'video' ? 'aspect-video' : 'aspect-square';

  // 预览按钮覆盖层（hover 显示眼睛图标）
  const previewOverlay = onPreview ? (
    <button
      onClick={(e) => { e.stopPropagation(); onPreview(); }}
      className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group"
      title={t('home.organize.dedupe.preview')}
    >
      <svg viewBox="0 0 24 24" className="w-7 h-7 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      </svg>
    </button>
  ) : null;

  if (src) {
    return (
      <div ref={containerRef} className={`relative ${aspectCls} bg-[var(--color-gray-100)] overflow-hidden`}>
        <img
          src={src}
          alt={photo.name}
          className="w-full h-full object-cover"
          draggable={false}
          loading="lazy"
        />
        {previewOverlay}
      </div>
    );
  }

  // 加载中 / 失败占位
  return (
    <div ref={containerRef} className={`relative ${aspectCls} bg-[var(--color-gray-100)] overflow-hidden flex items-center justify-center`}>
      {loading ? (
        <div className="w-5 h-5 border-2 border-[var(--color-gray-300)] border-t-[var(--color-gray-500)] rounded-full animate-spin" />
      ) : failed ? (
        <svg viewBox="0 0 24 24" className="w-7 h-7 text-[var(--color-gray-300)]" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-9 h-9 text-[var(--color-gray-300)]" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      )}
      {previewOverlay}
    </div>
  );
}

// ── 共享删除逻辑 ────────────────────────────────────────

/**
 * 删除一张或多张照片（统一入口，时间线/日历/人脸识别等浏览工具共用）
 * - folder + Tauri：移入系统回收站（可恢复），非物理删除
 * - library / Web：从列表移除并清理缩略图缓存
 * @returns 成功删除数量
 */
export async function deletePhotos(
  target: PhotoFileInfo[],
  sourceMode: DataSourceMode,
  onPhotosUpdate: (updater: (prev: PhotoFileInfo[]) => PhotoFileInfo[]) => void,
  addToast: (toast: { type: 'success' | 'error' | 'info' | 'warning'; message: string }) => void,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<number> {
  if (target.length === 0) return 0;
  let ok = 0, fail = 0;
  try {
    if (sourceMode === 'library') {
      // 库内模式：从列表移除并清理缩略图缓存
      for (const f of target) {
        if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
        evictFromCache(f.id);
        ok++;
      }
    } else if (isTauri()) {
      // folder + Tauri：移入系统回收站（可恢复）
      const { invoke } = await import('@tauri-apps/api/core');
      const paths = target.map((f) => f.path).filter((p): p is string => Boolean(p));
      if (paths.length > 0) {
        try {
          await invoke('trash_files', { paths });
          ok = paths.length;
          fail = target.length - paths.length;
        } catch {
          // 批量失败时逐个尝试，定位失败文件
          for (const f of target) {
            try {
              if (f.path) { await invoke('trash_files', { paths: [f.path] }); ok++; } else fail++;
            } catch { fail++; }
          }
        }
      } else {
        fail = target.length;
      }
    } else {
      // Web folder：无文件系统权限，仅从列表移除
      for (const f of target) {
        if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
        ok++;
      }
    }

    const deleteIds = new Set(target.map((f) => f.id));
    onPhotosUpdate((prev) => prev.filter((p) => !deleteIds.has(p.id)));

    addToast({
      type: fail > 0 ? 'warning' : 'success',
      message: fail > 0
        ? t('home.organize.shared.toastDeletedWithFail', { ok, fail })
        : t('home.organize.shared.toastDeleted', { ok }),
    });
  } catch (err) {
    addToast({
      type: 'error',
      message: t('home.organize.shared.toastDeleteFailed', { message: (err as Error).message }),
    });
    ok = 0;
  }
  return ok;
}

// ── 带操作菜单的缩略图组件 ──────────────────────────────

/**
 * 缩略图 + 右上角三点操作菜单（查看 / 删除）
 *
 * 鼠标悬浮在缩略图右上角显示“⋯”三点按钮，点击展开下拉菜单。
 * 供时间线 / 日历 / 人脸识别等浏览类工具的缩略图统一使用。
 */
export function ThumbWithMenu({
  photo,
  readPhotoData,
  onView,
  onDelete,
  selected = false,
  anomaly = false,
  anomalyLabel,
  onClick,
  thumb,
  confirmDelete = true,
}: {
  photo: PhotoFileInfo;
  readPhotoData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  onView: () => void;
  onDelete: () => void;
  selected?: boolean;
  anomaly?: boolean;
  anomalyLabel?: string;
  onClick?: () => void;
  /** 自定义缩略图内容（默认 ThumbImage small） */
  thumb?: React.ReactNode;
  confirmDelete?: boolean;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 三点按钮引用，用于把菜单定位到按钮旁边
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const handleView = () => {
    closeMenu();
    onView();
  };

  const handleDelete = () => {
    closeMenu();
    if (confirmDelete) {
      if (window.confirm(t('home.organize.shared.deleteConfirm', { name: photo.name }))) {
        onDelete();
      }
    } else {
      onDelete();
    }
  };

  return (
    <div
      ref={menuRef}
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={`relative group rounded-lg border-2 transition-all cursor-pointer ${
        selected
          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]'
          : anomaly
            ? 'border-red-300'
            : 'border-transparent hover:border-[var(--color-border)]'
      }`}
      title={photo.name}
    >
      {/* 图片单独置于 overflow-hidden 容器内圆角裁剪，外层不再 overflow-hidden，
          避免裁剪掉下方展开的“查看/删除”菜单 */}
      <div className="overflow-hidden rounded-lg">
        {thumb ?? (
          <ThumbImage photo={photo} readPhotoData={readPhotoData} size="small" />
        )}
      </div>

      {/* 选中标记（左上角） */}
      <span
        className={`absolute top-1 left-1 z-10 w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shadow-sm transition-all ${
          selected ? 'opacity-100 bg-[var(--color-brand)]' : 'opacity-0 bg-black/40'
        }`}
      >
        ✓
      </span>

      {/* 异常日期标签（右下角） */}
      {anomaly && anomalyLabel && (
        <span className="absolute bottom-0.5 right-0.5 z-10 text-[8px] leading-none px-1 py-0.5 rounded bg-red-500 text-white font-[600]">
          {anomalyLabel}
        </span>
      )}

      {/* 右上角三点菜单（高 z-index，确保展开后悬浮在内容最上层） */}
      <div className="absolute top-0.5 right-0.5 z-50">
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-all cursor-pointer border-none"
          title={t('home.organize.shared.moreActions')}
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
            <circle cx="8" cy="3" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="8" cy="13" r="1.4" />
          </svg>
        </button>

        {/* 下拉菜单：fixed 定位到三点按钮旁边，悬浮在最上层 */}
        {menuOpen && (
          <DropdownMenu
            triggerRef={btnRef}
            onView={handleView}
            onDelete={handleDelete}
            closeMenu={closeMenu}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 下拉操作菜单（固定定位到三点按钮附近，使用 portal 悬浮在最上层）
 * 解决原实现中菜单被父级 overflow-hidden 裁剪、且不在最上层展示的问题。
 */
function DropdownMenu({
  triggerRef,
  onView,
  onDelete,
  closeMenu,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  onView: () => void;
  onDelete: () => void;
  closeMenu: () => void;
}) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 根据三点按钮位置计算菜单固定定位（按钮旁边/下方，紧贴按钮便于操作），并限制不超出视口
  useLayoutEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuW = 110;
    const menuH = 88;
    // 左对齐按钮左侧、向下展开，紧贴按钮旁边
    let left = rect.left;
    let top = rect.bottom + 4;
    // 防止超出视口右/下边缘
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    if (top + menuH > window.innerHeight) top = Math.max(8, rect.top - menuH - 4);
    setPos({ top, left });
  }, [triggerRef]);

  if (!pos) return null;

  return (
    <>
      {/* 全屏透明遮罩：点击关闭菜单 */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={closeMenu}
        style={{ background: 'transparent' }}
      />
      <div
        className="fixed z-[70] min-w-[110px] rounded-lg border border-[var(--color-border)] bg-white shadow-lg py-1 animate-[fadeIn_120ms_ease-out]"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onView}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-gray-700)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors border-none bg-transparent"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[var(--color-gray-400)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          </svg>
          {t('home.organize.shared.view')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 cursor-pointer transition-colors border-none bg-transparent"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="M6 7l1 13h10l1-13" />
            <path d="M10 11v5M14 11v5" />
          </svg>
          {t('home.organize.shared.delete')}
        </button>
      </div>
    </>
  );
}
