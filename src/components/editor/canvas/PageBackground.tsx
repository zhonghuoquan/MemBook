/**
 * 页面背景渲染组件：支持纯色 / CSS 渐变 / 纹理（图案填充）/ 背景图片
 * 从 Canvas.tsx 提取，无共享状态依赖
 */
import { Rect, Group, Image } from 'react-konva';
import { useEffect, useMemo, useState } from 'react';
import { parseGradientColors, getTextureBaseColor, createTextureCanvas } from './constants';

/** 加载背景图片（dataURL/blobURL/http），返回 HTMLImageElement */
function useLoadedImage(src?: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => { if (!cancelled) setImg(image); };
    image.onerror = () => { if (!cancelled) setImg(null); };
    image.src = src;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [src]);
  return img;
}

/** 页面背景渲染组件：底色（纯色/渐变/纹理）+ 可选背景图片叠加 */
export function PageBackgroundRect({
  bg, backgroundImage, backgroundImageFit = 'cover', w, h, x = 0,
}: {
  bg?: string;
  backgroundImage?: string;
  backgroundImageFit?: 'cover' | 'contain';
  w: number;
  h: number;
  x?: number;
}) {
  // 纹理 Canvas tile（仅在纹理背景时生成，useMemo 保证 bg 不变时缓存稳定）
  const textureCanvas = useMemo(() => {
    if (bg && bg.startsWith('texture-')) return createTextureCanvas(bg);
    return null;
  }, [bg]);

  const bgImageEl = useLoadedImage(backgroundImage);

  // 底色图层
  const baseLayer = (() => {
    if (!bg) {
      return <Rect x={x} y={0} width={w} height={h} fill="#FFFFFF" shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
    }
    // 纯色（以 # 开头的短字符串）
    if (bg.startsWith('#') || (bg.length <= 7 && !bg.includes('(') && !bg.startsWith('texture'))) {
      return <Rect x={x} y={0} width={w} height={h} fill={bg} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
    }
    // 渐变：解析 CSS linear-gradient 为 Konva LinearGradient
    if (bg.startsWith('linear-gradient')) {
      const colorStops = parseGradientColors(bg);
      if (colorStops.length >= 2) {
        return (
          <Rect x={x} y={0} width={w} height={h} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: w, y: h }}
            fillLinearGradientColorStops={colorStops}
          />
        );
      }
    }
    // 纹理：底色 + Canvas 图案填充（fillPatternImage + repeat）
    if (bg.startsWith('texture-') && textureCanvas) {
      const textureBase = getTextureBaseColor(bg);
      return (
        <Rect
          x={x} y={0} width={w} height={h}
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
      return <Rect x={x} y={0} width={w} height={h} fill={getTextureBaseColor(bg)} shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
    }
    // 回退：纯白
    return <Rect x={x} y={0} width={w} height={h} fill="#FFFFFF" shadowColor="rgba(0,0,0,0.15)" shadowBlur={16} shadowOffsetY={6} listening={false} />;
  })();

  // 背景图片叠加层
  const imageLayer = (() => {
    if (!bgImageEl || !backgroundImage) return null;
    const imgW = bgImageEl.width;
    const imgH = bgImageEl.height;
    if (backgroundImageFit === 'contain') {
      // 完整缩放居中
      const scale = Math.min(w / imgW, h / imgH);
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = x + (w - dw) / 2;
      const dy = (h - dh) / 2;
      return <Image image={bgImageEl} x={dx} y={dy} width={dw} height={dh} listening={false} />;
    }
    // cover：铺满裁剪（保持宽高比）
    const scale = Math.max(w / imgW, h / imgH);
    const cropW = w / scale;
    const cropH = h / scale;
    const sx = (imgW - cropW) / 2;
    const sy = (imgH - cropH) / 2;
    return <Image image={bgImageEl} x={x} y={0} width={w} height={h} crop={{ x: sx, y: sy, width: cropW, height: cropH }} listening={false} />;
  })();

  return (
    <Group>
      {baseLayer}
      {imageLayer}
    </Group>
  );
}