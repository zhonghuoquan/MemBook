import { useState } from 'react';
import type { Template } from '../../types';
import { CoverPreview } from './CoverPreview';
import { Modal } from './Modal';

/**
 * CoverPreviewOverlay —— 封面/封底大图预览弹窗（共用一套）
 * ─────────────────────────────────────────
 * 主页「封面设计库」与编辑器左侧「封面」面板共用同一实现：
 * 点击卡片左上角眼睛（预览）按钮即打开本弹窗，单张封面真实渲染，
 * 点击封面在封面↔封底间 3D 翻转切换；右上角尺寸切换器可切换方/横/竖比例。
 * 修改此处预览呈现，两侧同步生效，禁止各自内联复制实现。
 */
const COVER_SIZES = [
  { key: 'landscape', w: 280, h: 210 },
  { key: 'square', w: 210, h: 210 },
  { key: 'portrait', w: 210, h: 280 },
] as const;
type CoverSizeKey = (typeof COVER_SIZES)[number]['key'];

export function CoverPreviewOverlay({
  open, template, onClose, title,
}: {
  open: boolean;
  /** 当前待预览的封面前端模板；null 时间接关闭弹窗 */
  template: Template | null;
  onClose: () => void;
  /** 弹窗标题（调用方用自己的 i18n 文案传入） */
  title: string;
}) {
  // 预览尺寸档位：默认方形，标题右侧切换（关闭再开保留上次选择）
  const [sizeKey, setSizeKey] = useState<CoverSizeKey>('square');

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="860px"
      height="min(90vh, 780px)"
      centerContent
      title={template ? title : ''}
      headerRight={template ? <SizeSwitcher value={sizeKey} onChange={setSizeKey} /> : undefined}
    >
      {template ? (
        <CoverFlipPreview key={template.id} template={template} sizeKey={sizeKey} />
      ) : null}
    </Modal>
  );
}

/** 线条化尺寸切换器：三个描边矩形示意横向/方形/竖向，纯图形、线条风格，固定高度、宽度按各自比例，选中项品牌色描边 + 浅底圈出 */
function SizeSwitcher({ value, onChange }: { value: CoverSizeKey; onChange: (k: CoverSizeKey) => void }) {
  const H = 16; // 图标固定高，宽按比例取
  return (
    <div className="flex items-center gap-1">
      {COVER_SIZES.map((s) => {
        const active = s.key === value;
        const w = Math.round((H * s.w) / s.h);
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            title={`${s.w}×${s.h}`}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer ${
              active
                ? 'bg-[var(--color-brand)]/10 ring-1 ring-[var(--color-brand)]'
                : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-700)] hover:bg-[var(--color-gray-100)]'
            }`}
          >
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
              <rect
                x="1" y="1" width={w - 2} height={H - 2} rx="2"
                fill="none"
                stroke={active ? 'var(--color-brand)' : 'currentColor'}
                strokeWidth={active ? 1.8 : 1.4}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** 封面/封底大图预览：单张真实渲染，点击在封面↔封底间切换。
 *  切换动效：当前面先 3D 翻开淡出（0.55s）→ 换面 → 新面柔和落定（0.5s）。
 *  尺寸由弹窗标题右侧 SizeSwitcher 受控传入，封面按所选尺寸比例完整显示。 */
function CoverFlipPreview({
  template,
  sizeKey,
}: {
  template: Template;
  sizeKey: CoverSizeKey;
}) {
  const [face, setFace] = useState<'front' | 'back'>('front');
  // 翻开淡出进行中：仅作用于「当前正在显示」的那一面（face 键不变时本页子节点稳定，切换面时整棵重挂）
  const [flick, setFlick] = useState(false);
  const backTemplate = template.backCover;
  const hasBack = !!backTemplate;
  const isBack = face === 'back' && hasBack;
  const current = isBack ? backTemplate : template;
  const size = COVER_SIZES.find((s) => s.key === sizeKey) ?? COVER_SIZES[1];
  const aspectCss = `${size.w} / ${size.h}`;
  // 显式像素宽：三档各自适配弹窗，height 由 aspect-ratio 推导，保证不变形、不超高滚动。
  const coverW = sizeKey === 'portrait' ? 430 : sizeKey === 'landscape' ? 580 : 540;

  const handleFlip = () => {
    if (!hasBack || flick) return;
    setFlick(true);
    // 先「翻开 → 淡出」0.55s，随后切换封面/封底并重挂落定
    window.setTimeout(() => {
      setFace((f) => (f === 'front' ? 'back' : 'front'));
      setFlick(false);
    }, 550);
  };

  // 翻开方向 / 落定方向均按当前面镜像：封面书脊在左（向左翻开）、封底书脊在右（向右翻开）
  const settleClass = isBack ? 'cover-settle-back' : 'cover-settle-front';
  const awayClass = isBack ? 'cover-flip-away-back' : 'cover-flip-away-front';

  return (
    <div className="flex flex-col items-center justify-center min-h-full select-none">
      {/* 切换动效样式：翻开淡出 + 新面落定 */}
      <style>{`
        @keyframes cover-flip-away-front { to { transform: perspective(1400px) translateX(-38%) rotateY(-34deg); opacity: 0; } }
        @keyframes cover-flip-away-back  { to { transform: perspective(1400px) translateX(38%)  rotateY(34deg);  opacity: 0; } }
        .cover-flip-away-front { transform-origin: left center; animation: cover-flip-away-front 0.55s cubic-bezier(0.5,0,0.8,0.4) forwards; }
        .cover-flip-away-back  { transform-origin: right center; animation: cover-flip-away-back 0.55s cubic-bezier(0.5,0,0.8,0.4) forwards; }
        @keyframes cover-settle-front { from { opacity: 0.5; transform: perspective(1600px) rotateY(-20deg); } to { opacity: 1; transform: perspective(1600px) rotateY(0deg); } }
        @keyframes cover-settle-back  { from { opacity: 0.5; transform: perspective(1600px) rotateY(20deg); } to { opacity: 1; transform: perspective(1600px) rotateY(0deg); } }
        .cover-settle-front { transform-origin: left center; animation: cover-settle-front 0.5s cubic-bezier(0.22,1,0.36,1); }
        .cover-settle-back  { transform-origin: right center; animation: cover-settle-back 0.5s cubic-bezier(0.22,1,0.36,1); }
      `}</style>

      <div onClick={handleFlip} className="group relative cursor-pointer border-none bg-transparent p-6 outline-none">
        {/* 悬浮放大：在稳定的外层应用 scale 上浮 + 强化投影，不与翻面/落定的 transform 冲突 */}
        <div className="relative transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] group-hover:-translate-y-2">
          {/* face 键：切换面时整棵重挂 → 触发新面的落定动画；flick 变化不重挂 */}
          <div key={face} className={settleClass}>
            {/* 翻开淡出：仅影响当前面自身，翻完换面后旧面卸载、新面不带此态 */}
            <div className={flick ? awayClass : ''} style={{ width: coverW, margin: '0 auto', transition: 'transform 0.55s cubic-bezier(0.4,0.2,0.2,1), opacity 0.55s ease' }}>
              <div className="w-full" style={{ aspectRatio: aspectCss }}>
                <CoverPreview template={current} variant={isBack ? 'back' : 'front'} aspectRatio={aspectCss} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}