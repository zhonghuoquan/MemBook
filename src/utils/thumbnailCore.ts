/**
 * MemBook — 缩略图渲染核心（纯函数，无 store 依赖）
 *
 * P1-5：从 gridThumbnailRenderer 抽取的页面绘制核心逻辑，
 * 供主线程（gridThumbnailRenderer）和 Web Worker（thumbnail.worker）共用。
 *
 * 设计约束：
 * - 不依赖 useEditorStore / localStorage / window 等主线程环境
 * - 不绘制时间水印（水印仅全屏视图使用，且需要 pages 全量数据，由主线程在后处理补绘）
 * - 不读写缓存（缓存由调用方管理）
 * - Canvas 2D context 接受 HTMLImageElement | ImageBitmap，drawImage 对两者均支持
 * - 贴纸图片由调用方预加载后传入（stickerImages 参数），本函数不做异步 IO
 */

import {
  MM_TO_PX,
  getSlotRect,
  calcPhotoRenderParams,
  wrapTextLines,
  paintTextureTile,
  getTextureBaseColor,
  type SlotRect,
} from './sharedRender';
import {
  resolveTemplate,
  getSlotZIndex,
  normalizeSlotCornerRadius,
  isCoverPage,
  type AlbumPage,
  type Photo,
  type PhotoPlacement,
  type BrushStroke,
  type StickyNote,
  type PageTextElement,
  type StickerElement,
  type ShapeElement,
} from '../types';
import type { PhotoContentInfo } from '../engine/content-aware';
import { SLOT_BORDER_COLORS, SLOT_CANVAS_PALETTE } from '../constants/templatePalette';
import { toRgba, linearGradientEndpoints } from '../constants/colorPalette';
import { getShapePolygonPoints, getRectCornerRadii } from './shapeGeometry';
import { MIN_SHAPE_SIZE_MM, MIN_STROKE_WIDTH } from '../components/editor/canvas/constants';

/** 兼容 OffscreenCanvas 与 HTMLCanvasElement 的 2D 上下文类型 */
type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** roundRect 扩展（部分旧 WebView2 不支持） */
type Ctx2DWithRoundRect = AnyCtx2D & {
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
};

export interface DrawPageOptions {
  /** 缩略图基准宽度（1.0x 缩放时的逻辑像素宽） */
  baseWidth: number;
  /** 缩放倍率 */
  scale: number;
}

/**
 * 计算缩略图 canvas 的像素尺寸。
 * 返回 null 表示 albumSize 缺失，无法渲染。
 */
export function calcThumbSize(
  albumSize: { width: number; height: number } | null,
  options: DrawPageOptions,
): { thumbW: number; thumbH: number; logicalW: number; logicalH: number } | null {
  if (!albumSize) return null;
  const { baseWidth, scale } = options;
  const logicalW = albumSize.width * MM_TO_PX;
  const logicalH = albumSize.height * MM_TO_PX;
  const thumbW = Math.round(baseWidth * scale);
  const thumbH = Math.round(thumbW * (albumSize.height / albumSize.width));
  return { thumbW, thumbH, logicalW, logicalH };
}

/** 解析 CSS linear-gradient 字符串中的颜色与 stop 位置 */
function parseCssGradientColors(css: string): (string | number)[] {
  const match = css.match(/linear-gradient\(([^)]+)\)/);
  if (!match) return [];
  const inner = match[1];
  const colors: string[] = [];
  const colorRegex = /#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)/g;
  let m: RegExpExecArray | null;
  while ((m = colorRegex.exec(inner)) !== null) {
    colors.push(m[0]);
  }
  if (colors.length < 2) return [];
  const stops: (string | number)[] = [];
  colors.forEach((c, i) => {
    stops.push(i / (colors.length - 1));
    stops.push(c);
  });
  return stops;
}

/** 生成纹理背景 tile（OffscreenCanvas 兼容 Worker；主线程用 document 回退） */
function createTextureTile(texture: string): CanvasImageSource | null {
  const size = 32;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(size, size);
      const octx = c.getContext('2d');
      if (!octx) return null;
      paintTextureTile(octx, texture, size);
      return c;
    }
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    paintTextureTile(ctx, texture, size);
    return c;
  } catch {
    return null;
  }
}

/** 绘制页面背景（支持纯色 / CSS linear-gradient / texture- 前缀，与编辑器/导出引擎一致） */
function drawPageBackground(ctx: AnyCtx2D, bg: string | undefined, w: number, h: number): void {
  const value = bg || '#FFFFFF';
  if (value.startsWith('#') || (value.length <= 7 && !value.includes('(') && !value.startsWith('texture'))) {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (value.startsWith('linear-gradient')) {
    const colorStops = parseCssGradientColors(value);
    if (colorStops.length >= 2) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      for (let i = 0; i < colorStops.length; i += 2) {
        grad.addColorStop(colorStops[i] as number, colorStops[i + 1] as string);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }
  }
  if (value.startsWith('texture-')) {
    ctx.fillStyle = getTextureBaseColor(value);
    ctx.fillRect(0, 0, w, h);
    // Worker 环境无 document，用 OffscreenCanvas 生成 pattern（主线程亦然），与画布图案一致
    const tile = createTextureTile(value);
    if (tile) {
      const pattern = ctx.createPattern(tile, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
    return;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
}

/** 在背景之上叠加背景图片位图（cover=铺满裁剪 / contain=完整居中，与画布/导出一致） */
function drawBackgroundImageOn(
  ctx: AnyCtx2D,
  img: HTMLImageElement | ImageBitmap,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
): void {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  if (fit === 'contain') {
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, 0, 0, w, h);
  }
}

/**
 * 在已缩放的 2D 上下文上绘制页面内容。
 * 与编辑器 Canvas.tsx 的 globalLayerElements 渲染顺序保持一致：
 *   背景 → 模板空槽位 → [合并排序: 槽位(z,typeOrder=0) + 笔触/文字/便利贴/贴纸(typeOrder=1)] → 水印(由调用方后处理)
 *
 * 调用方负责创建 canvas、设置尺寸、scale(drawScale)、编码输出。
 *
 * @param ctx          已执行 ctx.scale(drawScale, drawScale) 的 2D 上下文
 * @param page         页面数据
 * @param photos       全部照片列表（用于查找 placement 对应的照片元数据）
 * @param logicalW     页面逻辑宽度（mm × MM_TO_PX）
 * @param logicalH     页面逻辑高度
 * @param photoImages  已预加载的照片图像映射（HTMLImageElement 或 ImageBitmap）
 * @param stickerImages 已预加载的贴纸图像映射（key 为 blobId `sticker-blob-{stickerId}`）
 * @returns 实际绘制的照片数量（用于调用方校验是否完整渲染，避免残缺 dataURL 被缓存）
 */
export function drawPageToCanvas(
  ctx: AnyCtx2D,
  page: AlbumPage,
  photos: Photo[],
  logicalW: number,
  logicalH: number,
  photoImages?: Map<string, HTMLImageElement | ImageBitmap>,
  stickerImages?: Map<string, HTMLImageElement | ImageBitmap>,
  margin?: { left: number; right: number; top: number; bottom: number },
  /** P1-fix: Worker 路径传入的内容感知信息映射（photoId → contentInfo）。
   *  主线程不传时 calcPhotoRenderParams 自己查全局缓存。
   *  Worker 必须传入，否则 Worker 内全局缓存为空 → 永远居中。 */
  contentInfoMap?: Map<string, PhotoContentInfo>,
  /** 背景图片位图（主线程/Worker 预加载后传入；无则仅画底色） */
  backgroundImageBitmap?: HTMLImageElement | ImageBitmap,
): number {
  // 封面页在缩略图/全屏中只展示封面正面内容（不含书脊）：
  // 封面文字/形状在数据层整体右移了书脊宽（印刷一体，无视觉间隙），槽位经 slotOverrides 也含该偏移。
  // 在此构造"去书脊偏移"的页面副本（文字/形状减 mm 偏移、槽位减 px 偏移；无 slotOverrides 时
  // 槽位用模板默认坐标，本就在 [0,pageW]），使所有元素坐标统一到逻辑宽 logicalW（页面宽）内，
  // 封面正面恰好填满缩略图；书脊 logo 不再绘制。spineWidth 置 0 避免后续逻辑重复加偏移。
  if (isCoverPage(page) && (page.spineWidth ?? 0) > 0) {
    // 封面正面内容在数据层整体右移书脊宽（印刷一体，无视觉间隙），缩略图只显示封面正面（不含书脊）：
    // 整体左移书脊宽，使封面正面填满逻辑宽 logicalW（页面宽）。
    const offsetMm = (page.spineWidth ?? 0);
    const offsetPx = offsetMm * MM_TO_PX;
    page = {
      ...page,
      spineWidth: 0,
      textElements: (page.textElements || []).map((el) => ({ ...el, x: el.x - offsetMm })),
      shapeElements: (page.shapeElements || []).map((sh) => ({ ...sh, x: sh.x - offsetMm })),
      stickerElements: (page.stickerElements || []).map((st) => ({ ...st, x: st.x - offsetMm })),
      brushStrokes: (page.brushStrokes || []).map((s) => ({
        ...s,
        points: s.points.map((v, i) => (i % 2 === 0 ? v - offsetMm : v)),
      })),
      slotOverrides: page.slotOverrides
        ? (Object.fromEntries(
            Object.entries(page.slotOverrides).map(([id, o]) => [id, { ...o, x: o.x - offsetPx }]),
          ) as AlbumPage['slotOverrides'])
        : undefined,
    };
  }

  // ── 页面背景（支持纯色 / CSS linear-gradient / texture- 前缀，与编辑器/导出引擎一致）──
  drawPageBackground(ctx, page.background, logicalW, logicalH);
  // ── 背景图片叠加（若已预加载位图，与画布 PageBackgroundRect 一致：cover/contain）──
  if (backgroundImageBitmap) {
    drawBackgroundImageOn(ctx, backgroundImageBitmap, logicalW, logicalH, (page.backgroundImageFit ?? 'cover') as 'cover' | 'contain');
  }

  // ── 收集照片映射 ──
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  let drawnPhotoCount = 0;

  // ── 槽位圆角 ──（缩略图不支持每角单独圆角，归一化为平均值）
  const slotCornerRadius = normalizeSlotCornerRadius(page.slotCornerRadius);
  const template = resolveTemplate(page);
  const slots = template?.slots ?? [];

  // 收集已填充照片的槽位 ID，绘制背景时跳过
  const filledSlotIds = new Set(
    page.placements.filter((pl) => pl.photoId).map((pl) => pl.slotId),
  );

  // 1. 先按模板定义顺序绘制无照片的槽位背景
  slots.forEach((slotDef, i) => {
    const slotRect = getSlotRect(slotDef.id, page, logicalW, logicalH, margin);
    if (slotRect && !filledSlotIds.has(slotDef.id)) {
      drawTemplateSlot(ctx, slotRect, i, slotCornerRadius);
    }
  });

  // ── 2. 统一图层排序（与 Canvas.tsx globalLayerElements / exportEngine.drawPage 一致） ──
  // typeOrder: z 相同时决定渲染先后，小的渲染在下方（槽位=0，装饰元素=1）
  type RenderItem = { z: number; typeOrder: number; draw: () => void };
  const items: RenderItem[] = [];

  // 2.1 照片槽位（typeOrder=0）
  // slotOrder 优先；未定义时回退到模板 slots 数组顺序（与 Canvas.tsx 一致）
  // 这对 overlay 模板至关重要：slots 数组顺序 = 渲染层级（后者覆盖前者）
  const orderMap = new Map<string, number>();
  const effectiveSlotOrder = page.slotOrder ?? template?.slots.map((s) => s.id) ?? [];
  effectiveSlotOrder.forEach((id, i) => orderMap.set(id, i));
  const photoPlacements = page.placements
    .filter((pl) => pl.photoId)
    .sort((a, b) => {
      const ia = orderMap.has(a.slotId) ? orderMap.get(a.slotId)! : 999;
      const ib = orderMap.has(b.slotId) ? orderMap.get(b.slotId)! : 999;
      return ia - ib;
    });

  for (const placement of photoPlacements) {
    const photo = photoMap.get(placement.photoId!);
    if (!photo) continue;
    const img = photoImages?.get(placement.photoId!) ?? null;
    if (!img) continue;
    const imgW = img instanceof ImageBitmap ? img.width : img.naturalWidth;
    if (imgW <= 0) continue;

    const slot = getSlotRect(placement.slotId, page, logicalW, logicalH, margin);
    if (!slot) continue;
    const params = calcPhotoRenderParams(
      photo, placement, slot.width, slot.height,
      // P1-fix: Worker 路径从 contentInfoMap 取，主线程不传则返回 undefined（calcPhotoRenderParams 自己查全局缓存）
      contentInfoMap ? contentInfoMap.get(photo.id) ?? null : undefined,
    );
    if (!params) continue;

    const z = getSlotZIndex(page, placement.slotId);
    items.push({
      z,
      typeOrder: 0,
      draw: () => {
        drawPlacement(ctx, placement, img, slot, params, slotCornerRadius);
        drawnPhotoCount++;
      },
    });
  }

  // 2.2 笔触（typeOrder=1）
  (page.brushStrokes || []).forEach((stroke: BrushStroke) => {
    items.push({
      z: stroke.zIndex || 0,
      typeOrder: 1,
      draw: () => drawBrushStroke(ctx, stroke),
    });
  });

  // 2.3 文字元素（typeOrder=1）
  (page.textElements || []).forEach((te: PageTextElement) => {
    items.push({
      z: te.zIndex || 0,
      typeOrder: 1,
      draw: () => drawTextElement(ctx, te),
    });
  });

  // 2.4 便利贴（typeOrder=1）
  (page.stickyNotes || []).forEach((sn: StickyNote) => {
    items.push({
      z: sn.zIndex || 0,
      typeOrder: 1,
      draw: () => drawStickyNote(ctx, sn),
    });
  });

  // 2.5 贴纸（typeOrder=1）
  (page.stickerElements || []).forEach((st: StickerElement) => {
    const blobId = st.stickerId ? `sticker-blob-${st.stickerId}` : null;
    const img = blobId ? stickerImages?.get(blobId) : null;
    if (!img) return; // 贴纸图片未加载，跳过
    items.push({
      z: st.zIndex || 0,
      typeOrder: 1,
      draw: () => drawSticker(ctx, st, img),
    });
  });

  // 2.5b 形状（typeOrder=1）
  (page.shapeElements || []).forEach((sh: ShapeElement) => {
    items.push({
      z: sh.zIndex || 0,
      typeOrder: 1,
      draw: () => drawShape(ctx, sh),
    });
  });

  // 排序：先按 z 升序，z 相同时 typeOrder 小的（槽位）排前
  items.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.typeOrder - b.typeOrder;
  });

  // 页面边界裁剪：确保所有元素（含阴影）不超出页面范围，与编辑器 Stage 裁剪一致
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, logicalW, logicalH);
  ctx.clip();

  for (const item of items) {
    item.draw();
  }

  ctx.restore();

  return drawnPhotoCount;
}

/* ══════════════════════════ 各元素类型独立绘制函数 ══════════════════════════ */

/** 绘制照片槽位（含圆角裁剪、滤镜、翻转、旋转） */
function drawPlacement(
  ctx: AnyCtx2D,
  placement: PhotoPlacement,
  img: HTMLImageElement | ImageBitmap,
  slot: SlotRect,
  params: ReturnType<typeof calcPhotoRenderParams>,
  slotCornerRadius: number,
): void {
  if (!params) return;
  // 用户可配置阴影：仅 placement.shadow=true 时绘制（与编辑器/导出引擎一致）
  if (placement.shadow) {
    ctx.save();
    const sBlur = Math.max(4, Math.min(slot.width, slot.height) * 0.04);
    const sOffY = Math.max(2, Math.min(slot.width, slot.height) * 0.02);
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = sBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = sOffY;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    const ctxRR0 = ctx as Ctx2DWithRoundRect;
    if (slotCornerRadius > 0 && ctxRR0.roundRect) {
      ctxRR0.roundRect(slot.x, slot.y, slot.width, slot.height, slotCornerRadius);
    } else {
      ctx.rect(slot.x, slot.y, slot.width, slot.height);
    }
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  const ctxRR = ctx as Ctx2DWithRoundRect;
  if (slotCornerRadius > 0 && ctxRR.roundRect) {
    ctxRR.roundRect(slot.x, slot.y, slot.width, slot.height, slotCornerRadius);
  } else {
    ctx.rect(slot.x, slot.y, slot.width, slot.height);
  }
  ctx.clip();

  if (placement.filter === '黑白') {
    ctx.filter = 'grayscale(1)';
  }

  if (Math.abs(params.rotation) > 0.01) {
    const cx = slot.x + params.drawX;
    const cy = slot.y + params.drawY;
    ctx.translate(cx, cy);
    ctx.rotate((params.rotation * Math.PI) / 180);
    ctx.drawImage(img, -params.offsetX, -params.offsetY, params.drawW, params.drawH);
  } else {
    ctx.drawImage(img, slot.x + params.drawX, slot.y + params.drawY, params.drawW, params.drawH);
  }

  ctx.filter = 'none';
  ctx.restore();
}

/** 绘制画笔笔迹（与 exportEngine.drawBrushStroke 一致） */
function drawBrushStroke(ctx: AnyCtx2D, stroke: BrushStroke): void {
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.strokeWidth;
  ctx.globalAlpha = stroke.opacity;
  ctx.lineCap = stroke.lineCap;
  ctx.lineJoin = 'round';
  // 荧光笔使用 multiply 混合模式（与编辑器 Canvas.tsx 一致）
  ctx.globalCompositeOperation = stroke.brushType === 'highlighter' ? 'multiply' : 'source-over';

  const pts = stroke.points;
  if (pts.length < 4) {
    ctx.globalAlpha = 1;
    return;
  }

  ctx.moveTo(pts[0] * MM_TO_PX, pts[1] * MM_TO_PX);
  for (let i = 2; i < pts.length; i += 2) {
    if (i + 2 < pts.length && stroke.tension > 0) {
      const xc = (pts[i] * MM_TO_PX + pts[i + 2] * MM_TO_PX) / 2;
      const yc = (pts[i + 1] * MM_TO_PX + pts[i + 3] * MM_TO_PX) / 2;
      ctx.quadraticCurveTo(pts[i] * MM_TO_PX, pts[i + 1] * MM_TO_PX, xc, yc);
    } else {
      ctx.lineTo(pts[i] * MM_TO_PX, pts[i + 1] * MM_TO_PX);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** 绘制文字元素（与 exportEngine.drawTextElement 一致：含竖排文字支持） */
function drawTextElement(ctx: AnyCtx2D, te: PageTextElement): void {
  const tx = te.x * MM_TO_PX;
  const ty = te.y * MM_TO_PX;
  const tw = te.width * MM_TO_PX;
  const th = (te.height ?? 0) * MM_TO_PX;
  const fs = te.fontSize;
  const pad = 4;

  // 空文本处理（与 TextElementNode.tsx 一致：灰色斜体占位文字）
  const hasText = te.text && te.text.length > 0;
  let fontStyle = '';
  if (te.bold) fontStyle += 'bold ';
  if (te.italic || !hasText) fontStyle += 'italic ';
  ctx.font = `${fontStyle}${fs}px ${te.fontFamily || 'sans-serif'}`;
  ctx.textBaseline = 'top';
  // 渐变填充（与画布 TextElementNode / exportEngine 一致：线性=左上→右下，径向=中心向外）
  let fillValue: string | CanvasGradient = hasText ? (te.color || '#333') : '#999';
  if (hasText && te.gradient && te.gradient.length >= 2) {
    if (te.gradientType === 'radial') {
      const cx = tx + tw / 2;
      const cy = ty + th / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(tw, th) / 2);
      for (const s of te.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      fillValue = grad;
    } else {
      const { startX, startY, endX, endY } = linearGradientEndpoints(tw, th, te.gradientAngle ?? 45);
      const cxx = tx + tw / 2;
      const cyy = ty + th / 2;
      const grad = ctx.createLinearGradient(cxx + startX, cyy + startY, cxx + endX, cyy + endY);
      for (const s of te.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      fillValue = grad;
    }
  }
  ctx.fillStyle = fillValue;

  // 竖排（春联）模式：isVertical 标志为 true 时逐字竖排，从右到左
  if (te.isVertical) {
    ctx.textAlign = 'left';
    const text = te.text || '';
    const stepY = fs + (te.letterSpacing ?? 0);
    const stepX = fs + ((te.lineHeight ?? 1.2) - 1) * fs;
    const top = ty + pad;
    const bottom = ty + th - pad;
    let colX = tx + tw - fs - pad; // 从最右侧开始
    let cy = top;
    const nodes: { ch: string; x: number; y: number }[] = [];
    for (const ch of text) {
      if (ch === '\n') {
        colX -= stepX;
        cy = top;
        continue;
      }
      if (cy + fs > bottom) {
        colX -= stepX;
        cy = top;
      }
      nodes.push({ ch, x: colX, y: cy });
      cy += stepY;
    }
    // 对齐：根据 align 水平定位整块列（左/居/右对齐）
    if (nodes.length > 0) {
      const xs = nodes.map((n) => n.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs) + fs;
      let shift: number;
      if (te.align === 'left') shift = tx + pad - minX;
      else if (te.align === 'right') shift = tx + tw - fs - pad - maxX;
      else shift = tx + tw / 2 - (minX + maxX) / 2; // 居中
      for (const n of nodes) n.x += shift;
      // 垂直对齐：竖排整块内容在框内按 verticalAlign（top/center/bottom）定位
      const ys = nodes.map((n) => n.y);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys) + fs;
      const contentH = th - pad * 2;
      const blockH = maxY - minY;
      const valign = te.verticalAlign ?? 'center';
      let vshift = 0;
      if (valign === 'center') vshift = (contentH - blockH) / 2;
      else if (valign === 'bottom') vshift = contentH - blockH;
      if (vshift > 0) for (const n of nodes) n.y += vshift;
    }
    for (const n of nodes) ctx.fillText(n.ch, n.x, n.y);
    return;
  }

  // 横排模式（断行与编辑器 DOM 文字层 TextDomNode 同源：CJK 逐字可断、Latin 按空格断行，
  // 测量计入字距；内容宽 = 盒宽 − 左右内边距 − 末尾一字距，与 fitTextSize 同口径）
  ctx.textAlign = (te.align as CanvasTextAlign) || 'left';
  const hLs = te.letterSpacing ?? 0;
  ctx.letterSpacing = `${hLs}px`;
  const lines = wrapTextLines(ctx, te.text || '', tw - pad * 2 - hLs, hLs);
  const lineHeight = fs * (te.lineHeight ?? 1.2);
  // 垂直对齐：顶/居中/底（与编辑器 TextElementNode / exportEngine 一致，默认居中）
  const totalH = lines.length * lineHeight;
  const verticalAlign = te.verticalAlign ?? 'center';
  let y = ty + pad;
  if (verticalAlign === 'center') y += Math.max(0, (th - pad * 2 - totalH) / 2);
  else if (verticalAlign === 'bottom') y = Math.max(ty + pad, ty + th - pad - totalH);
  for (const line of lines) {
    let x = tx + pad;
    if (te.align === 'center') x = tx + tw / 2;
    else if (te.align === 'right') x = tx + tw - pad;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  ctx.letterSpacing = '0px';
}

/** 绘制便利贴（按 style 字段渲染，与 StickyNoteNode.tsx / exportEngine.drawStickyNote 一致） */
function drawStickyNote(ctx: AnyCtx2D, sn: StickyNote): void {
  const sx = sn.x * MM_TO_PX;
  const sy = sn.y * MM_TO_PX;
  // 与 StickyNoteNode.tsx 一致的 Math.max 最小尺寸限制
  const sw = Math.max(sn.width * MM_TO_PX, 40);
  const sh = Math.max(sn.height * MM_TO_PX, 40);
  const fs = sn.fontSize;
  const style = sn.style || 'rounded';

  // 与 StickyNoteNode.tsx 一致的圆角/阴影参数
  const cornerRadius = style === 'square' ? 2
    : style === 'rounded' ? 8
    : 6;
  const shadowBlur = style === 'shadow' ? 12 : 4;
  const shadowOffsetY = style === 'shadow' ? 6 : 2;
  const shadowOpacity = style === 'shadow' ? 0.25 : 0.15;

  ctx.save();
  // 完整复刻 Konva Group transform: T(x,y) * R(θ) * T(-offsetX, -offsetY)
  // 三段 translate 确保旋转中心与编辑器完全一致（旋转时也不会偏移）
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.rotate((sn.rotation * Math.PI) / 180);
  ctx.translate(-sw / 2, -sh / 2);

  // 背景矩形
  ctx.fillStyle = sn.color;
  ctx.shadowColor = `rgba(0,0,0,${shadowOpacity})`;
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowOffsetY;
  roundRectPath(ctx, -sw / 2, -sh / 2, sw, sh, cornerRadius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 边框（与 StickyNoteNode.tsx 一致：非 hover/selected 态的浅边框）
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  roundRectPath(ctx, -sw / 2, -sh / 2, sw, sh, cornerRadius);
  ctx.stroke();

  // tape 样式：绘制胶带装饰（与 StickyNoteNode.tsx 一致）
  if (style === 'tape') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    ctx.translate(-sw / 4, -sh / 2 - 4);
    ctx.rotate((-2 * Math.PI) / 180);
    roundRectPath(ctx, 0, 0, sw / 2, 12, 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 文字（内边距 6px，与 StickyNoteNode.tsx 一致）
  const pad = 6;
  const textWrapW = sw - pad * 2;
  const textH = sh - pad * 2;
  // 空文本处理（与 StickyNoteNode.tsx 一致：灰色斜体占位文字）
  const hasText = sn.text && sn.text.length > 0;
  ctx.fillStyle = hasText ? '#333' : '#999';
  ctx.font = `${hasText ? 'normal' : 'italic'} ${fs}px ${sn.fontFamily || 'sans-serif'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const displayText = hasText ? sn.text : '';
  const lines = wrapText(ctx, displayText, textWrapW);
  const lineHeight = fs * 1.2;
  let y = -sh / 2 + pad;
  for (const line of lines) {
    // 高度限制：超出便利贴底部的文字不绘制（与 Konva Text height + ellipsis 行为一致）
    if (y + fs > -sh / 2 + pad + textH) break;
    ctx.fillText(line, -sw / 2 + pad, y);
    y += lineHeight;
  }
  ctx.restore();
}

/** 绘制贴纸元素（与 StickerNode.tsx / exportEngine.drawSticker 一致） */
function drawSticker(
  ctx: AnyCtx2D,
  st: StickerElement,
  img: HTMLImageElement | ImageBitmap,
): void {
  const px = st.x * MM_TO_PX;
  const py = st.y * MM_TO_PX;
  const pw = Math.max(st.width * MM_TO_PX, 20);
  const ph = Math.max(st.height * MM_TO_PX, 20);

  ctx.save();
  // 完整复刻 Konva Group transform: T(x,y) * R(θ)
  // Group: x=px, y=py, rotation=θ（无 offset，旋转中心 = Group 原点 = 图片中心）
  // 旋转时图片中心保持不变，与编辑器 StickerNode.tsx 完全一致
  ctx.translate(px, py);
  ctx.rotate((st.rotation * Math.PI) / 180);

  // 翻转
  const scaleX = st.flipH ? -1 : 1;
  const scaleY = st.flipV ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // 阴影（与 StickerNode.tsx 默认值一致，opacity=0.2）
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

/** 绘制形状元素（复刻 ShapeNode.tsx 的 Konva transform 与最小尺寸下限，逻辑与 exportEngine.drawShape 一致） */
function drawShape(ctx: AnyCtx2D, sh: ShapeElement): void {
  const px = sh.x * MM_TO_PX;
  const py = sh.y * MM_TO_PX;
  // 最小尺寸下限与编辑器 ShapeNode 同源（MIN_SHAPE_SIZE_MM），确保小尺寸形状在缩略图与编辑模式一致
  const pw = Math.max(sh.width * MM_TO_PX, MIN_SHAPE_SIZE_MM * MM_TO_PX);
  const ph = Math.max(sh.height * MM_TO_PX, MIN_SHAPE_SIZE_MM * MM_TO_PX);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((sh.rotation * Math.PI) / 180);
  ctx.globalAlpha = typeof sh.opacity === 'number' ? sh.opacity : 1;

  const lineWidth = Math.max(MIN_STROKE_WIDTH, sh.strokeWidth || 0);
  ctx.lineWidth = lineWidth;
  const halfW = pw / 2;
  const halfH = ph / 2;
  // 渐变填充（与画布 ShapeGlyph / exportEngine 一致：线性=左上→右下，径向=中心向外）
  const hasFill = !!(sh.fill || (sh.gradient && sh.gradient.length >= 2));
  if (sh.gradient && sh.gradient.length >= 2) {
    if (sh.gradientType === 'radial') {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(pw, ph) / 2);
      for (const s of sh.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      ctx.fillStyle = grad;
    } else {
      const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, sh.gradientAngle ?? 45);
      const grad = ctx.createLinearGradient(startX, startY, endX, endY);
      for (const s of sh.gradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
      ctx.fillStyle = grad;
    }
  } else if (sh.fill) {
    ctx.fillStyle = sh.fill;
  }
  if (sh.strokeGradient && sh.strokeGradient.length >= 2) {
    const { startX, startY, endX, endY } = linearGradientEndpoints(pw, ph, sh.strokeGradientAngle ?? 45);
    const grad = ctx.createLinearGradient(startX, startY, endX, endY);
    for (const s of sh.strokeGradient) grad.addColorStop(s.offset, s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color);
    ctx.strokeStyle = grad;
  } else if (sh.stroke) {
    ctx.strokeStyle = sh.stroke;
  }

  const beginShape = () => {
    if (hasFill) ctx.fill();
    if ((sh.stroke || (sh.strokeGradient && sh.strokeGradient.length >= 2)) && lineWidth > 0) ctx.stroke();
  };

  switch (sh.type) {
    case 'circle':
    case 'ellipse':
      // 圆形/椭圆都填满 pw×ph 盒子（与 ShapeGlyph / exportEngine 一致）
      ctx.beginPath(); ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2); beginShape(); break;
    case 'triangle':
    case 'diamond':
    case 'pentagon':
    case 'hexagon':
    case 'star':
    case 'parallelogram':
    case 'trapezoid':
    case 'cutCornerRect':
    case 'cutDiagonalRect':
      // 多边形/星形/切角矩形：用共享顶点填满 pw×ph（最外边缘贴合控制盒）
      ctx.beginPath();
      {
        const pts = getShapePolygonPoints(sh.type, pw, ph, sh.cornerCut);
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath(); beginShape(); break;
    case 'rectangle':
    case 'roundedRect':
    case 'singleRoundRect':
    case 'diagonalRoundRect':
      // 矩形类：每角圆角半径由共享 getRectCornerRadii 计算（支持 cornerRadius 调节）
      roundRectPerCorner(ctx, -halfW, -halfH, pw, ph, getRectCornerRadii(sh.type, pw, ph, sh.cornerRadius) as [number, number, number, number]);
      beginShape(); break;
    default:
      ctx.beginPath(); ctx.rect(-halfW, -halfH, pw, ph); beginShape(); break;
    case 'arrow': {
      const tip = halfW, tail = -halfW;
      const headLen = Math.min(24, pw / 3);
      const headW = Math.min(18, ph / 2);
      ctx.beginPath();
      ctx.moveTo(tail, 0); ctx.lineTo(tip - headLen, 0);
      ctx.lineTo(tip - headLen, -headW); ctx.lineTo(tip, 0); ctx.lineTo(tip - headLen, headW);
      ctx.closePath(); beginShape(); break;
    }
    case 'line': {
      ctx.beginPath(); ctx.moveTo(-halfW, 0); ctx.lineTo(halfW, 0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = sh.stroke || sh.fill || '#6C63FF';
      ctx.lineWidth = Math.max(MIN_STROKE_WIDTH, sh.strokeWidth || 2);
      ctx.stroke(); break;
    }
  }

  ctx.restore();
}

/* ══════════════════════════ 工具函数 ══════════════════════════ */

/** 绘制圆角矩形路径（每角独立半径，兼容不支持原生 roundRect 的 WebView2）。radii 顺序：左上、右上、右下、左下 */
function roundRectPerCorner(
  ctx: AnyCtx2D,
  x: number, y: number, w: number, h: number,
  radii: [number, number, number, number],
): void {
  const [tl, tr, br, bl] = radii;
  const maxR = Math.min(w / 2, h / 2);
  const r = (v: number) => Math.max(0, Math.min(v, maxR));
  ctx.beginPath();
  ctx.moveTo(x + r(tl), y);
  ctx.lineTo(x + w - r(tr), y);
  ctx.arcTo(x + w, y, x + w, y + r(tr), r(tr));
  ctx.lineTo(x + w, y + h - r(br));
  ctx.arcTo(x + w, y + h, x + w - r(br), y + h, r(br));
  ctx.lineTo(x + r(bl), y + h);
  ctx.arcTo(x, y + h, x, y + h - r(bl), r(bl));
  ctx.lineTo(x, y + r(tl));
  ctx.arcTo(x, y, x + r(tl), y, r(tl));
  ctx.closePath();
}

/** 简单文字换行 */
function wrapText(ctx: AnyCtx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue; }
    let current = '';
    for (const char of para) {
      const test = current + char;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** 绘制圆角矩形路径（兼容旧 WebView2） */
function roundRectPath(ctx: AnyCtx2D, x: number, y: number, w: number, h: number, r: number): void {
  const ctxRR = ctx as Ctx2DWithRoundRect;
  if (ctxRR.roundRect) {
    ctxRR.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/** 绘制模板风格槽位背景（与 TemplatePanel 的 TemplateMiniPreview 保持一致） */
function drawTemplateSlot(
  ctx: AnyCtx2D,
  slot: SlotRect,
  index: number,
  cornerRadius: number,
): void {
  ctx.save();

  const [startColor, endColor] = SLOT_CANVAS_PALETTE[index % SLOT_CANVAS_PALETTE.length];

  const gradient = ctx.createLinearGradient(
    slot.x,
    slot.y,
    slot.x + slot.width,
    slot.y + slot.height,
  );
  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = SLOT_BORDER_COLORS[index % SLOT_BORDER_COLORS.length];
  ctx.lineWidth = 1;

  if (cornerRadius > 0) {
    const ctxRR = ctx as Ctx2DWithRoundRect;
    if (ctxRR.roundRect) {
      ctx.beginPath();
      ctxRR.roundRect(slot.x, slot.y, slot.width, slot.height, cornerRadius);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
      ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
    }
  } else {
    // cornerRadius <= 0 时也要绘制槽位背景（直角矩形）
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
  }

  ctx.restore();
}
