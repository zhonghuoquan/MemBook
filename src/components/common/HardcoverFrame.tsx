/**
 * HardcoverFrame — 精装硬壳书板共享外框
 * ─────────────────────────────────────────
 * 统一「精装硬壳相册实物效果」视觉语言：圆角 + 纸板边缘高光/暗边 + 铰链压槽 +
 * 表面光泽 + 多层浮起投影 + 落地投影。
 * 主页相册封面卡片（CoverPageCard）/ 封面模板库与编辑器封面面板（CoverPreview）/
 * 翻页预览封面封底（BookPreviewOverlay）共用此组件，
 * 保证所有入口的封面实物效果完全一致（以主页相册封面样式为基准）。
 * variant: front=封面（书脊在左）；back=封底（书脊在右，效果水平镜像）。
 */
import type { CSSProperties, ReactNode } from 'react';

/** 铰链压槽位置：书脊侧占封面宽 8% */
const HINGE_PCT = 8;

export function HardcoverFrame({
  variant = 'front',
  backgroundColor = '#FFFFFF',
  className = '',
  style,
  children,
}: {
  variant?: 'front' | 'back';
  /** 书板底色（内容未铺满时兜底） */
  backgroundColor?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const isBack = variant === 'back';
  const radius = isBack ? '1px 1px 3px 2px' : '1px 2px 3px 1px';
  // 铰链压槽定位：front 书脊在左；back 水平镜像到右
  const hingeFade = isBack ? 'to left' : 'to right';
  const hingeSide: CSSProperties = isBack ? { right: 0 } : { left: 0 };
  const ridgePos: CSSProperties = isBack ? { right: `calc(${HINGE_PCT}% - 2px)` } : { left: `calc(${HINGE_PCT}% - 2px)` };
  const groovePos: CSSProperties = isBack ? { right: `${HINGE_PCT}%` } : { left: `${HINGE_PCT}%` };
  const diffusePos: CSSProperties = isBack ? { right: `calc(${HINGE_PCT}% + 2px)` } : { left: `calc(${HINGE_PCT}% + 2px)` };

  return (
    <div
      className={`relative ${className}`}
      style={{ ...style, overflow: 'visible', containerType: 'inline-size' }}
    >
      {/* 落地投影：模拟真实书籍在台面上的柔和投影（cqw 定尺寸，不同尺寸封面一致） */}
      <div
        className="absolute pointer-events-none"
        style={{ left: '-3cqw', right: '-3cqw', bottom: '-6cqw', height: '14cqw', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.22), rgba(0,0,0,0) 72%)', filter: 'blur(5px)' }}
      />

      {/* 书板主体 */}
      <div
        className="relative w-full h-full overflow-hidden"
        style={{
          borderRadius: radius,
          backgroundColor,
          // 投影角度 90°：光从正上方照下，阴影只向下投射（底部）；cqw 定尺寸保证不同尺寸一致
          boxShadow: [
            '0 0.6cqw 1.8cqw rgba(0,0,0,0.20)',
            '0 1.8cqw 5cqw rgba(0,0,0,0.14)',
            '0 3.5cqw 9cqw rgba(0,0,0,0.12)',
          ].join(', '),
        }}
      >
        {children}

        {/* 纸板厚度边缘高光/暗边 — 压在内容之上，保证有照片时硬壳边缘依然可见（back 镜像：高光在书脊侧） */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 55,
            borderRadius: radius,
            boxShadow: [
              isBack ? 'inset -1px 0 0 0 rgba(255,255,255,0.20)' : 'inset 1px 0 0 0 rgba(255,255,255,0.20)',
              isBack ? 'inset 1px -1px 0 0 rgba(0,0,0,0.10)' : 'inset -1px -1px 0 0 rgba(0,0,0,0.10)',
              'inset 0 0 0 1px rgba(0,0,0,0.05)',
            ].join(', '),
          }}
        />

        {/* 表面光泽：对角线渐变模拟封面材料反光（back 镜像角度，保持同一受光方向） */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 60, background: `linear-gradient(${isBack ? 225 : 135}deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 30%, transparent 50%, rgba(0,0,0,0.02) 70%, rgba(0,0,0,0.05) 100%)` }}
        />

        {/* 铰链区（书脊侧到压槽之间）：朝光侧极微弱压暗 */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ zIndex: 50, width: `${HINGE_PCT}%`, ...hingeSide, background: `linear-gradient(${hingeFade}, rgba(0,0,0,0.03), rgba(0,0,0,0.01) 70%, transparent 100%)` }}
        />
        {/* 压槽靠书脊侧凸脊受光高光（光从上方照，凸脊朝上受光） */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ zIndex: 51, width: '2px', ...ridgePos, background: 'linear-gradient(to bottom, rgba(255,255,255,0.03), rgba(255,255,255,0.12) 20%, rgba(255,255,255,0.12) 80%, rgba(255,255,255,0.03))' }}
        />
        {/* 压槽主体：往下渐变的凹陷阴影 */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ zIndex: 51, width: '2px', ...groovePos, background: 'linear-gradient(to bottom, rgba(0,0,0,0.02), rgba(0,0,0,0.09) 20%, rgba(0,0,0,0.09) 80%, rgba(0,0,0,0.02))' }}
        />
        {/* 压槽靠封面侧漫射阴影衰减 */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ zIndex: 51, width: '5%', ...diffusePos, background: `linear-gradient(${hingeFade}, rgba(0,0,0,0.10), rgba(0,0,0,0.02) 55%, rgba(0,0,0,0))` }}
        />
      </div>
    </div>
  );
}
