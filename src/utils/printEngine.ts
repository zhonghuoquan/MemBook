/**
 * MemBook — 打印引擎
 *
 * 核心策略：
 *   1. 复用导出引擎的页面渲染能力，将页面渲染为高分辨率图片
 *   2. 组合为 PDF 文件保存到临时目录
 *   3. 通过 Rust 命令调用 SumatraPDF（sm.exe）直接发送到选定打印机
 *   4. 打印机列表通过 Windows Print API 获取，避免 PowerShell 弹窗
 */

import { useEditorStore, usePhotoStore } from '../store';
import { SlidingPhotoCache, calcExportMaxDim, renderPage, generatePdfBlob } from './exportEngine';
import { invoke } from '@tauri-apps/api/core';
import { tempDir } from '@tauri-apps/api/path';
import { logger } from './logger';

export type PrintRange = 'all' | 'current' | 'custom';
export type PrintColor = 'color' | 'grayscale';
export type PrintDuplex = 'single' | 'longEdge' | 'shortEdge';
export type PrintOrientation = 'auto' | 'portrait' | 'landscape';
export type PrintPaperSize = 'auto' | 'a4' | 'a3' | 'letter' | 'legal';

export interface PrintOptions {
  range: PrintRange;
  startPage?: number;
  endPage?: number;
  color: PrintColor;
  duplex: PrintDuplex;
  copies: number;
  pagesPerSheet: 1 | 2 | 4 | 6 | 9 | 16;
  paperSize: PrintPaperSize;
  orientation: PrintOrientation;
  printer?: string;
  onProgress?: (current: number, total: number) => void;
}

// 预览缩略图 DPI：48（显示宽度 360px，像素 397×531 足够清晰，渲染速度比 96 DPI 快 ~4x）
const PREVIEW_DPI = 48;
const PRINT_DPI = 300;

function resolvePageRange(opts: PrintOptions): { start: number; end: number } {
  const { pages } = useEditorStore.getState();
  const total = pages.length;
  if (total === 0) return { start: 1, end: 0 };

  const currentIndex = useEditorStore.getState().currentPageIndex;
  switch (opts.range) {
    case 'current':
      return { start: currentIndex + 1, end: currentIndex + 1 };
    case 'custom': {
      const start = Math.max(1, Math.min(opts.startPage ?? 1, total));
      const end = Math.max(start, Math.min(opts.endPage ?? total, total));
      return { start, end };
    }
    case 'all':
    default:
      return { start: 1, end: total };
  }
}

async function renderPagesForPrint(
  pageRange: { start: number; end: number },
  dpi: number,
  onProgress?: (current: number, total: number) => void,
  onPage?: (pageIndex: number, dataUrl: string) => void,
): Promise<{ dataUrls: string[]; pageIndices: number[] }> {
  const { pages } = useEditorStore.getState();
  const { photos } = usePhotoStore.getState();
  const photoDataMap = new Map(photos.map((p) => [p.id, p]));

  const pageMM = {
    w: useEditorStore.getState().albumSize?.width || 210,
    h: useEditorStore.getState().albumSize?.height || 280,
  };
  // 滑动窗口加载：仅缓存当前页 ±N 页的照片位图，控制打印渲染的内存峰值
  const photoCache = new SlidingPhotoCache(calcExportMaxDim(pageMM, dpi));
  const pageIndices: number[] = [];
  const dataUrls: string[] = [];
  const total = pageRange.end - pageRange.start + 1;

  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    const page = pages[i];
    if (!page) continue;
    const photoImages = await photoCache.preparePage(pages, i, photoDataMap);
    const url = await renderPage(page, dpi, photoImages, photoDataMap);
    dataUrls.push(url);
    pageIndices.push(i);
    // 流式回调：每生成一页立即通知调用方，支持增量渲染
    onPage?.(i, url);
    onProgress?.(dataUrls.length, total);
  }
  photoCache.clear();

  return { dataUrls, pageIndices };
}

export async function generatePrintPreviews(
  options: PrintOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<{ dataUrls: string[]; pageIndices: number[] }> {
  const pageRange = resolvePageRange(options);
  if (pageRange.start > pageRange.end) {
    return { dataUrls: [], pageIndices: [] };
  }
  return renderPagesForPrint(pageRange, PREVIEW_DPI, onProgress);
}

/**
 * 流式生成打印预览：每生成一页立即通过 onPage 回调通知调用方。
 *
 * 用于支持增量渲染：调用方收到一页就追加到 UI，避免等待全部生成完才显示。
 * 内部仍用 SlidingPhotoCache 控制内存峰值，onPage 回调同步触发。
 *
 * @returns 完成时返回所有页码索引（dataUrls 已通过 onPage 流式输出，不再返回）
 */
export async function generatePrintPreviewsStream(
  options: PrintOptions,
  onPage: (pageIndex: number, dataUrl: string) => void,
  onProgress?: (current: number, total: number) => void,
): Promise<{ pageIndices: number[] }> {
  const pageRange = resolvePageRange(options);
  if (pageRange.start > pageRange.end) {
    return { pageIndices: [] };
  }
  const result = await renderPagesForPrint(pageRange, PREVIEW_DPI, onProgress, onPage);
  return { pageIndices: result.pageIndices };
}

export async function printPages(options: PrintOptions): Promise<void> {
  const pageRange = resolvePageRange(options);
  if (pageRange.start > pageRange.end) {
    throw new Error('没有可打印的页面');
  }

  if (!options.printer) {
    throw new Error('请选择打印机');
  }

  const pdfBlob = await generatePdfBlob(
    pageRange,
    PRINT_DPI,
    options.color === 'grayscale',
    options.onProgress,
  );

  const dir = await tempDir();
  const pdfPath = `${dir}\\membook_print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;

  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const buf = await pdfBlob.arrayBuffer();
    await writeFile(pdfPath, new Uint8Array(buf));
  } catch (error) {
    logger.error('写入临时 PDF 失败:', error);
    throw new Error('准备打印文件失败');
  }

  try {
    await invoke('print_pdf', {
      pdfPath,
      printerName: options.printer,
      duplex: options.duplex === 'single' ? undefined : options.duplex,
      copies: options.copies > 1 ? options.copies : undefined,
    });
  } catch (error) {
    logger.error('打印命令调用失败:', error);
    throw new Error(`打印失败: ${error}`);
  }
}
