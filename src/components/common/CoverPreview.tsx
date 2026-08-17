import type { Template, PresetTextElement, PresetShapeElement, GradientStop, ShapeType } from '../../types';
import { toRgba } from '../../constants/colorPalette';
import { getShapePolygonPoints } from '../../utils/shapeGeometry';
import { HardcoverFrame } from './HardcoverFrame';
import coverLandscape from '../../assets/cover-landscape.jpg';

/** 封面预览示意照片：使用一张真实风景照片代入，模拟成品效果 */
const PREVIEW_PHOTO = coverLandscape;

/**
 * CoverPreview —— 封面模板预览画布（共享组件）
 * ─────────────────────────────────────────
 * 展示封面模板设计稿（示意照片 + 预设形状/文字），
 * 硬壳实物效果统一由共享 HardcoverFrame 承载（与主页相册封面卡片效果完全一致）。
 * 模板百分比坐标以封面为基准，铺满全宽。
 */
export function CoverPreview({
  template,
  aspectRatio = '1 / 1',
  variant = 'front',
}: {
  template: Template;
  rounded?: number;
  /** 封面/封底宽高比（如 '210 / 280'），默认方形。用于预览与相册实际尺寸比例一致 */
  aspectRatio?: string;
  /** front=封面（书脊在左）；back=封底（书脊在右，硬壳效果镜像到右侧） */
  variant?: 'front' | 'back';
}) {
  const bg = template.presetBackground || 'var(--color-surface-hover)';
  const shapes = template.presetShapeElements ?? [];
  const texts = template.presetTextElements ?? [];

  const maskShapes = shapes.filter((s) => s.id === 'mask');
  const baseShapes = shapes.filter((s) => s.id !== 'mask');

  return (
    <div className="w-full relative" style={{ aspectRatio }}>
      <HardcoverFrame variant={variant} className="w-full h-full" backgroundColor={bg}>
        {/* 1. 基础形状 */}
        {baseShapes.map((shape) => (
          <ShapePreview key={shape.id} shape={shape} />
        ))}

        {/* 2. 照片槽位 */}
        {template.slots.map((s) => (
          <div
            key={s.id}
            className="absolute overflow-hidden"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: `${s.width}%`, height: `${s.height}%`,
              backgroundImage: `url(${PREVIEW_PHOTO})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: '#B8C0CA',
              borderRadius: slotRadiusCss(template.slotCornerRadius),
              // 照片嵌入深度：内阴影模拟照片在封面内的凹陷
              boxShadow: [
                'inset 0 1px 2px rgba(0,0,0,0.10)',
                'inset 0 -1px 1px rgba(255,255,255,0.15)',
                '0 1px 2px rgba(0,0,0,0.10)',
              ].join(', '),
            }}
          />
        ))}

        {/* 3. 蒙版形状 */}
        {maskShapes.map((shape) => (
          <ShapePreview key={shape.id} shape={shape} />
        ))}

        {/* 4. 文字 */}
        {texts.map((txt) => (
          <TextPreview key={txt.id} txt={txt} />
        ))}
      </HardcoverFrame>
    </div>
  );
}

/** 预览文字等比缩放：封面基准宽 210mm 在画布中以 2px/mm 渲染为 420px，
 * 预览文字用 cqw（1% of 容器宽）随卡片等比缩放，始终与封面保持固定比例，
 * 避免在不同像素宽度的列表（主页/编辑器面板）中文字相对大小不一致。
 */
const PREVIEW_FONT_CQW = 100 / 420;

/**
 * 把业务渐变（角度 0=左→右, 90=上→下）+ 色标转成 CSS linear-gradient。
 * CSS 角度顺时针自顶部起算，转换：CSSdeg = angle + 90。
 */
function presetGradientCss(stops: GradientStop[], angle = 45): string {
  const parts = stops.map((s) => `${toRgba(s.color, s.alpha ?? 1)} ${Math.round(s.offset * 100)}%`);
  return `linear-gradient(${angle + 90}deg, ${parts.join(', ')})`;
}

/** 照片槽位四角圆角 → CSS borderRadius（number=统一，[tl,tr,br,bl]=每角单独，顺时针左上→右上→右下→左下） */
function slotRadiusCss(radius: Template['slotCornerRadius']): string {
  if (Array.isArray(radius)) {
    const [tl, tr, br, bl] = radius;
    return `${tl ?? 4}px ${tr ?? 4}px ${br ?? 4}px ${bl ?? 4}px`;
  }
  return `${radius ?? 4}px`;
}

/** 由共享形状几何（shapeGeometry.getShapePolygonPoints）计算 CSS clip-path，
 * 与画布/导出/缩略图共用同一几何，避免在预览里手工重复定义形状工具代码。
 * 返回 undefined 表示非多边形类（矩形/圆/椭圆/线），走 border-radius 渲染。 */
function shapeClipPath(type: string, cornerCut?: number): string | undefined {
  const pts = getShapePolygonPoints(type as ShapeType, 100, 100, cornerCut);
  if (!pts || pts.length < 3) return undefined;
  return `polygon(${pts.map((p) => `${p.x + 50}% ${p.y + 50}%`).join(', ')})`;
}

/** 形状预览：支持渐变填充、渐变描边、以及三角形/菱形/多边形/星形/切角矩形等多种形状 */
function ShapePreview({ shape }: { shape: PresetShapeElement }) {
  const isTransparent = shape.fill === 'rgba(0,0,0,0)' || shape.fill === 'transparent';
  const isEllipse = shape.type === 'ellipse' || shape.type === 'circle';
  const isLine = shape.type === 'line';
  const hasGradient = !!shape.gradient && shape.gradient.length >= 2;
  const hasStrokeGradient = !!shape.strokeGradient && shape.strokeGradient.length >= 2;
  const clip = shapeClipPath(shape.type, shape.cornerCut);

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${shape.x}%`,
    top: `${shape.y}%`,
    width: `${shape.width}%`,
    height: `${shape.height}%`,
    opacity: shape.opacity,
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
    boxSizing: 'border-box',
  };

  // 圆角矩形：圆角半径与画布一致 = cornerRadius × min(w,h)/2（cqw 随封面等比缩放，正圆角而非椭圆角）
  const isRound = ['roundedRect', 'singleRoundRect', 'diagonalRoundRect'].includes(shape.type);
  const radius = isRound
    ? `${(shape.cornerRadius ?? 0.15) * Math.min(shape.width, shape.height) / 2}cqw`
    : isEllipse ? '50%' : clip ? undefined : '2px';
  // 描边粗细按封面等比缩放（1cqw = 2.1mm，与画布 2px/mm 一致，避免预览固定像素粗细）
  const strokeCqw = `${Math.max(shape.strokeWidth / 2.1, 0.05)}cqw`;

  // 渐变描边（仅矩形类可精确用嵌套实现）：外层渐变 border + 内层填充
  if (hasStrokeGradient && !clip) {
    return (
      <div
        style={{
          ...baseStyle,
          padding: strokeCqw,
          borderRadius: radius,
          background: presetGradientCss(shape.strokeGradient!, shape.strokeGradientAngle),
        }}
      >
        <div
          style={{
            width: '100%', height: '100%',
            borderRadius: radius,
            background: hasGradient ? presetGradientCss(shape.gradient!, shape.gradientAngle) : (isTransparent ? 'transparent' : shape.fill),
          }}
        />
      </div>
    );
  }

  // 线条
  if (isLine) {
    return <div style={{ ...baseStyle, background: hasGradient ? presetGradientCss(shape.gradient!, shape.gradientAngle) : shape.fill }} />;
  }

  // 透明填充 + 有描边 → 边框
  if (isTransparent && shape.strokeWidth > 0) {
    return (
      <div
        style={{
          ...baseStyle,
          border: `${strokeCqw} solid ${hasStrokeGradient ? shape.strokeGradient![0].color : shape.stroke}`,
          borderRadius: radius,
          clipPath: clip,
        }}
      />
    );
  }

  // 色块 / 渐变块
  return (
    <div
      style={{
        ...baseStyle,
        background: hasGradient ? presetGradientCss(shape.gradient!, shape.gradientAngle) : shape.fill,
        borderRadius: radius,
        clipPath: clip,
      }}
    />
  );
}

/** 文字预览：支持横排 / 竖排（rotation）、渐变填充、字间距/行间距/垂直对齐。
 * 与画布渲染层（TextDomNode）对齐：字距/行距读取模板预设，多行文字按 \n 真实换行，
 * 不再硬编码 letterSpacing/nowrap，保证预览所见即所得。 */
function TextPreview({ txt }: { txt: PresetTextElement }) {
  const fontSize = Math.max(txt.fontSize * PREVIEW_FONT_CQW, 0.6);
  const justify =
    txt.align === 'left' ? 'flex-start' : txt.align === 'right' ? 'flex-end' : 'center';
  // 垂直对齐：顶/居中/底（默认居中，与转换逻辑缺省一致）
  const vAlign =
    (txt.verticalAlign ?? 'center') === 'top' ? 'flex-start'
      : (txt.verticalAlign ?? 'center') === 'bottom' ? 'flex-end'
        : 'center';
  const hasGradient = !!txt.gradient && txt.gradient.length >= 2;
  const textStyle: React.CSSProperties = hasGradient
    ? {
        backgroundImage: presetGradientCss(txt.gradient!, txt.gradientAngle),
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
      }
    : { color: txt.color };

  // 字间距/行间距：模板预设值（逻辑像素/字号倍数），用 cqw 等比缩放保持与封面固定比例
  const letterSpacing = txt.letterSpacing ? `${txt.letterSpacing * PREVIEW_FONT_CQW}cqw` : undefined;
  const lineHeight = txt.lineHeight ?? 1.2;

  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        left: `${txt.x}%`,
        top: `${txt.y}%`,
        width: `${txt.width}%`,
        height: `${txt.height}%`,
        fontSize: `${fontSize}cqw`,
        fontFamily: txt.fontFamily,
        fontWeight: txt.bold ? 600 : 400,
        fontStyle: txt.italic ? 'italic' : 'normal',
        textAlign: txt.align,
        justifyContent: vAlign,
        alignItems: justify,
        transform: txt.rotation ? `rotate(${txt.rotation}deg)` : undefined,
        lineHeight,
        letterSpacing,
        pointerEvents: 'none',
      }}
    >
      <span style={{ ...textStyle, whiteSpace: 'pre-line' }}>{txt.text}</span>
    </div>
  );
}