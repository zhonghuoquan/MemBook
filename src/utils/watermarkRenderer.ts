/**
 * MemBook — 时间水印渲染逻辑
 *
 * 纯函数，供 Canvas.tsx（编辑器预览）和 exportEngine.ts（导出）共用。
 */

import type { AlbumPage, Photo, WatermarkSettings, LocationGranularity } from '../types';
import { DEFAULT_WATERMARK_SETTINGS } from '../types';
import { useEditorStore } from '../store';
import { isActivated } from '../license/licenseService';

/* ══════════════════════════ 字体 ══════════════════════════ */

/**
 * 时间水印字体栈。
 * 直接写 "serif" 在 Tauri/WebView2 中可能无法回退到中文字体，
 * 导致中文水印空白。显式指定常见中文字体，最后回退到 serif。
 */
export const WATERMARK_FONT_STACK = '"Noto Serif SC","STSong","SimSun","Songti SC",serif';

/* ══════════════════════════ 日期格式化 ══════════════════════════ */

/**
 * 提取 ISO 日期字符串的日期部分（YYYY-MM-DD），用于同一天判定。
 */
function dateOnly(isoDate: string): string {
  return isoDate.slice(0, 10); // "2026-03-21T10:30:00.000Z" → "2026-03-21"
}

/**
 * 将 ISO 日期字符串格式化为中文日期。
 * "2026-03-21T10:30:00.000Z" → "2026年3月21日"
 */
export function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

/* ══════════════════════════ 地点格式化 ══════════════════════════ */

/** 去掉城市名末尾的"市"，让水印更简洁（如"杭州市"→"杭州"） */
function simplifyCity(name: string): string {
  return name.endsWith('市') && name.length > 2 ? name.slice(0, -1) : name;
}

/**
 * 按用户设置的精细度格式化地点字符串。
 * 兼容旧数据（如"杭州市-西湖区-灵隐街道"）和新数据（"浙江省-杭州市-..."）。
 * 输出地点内部用" · "分隔，不再保留"-"。
 */
export function formatLocation(location: string, granularity: LocationGranularity): string {
  if (!location) return '';
  const parts = location.split('-').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  // 直辖市列表
  const MUNICIPALITIES = ['北京', '北京市', '上海', '上海市', '天津', '天津市', '重庆', '重庆市'];
  const isMunicipality = (n: string) => MUNICIPALITIES.includes(n);

  // 找到城市索引：第一个以"市"结尾的项，或直辖市的第一项
  let cityIndex = parts.findIndex((p) => p.endsWith('市'));
  if (cityIndex < 0 && isMunicipality(parts[0])) cityIndex = 0;
  if (cityIndex < 0) cityIndex = parts.length > 1 ? 1 : 0;

  const city = simplifyCity(parts[cityIndex] || '');
  if (!city) return '';

  if (granularity === 'coarse') return city;

  const district = parts[cityIndex + 1] || '';
  if (granularity === 'standard') {
    return district ? `${city} - ${district}` : city;
  }

  // detailed：从省份（或直辖市）开始显示全部层级，内部用" - "连接
  const startIndex = isMunicipality(parts[0]) ? 0 : Math.max(0, cityIndex - 1);
  return parts.slice(startIndex).map((p, i) => {
    // 城市层级简化，其他层级保持原样
    const idx = startIndex + i;
    return idx === cityIndex ? simplifyCity(p) : p;
  }).join(' - ');
}

/* ══════════════════════════ 水印展示判定 ══════════════════════════ */

/**
 * 获取页面上所有 placement 对应的照片，按拍摄日期排序后返回最早的日期字符串。
 * 返回 null 表示页面没有有效照片。
 */
function getPageDate(page: AlbumPage, photos: Photo[]): string | null {
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  let earliestDate: string | null = null;

  for (const pl of page.placements) {
    if (!pl.photoId) continue;
    const photo = photoMap.get(pl.photoId);
    if (!photo) continue;
    if (!earliestDate || photo.date < earliestDate) {
      earliestDate = photo.date;
    }
  }

  return earliestDate;
}

/**
 * 判断某个 ISO 日期对应的照片是否来自修改日期（非 EXIF 拍摄日期）。
 * 只比较日期部分（YYYY-MM-DD）。
 */
function isModifiedDate(photoDate: string, photos: Photo[]): boolean {
  const day = dateOnly(photoDate);
  for (const p of photos) {
    if (dateOnly(p.date) === day && p.dateSource === 'modified') return true;
  }
  return false;
}

type PageDateLocationKey = { date: string | null; locations: string };

/**
 * 获取页面用于水印判定的“日期 + 地点”组合键。
 * 按 placements 顺序取最早拍摄日期，并收集该页同天所有照片的去重地点。
 */
function getPageDateLocationKey(
  page: AlbumPage,
  photos: Photo[],
  settings: WatermarkSettings,
): PageDateLocationKey {
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  let earliestDate: string | null = null;

  for (const pl of page.placements) {
    if (!pl.photoId) continue;
    const photo = photoMap.get(pl.photoId);
    if (!photo) continue;
    if (!earliestDate || photo.date < earliestDate) {
      earliestDate = photo.date;
    }
  }

  const locationSet = new Set<string>();
  if (earliestDate && settings.showLocation) {
    for (const pl of page.placements) {
      if (!pl.photoId) continue;
      const photo = photoMap.get(pl.photoId);
      if (!photo || dateOnly(photo.date) !== dateOnly(earliestDate)) continue;
      if (photo.location) locationSet.add(photo.location);
    }
  }

  return {
    date: earliestDate,
    locations: [...locationSet].sort().join(', '),
  };
}

/**
 * 判断当前页是否应该展示水印。
 *
 * 规则：
 * 1. 如果水印功能未开启 → false
 * 2. 页面无有效日期 → false
 * 3. 当前页日期来源为修改日期，且用户未开启 includeModified → false
 * 4. 第一页始终显示
 * 5. 之后每 6 页强制显示一次（index % 6 === 0）
 * 6. 其他情况：仅当当前页的“日期 + 地点”组合与上一页不同时显示
 *
 * @param pageIndex    当前页面索引
 * @param pages        所有页面
 * @param photos       所有照片
 * @param settings     水印设置
 */
export function shouldShowWatermark(
  pageIndex: number,
  pages: AlbumPage[],
  photos: Photo[],
  settings: WatermarkSettings,
): boolean {
  if (!settings.enabled) return false;

  const current = getPageDateLocationKey(pages[pageIndex], photos, settings);
  if (!current.date) return false;

  // 检查当前页日期是否来自修改日期（且用户未开启 includeModified）
  if (!settings.includeModified && isModifiedDate(current.date, photos)) {
    return false;
  }

  // 第一页始终显示
  if (pageIndex === 0) return true;

  // 每 6 页强制显示一次
  if (pageIndex % 6 === 0) return true;

  // 与前一页的“日期 + 地点”组合比较，不同才显示
  const prev = getPageDateLocationKey(pages[pageIndex - 1], photos, settings);
  if (
    prev.date &&
    dateOnly(prev.date) === dateOnly(current.date) &&
    prev.locations === current.locations
  ) {
    return false;
  }

  return true;
}

/**
 * 生成当前页的水印文本。
 * 格式："2026年3月21日 · 杭州市-西湖区, 上海市-浦东新区"
 * 同页同天多地点合并去重；无地点时只显示日期。
 */
export function getWatermarkText(
  pageIndex: number,
  pages: AlbumPage[],
  photos: Photo[],
  settings: WatermarkSettings,
): string {
  if (!settings.enabled) return '';

  const currentDate = getPageDate(pages[pageIndex], photos);
  if (!currentDate) return '';

  const photoMap = new Map(photos.map((p) => [p.id, p]));

  // 收集该页同天所有照片的去重地点
  const locationSet = new Set<string>();
  for (const pl of pages[pageIndex].placements) {
    if (!pl.photoId) continue;
    const photo = photoMap.get(pl.photoId);
    if (!photo || dateOnly(photo.date) !== dateOnly(currentDate)) continue;
    if (photo.location && settings.showLocation) {
      locationSet.add(photo.location);
    }
  }

  const locations = [...locationSet]
    .map((loc) => formatLocation(loc, settings.locationGranularity))
    .filter(Boolean)
    .join(', ');
  const dateStr = settings.showDate ? formatDate(currentDate) : '';
  const parts = [dateStr, locations].filter(Boolean);
  return parts.join(' · ');
}

/* ══════════════════════════ 导出辅助 ══════════════════════════ */

/**
 * 获取当前编辑状态下的完整水印设置（从 EditorStore 读取）。
 * 未激活时强制返回 enabled=false，避免未授权使用高级功能。
 */
export function getWatermarkSettings(): WatermarkSettings {
  try {
    const s = useEditorStore.getState();
    const settings = s.watermarkSettings ?? DEFAULT_WATERMARK_SETTINGS;
    if (!isActivated()) {
      return { ...settings, enabled: false };
    }
    return settings;
  } catch {
    return { ...DEFAULT_WATERMARK_SETTINGS, enabled: false };
  }
}

/**
 * 计算水印字体大小（固定 10px 逻辑坐标）。
 */
export function calcWatermarkFontSize(): number {
  return 7;
}

/**
 * 计算水印位置：左侧与安全区内边对齐，底部与安全区底边留 4px 间隙（位于边距区域内）。
 * @param safeAreaLeft  安全区左侧的 x 坐标（逻辑 px）
 * @param safeAreaBottom 安全区底边的 y 坐标（逻辑 px）
 * @param _fontSize 字体大小（保留参数，位置不再依赖字号）
 */
export function calcWatermarkPosition(
  safeAreaLeft: number,
  safeAreaBottom: number,
  _fontSize: number,
): { x: number; y: number } {
  return {
    x: safeAreaLeft,
    y: safeAreaBottom + 4, // 位于边距区域，距安全区底边 4px
  };
}

/**
 * 计算页面安全区边界，仅与全局边距设置相关。
 * 时间水印位置固定于安全区，不随照片槽的移动/缩放变化。
 */
export function calcPageSafeArea(
  _page: AlbumPage,
  albW: number,
  albH: number,
  canvasW: number,
  canvasH: number,
  globalMargin: { left: number; bottom: number },
): { left: number; bottom: number } {
  return {
    left: Math.round((globalMargin.left / albW) * canvasW),
    bottom: Math.round(canvasH - (globalMargin.bottom / albH) * canvasH),
  };
}
