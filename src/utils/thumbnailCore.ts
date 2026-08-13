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
  type SlotRect,
} from './sharedRender';
import {
  resolveTemplate,
  getSlotZIndex,
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

/** 纹理背景的基础色（与画布 getTextureBaseColor 一致） */
function getTextureBaseColor(texture: string): string {
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
    return;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
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
): number {
  // ── 页面背景（支持纯色 / CSS linear-gradient / texture- 前缀，与编辑器/导出引擎一致）──
  drawPageBackground(ctx, page.background, logicalW, logicalH);

  // ── 收集照片映射 ──
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  let drawnPhotoCount = 0;

  // ── 槽位圆角 ──
  const slotCornerRadius = page.slotCornerRadius ?? 5;
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
  ctx.fillStyle = hasText ? (te.color || '#333') : '#999';
  ctx.textBaseline = 'top';

  // 竖排（春联）模式：rotation === -90 时逐字竖排，从右到左
  if (te.rotation === -90) {
    ctx.textAlign = 'left';
    const text = te.text || '';
    const stepY = fs + 2;
    const stepX = fs + 6;
    let cx = tx + tw - fs - pad;
    let cy = ty + pad;
    for (const ch of text) {
      if (ch === '\n') {
        cx -= stepX;
        cy = ty + pad;
        continue;
      }
      if (cy + fs > ty + th - pad) {
        cx -= stepX;
        cy = ty + pad;
      }
      ctx.fillText(ch, cx, cy);
      cy += stepY;
    }
    return;
  }

  // 横排模式
  ctx.textAlign = (te.align as CanvasTextAlign) || 'left';
  const lines = wrapText(ctx, te.text || '', tw - pad * 2);
  const lineHeight = fs * 1.2;
  let y = ty + pad;
  for (const line of lines) {
    let x = tx + pad;
    if (te.align === 'center') x = tx + tw / 2;
    else if (te.align === 'right') x = tx + tw - pad;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
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

/** 绘制形状元素（复刻 ShapeNode.tsx 的 Konva transform，逻辑与 exportEngine.drawShape 一致） */
function drawShape(ctx: AnyCtx2D, sh: ShapeElement): void {
  const px = sh.x * MM_TO_PX;
  const py = sh.y * MM_TO_PX;
  const pw = Math.max(sh.width * MM_TO_PX, 10);
  const ph = Math.max(sh.height * MM_TO_PX, 10);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((sh.rotation * Math.PI) / 180);
  ctx.globalAlpha = typeof sh.opacity === 'number' ? sh.opacity : 1;

  const lineWidth = Math.max(0.5, sh.strokeWidth || 0);
  ctx.lineWidth = lineWidth;
  if (sh.fill) ctx.fillStyle = sh.fill;
  if (sh.stroke) ctx.strokeStyle = sh.stroke;

  const minDim = Math.min(pw, ph);
  const halfW = pw / 2;
  const halfH = ph / 2;

  const beginShape = () => {
    if (sh.fill) ctx.fill();
    if (sh.stroke && lineWidth > 0) ctx.stroke();
  };

  switch (sh.type) {
    case 'circle':
      ctx.beginPath(); ctx.arc(0, 0, minDim / 2, 0, Math.PI * 2); beginShape(); break;
    case 'ellipse':
      ctx.beginPath(); ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2); beginShape(); break;
    case 'triangle': {
      ctx.beginPath(); const r = minDim / 2;
      ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); beginShape(); break;
    }
    case 'diamond': {
      ctx.beginPath(); const r = minDim / 2;
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); beginShape(); break;
    }
    case 'square':
      ctx.beginPath(); ctx.rect(-halfW, -halfW, pw, pw); beginShape(); break;
    case 'rectangle':
    default:
      ctx.beginPath(); ctx.rect(-halfW, -halfH, pw, ph); beginShape(); break;
    case 'pentagon': {
      ctx.beginPath(); const r = minDim / 2;
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); beginShape(); break;
    }
    case 'hexagon': {
      ctx.beginPath(); const r = minDim / 2;
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); beginShape(); break;
    }
    case 'star': {
      ctx.beginPath(); const outer = minDim / 2, inner = minDim / 4;
      for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? outer : inner; const a = -Math.PI / 2 + (i * Math.PI) / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); beginShape(); break;
    }
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
      ctx.lineWidth = Math.max(1, sh.strokeWidth || 2);
      ctx.stroke(); break;
    }
  }

  ctx.restore();
}

/* ══════════════════════════ 工具函数 ══════════════════════════ */

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
