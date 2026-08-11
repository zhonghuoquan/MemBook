/**
 * 整理工具共享组件与工具函数
 */

import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoFileInfo, ToolProgress, DataSourceMode } from '../../../photo-tools';
import { formatBytes } from '../../../photo-tools';
import { getThumbUrl, type ThumbSize } from './thumbCache';

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
      <div className="h-2.5 bg-[var(--color-gray-100)] rounded-full overflow-hidden relative ring-1 ring-inset ring-[var(--color-border)]/40">
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
  const trackRef = useRef<HTMLDivElement | null>(null);
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
  const baseSlider =
    'pointer-events-none absolute w-full h-2 rounded-full appearance-none bg-transparent';

  return (
    <div className={`relative w-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* 轨道背景 */}
      <div ref={trackRef} className="h-2 rounded-full bg-[var(--color-gray-100)] ring-1 ring-inset ring-[var(--color-border)]/40" />
      {/* 选中区间高亮 */}
      <div
        className="absolute top-0 h-2 rounded-full"
        style={{
          left: `${leftPct}%`,
          width: `${rightPct - leftPct}%`,
          background: `linear-gradient(90deg, ${accent}, ${accent})`,
          opacity: 0.85,
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
        className={`${baseSlider} left-0 z-20`}
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
        className={`${baseSlider} left-0 z-30`}
        style={{
          ['--range-accent' as string]: accent,
        }}
        aria-label="max"
      />
      <style>{`
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #fff;
          border: 2.5px solid var(--range-accent, var(--color-brand));
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          cursor: grab;
          pointer-events: auto;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        input[type='range']::-webkit-slider-thumb:hover {
          transform: scale(1.12);
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        input[type='range']::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #fff;
          border: 2.5px solid var(--range-accent, var(--color-brand));
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
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
