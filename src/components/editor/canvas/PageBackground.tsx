/**
 * 页面背景渲染组件：支持纯色 / CSS 渐变 / 纹理（图案填充）
 * 从 Canvas.tsx 提取，无共享状态依赖
 */
import { Rect } from 'react-konva';
import { useMemo } from 'react';
import { parseGradientColors, getTextureBaseColor, createTextureCanvas } from './constants';

/** 页面背景渲染组件：支持纯色 / CSS 渐变 / 纹理（Canvas 图案填充） */
export function PageBackgroundRect({ bg, w, h }: { bg?: string; w: number; h: number }) {
  // 纹理 Canvas tile（仅在纹理背景时生成，useMemo 保证 bg 不变时缓存稳定）
  const textureCanvas = useMemo(() => {
    if (bg && bg.startsWith('texture-')) return createTextureCanvas(bg);
    return null;
  }, [bg]);

  if (!bg) {
    return <Rect x={0} y={0} width={w} height={h} fill="#FFFFFF" shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
  }

  // 纯色（以 # 开头的短字符串）
  if (bg.startsWith('#') || (bg.length <= 7 && !bg.includes('(') && !bg.startsWith('texture'))) {
    return <Rect x={0} y={0} width={w} height={h} fill={bg} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
  }

  // 渐变：解析 CSS linear-gradient 为 Konva LinearGradient
  if (bg.startsWith('linear-gradient')) {
    const colorStops = parseGradientColors(bg);
    if (colorStops.length >= 2) {
      return (
        <Rect x={0} y={0} width={w} height={h} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: w, y: h }}
          fillLinearGradientColorStops={colorStops}
        />
      );
    }
  }

  // 纹理：底色 + Canvas 图案填充（fillPatternImage + repeat）
  // Konva fillPatternImage 运行时接受 HTMLCanvasElement，但 TS 类型只声明了 HTMLImageElement，需断言
  if (bg.startsWith('texture-') && textureCanvas) {
    const textureBase = getTextureBaseColor(bg);
    return (
      <Rect
        x={0} y={0} width={w} height={h}
        fill={textureBase}
        fillPatternImage={textureCanvas as unknown as HTMLImageElement}
        fillPatternRepeat="repeat"
        shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6}
        listening={false}
      />
    );
  }

  // 纹理但 Canvas 生成失败：回退到底色
  if (bg.startsWith('texture-')) {
    return <Rect x={0} y={0} width={w} height={h} fill={getTextureBaseColor(bg)} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
  }

  // 回退：纯白
  return <Rect x={0} y={0} width={w} height={h} fill="#FFFFFF" shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
}
