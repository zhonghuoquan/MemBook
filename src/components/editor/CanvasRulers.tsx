/**
 * CanvasRulers —— PS 风格标尺（顶部横尺 + 左侧竖尺 + 角块）
 *
 * 固定在画布滚动容器视口边缘（不随内容滚动），刻度按 canvasZoom 自适应：
 *   - 主刻度间距保持约 60px 屏幕宽（从 10/20/50/100/200/500/1000/2000 中选）；
 *   - 页面逻辑 0 点 = 内容 Group 原点（groupOX/groupOY）减去滚动偏移；
 *   - 页面内容范围在标尺上高亮（浅紫底 + 边界线）。
 *
 * 交互：在横尺/竖尺上按下并拖动 → 拖出参考线（onGuideDrag 实时回调页面逻辑坐标，
 * onGuideEnd 结束）。标尺条 pointer-events-auto，其余区域穿透到画布。
 */
import { useCallback, useEffect, useRef } from 'react';
import { MM_TO_PX } from './canvas/constants';

export const RULER_SIZE = 24;

/** 指针坐标 → 页面逻辑像素（未钳制，由调用方决定是否 clamp） */
function clientToPage(
  clientX: number,
  clientY: number,
  el: HTMLElement,
  groupOX: number,
  groupOY: number,
  zoom: number,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: (clientX - rect.left + el.scrollLeft - groupOX) / zoom,
    y: (clientY - rect.top + el.scrollTop - groupOY) / zoom,
  };
}

interface RulerDrawOpts {
  horizontal: boolean;
  origin: number;        // 页面逻辑 0 在滚动内容中的偏移（groupOX / groupOY）
  zoom: number;
  scroll: number;        // 滚动偏移（scrollLeft / scrollTop）
  size: number;          // 标尺长度（视口宽 / 视口高，CSS px）
  thickness: number;     // 标尺厚度 RULER_SIZE
  pageLen: number;       // 页面逻辑长度（mm）
  mmToPx: number;        // 毫米 → 逻辑像素换算（画布 1mm = MM_TO_PX 逻辑px）
}

/** 绘制一组刻度（主/中/次刻度 + 主刻度数字标签）。
 *  单位按 mm：刻度间距从 1/2/5/10/20/50/100/200mm 中自适应选择，
 *  使主刻度在屏幕上的间距保持约 60px。数字靠外侧、刻度线靠内侧，避免互相重叠。 */
function drawTicks(ctx: CanvasRenderingContext2D, o: RulerDrawOpts) {
  const MM_MAJORS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  let major = MM_MAJORS[0];
  for (const m of MM_MAJORS) if (m * o.mmToPx * o.zoom >= 60) { major = m; break; }
  const mid = major / 2;
  const minor = major / 10;
  const scale = o.mmToPx * o.zoom;

  // mm → 标尺屏幕 px（含滚动偏移）
  const px = (p: number) => o.origin + p * scale - o.scroll;
  // 可见范围（外扩一个主刻度，避免边界漏刻）
  const firstP = Math.max(0, Math.floor(((-o.origin + o.scroll) / scale - major) / minor) * minor);
  const lastP = Math.min(o.pageLen, Math.ceil(((o.size - o.origin + o.scroll) / scale + major) / minor) * minor);

  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let lastLabelEnd = -Infinity;

  for (let p = firstP; p <= lastP; p += minor) {
    const v = px(p);
    if (v < -6 || v > o.size + 6) continue;
    const rounded = Math.round(p);
    const isMajor = Math.abs(p % major) < 1e-6;
    const isMid = !isMajor && Math.abs(p % mid) < 1e-6;

    if (o.horizontal) {
      // 主刻度 24→13 / 中刻度 24→16 / 次刻度 24→19（数字区 2~11 与刻度区分开）
      ctx.strokeStyle = isMajor ? '#475569' : '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(v, o.thickness);
      ctx.lineTo(v, isMajor ? 13 : isMid ? 16 : 19);
      ctx.stroke();
      if (isMajor) {
        const label = String(rounded);
        const w = ctx.measureText(label).width;
        if (v > 1 && v + w < o.size - 2 && v - lastLabelEnd > 8) {
          ctx.fillStyle = '#64748b';
          ctx.fillText(label, v + 3, 2);
          lastLabelEnd = v + w;
        }
      }
    } else {
      ctx.strokeStyle = isMajor ? '#475569' : '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o.thickness, v);
      ctx.lineTo(isMajor ? 13 : isMid ? 16 : 19, v);
      ctx.stroke();
      if (isMajor) {
        const label = String(rounded);
        if (v > 6 && v < o.size - 4) {
          ctx.save();
          ctx.translate(3, v + 0.5);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = '#64748b';
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }
  }
}

export interface CanvasRulersProps {
  /** 画布滚动容器（data-canvas-container） */
  scrollEl: HTMLElement | null;
  groupOX: number;
  groupOY: number;
  zoom: number;
  canvasW: number; // 页面逻辑像素宽
  canvasH: number; // 页面逻辑像素高
  /** 从标尺拖出参考线：拖动中实时回调（页面逻辑像素，已钳制到页面内） */
  onGuideDrag?: (orientation: 'horizontal' | 'vertical', positionPx: number) => void;
  /** 松开结束拖出参考线 */
  onGuideEnd?: () => void;
}

export function CanvasRulers({ scrollEl, groupOX, groupOY, zoom, canvasW, canvasH, onGuideDrag, onGuideEnd }: CanvasRulersProps) {
  const hRef = useRef<HTMLCanvasElement>(null);
  const vRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<{ orientation: 'horizontal' | 'vertical'; onGuideDrag?: typeof onGuideDrag; onGuideEnd?: typeof onGuideEnd } | null>(null);

  const draw = useCallback(() => {
    if (!scrollEl) return;
    const dpr = window.devicePixelRatio || 1;
    const scrollLeft = scrollEl.scrollLeft;
    const scrollTop = scrollEl.scrollTop;

    const h = hRef.current;
    if (h) {
      const w = h.clientWidth || scrollEl.clientWidth - RULER_SIZE;
      h.width = Math.max(1, Math.round(w * dpr));
      h.height = Math.max(1, Math.round(RULER_SIZE * dpr));
      const ctx = h.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, RULER_SIZE);
        // 页面内容范围高亮 + 边界
        const p0 = groupOX - scrollLeft;
        const p1 = groupOX + canvasW * zoom - scrollLeft;
        ctx.fillStyle = 'rgba(108,99,255,0.07)';
        ctx.fillRect(p0, 0, Math.max(0, p1 - p0), RULER_SIZE);
        ctx.strokeStyle = 'rgba(108,99,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p0, 0); ctx.lineTo(p0, RULER_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p1, 0); ctx.lineTo(p1, RULER_SIZE); ctx.stroke();
        drawTicks(ctx, { horizontal: true, origin: groupOX, zoom, scroll: scrollLeft, size: w, thickness: RULER_SIZE, pageLen: canvasW / MM_TO_PX, mmToPx: MM_TO_PX });
      }
    }

    const v = vRef.current;
    if (v) {
      const hh = v.clientHeight || scrollEl.clientHeight - RULER_SIZE;
      v.width = Math.max(1, Math.round(RULER_SIZE * dpr));
      v.height = Math.max(1, Math.round(hh * dpr));
      const ctx = v.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, RULER_SIZE, hh);
        const p0 = groupOY - scrollTop;
        const p1 = groupOY + canvasH * zoom - scrollTop;
        ctx.fillStyle = 'rgba(108,99,255,0.07)';
        ctx.fillRect(0, p0, RULER_SIZE, Math.max(0, p1 - p0));
        ctx.strokeStyle = 'rgba(108,99,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, p0); ctx.lineTo(RULER_SIZE, p0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p1); ctx.lineTo(RULER_SIZE, p1); ctx.stroke();
        drawTicks(ctx, { horizontal: false, origin: groupOY, zoom, scroll: scrollTop, size: hh, thickness: RULER_SIZE, pageLen: canvasH / MM_TO_PX, mmToPx: MM_TO_PX });
      }
    }
  }, [scrollEl, groupOX, groupOY, zoom, canvasW, canvasH]);

  // 滚动 / 尺寸变化 / 坐标变化时重绘
  useEffect(() => {
    draw();
    if (!scrollEl) return;
    const onScroll = () => draw();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(draw);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [draw, scrollEl]);

  // 从标尺拖出参考线（横尺 → 水平参考线/横线，位置随 Y；竖尺 → 垂直参考线/竖线，位置随 X）
  const startGuide = (orientation: 'horizontal' | 'vertical') => (e: React.MouseEvent) => {
    if (!scrollEl) return;
    e.preventDefault();
    activeRef.current = { orientation, onGuideDrag, onGuideEnd };
    const move = (ev: MouseEvent) => {
      const a = activeRef.current;
      if (!a || !scrollEl) return;
      const pos = clientToPage(ev.clientX, ev.clientY, scrollEl, groupOX, groupOY, zoom);
      const p = a.orientation === 'vertical'
        ? Math.min(canvasW, Math.max(0, pos.x))
        : Math.min(canvasH, Math.max(0, pos.y));
      a.onGuideDrag?.(a.orientation, p);
    };
    const up = () => {
      const a = activeRef.current;
      activeRef.current = null;
      a?.onGuideEnd?.();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      {/* 顶部横尺 */}
      <div
        className="absolute top-0 left-0 z-20 select-none cursor-crosshair pointer-events-auto bg-white border-b border-r border-[var(--color-border)] overflow-hidden"
        style={{ height: RULER_SIZE, right: 0 }}
        onMouseDown={startGuide('horizontal')}
      >
        <canvas ref={hRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>
      {/* 左侧竖尺 */}
      <div
        className="absolute top-0 left-0 z-20 select-none cursor-crosshair pointer-events-auto bg-white border-b border-r border-[var(--color-border)] overflow-hidden"
        style={{ width: RULER_SIZE, bottom: 0 }}
        onMouseDown={startGuide('vertical')}
      >
        <canvas ref={vRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>
      {/* 左上角块 */}
      <div
        className="absolute top-0 left-0 z-20 pointer-events-none bg-[var(--color-gray-50)] border-r border-b border-[var(--color-border)]"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />
    </>
  );
}
