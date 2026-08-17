/**
 * 文字元素 DOM 常驻渲染节点（2026-08-15 单一排版引擎重构）
 *
 * 设计：显示态与编辑态是【同一个 DOM 节点、同一次 CSS 布局】——
 * 显示态该节点只读（pointer-events 穿透，命中/选中/控制点由 Konva TextElementNode 承载），
 * 双击进入编辑仅切换 contentEditable + 聚焦光标。因此进/出编辑在结构上不可能产生
 * 位置、大小、间距跳变（所见即所得），任何字体/字号/行高/字距/对齐组合均一致。
 *
 * 历史背景：此前显示用 Konva canvas 2D 排版、编辑用浏览器 DOM inline layout，
 * 两套引擎的 leading 分布/基线/断行列容量公式存在固有差异，靠逐项补偿无法对齐
 * （half-leading 方向、+1px 基线常量、列容量 floor±1 等），多行/多列必跳变。
 * 该方案已废弃，禁止回退。
 *
 * 坐标系：本组件渲染在 Canvas 的「文字 DOM 层」容器内，容器已定位到页面左上角
 * （groupOX/OY），故此处 left/top 使用页面局部坐标（el.x/y mm × MM_TO_PX × canvasZoom）。
 */
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageTextElement } from '../../../types';
import { MM_TO_PX } from './constants';
import { toRgba } from '../../../constants/colorPalette';
import type { GradientStop } from '../../../types';

/**
 * 按固定宽度把文本展开为渲染行（CJK 逐字可断、Latin 按空格断行），并记录每行在原文中的起始偏移。
 * 与 DOM 断行行为（word-break:normal + whitespace-pre-wrap）近似一致，
 * 供 fitTextSize（退出编辑尺寸计算 / 模板应用自适应）与双击光标定位（estimateTextIndexAtPoint）共用同一套断行逻辑。
 * font/contentWpx 需使用同一单位（同为逻辑 px 或同为 zoom 后 px），比值判断与单位无关。
 * letterSpacing 必须与 font/contentWpx 同单位：断行测量时计入每字符后的字距（Canvas measureText 不含 letter-spacing），
 * 否则一字距偏大的多行文本会被少算行数、导致文本框高度不足而裁剪（历史教训见开发日志 2026-08-15）。
 */
export function wrapTextLines(text: string, font: string, contentWpx: number, letterSpacing = 0): { text: string; start: number }[] {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = font;
  // 实际渲染宽度 ≈ measureText + 每字符后的字距（含末尾），Canvas 不自带 letter-spacing 需手动计入
  const w = (s: string) => ctx.measureText(s).width + s.length * letterSpacing;
  const lines: { text: string; start: number }[] = [];
  let pos = 0;
  for (const para of text.split('\n')) {
    if (para === '') { lines.push({ text: '', start: pos }); pos += 1; continue; }
    // CJK 字符（含假名/全角/标点）逐字为独立 token 可断行；Latin 按空格分词整体断行
    const tokens = para.split(/(\s+|[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\u3000-\u303f\uff00-\uffef])/).filter((s) => s.length > 0);
    let line = '';
    for (const tk of tokens) {
      const test = line + tk;
      if (w(test) > contentWpx && line !== '') {
        lines.push({ text: line, start: pos - line.length });
        line = tk.replace(/^\s+/, '');
      } else {
        line = test;
      }
    }
    lines.push({ text: line, start: pos - line.length });
    pos += para.length + 1; // 段落字符数 + 换行符
  }
  return lines;
}

/**
 * 计算文字元素编辑后的尺寸（mm）：PPT 风格 —— 盒子只增不减，左上角不动。
 * **公式与 TextDomNode 的 DOM 排版完全同源**（单位桥接：fontSize/letterSpacing 为逻辑 px，
 * el.width/height 为 mm，经 MM_TO_PX 换算；zoom 在比值中自然消去，无需传入）：
 * - 竖排：每列容量 perCol = floor((height×MM_TO_PX − 2×4px) / (fontSize+letterSpacing))（无 +1），
 *   显式 \n 即换列，列内超高度自动换列；宽度按列数×列宽(fontSize×lineHeight)增长，高度按最长列增长。
 * - 横排：宽度固定 el.width，高度按固定宽度换行所需行数×行高(fontSize×lineHeight)增长。
 * 历史教训：旧版 mm 与 px 混算 + perCol 多 +1，导致退出编辑时文本框尺寸爆炸/排版重排（2026-08-15）。
 */
export function fitTextSize(
  el: Pick<PageTextElement, 'text' | 'fontSize' | 'fontFamily' | 'bold' | 'italic' | 'isVertical' | 'width' | 'height' | 'lineHeight' | 'letterSpacing'>,
): { width: number; height: number } {
  const fontSize = el.fontSize;
  const font = `${el.bold ? 'bold ' : ''}${el.italic ? 'italic ' : ''}${fontSize}px ${el.fontFamily}`;
  const padPx = 4; // 逻辑 px（textPad = 4×zoom）
  const text = el.text || '';
  const lineHeight = el.lineHeight ?? 1.2;
  const ls = el.letterSpacing ?? 0;
  const stepY = fontSize + ls;         // 竖排字步进（px）
  const stepX = fontSize * lineHeight; // 竖排列宽（px）

  if (el.isVertical) {
    const contentHpx = Math.max(0, (el.height ?? 0) * MM_TO_PX - padPx * 2);
    const perCol = Math.max(1, Math.floor(contentHpx / stepY));
    let totalCols = 0;
    let maxLen = 0;
    for (const col of text.split('\n')) {
      totalCols += Math.max(1, Math.ceil(col.length / perCol));
      for (let i = 0; i < col.length; i += perCol) maxLen = Math.max(maxLen, Math.min(perCol, col.length - i));
    }
    return {
      width: Math.max(el.width, (totalCols * stepX + padPx * 2) / MM_TO_PX),
      height: Math.max(el.height ?? 0, (maxLen * stepY + padPx * 2) / MM_TO_PX),
    };
  }

  // 横排：宽度固定为 el.width，只增长高度以容纳按固定宽度换行后的文字。
  // 可用宽度 = 盒宽 − 左右内边距 − 末尾一个字距（末尾 letter-spacing 不占内容宽）；
  // 断行测量在 wrapTextLines 内计入每字符字距，保证多行行数估算与真实渲染一致。
  const contentWpx = Math.max(1, el.width * MM_TO_PX - padPx * 2 - ls);
  const lines = wrapTextLines(text, font, contentWpx, ls);
  return {
    width: el.width,
    height: Math.max(el.height ?? 0, (lines.length * fontSize * lineHeight + padPx * 2) / MM_TO_PX),
  };
}

/** 将渐变 stops + 角度 转为 CSS linear-gradient（DOM 文字层 background-clip:text 预览用，不参与导出/缩略图） */
function gradientToCssByAngle(stops: GradientStop[], angle = 45): string {
  const parts = (stops.length >= 2 ? stops : [{ offset: 0, color: '#999' }, { offset: 1, color: '#999' }])
    .map((s) => `${s.alpha != null && s.alpha < 1 ? toRgba(s.color, s.alpha) : s.color} ${Math.round(s.offset * 100)}%`);
  return `linear-gradient(${angle}deg, ${parts.join(', ')})`;
}

/** 在 contentEditable 元素内把光标定位到文本的某个字符索引处 */
export function setCaretAt(el: HTMLElement, index: number) {
  const node = el.firstChild;
  if (!node) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let target: Text | null = null;
  let targetOffset = 0;
  while (walker.nextNode()) {
    const tNode = walker.currentNode as Text;
    const len = (tNode.textContent || '').length;
    if (pos + len >= index) { target = tNode; targetOffset = index - pos; break; }
    pos += len;
  }
  if (!target) { target = el.lastChild as Text | null; targetOffset = target?.length ?? 0; }
  if (!target) return;
  const range = document.createRange();
  range.setStart(target, targetOffset);
  range.collapse(true);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

function TextDomNodeImpl({
  el, canvasZoom, isEditing, cursorIndex, onCaretPlaced, onLiveText, onUpdate, onRequestExit,
}: {
  el: PageTextElement;
  canvasZoom: number;
  isEditing: boolean;
  /** 进入编辑时要定位的光标字符索引（双击进入时估算；新建/工具栏入口为 null） */
  cursorIndex: number | null;
  /** 光标定位完成后回调（消费掉一次性索引） */
  onCaretPlaced: () => void;
  /** 输入过程实时同步文本到 store（不记录历史） */
  onLiveText: (val: string) => void;
  /** 退出编辑保存（记录历史） */
  onUpdate: (patch: Partial<PageTextElement>, recordHistory?: boolean) => void;
  /** 请求退出编辑（失焦 / Esc / Ctrl+Enter） */
  onRequestExit: () => void;
}) {
  const { t } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);
  // 编辑会话只初始化一次（写入文本 + 聚焦 + 定位光标）
  const initRef = useRef(false);
  // 退出编辑的 cleanup 需要最新的元素数据/回调（避免闭包过期）
  const stateRef = useRef({ el, onUpdate });
  stateRef.current = { el, onUpdate };

  const isVert = el.isVertical === true;
  const elW = el.width;
  const elH = el.height ?? 20;
  // 最小尺寸（mm，与 TextElementNode resize 下限一致）：横排窄矮（8×4mm）、竖排窄高（4×8mm）。
  // 仅保留极小下限保证框不塌陷，不再锁死 50×20px，用户可自由缩小文本框（PPT 逻辑）。
  const MIN_W_MM = isVert ? 4 : 8;
  const MIN_H_MM = isVert ? 8 : 4;
  const tw = Math.max(elW * MM_TO_PX, MIN_W_MM * MM_TO_PX) * canvasZoom;
  const boxH = Math.max(elH * MM_TO_PX, MIN_H_MM * MM_TO_PX) * canvasZoom;
  const textPad = 4 * canvasZoom; // 内边距与文字框渲染一致
  const elRotation = el.rotation ?? 0;
  // 左上角锚定（页面局部坐标，容器已在页面左上角）
  const tlX = el.x * MM_TO_PX * canvasZoom;
  const tlY = el.y * MM_TO_PX * canvasZoom;
  const fs = el.fontSize * canvasZoom;

  const hAlign = el.align ?? 'left';
  const vAlign = el.verticalAlign ?? 'center';
  // 横排：justify=垂直(vAlign)，items=stretch（水平由 textAlign 控制）
  // 竖排（PPT 语义，随文字方向旋转）：justify=垂直 由 align 决定（左=顶,中=中,右=底）；items=水平 由 verticalAlign 决定（顶=左,中=中,底=右）
  const justify = isVert
    ? (hAlign === 'center' ? 'center' : hAlign === 'right' ? 'flex-end' : 'flex-start')
    : (vAlign === 'center' ? 'center' : vAlign === 'bottom' ? 'flex-end' : 'flex-start');
  const alignItems = isVert
    ? (vAlign === 'center' ? 'center' : vAlign === 'bottom' ? 'flex-end' : 'flex-start')
    : 'stretch';

  // 竖排文字块几何（与 CSS vertical-rl 布局一致，公式与 fitTextSize 完全同源）：
  // 显式 \n 即换列；列内超出内容区高度自动换列。块宽 = 列数 × 列宽(stepX = fontSize×lineHeight)；
  // 块高：所有段都未满一列 = 最长段字符数 × 字步进；任一段换列 = 内容区高。
  const vertStep = fs + (el.letterSpacing ?? 0) * canvasZoom;
  const vertStepX = fs * (el.lineHeight ?? 1.2);
  const vertContentAreaH = boxH - 2 * textPad;
  const perCol = Math.max(1, Math.floor(vertContentAreaH / vertStep));
  const vertSegs = isVert ? (el.text ?? '').split('\n') : [];
  const vertMaxSeg = vertSegs.reduce((m, s) => Math.max(m, s.length), 0);
  let numCols = 0;
  for (const s of vertSegs) numCols += Math.max(1, Math.ceil(s.length / perCol));
  numCols = Math.max(1, numCols);
  const vertBlockH = isVert
    ? (vertMaxSeg >= perCol ? vertContentAreaH : Math.max(1, vertMaxSeg) * vertStep)
    : undefined;
  const vertBlockW = isVert ? numCols * vertStepX : undefined;

  // 渐变文字：background-clip:text 显示真实渐变；纯色直接用 color
  const hasGradient = !!(el.gradient && el.gradient.length >= 2);
  const gradCss = hasGradient ? gradientToCssByAngle(el.gradient!, el.gradientAngle) : null;
  const isEmpty = !el.text;

  // ── 编辑初始化：写入文本 + 聚焦 + 定位光标（首帧绘制前，避免光标跳动） ──
  useLayoutEffect(() => {
    if (!isEditing) { initRef.current = false; return; }
    if (initRef.current) return;
    initRef.current = true;
    const div = divRef.current;
    if (!div) return;
    div.textContent = el.text ?? '';
    div.focus();
    if (cursorIndex != null) {
      setCaretAt(div, Math.max(0, Math.min(cursorIndex, (div.textContent || '').length)));
      onCaretPlaced();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, cursorIndex]);

  // ── 退出编辑保存（任意退出路径统一在此提交：失焦/画布点击/Esc/元素删除不触发） ──
  useLayoutEffect(() => {
    if (!isEditing) return;
    return () => {
      const div = divRef.current;
      if (!div) return; // 组件卸载（元素已删除）时不保存
      const { el: cur, onUpdate: upd } = stateRef.current;
      const val = (div.innerText || '').replace(/\u200b/g, '');
      // 未修改文本：完全不提交（盒子/排版保持原样，纯进/出编辑零变化，也不产生空历史快照）
      if (val === (cur.text ?? '')) return;
      const fitted = fitTextSize({ ...cur, text: val });
      upd({ text: val, width: fitted.width, height: fitted.height }, true);
    };
  }, [isEditing]);

  return (
    <div
      style={{
        position: 'absolute',
        left: tlX, top: tlY, width: tw, height: boxH,
        transform: elRotation ? `rotate(${elRotation}deg)` : undefined,
        transformOrigin: 'center center',
        // 固定高度（与文字框一致），文字块在其中垂直对齐、中心恒定，输入时不跳动
        display: 'flex', flexDirection: 'column', justifyContent: justify,
        alignItems,
        overflow: 'hidden',
        pointerEvents: 'none', // 显示态穿透点击到 Konva 命中区；编辑态由内层 contentEditable 接管
      }}
    >
      <div
        ref={divRef}
        contentEditable={isEditing}
        suppressContentEditableWarning
        spellCheck={false}
        className={`${isVert ? '' : 'w-full'} outline-none overflow-hidden whitespace-pre-wrap`}
        style={{
          // 编辑态才可交互（caret 点击定位/选择）；显示态穿透
          pointerEvents: isEditing ? 'auto' : 'none',
          outline: 'none',
          boxShadow: 'none',
          // 断行规则：只在空格处断行、不在单词内切割
          wordBreak: 'normal',
          overflowWrap: 'normal',
          // 竖排：writing-mode 使输入光标方向为竖向（与 PPT 一致），字符正立
          writingMode: isVert ? 'vertical-rl' : undefined,
          textOrientation: isVert ? 'upright' : undefined,
          // 竖排：宽度 = 块宽（列数×列宽），使浏览器列间距与换列一致
          width: isVert ? vertBlockW : undefined,
          minWidth: isVert ? fs : undefined,
          // 竖排：高度 = 块高（单列内容高 / 多列内容区触发换列）
          height: isVert ? vertBlockH : undefined,
          // 竖排须 content-box，避免全局 border-box 让 height 含 padding
          boxSizing: isVert ? 'content-box' : undefined,
          fontSize: fs,
          fontFamily: el.fontFamily,
          // 空内容占位样式（灰色斜体，与占位文案一致）；渐变文字用 background-clip
          color: isEmpty ? '#999' : (gradCss ? 'transparent' : el.color),
          fontStyle: isEmpty ? 'italic' : (el.italic ? 'italic' : 'normal'),
          backgroundImage: !isEmpty && gradCss ? gradCss : undefined,
          WebkitBackgroundClip: !isEmpty && gradCss ? 'text' : undefined,
          backgroundClip: !isEmpty && gradCss ? 'text' : undefined,
          fontWeight: el.bold ? 600 : 400,
          textDecoration: el.underline ? 'underline' : undefined,
          // 竖排（vertical-rl）：text-align 控制列内垂直对齐（左=顶/中=列中间/右=底，断行未满列按此对齐）
          textAlign: isVert
            ? ((hAlign === 'center' ? 'center' : hAlign === 'right' ? 'end' : 'start') as 'start' | 'center' | 'end')
            : (hAlign as 'left' | 'center' | 'right'),
          // 行高：横排=行距倍数；竖排（vertical-rl）= 列宽/列间距（= fontSize×lineHeight）
          lineHeight: el.lineHeight ?? 1.2,
          letterSpacing: (el.letterSpacing ?? 0) * canvasZoom,
          padding: `${textPad}px`,
          caretColor: '#6C63FF',
        }}
        onInput={(e) => {
          // 实时同步文本到 store（不记录历史）；显示内容由本节点自身呈现，无需重排推算
          onLiveText((e.currentTarget.innerText || '').replace(/\u200b/g, ''));
        }}
        onBlur={() => onRequestExit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onRequestExit(); }
          // Enter 插入换行（与 PPT 一致）；Ctrl/Cmd+Enter 保存退出
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRequestExit(); }
        }}
        // 编辑态 children 由 DOM 自管理（React 渲染 undefined 不触碰已有内容，避免光标跳动）；
        // 显示态由 React 渲染文本/占位。切换发生在 commit 后、绘制前的 effect 中，无闪烁。
      >
        {isEditing ? undefined : (el.text || t('editor.textElement.placeholder'))}
      </div>
    </div>
  );
}

export const TextDomNode = TextDomNodeImpl;
