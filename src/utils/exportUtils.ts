/**
 * ⚠️ DEPRECATED — 已废弃，请使用 exportEngine.ts
 *
 * 旧方案基于"截取屏幕 Stage 像素 + 固定 2.5 秒等待"，存在以下问题：
 *   1. 照片加载不可靠（定时等待而非事件驱动）
 *   2. 依赖屏幕 pixelRatio（最大 2x），无法达到真实 300 DPI
 *   3. 切换页面破坏 UI Stage 状态
 *   4. 失败时静默返回白页
 *
 * 新方案 exportEngine.ts 直接使用真实 Konva Stage 做高分辨率截图，
 * 无需复制渲染逻辑，导出结果与编辑器显示完全一致。
 *
 * 保留仅作参考。
 */

import { useEditorStore, useUIStore } from '../store';
import { getKonvaStage } from '../engine/stage-handle';
import { logger } from './logger';

export type ExportFormat = 'pdf' | 'png' | 'jpg';

export interface ExportOptions {
  format: ExportFormat;
  quality: number;
  scale: number;
  pageRange: { start: number; end: number };
  projectName: string;
  outputPath?: string;
  onProgress?: (current: number, total: number) => void;
}

function getStage() { return getKonvaStage(); }

function blankPagePNG(w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}

function dataURLtoBlob(dataURL: string): Blob {
  try {
    const [header, b64] = dataURL.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch { return new Blob([], { type: 'image/png' }); }
}

function getPageSizeMM() {
  const s = useEditorStore.getState().albumSize;
  return { w: s?.width || 210, h: s?.height || 280 };
}

/* ══════════════════════════ 核心渲染 ══════════════════════════ */

async function renderPage(pageIndex: number, scale: number): Promise<string> {
  const MM = 2;
  const albumSize = useEditorStore.getState().albumSize;
  const pageW = albumSize ? Math.round(albumSize.width * MM) : 420;
  const pageH = albumSize ? Math.round(albumSize.height * MM) : 560;
  const targetW = Math.round(pageW * scale);
  const targetH = Math.round(pageH * scale);

  const fallback = () => blankPagePNG(targetW, targetH);

  try {
    useEditorStore.getState().setCurrentPage(pageIndex);
    await new Promise(r => setTimeout(r, 2500));

    const stage = getStage();
    if (!stage) return fallback();

    try { stage.draw(); } catch {}
    try { stage.batchDraw(); } catch {}

    // ── 直接读取 Konva Layer 内部 Canvas 像素（toDataURL 不靠谱时最可靠的方案）──
    const layers = (stage.getLayers?.() || []) as any[];
    const mainLayer = layers[0];
    if (!mainLayer) return fallback();

    const layerCanvas = mainLayer.getCanvas?.()?._canvas as HTMLCanvasElement | undefined;
    if (!layerCanvas || layerCanvas.width === 0) return fallback();

    // 页面在 Stage 中的区域
    const zoom = useUIStore.getState().canvasZoom;
    const sw = stage.width();
    const sh = stage.height();
    const srcW = Math.max(1, pageW * zoom);
    const srcH = Math.max(1, pageH * zoom);
    const srcX = Math.max(0, (sw - srcW) / 2);
    const srcY = Math.max(0, (sh - srcH) / 2);

    // 绘制到目标 Canvas
    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(layerCanvas, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

    const dataURL = c.toDataURL('image/png');
    return dataURL.length > 1000 ? dataURL : fallback();
  } catch (err) {
    logger.warn(`[export] P${pageIndex + 1} crash:`, err);
  }

  return fallback();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
}

async function pngToJpeg(pngURL: string, quality = 0.88): Promise<string> {
  try {
    const img = await loadImage(pngURL);
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
  } catch { return pngURL; }
}

/* ══════════════════════════ 导出函数 ══════════════════════════ */

export async function exportToPNG(options: ExportOptions): Promise<void> {
  const { pageRange, scale, projectName, outputPath, onProgress } = options;
  const blobs: Blob[] = [];
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    blobs.push(dataURLtoBlob(await renderPage(i, scale)));
    onProgress?.(i - pageRange.start + 1, pageRange.end - pageRange.start + 1);
  }
  if (blobs.length === 1) {
    await saveFile(blobs[0], `${projectName}_第${pageRange.start}页.png`, outputPath);
  } else {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    blobs.forEach((b, i) => zip.file(`${projectName}_第${pageRange.start + i}页.png`, b));
    await saveFile(await zip.generateAsync({ type: 'blob' }), `${projectName}_导出.zip`, outputPath);
  }
}

export async function exportToJPG(options: ExportOptions): Promise<void> {
  const { pageRange, scale, quality, projectName, outputPath, onProgress } = options;
  const blobs: Blob[] = [];
  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    const dataURL = await renderPage(i, scale);
    const img = new Image();
    const canvas = document.createElement('canvas');
    await new Promise<void>((resolve) => {
      img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve();
      };
      img.src = dataURL;
    });
    blobs.push(await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', quality / 100)));
    onProgress?.(i - pageRange.start + 1, pageRange.end - pageRange.start + 1);
  }
  if (blobs.length === 1) {
    await saveFile(blobs[0], `${projectName}_第${pageRange.start}页.jpg`, outputPath);
  } else {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    blobs.forEach((b, i) => zip.file(`${projectName}_第${pageRange.start + i}页.jpg`, b));
    await saveFile(await zip.generateAsync({ type: 'blob' }), `${projectName}_导出.zip`, outputPath);
  }
}

export async function exportToPDF(options: ExportOptions): Promise<void> {
  const { pageRange, scale, projectName, outputPath, onProgress } = options;
  const pageMM = getPageSizeMM();
  const jsPDF = (await import('jspdf')).default;
  const pdf = new jsPDF({
    orientation: pageMM.w > pageMM.h ? 'landscape' : 'portrait',
    unit: 'mm', format: [pageMM.w, pageMM.h], compress: true,
  });

  for (let i = pageRange.start - 1; i < pageRange.end; i++) {
    try {
      if (i > pageRange.start - 1) pdf.addPage([pageMM.w, pageMM.h], pageMM.w > pageMM.h ? 'landscape' : 'portrait');
      const pngURL = await renderPage(i, scale);
      const jpgURL = await pngToJpeg(pngURL, 0.88);
      const img = await loadImage(jpgURL);
      pdf.addImage(img, 'JPEG', 0, 0, pageMM.w, pageMM.h);
    } catch (err) {
      logger.warn(`[export] PDF page ${i + 1} failed:`, err);
    }
    onProgress?.(i - pageRange.start + 1, pageRange.end - pageRange.start + 1);
  }

  const arrBuf = pdf.output('arraybuffer') as ArrayBuffer;
  await saveFile(new Blob([arrBuf], { type: 'application/pdf' }), `${projectName}.pdf`, outputPath);
}

/* ══════════════════════════ 文件保存 ══════════════════════════ */

async function saveFile(blob: Blob, filename: string, outputPath?: string): Promise<void> {
  try {
    if ((window as any).__TAURI_INTERNALS__) {
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const finalPath = outputPath
        ? `${outputPath.replace(/[/\\]$/, '')}/${filename}`
        : (await (await import('@tauri-apps/plugin-dialog')).save({ defaultPath: filename }));
      if (!finalPath) return;
      const buf = await blob.arrayBuffer();
      await writeFile(finalPath, new Uint8Array(buf));
      return;
    }
  } catch {}

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}
