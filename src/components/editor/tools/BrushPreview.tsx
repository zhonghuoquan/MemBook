import { useEffect, useRef } from 'react';
import type { BrushType } from '../../../types';

/**
 * 画笔实时预览画布
 * 绘制一条示例曲线，实时反映当前笔触类型/粗细/颜色/透明度
 */

interface BrushPreviewProps {
  brushType: BrushType;
  strokeWidth: number;
  color: string;
  opacity: number;
}

const PREVIEW_W = 240;
const PREVIEW_H = 48;

// 示例 S 曲线控制点
const CURVE_POINTS = [
  10, 24,
  40, 8,
  80, 40,
  120, 8,
  160, 40,
  200, 16,
  230, 24,
];

export function BrushPreview({ brushType, strokeWidth, color, opacity }: BrushPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 高清渲染
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PREVIEW_W * dpr;
    canvas.height = PREVIEW_H * dpr;
    canvas.style.width = `${PREVIEW_W}px`;
    canvas.style.height = `${PREVIEW_H}px`;
    ctx.scale(dpr, dpr);

    // 清空
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

    // 混合模式
    ctx.globalCompositeOperation = brushType === 'highlighter' ? 'multiply' : 'source-over';
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = brushType === 'brush' ? strokeWidth * 2.5
      : brushType === 'marker' ? strokeWidth * 1.8
      : brushType === 'highlighter' ? strokeWidth * 4
      : strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 绘制平滑曲线
    ctx.beginPath();
    ctx.moveTo(CURVE_POINTS[0], CURVE_POINTS[1]);
    for (let i = 2; i < CURVE_POINTS.length - 2; i += 2) {
      const xc = (CURVE_POINTS[i] + CURVE_POINTS[i + 2]) / 2;
      const yc = (CURVE_POINTS[i + 1] + CURVE_POINTS[i + 3]) / 2;
      ctx.quadraticCurveTo(CURVE_POINTS[i], CURVE_POINTS[i + 1], xc, yc);
    }
    const last = CURVE_POINTS.length;
    ctx.lineTo(CURVE_POINTS[last - 2], CURVE_POINTS[last - 1]);
    ctx.stroke();
  }, [brushType, strokeWidth, color, opacity]);

  return (
    <div className="rounded-[var(--radius-md)] bg-white border border-[var(--color-border-light)] overflow-hidden flex items-center justify-center">
      <canvas
        ref={canvasRef}
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
        className="block"
      />
    </div>
  );
}
