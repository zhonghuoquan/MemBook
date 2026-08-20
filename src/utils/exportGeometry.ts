/**
 * MemBook — 导出/打印几何数学（纯函数，无 store / DOM / jsPDF / Tauri 依赖）
 *
 * 从 exportEngine 抽取的确定性尺寸计算，供导出引擎与单元测试共用。
 * 独立成模块的原因：直接 import exportEngine 会触发 jsPDF / Tauri 等浏览器依赖，
 * 难以在测试环境安全加载。
 *
 * 覆盖：
 * - 页面导出物理宽度（封面含设计书脊 / 出血）
 * - 导出画布像素尺寸（DPI 换算 / 四周出血 / 封面书脊扩展）
 * - 照片降采样阈值
 */
import { isCoverPage, type AlbumPage } from '../types';
import { MM_TO_PX } from './sharedRender';

/** 按 DPI 换算每毫米像素（25.4mm = 1 英寸） */
export function pxPerMmAt(dpi: number): number {
  return dpi / 25.4;
}

/**
 * 页面导出的物理宽度（mm）：
 * - 封面页含设计书脊（书脊背面 + 封面正面，印刷一体，无编辑器视觉间隙）
 * - 封底无书脊
 * - 四周各扩展出血边
 */
export function pageExportWidthMm(
  page: AlbumPage | undefined,
  pageMM: { w: number; h: number },
  bleed: number,
): number {
  if (!page) return pageMM.w + bleed * 2;
  const isCoverLike = isCoverPage(page);
  return pageMM.w + (isCoverLike ? (page.spineWidth ?? 0) : 0) + bleed * 2;
}

export interface ExportCanvasSize {
  /** 每毫米像素（由 dpi 决定） */
  pxPerMM: number;
  /** 编辑器逻辑坐标宽（mm × MM_TO_PX），封面额外 + 设计书脊 */
  logicalW: number;
  /** 编辑器逻辑坐标高（mm × MM_TO_PX） */
  logicalH: number;
  /** 四周出血扩展后的导出画布像素宽（含封面书脊） */
  canvasW: number;
  /** 四周出血扩展后的导出画布像素高 */
  canvasH: number;
}

/** 导出画布/逻辑尺寸（纯计算，与 renderPage 一致）：逻辑坐标 = mm × MM_TO_PX，像素坐标 = mm × dpi/25.4 */
export function calcExportCanvasSize(
  pageMM: { w: number; h: number },
  opts: { spineMm?: number; bleed?: number; dpi?: number } = {},
): ExportCanvasSize {
  const dpi = opts.dpi ?? 300;
  const pxPerMM = pxPerMmAt(dpi);
  const designSpine = opts.spineMm ?? 0;
  const bleed = opts.bleed ?? 0;
  const logicalW = (pageMM.w + designSpine) * MM_TO_PX;
  const logicalH = pageMM.h * MM_TO_PX;
  const canvasW = Math.round((pageMM.w + designSpine + bleed * 2) * pxPerMM);
  const canvasH = Math.round((pageMM.h + bleed * 2) * pxPerMM);
  return { pxPerMM, logicalW, logicalH, canvasW, canvasH };
}

/**
 * 按导出 DPI 计算照片降采样阈值（页面最长边像素 × 2）。
 * 超过该阈值的照片在导出前先等比缩小，控制内存峰值且不失真。
 */
export function calcExportMaxDim(pageMM: { w: number; h: number }, dpi: number): number {
  return Math.max(pageMM.w, pageMM.h) * pxPerMmAt(dpi) * 2;
}