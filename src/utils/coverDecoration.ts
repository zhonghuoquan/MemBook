/**
 * MemBook — 封面/封底装饰层绘制（渲染层感知 pageKind）
 * ──────────────────────────────────────────────────────────
 * 目标：兑现设计承诺的"美学落地"——渲染层真正把封面的美画出来，而不仅靠生成器写几个文字元素。
 *
 * 在 exportEngine.drawPage / thumbnailCore.drawPageToCanvas 中，在页面图层之上、
 * 时间水印之前调用 drawCoverDecoration()，对封面/封底叠加：
 *   ① cover-2 全幅底图：在标题文字区下方叠一条半透明线性渐变蒙版（rgba(0,0,0,.35)→transparent），保证压字可读；
 *   ② 所有封面：在主图空白角补一条品牌紫 #6C63FF 装饰线（兑现当初承诺的记忆锚点）。
 *
 * 本模块为纯函数、无 store 依赖，坐标基于页面百分比（0-100），由调用方按实际画布尺寸换算，
 * 因此可同时服务于缩略图（thumbnailCore）、导出引擎（exportEngine）与 Worker。
 */
import type { AlbumPage } from '../types';
import { isCoverPage } from '../types';

/** 品牌点缀色（全页最多 1 个点缀色） */
export const BRAND_ACCENT = '#6C63FF';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * 绘制封面/封底的装饰层。
 * @param ctx      2D 上下文（已处于页面逻辑坐标系的 0,0 起点）
 * @param page     当前页面
 * @param w,h      页面逻辑宽高（px）
 * @param mmToPx   每毫米像素（用于把装饰线条宽等换算为像素；缺省按 w/210 近似）
 */
export function drawCoverDecoration(
  ctx: Ctx2D,
  page: AlbumPage,
  w: number,
  h: number,
  mmToPx = w / 210,
): void {
  if (!isCoverPage(page)) return;

  ctx.save();

  // ── ① 全幅底图 cover-2：标题区下方叠半透明渐变蒙版，保证压字可读 ──
  if (page.templateId === 'cover-2') {
    const maskTop = h * 0.5;      // 从 50% 高度开始
    const maskBottom = h * 0.98;  // 到 98% 高度
    const gradient = ctx.createLinearGradient(0, maskTop, 0, maskBottom);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, maskTop, w, maskBottom - maskTop);
  }

  // ── ② 所有封面：主图空白角补一条品牌紫装饰线（记忆锚点） ──
  // 线条放在页面上部偏左/偏右的留白角，避免压到文字与主图
  const lineTop = h * 0.10;
  const lineLength = Math.min(w * 0.14, 90 * mmToPx);
  const lineThickness = Math.max(2.5, 1.2 * mmToPx);
  ctx.strokeStyle = BRAND_ACCENT;
  ctx.lineWidth = lineThickness;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.55;

  // 全幅底图（cover-2）装饰线放左上角；其余封面放主图对侧留白角（默认右上）
  const onRight = page.templateId !== 'cover-2';
  const startX = onRight ? w - lineLength - w * 0.08 : w * 0.08;
  ctx.beginPath();
  ctx.moveTo(startX, lineTop);
  ctx.lineTo(startX + lineLength, lineTop);
  ctx.stroke();

  ctx.restore();
}
