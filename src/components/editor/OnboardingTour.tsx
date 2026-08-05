import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/* ════════════════════════════════════════
   MemBook 首次使用引导（通用 Tour 组件）
   ════════════════════════════════════════ */

export interface TourStep {
  id: string;
  emoji: string;
  titleKey: string;
  descKeys: string[];
  target: string;
  /** 期望的气泡方向，默认 'bottom' */
  preferredSide?: 'bottom' | 'top' | 'left' | 'right';
}

export interface TourOverlayProps {
  steps: TourStep[];
  storageKey: string;
  onComplete: () => void;
}

function markDone(storageKey: string) {
  try {
    localStorage.setItem(storageKey, '1');
  } catch { /* ignore */ }
}

export function shouldShowTour(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== '1';
  } catch {
    return true;
  }
}

const CARD_MIN_WIDTH = 280;
const CARD_WIDTH = 340;
const CARD_MAX_WIDTH = 400;
const GAP = 12;
const SAFE_MARGIN = 16;
const ARROW_WIDTH = 16;
const ARROW_HALF = ARROW_WIDTH / 2;

interface TooltipLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'bottom' | 'top' | 'left' | 'right';
}

/**
 * 四方向自适应定位算法：
 * 1. 按 preferredSide 优先尝试
 * 2. 空间不足时自动切换到反方向或垂直方向
 * 3. 确保卡片不遮挡目标元素
 * 4. 始终留在窗口可视区域内
 */
function computeTooltipLayout(
  target: DOMRect,
  cardWidth: number,
  cardHeight: number,
  preferred: 'bottom' | 'top' | 'left' | 'right' = 'bottom',
): TooltipLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, vw - SAFE_MARGIN * 2));
  const width = Math.min(cardWidth, maxW);

  // 计算各方向可用空间
  const space = {
    bottom: vh - target.bottom - GAP,
    top: target.top - GAP,
    right: vw - target.right - GAP,
    left: target.left - GAP,
  };

  // 按优先级排序候选方向
  const opposite = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' } as const;
  const order: ('bottom' | 'top' | 'left' | 'right')[] = [
    preferred,
    opposite[preferred],
    'bottom', 'top', 'right', 'left',
  ];
  // 去重
  const seen = new Set<string>();
  const candidates = order.filter((d) => {
    if (seen.has(d)) return false;
    seen.add(d); return true;
  });

  // 找到第一个有足够空间的方向
  let chosenSide: 'bottom' | 'top' | 'left' | 'right' = preferred;
  for (const dir of candidates) {
    if (dir === 'bottom' || dir === 'top') {
      if (space[dir] >= cardHeight) { chosenSide = dir; break; }
    } else {
      if (space[dir] >= width) { chosenSide = dir; break; }
    }
  }

  // 如果都不够，选空间最大的方向
  const maxSpace = Math.max(space.bottom, space.top, space.right, space.left);
  if (maxSpace < 0) {
    chosenSide = preferred;
  }

  let left: number;
  let top: number;

  switch (chosenSide) {
    case 'bottom':
      left = target.left + target.width / 2 - width / 2;
      top = target.bottom + GAP;
      break;
    case 'top':
      left = target.left + target.width / 2 - width / 2;
      top = target.top - cardHeight - GAP;
      break;
    case 'right':
      left = target.right + GAP;
      top = target.top + target.height / 2 - cardHeight / 2;
      break;
    case 'left':
      left = target.left - width - GAP;
      top = target.top + target.height / 2 - cardHeight / 2;
      break;
  }

  // 钳制到安全区域内
  left = Math.max(SAFE_MARGIN, Math.min(left, vw - width - SAFE_MARGIN));
  top = Math.max(SAFE_MARGIN, Math.min(top, vh - cardHeight - SAFE_MARGIN));

  return { left, top, width, height: cardHeight, side: chosenSide };
}

/** 计算箭头相对于卡片的位置与旋转（三角形箭头，贴合卡片边缘指向目标） */
function getArrowStyle(layout: TooltipLayout, target: DOMRect): React.CSSProperties {
  const { side, left: cardLeft, top: cardTop, width, height } = layout;
  const targetCx = target.left + target.width / 2;
  const targetCy = target.top + target.height / 2;

  switch (side) {
    case 'bottom':
      return {
        left: Math.max(ARROW_HALF, Math.min(targetCx - cardLeft - ARROW_HALF, width - ARROW_WIDTH)),
        top: -ARROW_WIDTH,
        transform: 'none',
      };
    case 'top':
      return {
        left: Math.max(ARROW_HALF, Math.min(targetCx - cardLeft - ARROW_HALF, width - ARROW_WIDTH)),
        top: height,
        transform: 'rotate(180deg)',
      };
    case 'right':
      return {
        left: -ARROW_WIDTH,
        top: Math.max(ARROW_HALF, Math.min(targetCy - cardTop - ARROW_HALF, height - ARROW_WIDTH)),
        transform: 'rotate(-90deg)',
      };
    case 'left':
    default:
      return {
        left: width,
        top: Math.max(ARROW_HALF, Math.min(targetCy - cardTop - ARROW_HALF, height - ARROW_WIDTH)),
        transform: 'rotate(90deg)',
      };
  }
}

/** 通用引导浮层：高亮目标 + 自适应气泡 */
export function TourOverlay({ steps, storageKey, onComplete }: TourOverlayProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const current = steps[step];

  // ── 定位目标元素并滚动可见 ──
  const locateTarget = useCallback(() => {
    const el = document.querySelector(current.target) as HTMLElement | null;
    if (!el) return;
    // 使用 instant 滚动避免动画期间的位置抖动，滚动后立即测量
    el.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    setTargetRect(rect);
  }, [current]);

  useEffect(() => {
    locateTarget();
    const onResize = () => locateTarget();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [locateTarget]);

  // ── 同步测量卡片并计算安全位置（useLayoutEffect 在绘制前完成，避免飞入抖动）──
  useLayoutEffect(() => {
    if (!targetRect) return;
    const cardEl = cardRef.current;
    const height = cardEl ? cardEl.offsetHeight : 200;
    const result = computeTooltipLayout(
      targetRect, CARD_WIDTH, height,
      current.preferredSide ?? 'bottom',
    );
    setLayout(result);
  }, [targetRect, step, current.descKeys.length, current.titleKey, current.preferredSide]);

  // ── 下一步 / 完成 ──
  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
      setLayout(null);
    } else {
      markDone(storageKey);
      onComplete();
    }
  };

  const handleSkip = () => {
    markDone(storageKey);
    onComplete();
  };

  if (!targetRect) return null;

  const isLast = step === steps.length - 1;

  // 高亮环（带全屏遮罩）
  const spotlightStyle: React.CSSProperties = {
    position: 'fixed',
    left: targetRect.left - 4,
    top: targetRect.top - 4,
    width: targetRect.width + 8,
    height: targetRect.height + 8,
    borderRadius: 8,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
    zIndex: 299,
    pointerEvents: 'none',
    transition: 'all 0.3s ease',
  };

  const cardStyle: React.CSSProperties = layout
    ? {
        position: 'fixed',
        left: layout.left,
        top: layout.top,
        width: layout.width,
        zIndex: 300,
        opacity: 1,
      }
    : {
        position: 'fixed',
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        zIndex: 300,
        opacity: 0,
        pointerEvents: 'none',
      };

  const overlay = (
    <div className="fixed inset-0 z-[250]" style={{ pointerEvents: 'none' }}>
      {/* 高亮环 + 全屏暗色遮罩 */}
      <div style={spotlightStyle} />

      {/* 气泡提示卡 */}
      <div
        ref={cardRef}
        className="bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.2)] border border-[var(--color-border)] p-5"
        style={{ ...cardStyle, pointerEvents: 'auto', transition: 'opacity 0.15s ease' }}
      >
        {/* 箭头指示器（卡片子元素，随卡片一起定位，避免分离抖动） */}
        {layout && (
          <div
            style={{
              position: 'absolute',
              width: ARROW_WIDTH,
              height: ARROW_WIDTH,
              background: 'white',
              clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
              zIndex: 10,
              pointerEvents: 'none',
              ...getArrowStyle(layout, targetRect),
            }}
          />
        )}
        {/* 步骤指示器 */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[22px] leading-none">{current.emoji}</span>
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-4 bg-[var(--color-brand)]'
                    : i < step
                    ? 'bg-[var(--color-brand)]/40'
                    : 'bg-[var(--color-gray-200)]'
                }`}
              />
            ))}
            <span className="ml-2 text-[10px] text-[var(--color-gray-400)] font-[500]">{step + 1}/{steps.length}</span>
          </div>
        </div>

        {/* 标题 */}
        <h3 className="text-[14px] font-[600] text-[var(--color-gray-800)] leading-snug mb-2">
          {t(current.titleKey)}
        </h3>

        {/* 描述（按段落渲染，避免手动断行留白） */}
        <div className="space-y-1.5">
          {current.descKeys.map((p, i) => (
            <p key={i} className="text-[12px] text-[var(--color-gray-500)] leading-relaxed">
              {t(p)}
            </p>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--color-border-light)]">
          <button
            className="text-[11px] text-[var(--color-gray-400)] border-none bg-transparent cursor-pointer hover:text-[var(--color-gray-600)] transition-colors"
            onClick={handleSkip}
          >
            {t('editor.onboarding.skip')}
          </button>
          <button
            className="px-4 py-1.5 rounded-lg border-none bg-[var(--color-brand)] text-white text-[12px] font-[500] cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors shadow-[0_2px_8px_rgba(108,99,255,0.25)]"
            onClick={handleNext}
          >
            {isLast ? t('editor.onboarding.finish') : t('editor.onboarding.next')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

/* ════════════════════════════════════════
   编辑器引导（保留原有 key，兼容老用户）
   ════════════════════════════════════════ */

const EDITOR_STORAGE_KEY = 'membook-onboarding-done';

const EDITOR_STEPS: TourStep[] = [
  {
    id: 'upload-zone',
    emoji: '📸',
    titleKey: 'editor.onboarding.editor.step1.title',
    descKeys: ['editor.onboarding.editor.step1.desc1'],
    target: '[data-onboarding="upload-zone"]',
    preferredSide: 'right',
  },
  {
    id: 'smart-layout',
    emoji: '🤖',
    titleKey: 'editor.onboarding.editor.step2.title',
    descKeys: [
      'editor.onboarding.editor.step2.desc1',
      'editor.onboarding.editor.step2.desc2',
      'editor.onboarding.editor.step2.desc3',
    ],
    target: '[data-onboarding="smart-layout"]',
    preferredSide: 'right',
  },
  {
    id: 'page-toolbar',
    emoji: '🎨',
    titleKey: 'editor.onboarding.editor.step3.title',
    descKeys: [
      'editor.onboarding.editor.step3.desc1',
      'editor.onboarding.editor.step3.desc2',
    ],
    target: '[data-onboarding="page-toolbar"]',
    preferredSide: 'bottom',
  },
  {
    id: 'bottom-nav',
    emoji: '📄',
    titleKey: 'editor.onboarding.editor.step4.title',
    descKeys: ['editor.onboarding.editor.step4.desc1'],
    target: '[data-onboarding="bottom-nav"]',
    preferredSide: 'top',
  },
  {
    id: 'canvas-page',
    emoji: '✏️',
    titleKey: 'editor.onboarding.editor.step5.title',
    descKeys: ['editor.onboarding.editor.step5.desc1'],
    target: '[data-onboarding="canvas-page"]',
    preferredSide: 'right',
  },
  {
    id: 'export',
    emoji: '📥',
    titleKey: 'editor.onboarding.editor.step6.title',
    descKeys: ['editor.onboarding.editor.step6.desc1'],
    target: '[data-onboarding="export-btn"]',
    preferredSide: 'bottom',
  },
];

export const shouldShowOnboarding = () => shouldShowTour(EDITOR_STORAGE_KEY);

export function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  return <TourOverlay steps={EDITOR_STEPS} storageKey={EDITOR_STORAGE_KEY} onComplete={onComplete} />;
}

/* ════════════════════════════════════════
   主页引导
   ════════════════════════════════════════ */

const HOME_STORAGE_KEY = 'membook-home-onboarding-done';

const HOME_STEPS: TourStep[] = [
  {
    id: 'home-nav',
    emoji: '🏠',
    titleKey: 'editor.onboarding.home.step1.title',
    descKeys: ['editor.onboarding.home.step1.desc1'],
    target: '[data-onboarding="home-nav"]',
    preferredSide: 'right',
  },
  {
    id: 'home-create',
    emoji: '➕',
    titleKey: 'editor.onboarding.home.step2.title',
    descKeys: ['editor.onboarding.home.step2.desc1'],
    target: '[data-onboarding="home-create-btn"]',
    preferredSide: 'bottom',
  },
  {
    id: 'home-data-tools',
    emoji: '💾',
    titleKey: 'editor.onboarding.home.step3.title',
    descKeys: ['editor.onboarding.home.step3.desc1'],
    target: '[data-onboarding="home-data-tools"]',
    preferredSide: 'bottom',
  },
];

export const shouldShowHomeOnboarding = () => shouldShowTour(HOME_STORAGE_KEY);

export function HomeOnboardingTour({ onComplete }: { onComplete: () => void }) {
  return <TourOverlay steps={HOME_STEPS} storageKey={HOME_STORAGE_KEY} onComplete={onComplete} />;
}
