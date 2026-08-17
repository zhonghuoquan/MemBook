/**
 * MemBook — 共享渲染逻辑
 *
 * 从 Canvas.tsx 提取的纯函数，供编辑器和导出引擎共用。
 * 确保导出结果与编辑器显示完全一致。
 */

import { resolveTemplate } from '../types';
import type { AlbumPage, PhotoPlacement, Photo } from '../types';
import { getCachedContentInfo, computeSmartObjectPosition, type PhotoContentInfo } from '../engine/content-aware';

/* ══════════════════════════ 常量 ══════════════════════════ */

/** 编辑器内部使用的 mm→px 转换系数 */
export const MM_TO_PX = 2;

/* ══════════════════════════ 纹理背景 tile 绘制 ══════════════════════════ */

/** 纹理背景基础色（与画布/导出一致） */
export function getTextureBaseColor(texture: string): string {
  const map: Record<string, string> = {
    'texture-ricepaper': '#F5F0E8',
    'texture-kraft': '#C4A882',
    'texture-dots': '#F9FAFB',
    'texture-grid': '#F9FAFB',
    'texture-stripes': '#FAFAFA',
    'texture-linen': '#F0EDE8',
  };
  return map[texture] || '#FFFFFF';
}

/**
 * 在任意 2D context 上绘制纹理背景的 32×32 tile 图案。
 * ctx 可为 CanvasRenderingContext2D 或 OffscreenCanvasRenderingContext2D，
 * 供画布（createTextureCanvas）、导出与缩略图 Worker 三端共用，保证图案一致。
 */
export function paintTextureTile(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  texture: string,
  size = 32,
): void {
  switch (texture) {
    case 'texture-ricepaper': {
      ctx.fillStyle = '#F5F0E8';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#E8E0D0';
      const dots: [number, number][] = [[4, 6], [12, 3], [20, 8], [28, 5], [6, 14], [14, 18], [22, 12], [30, 16], [8, 24], [16, 28], [24, 22], [2, 30], [18, 24], [26, 30], [10, 10], [24, 4]];
      for (const [x, y] of dots) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'texture-kraft': {
      ctx.fillStyle = '#C4A882';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(120, 90, 50, 0.15)';
      ctx.lineWidth = 0.5;
      const lines: [number, number, number, number][] = [[2, 0, 6, 32], [10, 0, 14, 32], [18, 0, 22, 32], [26, 0, 30, 32]];
      for (const [x1, y1, x2, y2] of lines) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(100, 70, 30, 0.08)';
      const spots: [number, number][] = [[5, 5], [15, 12], [25, 8], [8, 20], [20, 25], [28, 18]];
      for (const [x, y] of spots) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'texture-dots': {
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#D1D5DB';
      const step = 12;
      for (let x = step / 2; x < size; x += step) {
        for (let y = step / 2; y < size; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'texture-grid': {
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      const step = 16;
      for (let x = 0; x <= size; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
    case 'texture-stripes': {
      ctx.fillStyle = '#FAFAFA';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      for (let i = -size; i < size * 2; i += 5) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size, size);
        ctx.stroke();
      }
      break;
    }
    case 'texture-linen': {
      ctx.fillStyle = '#F0EDE8';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(0,0,0,0.03)';
      ctx.lineWidth = 1;
      const step = 4;
      for (let x = 0; x <= size; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
}

/** 工作区四周保留的额外滚动边距（px），使页面始终可平移并以鼠标为锚点缩放 */
export const CANVAS_WORKSPACE_EXTRA = 500;

/* ══════════════════════════ 页面预览适配（保持宽高比并居中） ══════════════════════════ */

export interface PagePreviewFit {
  pageW: number;
  pageH: number;
  renderW: number;
  renderH: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

/**
 * 将页面按原始宽高比居中适配到缩略图/预览容器。
 * 用于 PageSlotPreview、BottomNav PageThumbnail 等需要保持页面比例的预览场景。
 */
export function calcPagePreviewFit(
  albumSize: { width: number; height: number } | null,
  containerW: number,
  containerH: number,
  mmToPx = MM_TO_PX,
): PagePreviewFit {
  const pageW = albumSize ? albumSize.width * mmToPx : containerW;
  const pageH = albumSize ? albumSize.height * mmToPx : containerH;
  const pageAspect = pageW / pageH;
  const containerAspect = containerW / containerH;

  let renderW: number;
  let renderH: number;
  let offsetX: number;
  let offsetY: number;

  if (containerAspect > pageAspect) {
    renderH = containerH;
    renderW = renderH * pageAspect;
    offsetX = (containerW - renderW) / 2;
    offsetY = 0;
  } else {
    renderW = containerW;
    renderH = renderW / pageAspect;
    offsetX = 0;
    offsetY = (containerH - renderH) / 2;
  }

  return { pageW, pageH, renderW, renderH, offsetX, offsetY, scale: renderW / pageW };
}

/* ══════════════════════════ cover-fit 计算 ══════════════════════════ */

/** 简单 cover-fit：按较大缩放比填满 */
export function calcCoverFit(iw: number, ih: number, cw: number, ch: number) {
  const scale = Math.max(cw / iw, ch / ih);
  return { x: 0, y: 0, width: iw * scale, height: ih * scale };
}

/** 旋转后全覆盖：缩放照片使旋转后槽位四角不露白 */
export function calcCoverFitWithRotation(
  iw: number, ih: number,
  cw: number, ch: number,
  rotationDeg: number,
) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const reqW = cw * cos + ch * sin;
  const reqH = cw * sin + ch * cos;
  const scale = Math.max(reqW / iw, reqH / ih);
  const boundingW = (iw * cos + ih * sin) * scale;
  const boundingH = (iw * sin + ih * cos) * scale;
  return {
    imgW: iw * scale,
    imgH: ih * scale,
    boundingW,
    boundingH,
    scale,
  };
}

/* ══════════════════════════ 文字断行（与编辑器 DOM 文字层同源） ══════════════════════════ */

/**
 * Canvas 版文字断行：与编辑器 DOM 文字层 TextDomNode.wrapTextLines 的排版规则完全同源。
 * - CJK（含假名/全角/标点）逐字为独立 token 可断行；Latin 按空格分词整体断行（对应 DOM word-break:normal）
 * - 测量计入每字符后的字距：ctx.letterSpacing 不影响 measureText，需手动加 s.length×letterSpacing
 * - contentWpx 需传「盒宽 − 左右内边距 − 末尾一个字距」（与 wrapTextLines 调用方同口径）
 * 纯函数、无 DOM 依赖，可在 Web Worker 中安全使用。
 */
export function wrapTextLines(
  ctx: { measureText(s: string): { width: number } },
  text: string,
  contentWpx: number,
  letterSpacing = 0,
): string[] {
  const w = (s: string) => ctx.measureText(s).width + s.length * letterSpacing;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') { lines.push(''); continue; }
    const tokens = para.split(/(\s+|[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\u3000-\u303f\uff00-\uffef])/).filter((s) => s.length > 0);
    let line = '';
    for (const tk of tokens) {
      const test = line + tk;
      if (w(test) > contentWpx && line !== '') {
        lines.push(line);
        line = tk.replace(/^\s+/, '');
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ══════════════════════════ 槽位坐标计算 ══════════════════════════ */

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算槽位在页面逻辑坐标中的位置和尺寸。
 * 与 Canvas.tsx 的 slotX/slotY/slotWidth/slotHeight 逻辑完全一致。
 *
 * 无 slotOverrides 时按用户边距计算安全区，并对页面铺开型模板（bbox≥85%）使用独立轴缩放填满安全区；
 * 其他模板使用等比缩放（取 sx/sy 较小者）保持原始比例，居中对齐。
 *
 * @param slotId 槽位 ID
 * @param page 页面数据
 * @param canvasW 页面逻辑宽度（mm × MM_TO_PX）
 * @param canvasH 页面逻辑高度（mm × MM_TO_PX）
 * @param margin 可选页边距（mm）；未传时回退到零边距等比缩放（调用方应显式传入）
 */
export function getSlotRect(
  slotId: string,
  page: AlbumPage,
  canvasW: number,
  canvasH: number,
  margin?: { left: number; right: number; top: number; bottom: number },
): SlotRect | null {
  const override = page.slotOverrides?.[slotId];
  if (override) {
    return { x: override.x, y: override.y, width: override.width, height: override.height };
  }

  // 查找模板槽位定义（统一入口：静态模板 + GP 虚拟模板）
  const template = resolveTemplate(page);
  const slotDef = template?.slots.find(s => s.id === slotId);
  if (!slotDef) return null;

  // margin 由调用方传入（主线程从 editorStore 读取，Worker 由消息参数传入）
  // 不再从 editorStore 回退读取，避免 Worker 中导入 store 导致模块求值崩溃
  const pm = margin;
  if (!pm) {
    // 无边距信息时回退到原等比缩放（保持向后兼容）
    const baseScale = Math.min(canvasW, canvasH) / 100;
    const offsetX = (canvasW - 100 * baseScale) / 2;
    const offsetY = (canvasH - 100 * baseScale) / 2;
    return {
      x: slotDef.x * baseScale + offsetX,
      y: slotDef.y * baseScale + offsetY,
      width: slotDef.width * baseScale,
      height: slotDef.height * baseScale,
    };
  }

  // 计算安全区（像素）和模板包围盒（百分比）
  // canvasW = mmWidth * MM_TO_PX，所以 mmWidth = canvasW / MM_TO_PX
  const pageWmm = canvasW / MM_TO_PX;
  const pageHmm = canvasH / MM_TO_PX;
  const safeLPx = (pm.left / pageWmm) * canvasW;
  const safeTPx = (pm.top / pageHmm) * canvasH;
  const safeWPx = canvasW - ((pm.left + pm.right) / pageWmm) * canvasW;
  const safeHPx = canvasH - ((pm.top + pm.bottom) / pageHmm) * canvasH;
  const allSlots = template?.slots ?? [slotDef];
  let minX = 100, minY = 100, maxX = 0, maxY = 0;
  for (const s of allSlots) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x + s.width > maxX) maxX = s.x + s.width;
    if (s.y + s.height > maxY) maxY = s.y + s.height;
  }
  const bboxW = maxX - minX || 100;
  const bboxH = maxY - minY || 100;
  // stagger/magazine/overlay 模板有精心设计的相对位置，独立轴缩放会破坏主图居中与副图关系
  // 与 helpers.ts calcMarginOverrides 的 isPageSpread 逻辑保持一致
  const isStagger = template?.tags?.includes('stagger')
    || template?.tags?.includes('magazine')
    || template?.tags?.includes('overlay')
    || template?.subCategory === 'magazine';
  const isSpread = bboxW >= 85 && bboxH >= 85 && !isStagger;
  const scaleX = isSpread ? safeWPx / bboxW : Math.min(safeWPx / bboxW, safeHPx / bboxH);
  const scaleY = isSpread ? safeHPx / bboxH : Math.min(safeWPx / bboxW, safeHPx / bboxH);
  const offsetX = safeLPx + (safeWPx - bboxW * scaleX) / 2 - minX * scaleX;
  const offsetY = safeTPx + (safeHPx - bboxH * scaleY) / 2 - minY * scaleY;

  return {
    x: slotDef.x * scaleX + offsetX,
    y: slotDef.y * scaleY + offsetY,
    width: slotDef.width * scaleX,
    height: slotDef.height * scaleY,
  };
}

/* ══════════════════════════ 照片渲染参数计算 ══════════════════════════ */

export interface PhotoRenderParams {
  /** 照片绘制宽度（逻辑坐标） */
  drawW: number;
  /** 照片绘制高度（逻辑坐标） */
  drawH: number;
  /** 照片在槽位内的 x 偏移 */
  drawX: number;
  /** 照片在槽位内的 y 偏移 */
  drawY: number;
  /** 旋转角度 */
  rotation: number;
  /** 旋转中心 x（相对照片左上角） */
  offsetX: number;
  /** 旋转中心 y（相对照片左上角） */
  offsetY: number;
}

/**
 * 计算照片在槽位中的渲染参数。
 * 与 Canvas.tsx CanvasPhotoRenderer 的计算逻辑完全一致。
 *
 * P1-fix: 新增 contentInfo 可选参数，供 Worker 路径传入（Worker 无法访问全局缓存）。
 *   未传入时从全局 photoContentCache 读取（主线程默认行为）。
 */
export function calcPhotoRenderParams(
  photo: Photo,
  placement: PhotoPlacement,
  slotW: number,
  slotH: number,
  contentInfo?: PhotoContentInfo | null,
): PhotoRenderParams | null {
  if (photo.width <= 0 || photo.height <= 0) return null;

  const baseRotation = placement.rotation || 0;
  const panRotation = placement.panRotation;
  const totalRotation = panRotation ?? baseRotation;
  const hasRotation = Math.abs(totalRotation) > 0.01;

  const coverFit = calcCoverFitWithRotation(photo.width, photo.height, slotW, slotH, totalRotation);
  const panScale = Math.max(placement.panScale || 1, 1);

  const imgW = coverFit.imgW * panScale;
  const imgH = coverFit.imgH * panScale;
  const boundingW = coverFit.boundingW * panScale;
  const boundingH = coverFit.boundingH * panScale;

  // 照片位置：阶段4-2 主体感知，无手动 pan 且无旋转时按人脸焦点对齐
  const useSmartPosition =
    !hasRotation &&
    placement.panX === undefined &&
    placement.panY === undefined &&
    panScale === 1;
  let defaultPx: number;
  let defaultPy: number;
  if (useSmartPosition) {
    // P1-fix: 优先用传入的 contentInfo（Worker 路径），否则查全局缓存（主线程）
    // P1-fix: 接受人脸检测和能量分析两种来源，只要焦点偏离中心即启用智能定位
    const info = contentInfo !== undefined ? contentInfo : getCachedContentInfo(photo.id);
    if (info &&
        (Math.abs(info.focusX - 0.5) > 0.02 || Math.abs(info.focusY - 0.5) > 0.02)) {
      const smart = computeSmartObjectPosition(photo.width, photo.height, slotW, slotH, info);
      defaultPx = Math.round(smart.offsetX);
      defaultPy = Math.round(smart.offsetY);
    } else {
      defaultPx = Math.round((slotW - boundingW) / 2);
      defaultPy = Math.round((slotH - boundingH) / 2);
    }
  } else {
    defaultPx = Math.round((slotW - boundingW) / 2);
    defaultPy = Math.round((slotH - boundingH) / 2);
  }
  const px = placement.panX !== undefined ? placement.panX : defaultPx;
  const py = placement.panY !== undefined ? placement.panY : defaultPy;

  // Konva Image 定位逻辑
  const offsetX = hasRotation ? imgW / 2 : 0;
  const offsetY = hasRotation ? imgH / 2 : 0;
  const imgX = hasRotation ? (px + boundingW / 2) : px;
  const imgY = hasRotation ? (py + boundingH / 2) : py;

  return {
    drawW: imgW,
    drawH: imgH,
    drawX: imgX,
    drawY: imgY,
    rotation: totalRotation,
    offsetX,
    offsetY,
  };
}

/* ══════════════════════════ 画布缩放锚点计算 ══════════════════════════ */

export interface CanvasZoomAnchor {
  /** 锚点在工作区视口内的 x 坐标 */
  x: number;
  /** 锚点在工作区视口内的 y 坐标 */
  y: number;
}

/**
 * 计算以指定锚点为中心缩放画布后的新滚动位置。
 * 同时考虑 Stage 尺寸和页面 Group 偏移（groupOX/groupOY）随 zoom 的变化，
 * 保证锚点下方的同一逻辑页面点在缩放前后始终位于锚点下方（类似 PS）。
 *
 * @param container 可滚动的工作区容器
 * @param canvasW 页面逻辑宽度（mm × MM_TO_PX）
 * @param canvasH 页面逻辑高度（mm × MM_TO_PX）
 * @param oldZoom 缩放前比例
 * @param newZoom 缩放后比例
 * @param anchor 锚点在视口内的坐标（鼠标位置或视口中心）
 * @param workspaceExtra 工作区四周保留的额外滚动边距（默认 500px）
 * @returns 缩放后应设置的 scrollLeft/scrollTop
 */
export function computeZoomedScroll(
  container: HTMLElement,
  canvasW: number,
  canvasH: number,
  oldZoom: number,
  newZoom: number,
  anchor: CanvasZoomAnchor,
  workspaceExtra: number = CANVAS_WORKSPACE_EXTRA,
): { scrollLeft: number; scrollTop: number } {
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const scrollX = container.scrollLeft;
  const scrollY = container.scrollTop;

  // Stage 尺寸：容器 + 两侧额外边距，或页面内容 + 100*zoom 边距，取较大值
  const oldStageW = Math.max(containerW + workspaceExtra * 2, (canvasW + 200) * oldZoom);
  const oldStageH = Math.max(containerH + workspaceExtra * 2, (canvasH + 200) * oldZoom);
  const newStageW = Math.max(containerW + workspaceExtra * 2, (canvasW + 200) * newZoom);
  const newStageH = Math.max(containerH + workspaceExtra * 2, (canvasH + 200) * newZoom);

  // 页面 Group 在 Stage 内的偏移
  const oldGroupOX = (oldStageW - canvasW * oldZoom) / 2;
  const oldGroupOY = (oldStageH - canvasH * oldZoom) / 2;
  const newGroupOX = (newStageW - canvasW * newZoom) / 2;
  const newGroupOY = (newStageH - canvasH * newZoom) / 2;

  // 锚点下方的逻辑页面点
  const lx = (scrollX + anchor.x - oldGroupOX) / oldZoom;
  const ly = (scrollY + anchor.y - oldGroupOY) / oldZoom;

  // 缩放后保持该逻辑点位于锚点下方
  const scrollLeft = newGroupOX + lx * newZoom - anchor.x;
  const scrollTop = newGroupOY + ly * newZoom - anchor.y;

  return { scrollLeft, scrollTop };
}

/* ══════════════════════════ 画布居中滚动位置计算 ══════════════════════════ */

/**
 * 计算将页面居中显示在视口中的滚动位置。
 * 与 useCanvasCentering 的居中逻辑保持一致：Stage 在视口中居中，
 * 页面在 Stage 中居中，因此页面也在视口中居中。
 *
 * 用于「重置缩放」「最大化/最小化」等需要让页面回到中心的场景。
 *
 * @param container 可滚动的工作区容器
 * @param canvasW 页面逻辑宽度（mm × MM_TO_PX）
 * @param canvasH 页面逻辑高度（mm × MM_TO_PX）
 * @param zoom 目标缩放比例
 * @param workspaceExtra 工作区四周保留的额外滚动边距（默认 500px）
 * @returns 居中后应设置的 scrollLeft/scrollTop
 */
export function computeCenteredScroll(
  container: HTMLElement,
  canvasW: number,
  canvasH: number,
  zoom: number,
  workspaceExtra: number = CANVAS_WORKSPACE_EXTRA,
): { scrollLeft: number; scrollTop: number } {
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;

  // Stage 尺寸：与 computeZoomedScroll / useCanvasCentering 完全相同的口径
  const stageW = Math.max(containerW + workspaceExtra * 2, (canvasW + 200) * zoom);
  const stageH = Math.max(containerH + workspaceExtra * 2, (canvasH + 200) * zoom);

  // Stage 在视口中居中 → 页面（在 Stage 内居中）也随之在视口居中
  return {
    scrollLeft: Math.max(0, (stageW - containerW) / 2),
    scrollTop: Math.max(0, (stageH - containerH) / 2),
  };
}
