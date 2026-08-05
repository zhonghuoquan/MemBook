/**
 * 页面背景渲染组件：支持纯色 / CSS 渐变 / 纹理
 * 从 Canvas.tsx 提取，无共享状态依赖
 */
import { Rect } from 'react-konva';
import { parseGradientColors, getTextureBaseColor } from './constants';

/** 页面背景渲染组件：支持纯色 / CSS 渐变 / 纹理 */
export function PageBackgroundRect({ bg, w, h }: { bg?: string; w: number; h: number }) {
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

  // 纹理：用 CSS 背景 + 透明覆盖的方式（Konva 不直接支持 CSS 纹理，使用纯色底 + HTML overlay）
  if (bg.startsWith('texture-')) {
    const textureBase = getTextureBaseColor(bg);
    return <Rect x={0} y={0} width={w} height={h} fill={textureBase} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
  }

  // 回退：纯白
  return <Rect x={0} y={0} width={w} height={h} fill="#FFFFFF" shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
}
