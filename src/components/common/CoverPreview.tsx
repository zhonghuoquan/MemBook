import type { Template, PresetTextElement, PresetShapeElement } from '../../types';

/**
 * CoverPreview —— 封面模板正方形预览画布（共享组件）
 * ─────────────────────────────────────────
 * 按 template 的百分比坐标渲染：书脊色块 + 装饰形状 + 照片槽位（picsum 真实图片占位）+ 蒙版 + 预设文字（横排/竖排）。
 * 用于编辑器 CoverLibraryPanel 和主页 CoverGallery，保证两处预览效果一致。
 */
export function CoverPreview({
  template,
  active = false,
  rounded = 6,
}: {
  template: Template;
  active?: boolean;
  rounded?: number;
}) {
  const bg = template.presetBackground || 'var(--color-surface-hover)';
  const shapes = template.presetShapeElements ?? [];
  const texts = template.presetTextElements ?? [];

  // mask 类形状渲染在照片之上（渐变蒙版）
  const maskShapes = shapes.filter((s) => s.id === 'mask');
  const baseShapes = shapes.filter((s) => s.id !== 'mask');
  const spineTexts = texts.filter((t) => t.id === 'spineText');
  const otherTexts = texts.filter((t) => t.id !== 'spineText');

  return (
    <div
      className="w-full aspect-square relative overflow-hidden"
      style={{ backgroundColor: bg, borderRadius: `${rounded}px` }}
    >
      {/* 1. 基础形状（含书脊色块、装饰线、边框） */}
      {baseShapes.map((shape) => (
        <ShapePreview key={shape.id} shape={shape} />
      ))}

      {/* 2. 照片槽位（真实图片占位） */}
      {template.slots.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-[2px]"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: `${s.width}%`, height: `${s.height}%`,
            backgroundImage: `url(https://picsum.photos/seed/${template.id}-${s.id}/120/120)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: active ? 'var(--color-brand)' : '#B8C0CA',
            outline: active ? '1px solid var(--color-brand)' : '1px solid rgba(255,255,255,0.4)',
            outlineOffset: '-1px',
          }}
        />
      ))}

      {/* 3. 蒙版形状（照片之上） */}
      {maskShapes.map((shape) => (
        <ShapePreview key={shape.id} shape={shape} />
      ))}

      {/* 4. 书脊文字（竖排） */}
      {spineTexts.map((txt) => (
        <TextPreview key={txt.id} txt={txt} />
      ))}

      {/* 5. 其他文字 */}
      {otherTexts.map((txt) => (
        <TextPreview key={txt.id} txt={txt} />
      ))}
    </div>
  );
}

/** 预览文字缩放因子：实际 fontSize(pt) → 预览 px */
const PREVIEW_FONT_SCALE = 0.42;

/** 形状预览：支持 rectangle / ellipse / line / 透明边框 */
function ShapePreview({ shape }: { shape: PresetShapeElement }) {
  const isTransparent = shape.fill === 'rgba(0,0,0,0)' || shape.fill === 'transparent';
  const isEllipse = shape.type === 'ellipse' || shape.type === 'circle';
  const isLine = shape.type === 'line';

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

  // 透明填充 + 有描边 → 渲染为边框
  if (isTransparent && shape.strokeWidth > 0) {
    return (
      <div
        style={{
          ...baseStyle,
          border: `${Math.max(shape.strokeWidth, 0.5)}px solid ${shape.stroke}`,
          borderRadius: isEllipse ? '50%' : '2px',
        }}
      />
    );
  }

  // 线条：用背景色填充细长矩形
  if (isLine) {
    return <div style={{ ...baseStyle, backgroundColor: shape.fill }} />;
  }

  // 矩形 / 椭圆：色块
  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: shape.fill,
        borderRadius: isEllipse ? '50%' : '2px',
      }}
    />
  );
}

/** 文字预览：支持横排 / 竖排（rotation） */
function TextPreview({ txt }: { txt: PresetTextElement }) {
  const fontSize = Math.max(txt.fontSize * PREVIEW_FONT_SCALE, 5);
  const justify =
    txt.align === 'left' ? 'flex-start' : txt.align === 'right' ? 'flex-end' : 'center';

  return (
    <div
      className="absolute flex overflow-hidden"
      style={{
        left: `${txt.x}%`,
        top: `${txt.y}%`,
        width: `${txt.width}%`,
        height: `${txt.height}%`,
        color: txt.color,
        fontSize: `${fontSize}px`,
        fontFamily: txt.fontFamily,
        fontWeight: txt.bold ? 600 : 400,
        fontStyle: txt.italic ? 'italic' : 'normal',
        textAlign: txt.align,
        alignItems: 'center',
        justifyContent: justify,
        transform: txt.rotation ? `rotate(${txt.rotation}deg)` : undefined,
        whiteSpace: 'nowrap',
        letterSpacing: '0.05em',
        pointerEvents: 'none',
      }}
    >
      <span className="truncate px-0.5">{txt.text}</span>
    </div>
  );
}
