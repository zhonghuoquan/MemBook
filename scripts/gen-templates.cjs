/**
 * 版式库生成器 v3：强去重 + Mixbook 风格创意叠加
 *
 * 核心改进：
 * 1. 双重去重：10% 网格签名（视觉相似）+ 结构模式签名（同布局不同边距）
 *    - 10% 网格：margin 差异 ≤10% 视为相同
 *    - 模式签名：归一化到 10×10 网格，相同模式每种最多保留 2 个变体
 * 2. Mixbook 风格创意布局（8 种新 generator）：
 *    - photoPile 散落照片堆 / cascadeStair 阶梯瀑布 / frameInFrame 框中框
 *    - asymmetricOverlap 不对称深叠 / magazineCollage 杂志拼贴
 *    - polaroidPile 宝丽来堆 / diagonalCascade 对角级联 / steppedFan 阶梯扇形
 * 3. 严格校验：x≥0, y≥0, x+width≤100, y+height≤100, 槽位不超出页面
 *
 * 运行：node scripts/gen-templates.cjs
 * 输出：src/types/generated-templates.ts
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── 工具函数 ──

function r(n) { return Math.round(n * 10) / 10; }
function slotId(prefix, i) { return `${prefix}${i + 1}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 校验槽位坐标合法性
 */
function validateSlots(slots) {
  for (const s of slots) {
    if (s.x < -0.1 || s.y < -0.1 || s.width < 1 || s.height < 1) {
      throw new Error(`Invalid slot: ${JSON.stringify(s)}`);
    }
    if (s.x + s.width > 100.1) {
      throw new Error(`Slot overflows X: ${JSON.stringify(s)} (x+w=${r(s.x + s.width)})`);
    }
    if (s.y + s.height > 100.1) {
      throw new Error(`Slot overflows Y: ${JSON.stringify(s)} (y+h=${r(s.y + s.height)})`);
    }
  }
}

// ── 签名函数 ──

/**
 * 10% 网格签名（视觉相似去重）：将坐标归一化到 10% 网格
 * margin 差异 ≤5% 的模板视为相同
 */
function visualSignature(slots) {
  const n = slots.map(s => ({
    x: Math.round(s.x / 10) * 10,
    y: Math.round(s.y / 10) * 10,
    w: Math.round(s.width / 10) * 10,
    h: Math.round(s.height / 10) * 10,
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

/**
 * 结构模式签名：归一化到 10×10 网格，忽略边距差异
 * 用于检测"相同布局模式，不同边距"的重复
 */
function patternSignature(slots) {
  if (slots.length === 0) return '';
  const xs = slots.map(s => s.x);
  const ys = slots.map(s => s.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...slots.map(s => s.x + s.width));
  const maxY = Math.max(...slots.map(s => s.y + s.height));
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const n = slots.map(s => ({
    x: Math.round(((s.x - minX) / w) * 10),
    y: Math.round(((s.y - minY) / h) * 10),
    w: Math.round((s.width / w) * 10),
    h: Math.round((s.height / h) * 10),
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

/**
 * 5% 网格签名（精确结构去重）：将坐标归一化到 5% 网格
 * 用于检测仅有微小坐标差异（<5%）的近似完全重复
 */
function exactSignature(slots) {
  const n = slots.map(s => ({
    x: Math.round(s.x / 5) * 5,
    y: Math.round(s.y / 5) * 5,
    w: Math.round(s.width / 5) * 5,
    h: Math.round(s.height / 5) * 5,
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

// ── 现有 60 种模板签名（用于去重比对） ──
const existingVisualSigs = new Set();
const existingExactSigs = new Set();
const existingPatternSigs = new Map(); // pattern → count

function addExisting(slots) {
  existingVisualSigs.add(visualSignature(slots));
  existingExactSigs.add(exactSignature(slots));
  const p = patternSignature(slots);
  existingPatternSigs.set(p, (existingPatternSigs.get(p) || 0) + 1);
}

// 1图（4个）
addExisting([{ id: 'main', x: 0, y: 0, width: 100, height: 100 }]); // full / full-bleed
addExisting([{ id: 'main', x: 6, y: 8, width: 88, height: 84 }]); // full-framed
addExisting([{ id: 'main', x: 3, y: 25, width: 94, height: 50 }]); // full-panorama

// 2图（5个）
addExisting([
  { id: 'left', x: 3, y: 5, width: 45.5, height: 90 },
  { id: 'right', x: 51.5, y: 5, width: 45.5, height: 90 },
]); // dual-half
addExisting([
  { id: 'big', x: 3, y: 5, width: 64, height: 90 },
  { id: 'small', x: 70, y: 5, width: 27, height: 90 },
]); // dual-big-small
addExisting([
  { id: 'top', x: 3, y: 5, width: 94, height: 43 },
  { id: 'bottom', x: 3, y: 51, width: 94, height: 44 },
]); // dual-stack
addExisting([
  { id: 'back', x: 3, y: 8, width: 55, height: 84 },
  { id: 'front', x: 64, y: 18, width: 33, height: 64 },
]); // dual-overlap
addExisting([
  { id: 'tl', x: 3, y: 5, width: 55, height: 42 },
  { id: 'br', x: 42, y: 53, width: 55, height: 42 },
]); // dual-diagonal

// 3图（7个）
addExisting([
  { id: 'top', x: 3, y: 5, width: 94, height: 43 },
  { id: 'bottom-l', x: 3, y: 52, width: 45.5, height: 43 },
  { id: 'bottom-r', x: 51.5, y: 52, width: 45.5, height: 43 },
]); // pin-shape
addExisting([
  { id: 'col1', x: 3, y: 5, width: 29.3, height: 90 },
  { id: 'col2', x: 35.3, y: 5, width: 29.3, height: 90 },
  { id: 'col3', x: 67.7, y: 5, width: 29.3, height: 90 },
]); // triple-col
addExisting([
  { id: 'big', x: 3, y: 5, width: 60, height: 90 },
  { id: 'rt', x: 66, y: 5, width: 31, height: 43 },
  { id: 'rb', x: 66, y: 51, width: 31, height: 44 },
]); // magazine-triple
addExisting([
  { id: 'main', x: 3, y: 5, width: 42, height: 90 },
  { id: 'rt', x: 48, y: 5, width: 49, height: 43 },
  { id: 'rb', x: 48, y: 51, width: 49, height: 44 },
]); // triple-portrait
addExisting([
  { id: 'big', x: 3, y: 5, width: 64, height: 90 },
  { id: 'tr', x: 70, y: 5, width: 27, height: 42 },
  { id: 'br', x: 70, y: 53, width: 27, height: 42 },
]); // triple-l-shape
addExisting([
  { id: 'main', x: 3, y: 5, width: 55, height: 90 },
  { id: 'rt', x: 61, y: 5, width: 36, height: 43 },
  { id: 'rb', x: 61, y: 52, width: 36, height: 43 },
]); // triple-stack-right
addExisting([
  { id: 'top', x: 3, y: 5, width: 94, height: 52 },
  { id: 'bl', x: 3, y: 61, width: 45.5, height: 34 },
  { id: 'br', x: 51.5, y: 61, width: 45.5, height: 34 },
]); // triple-horizontal-big

// 4图（9个）
addExisting([
  { id: 'col1', x: 3, y: 5, width: 21.5, height: 90 },
  { id: 'col2', x: 27.5, y: 5, width: 21.5, height: 90 },
  { id: 'col3', x: 52, y: 5, width: 21.5, height: 90 },
  { id: 'col4', x: 76.5, y: 5, width: 21.5, height: 90 },
]); // quad-col
addExisting([
  { id: 'tl', x: 3, y: 5, width: 45.5, height: 43 },
  { id: 'tr', x: 51.5, y: 5, width: 45.5, height: 43 },
  { id: 'bl', x: 3, y: 52, width: 45.5, height: 43 },
  { id: 'br', x: 51.5, y: 52, width: 45.5, height: 43 },
]); // quad-grid
addExisting([
  { id: 'hero', x: 3, y: 5, width: 94, height: 57 },
  { id: 's1', x: 3, y: 65, width: 29.3, height: 30 },
  { id: 's2', x: 35.3, y: 65, width: 29.3, height: 30 },
  { id: 's3', x: 67.7, y: 65, width: 29.3, height: 30 },
]); // quad-hero
addExisting([
  { id: 'lt', x: 3, y: 5, width: 45.5, height: 33 },
  { id: 'lb', x: 3, y: 41, width: 45.5, height: 54 },
  { id: 'rt', x: 51.5, y: 5, width: 45.5, height: 54 },
  { id: 'rb', x: 51.5, y: 62, width: 45.5, height: 33 },
]); // quad-asym
addExisting([
  { id: 'big', x: 3, y: 5, width: 64, height: 58 },
  { id: 'rt', x: 70, y: 5, width: 27, height: 27.5 },
  { id: 'rb', x: 70, y: 35.5, width: 27, height: 27.5 },
  { id: 'bot', x: 3, y: 66, width: 94, height: 29 },
]); // quad-stagger
addExisting([
  { id: 'big', x: 3, y: 5, width: 55, height: 90 },
  { id: 'rt', x: 61, y: 5, width: 36, height: 27 },
  { id: 'rm', x: 61, y: 36, width: 36, height: 27 },
  { id: 'rb', x: 61, y: 67, width: 36, height: 28 },
]); // quad-hero-left
addExisting([
  { id: 'big', x: 42, y: 5, width: 55, height: 90 },
  { id: 'lt', x: 3, y: 5, width: 36, height: 27 },
  { id: 'lm', x: 3, y: 36, width: 36, height: 27 },
  { id: 'lb', x: 3, y: 67, width: 36, height: 28 },
]); // quad-hero-right
addExisting([
  { id: 'top', x: 3, y: 5, width: 94, height: 48 },
  { id: 'b1', x: 3, y: 57, width: 29.3, height: 38 },
  { id: 'b2', x: 35.3, y: 57, width: 29.3, height: 38 },
  { id: 'b3', x: 67.7, y: 57, width: 29.3, height: 38 },
]); // quad-triptych-plus
addExisting([
  { id: 't1', x: 3, y: 5, width: 45.5, height: 38 },
  { id: 't2', x: 51.5, y: 5, width: 45.5, height: 52 },
  { id: 'b1', x: 3, y: 47, width: 45.5, height: 48 },
  { id: 'b2', x: 51.5, y: 61, width: 45.5, height: 34 },
]); // quad-masonry

// 5图（12个）
addExisting([
  { id: 't1', x: 3, y: 5, width: 45.5, height: 43 },
  { id: 't2', x: 51.5, y: 5, width: 45.5, height: 43 },
  { id: 'b1', x: 3, y: 52, width: 29.3, height: 43 },
  { id: 'b2', x: 35.3, y: 52, width: 29.3, height: 43 },
  { id: 'b3', x: 67.7, y: 52, width: 29.3, height: 43 },
]); // five-top2-bot3
addExisting([
  { id: 't1', x: 3, y: 5, width: 29.3, height: 43 },
  { id: 't2', x: 35.3, y: 5, width: 29.3, height: 43 },
  { id: 't3', x: 67.7, y: 5, width: 29.3, height: 43 },
  { id: 'b1', x: 3, y: 52, width: 45.5, height: 43 },
  { id: 'b2', x: 51.5, y: 52, width: 45.5, height: 43 },
]); // five-top3-bot2
addExisting([
  { id: 'l1', x: 3, y: 5, width: 55.5, height: 28.3 },
  { id: 'l2', x: 3, y: 36.3, width: 55.5, height: 28.3 },
  { id: 'l3', x: 3, y: 67.7, width: 55.5, height: 28.3 },
  { id: 'r1', x: 61.5, y: 5, width: 35.5, height: 43 },
  { id: 'r2', x: 61.5, y: 52, width: 35.5, height: 43 },
]); // five-left3-right2
addExisting([
  { id: 'l1', x: 3, y: 5, width: 35.5, height: 43 },
  { id: 'l2', x: 3, y: 52, width: 35.5, height: 43 },
  { id: 'r1', x: 41.5, y: 5, width: 55.5, height: 28.3 },
  { id: 'r2', x: 41.5, y: 36.3, width: 55.5, height: 28.3 },
  { id: 'r3', x: 41.5, y: 67.7, width: 55.5, height: 28.3 },
]); // five-left2-right3
addExisting([
  { id: 'l1', x: 3, y: 5, width: 40.5, height: 28.3 },
  { id: 'l2', x: 3, y: 36.3, width: 40.5, height: 28.3 },
  { id: 'l3', x: 3, y: 67.7, width: 40.5, height: 28.3 },
  { id: 'r1', x: 46.5, y: 5, width: 50.5, height: 43 },
  { id: 'r2', x: 46.5, y: 52, width: 50.5, height: 43 },
]); // five-left3-right2-big
addExisting([
  { id: 't1', x: 3, y: 5, width: 45.5, height: 26 },
  { id: 't2', x: 51.5, y: 5, width: 45.5, height: 26 },
  { id: 'mid', x: 3, y: 34, width: 94, height: 32 },
  { id: 'b1', x: 3, y: 69, width: 45.5, height: 26 },
  { id: 'b2', x: 51.5, y: 69, width: 45.5, height: 26 },
]); // five-cross
addExisting([
  { id: 'big', x: 3, y: 5, width: 50, height: 90 },
  { id: 'stl', x: 56, y: 5, width: 19, height: 43 },
  { id: 'str', x: 78, y: 5, width: 19, height: 43 },
  { id: 'sbl', x: 56, y: 51, width: 19, height: 44 },
  { id: 'sbr', x: 78, y: 51, width: 19, height: 44 },
]); // magazine-five
addExisting([
  { id: 'tl', x: 3, y: 5, width: 35, height: 30 },
  { id: 'tr', x: 62, y: 5, width: 35, height: 30 },
  { id: 'mid', x: 28, y: 38, width: 44, height: 24 },
  { id: 'bl', x: 3, y: 66, width: 35, height: 29 },
  { id: 'br', x: 62, y: 66, width: 35, height: 29 },
]); // five-circle-center
addExisting([
  { id: 't1', x: 3, y: 5, width: 28, height: 45 },
  { id: 't2', x: 33, y: 15, width: 34, height: 45 },
  { id: 't3', x: 69, y: 5, width: 28, height: 45 },
  { id: 'b1', x: 3, y: 55, width: 28, height: 40 },
  { id: 'b2', x: 33, y: 65, width: 64, height: 30 },
]); // five-stagger
addExisting([
  { id: 't1', x: 3, y: 5, width: 29.3, height: 30 },
  { id: 't2', x: 35.3, y: 5, width: 29.3, height: 30 },
  { id: 't3', x: 67.7, y: 5, width: 29.3, height: 30 },
  { id: 'mid', x: 3, y: 39, width: 94, height: 22 },
  { id: 'b1', x: 3, y: 65, width: 94, height: 30 },
]); // five-panorama-center
addExisting([
  { id: 'big', x: 3, y: 5, width: 55, height: 90 },
  { id: 'r1', x: 61, y: 5, width: 36, height: 20 },
  { id: 'r2', x: 61, y: 28, width: 36, height: 20 },
  { id: 'r3', x: 61, y: 51, width: 36, height: 20 },
  { id: 'r4', x: 61, y: 74, width: 36, height: 21 },
]); // five-left-big-right4
addExisting([
  { id: 'big', x: 3, y: 5, width: 94, height: 52 },
  { id: 'b1', x: 3, y: 61, width: 21.25, height: 34 },
  { id: 'b2', x: 27.25, y: 61, width: 21.25, height: 34 },
  { id: 'b3', x: 51.5, y: 61, width: 21.25, height: 34 },
  { id: 'b4', x: 75.75, y: 61, width: 21.25, height: 34 },
]); // five-top-big-bot4

// 6图（7个）
addExisting([
  { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 43 },
  { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 43 },
  { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 43 },
  { id: 'r2c1', x: 3, y: 52, width: 29.3, height: 43 },
  { id: 'r2c2', x: 35.3, y: 52, width: 29.3, height: 43 },
  { id: 'r2c3', x: 67.7, y: 52, width: 29.3, height: 43 },
]); // six-grid
addExisting([
  { id: 'b1', x: 3, y: 5, width: 45.5, height: 43 },
  { id: 'b2', x: 3, y: 51, width: 45.5, height: 44 },
  { id: 'stl', x: 51.5, y: 5, width: 21.25, height: 43 },
  { id: 'str', x: 75.75, y: 5, width: 21.25, height: 43 },
  { id: 'sbl', x: 51.5, y: 51, width: 21.25, height: 44 },
  { id: 'sbr', x: 75.75, y: 51, width: 21.25, height: 44 },
]); // six-hero-grid
addExisting([
  { id: 'big', x: 3, y: 5, width: 54, height: 90 },
  { id: 'rtl', x: 60, y: 5, width: 17, height: 28.3 },
  { id: 'rtr', x: 80, y: 5, width: 17, height: 28.3 },
  { id: 'rml', x: 60, y: 36.3, width: 17, height: 28.3 },
  { id: 'rmr', x: 80, y: 36.3, width: 17, height: 28.3 },
  { id: 'rbot', x: 60, y: 67.7, width: 37, height: 28.3 },
]); // six-magazine
addExisting([
  { id: 'r1c1', x: 3, y: 5, width: 35, height: 43 },
  { id: 'r1c2', x: 41, y: 5, width: 25, height: 43 },
  { id: 'r1c3', x: 69, y: 5, width: 28, height: 43 },
  { id: 'r2c1', x: 3, y: 52, width: 28, height: 43 },
  { id: 'r2c2', x: 34, y: 52, width: 32, height: 43 },
  { id: 'r2c3', x: 69, y: 52, width: 28, height: 43 },
]); // six-3x2-alt
addExisting([
  { id: 'big', x: 3, y: 5, width: 50, height: 90 },
  { id: 'r1', x: 56, y: 5, width: 41, height: 16 },
  { id: 'r2', x: 56, y: 24, width: 41, height: 16 },
  { id: 'r3', x: 56, y: 43, width: 41, height: 16 },
  { id: 'r4', x: 56, y: 62, width: 41, height: 16 },
  { id: 'r5', x: 56, y: 81, width: 41, height: 14 },
]); // six-left-big-right5
addExisting([
  { id: 'big', x: 3, y: 5, width: 94, height: 50 },
  { id: 'b1', x: 3, y: 59, width: 17.2, height: 36 },
  { id: 'b2', x: 23.2, y: 59, width: 17.2, height: 36 },
  { id: 'b3', x: 43.4, y: 59, width: 17.2, height: 36 },
  { id: 'b4', x: 63.6, y: 59, width: 17.2, height: 36 },
  { id: 'b5', x: 83.8, y: 59, width: 13.2, height: 36 },
]); // six-top-big-bot5
addExisting([
  { id: 'center', x: 32, y: 32, width: 36, height: 36 },
  { id: 't', x: 32, y: 5, width: 36, height: 24 },
  { id: 'b', x: 32, y: 71, width: 36, height: 24 },
  { id: 'l', x: 3, y: 32, width: 26, height: 36 },
  { id: 'r', x: 71, y: 32, width: 26, height: 36 },
  { id: 'corner', x: 3, y: 5, width: 26, height: 24 },
]); // six-around

// 7图（8个）
addExisting([
  { id: 'big', x: 3, y: 5, width: 55, height: 55 },
  { id: 'r1', x: 61, y: 5, width: 36, height: 28 },
  { id: 'r2', x: 61, y: 36, width: 36, height: 28 },
  { id: 'r3', x: 61, y: 67, width: 36, height: 28 },
  { id: 'b1', x: 3, y: 64, width: 17, height: 31 },
  { id: 'b2', x: 22, y: 64, width: 17, height: 31 },
  { id: 'b3', x: 41, y: 64, width: 17, height: 31 },
]); // seven-3x2-plus1
addExisting([
  { id: 'big', x: 3, y: 5, width: 48, height: 90 },
  { id: 'r1', x: 54, y: 5, width: 43, height: 13.6 },
  { id: 'r2', x: 54, y: 21.6, width: 43, height: 13.6 },
  { id: 'r3', x: 54, y: 38.2, width: 43, height: 13.6 },
  { id: 'r4', x: 54, y: 54.8, width: 43, height: 13.6 },
  { id: 'r5', x: 54, y: 71.4, width: 43, height: 13.6 },
  { id: 'r6', x: 54, y: 88, width: 43, height: 7 },
]); // seven-left-big-right6
addExisting([
  { id: 'big', x: 3, y: 5, width: 94, height: 48 },
  { id: 'b1', x: 3, y: 57, width: 14.1, height: 38 },
  { id: 'b2', x: 19.1, y: 57, width: 14.1, height: 38 },
  { id: 'b3', x: 35.2, y: 57, width: 14.1, height: 38 },
  { id: 'b4', x: 51.3, y: 57, width: 14.1, height: 38 },
  { id: 'b5', x: 67.4, y: 57, width: 14.1, height: 38 },
  { id: 'b6', x: 83.5, y: 57, width: 13.5, height: 38 },
]); // seven-top-big-bot6
addExisting([
  { id: 'c1', x: 3, y: 5, width: 29.3, height: 55 },
  { id: 'c2', x: 35.3, y: 5, width: 29.3, height: 38 },
  { id: 'c3', x: 67.7, y: 5, width: 29.3, height: 48 },
  { id: 'c4', x: 3, y: 64, width: 29.3, height: 31 },
  { id: 'c5', x: 35.3, y: 47, width: 29.3, height: 34 },
  { id: 'c6', x: 67.7, y: 57, width: 29.3, height: 24 },
  { id: 'span', x: 35.3, y: 82, width: 61.7, height: 13 },
]); // seven-masonry
addExisting([
  { id: 'pan', x: 3, y: 5, width: 94, height: 36 },
  { id: 'r1', x: 3, y: 45, width: 29.3, height: 24 },
  { id: 'r2', x: 35.3, y: 45, width: 29.3, height: 24 },
  { id: 'r3', x: 67.7, y: 45, width: 29.3, height: 24 },
  { id: 'b1', x: 3, y: 72, width: 29.3, height: 23 },
  { id: 'b2', x: 35.3, y: 72, width: 29.3, height: 23 },
  { id: 'b3', x: 67.7, y: 72, width: 29.3, height: 23 },
]); // seven-panorama
addExisting([
  { id: 'center', x: 35, y: 35, width: 30, height: 30 },
  { id: 't', x: 35, y: 5, width: 30, height: 27 },
  { id: 'tr', x: 68, y: 18, width: 27, height: 27 },
  { id: 'br', x: 68, y: 55, width: 27, height: 27 },
  { id: 'b', x: 35, y: 68, width: 30, height: 27 },
  { id: 'bl', x: 5, y: 55, width: 27, height: 27 },
  { id: 'tl', x: 5, y: 18, width: 27, height: 27 },
]); // seven-circle
addExisting([
  { id: 'r1', x: 3, y: 5, width: 45.5, height: 15 },
  { id: 'r2', x: 51.5, y: 5, width: 45.5, height: 15 },
  { id: 'r3', x: 3, y: 23, width: 45.5, height: 15 },
  { id: 'r4', x: 51.5, y: 23, width: 45.5, height: 15 },
  { id: 'r5', x: 3, y: 41, width: 45.5, height: 15 },
  { id: 'r6', x: 51.5, y: 59, width: 45.5, height: 15 },
  { id: 'r7', x: 3, y: 77, width: 94, height: 18 },
]); // seven-zigzag
// 注：seven-2x3-plus1 原本与 seven-3x2-plus1 完全相同，已修正为真正的 2x3+1 布局（2行3列网格 + 底部1横幅）
addExisting([
  { id: 'r1c1', x: 3, y: 5, width: 30, height: 30 },
  { id: 'r1c2', x: 35, y: 5, width: 30, height: 30 },
  { id: 'r1c3', x: 67, y: 5, width: 30, height: 30 },
  { id: 'r2c1', x: 3, y: 37, width: 30, height: 30 },
  { id: 'r2c2', x: 35, y: 37, width: 30, height: 30 },
  { id: 'r2c3', x: 67, y: 37, width: 30, height: 30 },
  { id: 'bot', x: 3, y: 70, width: 94, height: 25 },
]); // seven-2x3-plus1 (修正后：2行3列网格 + 底部1横幅)

// 8图（8个）
addExisting([
  { id: 'r1c1', x: 3, y: 5, width: 21.5, height: 43 },
  { id: 'r1c2', x: 27.5, y: 5, width: 21.5, height: 43 },
  { id: 'r1c3', x: 52, y: 5, width: 21.5, height: 43 },
  { id: 'r1c4', x: 76.5, y: 5, width: 21.5, height: 43 },
  { id: 'r2c1', x: 3, y: 52, width: 21.5, height: 43 },
  { id: 'r2c2', x: 27.5, y: 52, width: 21.5, height: 43 },
  { id: 'r2c3', x: 52, y: 52, width: 21.5, height: 43 },
  { id: 'r2c4', x: 76.5, y: 52, width: 21.5, height: 43 },
]); // eight-grid-4x2
addExisting([
  { id: 'r1c1', x: 3, y: 5, width: 29.3, height: 28.3 },
  { id: 'r1c2', x: 35.3, y: 5, width: 29.3, height: 28.3 },
  { id: 'r1c3', x: 67.7, y: 5, width: 29.3, height: 28.3 },
  { id: 'r2c1', x: 3, y: 36.3, width: 29.3, height: 28.3 },
  { id: 'r2c2', x: 35.3, y: 36.3, width: 29.3, height: 28.3 },
  { id: 'r2c3', x: 67.7, y: 36.3, width: 29.3, height: 28.3 },
  { id: 'r3c1', x: 3, y: 67.7, width: 29.3, height: 27.3 },
  { id: 'r3c2', x: 35.3, y: 67.7, width: 29.3, height: 27.3 },
]); // eight-3x3-minus1
addExisting([
  { id: 'big', x: 3, y: 5, width: 45, height: 90 },
  { id: 'r1', x: 51, y: 5, width: 46, height: 11.6 },
  { id: 'r2', x: 51, y: 19.6, width: 46, height: 11.6 },
  { id: 'r3', x: 51, y: 34.2, width: 46, height: 11.6 },
  { id: 'r4', x: 51, y: 48.8, width: 46, height: 11.6 },
  { id: 'r5', x: 51, y: 63.4, width: 46, height: 11.6 },
  { id: 'r6', x: 51, y: 78, width: 46, height: 8.5 },
  { id: 'r7', x: 51, y: 89.5, width: 46, height: 5.5 },
]); // eight-left-big-right7
addExisting([
  { id: 'big', x: 3, y: 5, width: 94, height: 45 },
  { id: 'b1', x: 3, y: 54, width: 12.5, height: 41 },
  { id: 'b2', x: 17.5, y: 54, width: 12.5, height: 41 },
  { id: 'b3', x: 32, y: 54, width: 12.5, height: 41 },
  { id: 'b4', x: 46.5, y: 54, width: 12.5, height: 41 },
  { id: 'b5', x: 61, y: 54, width: 12.5, height: 41 },
  { id: 'b6', x: 75.5, y: 54, width: 12.5, height: 41 },
  { id: 'b7', x: 90, y: 54, width: 7, height: 41 },
]); // eight-top-big-bot7
addExisting([
  { id: 'c1', x: 3, y: 5, width: 22.5, height: 50 },
  { id: 'c2', x: 28.5, y: 5, width: 22.5, height: 38 },
  { id: 'c3', x: 54, y: 5, width: 22.5, height: 46 },
  { id: 'c4', x: 79.5, y: 5, width: 17.5, height: 30 },
  { id: 'c5', x: 3, y: 59, width: 22.5, height: 36 },
  { id: 'c6', x: 28.5, y: 47, width: 22.5, height: 48 },
  { id: 'c7', x: 54, y: 55, width: 22.5, height: 40 },
  { id: 'c8', x: 79.5, y: 39, width: 17.5, height: 56 },
]); // eight-masonry
addExisting([
  { id: 'c1r1', x: 3, y: 5, width: 45.5, height: 20 },
  { id: 'c2r1', x: 51.5, y: 5, width: 45.5, height: 20 },
  { id: 'c1r2', x: 3, y: 28, width: 45.5, height: 20 },
  { id: 'c2r2', x: 51.5, y: 28, width: 45.5, height: 20 },
  { id: 'c1r3', x: 3, y: 51, width: 45.5, height: 20 },
  { id: 'c2r3', x: 51.5, y: 51, width: 45.5, height: 20 },
  { id: 'c1r4', x: 3, y: 74, width: 45.5, height: 21 },
  { id: 'c2r4', x: 51.5, y: 74, width: 45.5, height: 21 },
]); // eight-2x4
addExisting([
  { id: 'center', x: 38, y: 38, width: 24, height: 24 },
  { id: 't', x: 38, y: 5, width: 24, height: 30 },
  { id: 'tr', x: 65, y: 5, width: 26, height: 30 },
  { id: 'r', x: 65, y: 38, width: 26, height: 24 },
  { id: 'br', x: 65, y: 65, width: 26, height: 25 },
  { id: 'b', x: 38, y: 65, width: 24, height: 25 },
  { id: 'bl', x: 5, y: 65, width: 28, height: 25 },
  { id: 'l', x: 5, y: 38, width: 28, height: 24 },
]); // eight-around
addExisting([
  { id: 'r1', x: 3, y: 5, width: 45.5, height: 20 },
  { id: 'r2', x: 51.5, y: 12, width: 45.5, height: 20 },
  { id: 'r3', x: 3, y: 28, width: 45.5, height: 20 },
  { id: 'r4', x: 51.5, y: 35, width: 45.5, height: 20 },
  { id: 'r5', x: 3, y: 51, width: 45.5, height: 20 },
  { id: 'r6', x: 51.5, y: 58, width: 45.5, height: 20 },
  { id: 'r7', x: 3, y: 74, width: 45.5, height: 20 },
  { id: 'r8', x: 51.5, y: 81, width: 45.5, height: 14 },
]); // eight-stagger

console.log(`Loaded ${existingVisualSigs.size} existing visual signatures, ${existingPatternSigs.size} pattern signatures`);

// ── 现有 ID 集合 ──
const existingIds = new Set([
  'full', 'full-bleed', 'full-framed', 'full-panorama',
  'dual-half', 'dual-big-small', 'dual-stack', 'dual-overlap', 'dual-diagonal',
  'pin-shape', 'triple-col', 'magazine-triple', 'triple-portrait',
  'triple-l-shape', 'triple-stack-right', 'triple-horizontal-big',
  'quad-col', 'quad-grid', 'quad-hero', 'quad-asym', 'quad-stagger',
  'quad-hero-left', 'quad-hero-right', 'quad-triptych-plus', 'quad-masonry',
  'five-top2-bot3', 'five-top3-bot2', 'five-left3-right2', 'five-left2-right3',
  'five-left3-right2-big', 'five-cross', 'magazine-five', 'five-circle-center',
  'five-stagger', 'five-panorama-center', 'five-left-big-right4', 'five-top-big-bot4',
  'six-grid', 'six-hero-grid', 'six-magazine', 'six-3x2-alt',
  'six-left-big-right5', 'six-top-big-bot5', 'six-around',
  'seven-3x2-plus1', 'seven-left-big-right6', 'seven-top-big-bot6', 'seven-masonry',
  'seven-panorama', 'seven-circle', 'seven-zigzag', 'seven-2x3-plus1',
  'eight-grid-4x2', 'eight-3x3-minus1', 'eight-left-big-right7', 'eight-top-big-bot7',
  'eight-masonry', 'eight-2x4', 'eight-around', 'eight-stagger',
]);

// ════════════════════════════════════════
// 基础布局生成器（用于参考，主要使用 Mixbook 风格生成器）
// ════════════════════════════════════════

function genGrid(cols, rows, margin = 3, gap = 2) {
  const slots = [];
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  const slotW = (totalW - (cols - 1) * gap) / cols;
  const slotH = (totalH - (rows - 1) * gap) / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({
        id: `r${row + 1}c${col + 1}`,
        x: r(margin + col * (slotW + gap)),
        y: r(margin + row * (slotH + gap)),
        width: r(slotW),
        height: r(slotH),
      });
    }
  }
  return slots;
}

function genMagazine(count, bigSide = 'left', bigRatio = 0.55, margin = 3, gap = 2) {
  const slots = [];
  const smallCount = count - 1;
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  if (bigSide === 'left' || bigSide === 'right') {
    const bigW = totalW * bigRatio;
    const smallW = totalW - bigW - gap;
    const bigX = bigSide === 'left' ? margin : margin + smallW + gap;
    const smallX = bigSide === 'left' ? margin + bigW + gap : margin;
    slots.push({ id: 'big', x: r(bigX), y: r(margin), width: r(bigW), height: r(totalH) });
    const smallH = (totalH - (smallCount - 1) * gap) / smallCount;
    for (let i = 0; i < smallCount; i++) {
      slots.push({
        id: slotId('s', i),
        x: r(smallX),
        y: r(margin + i * (smallH + gap)),
        width: r(smallW),
        height: r(smallH),
      });
    }
  } else {
    const bigH = totalH * bigRatio;
    const smallH = totalH - bigH - gap;
    const bigY = bigSide === 'top' ? margin : margin + smallH + gap;
    const smallY = bigSide === 'top' ? margin + bigH + gap : margin;
    slots.push({ id: 'big', x: r(margin), y: r(bigY), width: r(totalW), height: r(bigH) });
    const smallW = (totalW - (smallCount - 1) * gap) / smallCount;
    for (let i = 0; i < smallCount; i++) {
      slots.push({
        id: slotId('s', i),
        x: r(margin + i * (smallW + gap)),
        y: r(smallY),
        width: r(smallW),
        height: r(smallH),
      });
    }
  }
  return slots;
}

function genFilmstrip(count, margin = 3, heightPct = 90) {
  const slots = [];
  const gap = 1.5;
  const totalW = 100 - 2 * margin;
  const slotW = (totalW - (count - 1) * gap) / count;
  const y = (100 - heightPct) / 2;
  for (let i = 0; i < count; i++) {
    slots.push({
      id: slotId('f', i),
      x: r(margin + i * (slotW + gap)),
      y: r(y),
      width: r(slotW),
      height: r(heightPct),
    });
  }
  return slots;
}

function genTriptych(count) {
  const margin = 3, gap = 2;
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  const bigH = totalH * 0.5;
  const smallH = totalH - bigH - gap;
  const slots = [{ id: 'top', x: r(margin), y: r(margin), width: r(totalW), height: r(bigH) }];
  const smallCount = count - 1;
  const smallW = (totalW - (smallCount - 1) * gap) / smallCount;
  for (let i = 0; i < smallCount; i++) {
    slots.push({
      id: slotId('b', i),
      x: r(margin + i * (smallW + gap)),
      y: r(margin + bigH + gap),
      width: r(smallW),
      height: r(smallH),
    });
  }
  return slots;
}

function genLPattern(count) {
  const margin = 3, gap = 2;
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  const slots = [];
  const bigW = totalW * 0.58;
  const smallW = totalW - bigW - gap;
  slots.push({ id: 'big', x: r(margin), y: r(margin), width: r(bigW), height: r(totalH) });
  const smallCount = count - 1;
  const smallH = (totalH - (smallCount - 1) * gap) / smallCount;
  for (let i = 0; i < smallCount; i++) {
    slots.push({
      id: slotId('r', i),
      x: r(margin + bigW + gap),
      y: r(margin + i * (smallH + gap)),
      width: r(smallW),
      height: r(smallH),
    });
  }
  return slots;
}

function genDiagonal(count) {
  const margin = 3;
  const slots = [];
  const totalArea = 100 - 2 * margin;
  const slotSize = totalArea / count * 0.75;
  const step = (totalArea - slotSize) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    slots.push({
      id: slotId('d', i),
      x: r(margin + i * step),
      y: r(margin + i * step),
      width: r(slotSize),
      height: r(slotSize),
    });
  }
  return slots;
}

// ════════════════════════════════════════
// Mixbook 风格创意生成器（重点增强）
// ════════════════════════════════════════

/**
 * 1. 散落照片堆 (Photo Pile)：等大照片螺旋散射堆叠
 *    模拟一叠照片散落在桌面的效果，每张照片有偏移
 */
function genPhotoPile(count) {
  const slots = [];
  const margin = 6;
  const photoSize = count <= 3 ? 50 : count <= 5 ? 42 : count <= 8 ? 36 : 30;
  const centerX = 50, centerY = 50;
  for (let i = 0; i < count; i++) {
    // 螺旋分布
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.3;
    const radius = (i / count) * (45 - photoSize / 2) * 0.7;
    const x = centerX + Math.cos(angle) * radius - photoSize / 2;
    const y = centerY + Math.sin(angle) * radius - photoSize / 2;
    slots.push({
      id: slotId('p', i),
      x: r(clamp(x, margin, 100 - margin - photoSize)),
      y: r(clamp(y, margin, 100 - margin - photoSize)),
      width: r(photoSize),
      height: r(photoSize),
    });
  }
  return slots;
}

/**
 * 2. 阶梯瀑布 (Cascade Stair)：照片沿对角线阶梯式排列
 *    每张照片比前一张向下偏移，形成瀑布效果
 */
function genCascadeStair(count) {
  const slots = [];
  const margin = 4;
  const photoW = count <= 4 ? 55 : count <= 6 ? 45 : 38;
  const photoH = count <= 4 ? 40 : count <= 6 ? 35 : 30;
  const stepX = (100 - 2 * margin - photoW) / Math.max(1, count - 1);
  const stepY = (100 - 2 * margin - photoH) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    slots.push({
      id: slotId('s', i),
      x: r(margin + i * stepX * 0.6),
      y: r(margin + i * stepY),
      width: r(photoW),
      height: r(photoH),
    });
  }
  return slots;
}

/**
 * 3. 框中框 (Frame in Frame)：大图作为背景，小图叠加在中央
 *    类似相框效果，主图全幅，叠加图居中
 */
function genFrameInFrame(count) {
  const slots = [];
  const margin = 3;
  // 背景大图
  slots.push({ id: 'bg', x: r(margin), y: r(margin), width: r(100 - 2 * margin), height: r(100 - 2 * margin) });
  // 叠加小图：居中排列
  const innerCount = count - 1;
  if (innerCount === 0) return slots;
  const innerSize = 35;
  const innerGap = 2;
  if (innerCount === 1) {
    slots.push({
      id: 'fg',
      x: r(50 - innerSize / 2),
      y: r(50 - innerSize / 2),
      width: r(innerSize),
      height: r(innerSize),
    });
  } else if (innerCount === 2) {
    // 上下居中
    const w = 40, h = 28;
    slots.push({ id: 'fg1', x: r(50 - w / 2), y: r(50 - h - 1), width: r(w), height: r(h) });
    slots.push({ id: 'fg2', x: r(50 - w / 2), y: r(50 + 1), width: r(w), height: r(h) });
  } else {
    // 网格居中
    const cols = Math.ceil(Math.sqrt(innerCount));
    const rows = Math.ceil(innerCount / cols);
    const cellW = (innerSize - (cols - 1) * innerGap) / cols;
    const cellH = (innerSize - (rows - 1) * innerGap) / rows;
    for (let i = 0; i < innerCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({
        id: slotId('fg', i),
        x: r(50 - innerSize / 2 + col * (cellW + innerGap)),
        y: r(50 - innerSize / 2 + row * (cellH + innerGap)),
        width: r(cellW),
        height: r(cellH),
      });
    }
  }
  return slots;
}

/**
 * 4. 不对称深叠 (Asymmetric Overlap)：大图 + 多个小图深度叠加
 *    主图占大部分，小图压叠在角落，深度叠加
 */
function genAsymmetricOverlap(count, depth = 0.35) {
  const margin = 4;
  const slots = [];
  const totalArea = 100 - 2 * margin;
  // 主图占左上 60%
  const mainW = totalArea * 0.62;
  const mainH = totalArea * 0.68;
  slots.push({ id: 'main', x: r(margin), y: r(margin), width: r(mainW), height: r(mainH) });
  // 其余小图压叠在右下角
  const smallCount = count - 1;
  const smallSize = totalArea * 0.32;
  const step = smallSize * (1 - depth);
  for (let i = 0; i < smallCount; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    let x = margin + mainW - smallSize * 0.35 + col * step;
    let y = margin + mainH - smallSize * 0.25 + row * step;
    x = clamp(x, margin, 100 - margin - smallSize);
    y = clamp(y, margin, 100 - margin - smallSize);
    slots.push({
      id: slotId('o', i),
      x: r(x),
      y: r(y),
      width: r(smallSize),
      height: r(smallSize),
    });
  }
  return slots;
}

/**
 * 5. 杂志拼贴 (Magazine Collage)：1 大图 + 散落小图
 *    杂志风英雄图 + 围绕的细节小图
 */
function genMagazineCollage(count, heroSide = 'left') {
  const margin = 3, gap = 2;
  const slots = [];
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  const smallCount = count - 1;
  if (heroSide === 'left' || heroSide === 'right') {
    const heroW = totalW * 0.62;
    const stripW = totalW - heroW - gap;
    const heroX = heroSide === 'left' ? margin : margin + stripW + gap;
    const stripX = heroSide === 'left' ? margin + heroW + gap : margin;
    // 英雄图占 75% 高度，居中
    const heroH = totalH * 0.78;
    const heroY = margin + (totalH - heroH) / 2;
    slots.push({ id: 'hero', x: r(heroX), y: r(heroY), width: r(heroW), height: r(heroH) });
    // 细节小图：不等高分布
    const heights = smallCount === 1 ? [totalH]
      : smallCount === 2 ? [totalH * 0.55, totalH * 0.43]
      : smallCount === 3 ? [totalH * 0.35, totalH * 0.30, totalH * 0.33]
      : Array(smallCount).fill((totalH - (smallCount - 1) * gap) / smallCount);
    let y = margin;
    for (let i = 0; i < smallCount; i++) {
      slots.push({
        id: slotId('d', i),
        x: r(stripX),
        y: r(y),
        width: r(stripW),
        height: r(heights[i]),
      });
      y += heights[i] + gap;
    }
  } else {
    const heroH = totalH * 0.62;
    const stripH = totalH - heroH - gap;
    const heroY = heroSide === 'top' ? margin : margin + stripH + gap;
    const stripY = heroSide === 'top' ? margin + heroH + gap : margin;
    const heroW = totalW * 0.78;
    const heroX = margin + (totalW - heroW) / 2;
    slots.push({ id: 'hero', x: r(heroX), y: r(heroY), width: r(heroW), height: r(heroH) });
    const smallW = (totalW - (smallCount - 1) * gap) / smallCount;
    for (let i = 0; i < smallCount; i++) {
      slots.push({
        id: slotId('d', i),
        x: r(margin + i * (smallW + gap)),
        y: r(stripY),
        width: r(smallW),
        height: r(stripH),
      });
    }
  }
  return slots;
}

/**
 * 6. 宝丽来堆 (Polaroid Pile)：等大照片错位堆叠
 *    模拟一叠宝丽来照片，每张照片错位排列
 */
function genPolaroidPile(count) {
  const slots = [];
  const margin = 8;
  const cardW = count <= 3 ? 55 : count <= 5 ? 48 : 42;
  const cardH = count <= 3 ? 55 : count <= 5 ? 48 : 42;
  const maxOffsetX = 100 - 2 * margin - cardW;
  const maxOffsetY = 100 - 2 * margin - cardH;
  for (let i = 0; i < count; i++) {
    // 之字形错位
    const offsetX = (i / Math.max(1, count - 1)) * maxOffsetX;
    const offsetY = (i / Math.max(1, count - 1)) * maxOffsetY * 0.5
      + (i % 2 === 0 ? 0 : maxOffsetY * 0.3);
    slots.push({
      id: slotId('card', i),
      x: r(margin + offsetX),
      y: r(clamp(margin + offsetY, margin, 100 - margin - cardH)),
      width: r(cardW),
      height: r(cardH),
    });
  }
  return slots;
}

/**
 * 7. 对角级联 (Diagonal Cascade)：沿对角线错落大小交替
 *    大小照片交替，沿对角线分布
 */
function genDiagonalCascade(count) {
  const slots = [];
  const margin = 4;
  const totalArea = 100 - 2 * margin;
  const bigSize = totalArea * 0.45;
  const smallSize = totalArea * 0.32;
  const stepX = (totalArea - bigSize) / Math.max(1, Math.ceil(count / 2) - 1);
  const stepY = (totalArea - bigSize) / Math.max(1, Math.ceil(count / 2) - 1);
  for (let i = 0; i < count; i++) {
    const isBig = i % 2 === 0;
    const size = isBig ? bigSize : smallSize;
    const pairIdx = Math.floor(i / 2);
    const x = margin + pairIdx * stepX + (isBig ? 0 : bigSize * 0.3);
    const y = margin + pairIdx * stepY + (isBig ? 0 : bigSize * 0.3);
    slots.push({
      id: slotId('d', i),
      x: r(clamp(x, margin, 100 - margin - size)),
      y: r(clamp(y, margin, 100 - margin - size)),
      width: r(size),
      height: r(size),
    });
  }
  return slots;
}

/**
 * 8. 阶梯扇形 (Stepped Fan)：扇形展开的阶梯布局
 *    照片以扇形方式展开，每张照片向不同方向偏移
 */
function genSteppedFan(count) {
  const slots = [];
  const margin = 5;
  const photoW = count <= 4 ? 50 : count <= 6 ? 42 : 35;
  const photoH = count <= 4 ? 38 : count <= 6 ? 32 : 28;
  const centerX = 50;
  const baseY = 50;
  for (let i = 0; i < count; i++) {
    // 扇形分布：从左到右，y 上下波动
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = (t - 0.5) * Math.PI * 0.6; // ±54°
    const radius = 30;
    const x = centerX + (t - 0.5) * (100 - 2 * margin - photoW);
    const y = baseY + Math.sin(angle) * radius - photoH / 2;
    slots.push({
      id: slotId('f', i),
      x: r(clamp(x, margin, 100 - margin - photoW)),
      y: r(clamp(y, margin, 100 - margin - photoH)),
      width: r(photoW),
      height: r(photoH),
    });
  }
  return slots;
}

/**
 * 9. 错落瀑布流 (Masonry Stagger)：多列不等高瀑布流
 */
function genMasonryStagger(count, cols = 3) {
  const margin = 3, gap = 2;
  const slots = [];
  const totalW = 100 - 2 * margin;
  const totalH = 100 - 2 * margin;
  const slotW = (totalW - (cols - 1) * gap) / cols;
  const colYs = new Array(cols).fill(margin);
  const colCounts = new Array(cols).fill(0);
  // 高度模式：交替不等高
  const heightPatterns = [
    [0.55, 0.40],
    [0.40, 0.55],
    [0.48, 0.48],
  ];
  for (let i = 0; i < count; i++) {
    let minCol = 0;
    for (let c = 1; c < cols; c++) {
      if (colYs[c] < colYs[minCol]) minCol = c;
    }
    const pattern = heightPatterns[minCol % heightPatterns.length];
    const idx = colCounts[minCol];
    const heightRatio = pattern[idx % pattern.length];
    let slotH = totalH * heightRatio;
    if (colYs[minCol] + slotH > 100 - margin) {
      const remainH = 100 - margin - colYs[minCol];
      if (remainH > 5) slotH = remainH;
      else break;
    }
    slots.push({
      id: slotId('m', i),
      x: r(margin + minCol * (slotW + gap)),
      y: r(colYs[minCol]),
      width: r(slotW),
      height: r(slotH),
    });
    colYs[minCol] = r(colYs[minCol] + slotH + gap);
    colCounts[minCol]++;
  }
  return slots;
}

/**
 * 10. 中心环绕 (Center Surround)：1 中心图 + 其余环绕
 */
function genCenterSurround(count) {
  const slots = [];
  const margin = 3;
  const centerSize = count <= 5 ? 36 : count <= 7 ? 32 : 28;
  slots.push({
    id: 'center',
    x: r(50 - centerSize / 2),
    y: r(50 - centerSize / 2),
    width: r(centerSize),
    height: r(centerSize),
  });
  const surroundCount = count - 1;
  // 环绕图：上下左右 + 对角
  const positions = [
    { x: 50, y: margin, w: centerSize, h: (100 - 2 * margin - centerSize) / 2 - margin },
    { x: 50, y: 50 + centerSize / 2 + 1, w: centerSize, h: (100 - 2 * margin - centerSize) / 2 - margin },
    { x: margin, y: 50, w: (50 - margin - centerSize / 2), h: centerSize },
    { x: 50 + centerSize / 2 + 1, y: 50, w: (50 - margin - centerSize / 2), h: centerSize },
    { x: margin, y: margin, w: (50 - margin - centerSize / 2), h: (50 - margin - centerSize / 2) },
    { x: 50 + centerSize / 2 + 1, y: margin, w: (50 - margin - centerSize / 2), h: (50 - margin - centerSize / 2) },
    { x: margin, y: 50 + centerSize / 2 + 1, w: (50 - margin - centerSize / 2), h: (50 - margin - centerSize / 2) },
    { x: 50 + centerSize / 2 + 1, y: 50 + centerSize / 2 + 1, w: (50 - margin - centerSize / 2), h: (50 - margin - centerSize / 2) },
    { x: margin, y: margin, w: 100 - 2 * margin, h: 100 - 2 * margin }, // 全幅
  ];
  for (let i = 0; i < Math.min(surroundCount, positions.length); i++) {
    const p = positions[i];
    slots.push({
      id: slotId('s', i),
      x: r(p.x === 50 ? 50 - p.w / 2 : p.x),
      y: r(p.y === 50 ? 50 - p.h / 2 : p.y),
      width: r(p.w),
      height: r(p.h),
    });
  }
  // 如果还有多余的，放在四角
  while (slots.length < count) {
    const i = slots.length - 1;
    slots.push({
      id: slotId('extra', i),
      x: r(margin + (i % 4) * 20),
      y: r(margin + Math.floor(i / 4) * 20),
      width: r(15),
      height: r(15),
    });
  }
  return slots;
}

/**
 * 11. 阶梯叠层 (Staircase Stack)：照片沿对角线阶梯式叠加
 *    每张照片比前一张向右下偏移，形成阶梯叠加效果（Mixbook 经典风格）
 */
function genStaircaseStack(count) {
  const slots = [];
  const margin = 4;
  const photoW = count <= 3 ? 55 : count <= 5 ? 48 : count <= 8 ? 42 : 36;
  const photoH = count <= 3 ? 42 : count <= 5 ? 36 : count <= 8 ? 32 : 28;
  const stepX = (100 - 2 * margin - photoW) / Math.max(1, count - 1);
  const stepY = (100 - 2 * margin - photoH) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    slots.push({
      id: slotId('s', i),
      x: r(margin + i * stepX),
      y: r(margin + i * stepY),
      width: r(photoW),
      height: r(photoH),
    });
  }
  return slots;
}

/**
 * 12. 错位拼贴 (Shifted Collage)：不等大照片错位叠加拼贴
 *    大小交替的照片以错位方式排列，形成丰富层次感
 */
function genShiftedCollage(count) {
  const slots = [];
  const margin = 3;
  const bigW = 52, bigH = 38;
  const smallW = 38, smallH = 30;
  const positions = [
    { x: margin, y: margin, w: bigW, h: bigH },
    { x: 45, y: 8, w: smallW, h: smallH },
    { x: 62, y: margin, w: 35, h: bigH },
    { x: 15, y: 42, w: smallW, h: smallH },
    { x: 50, y: 38, w: bigW, h: bigH },
    { x: margin, y: 62, w: 35, h: 35 },
    { x: 40, y: 68, w: smallW, h: 29 },
    { x: 68, y: 55, w: 29, h: 42 },
  ];
  for (let i = 0; i < count; i++) {
    const p = positions[i % positions.length];
    slots.push({
      id: slotId('c', i),
      x: r(clamp(p.x, margin, 100 - margin - p.w)),
      y: r(clamp(p.y, margin, 100 - margin - p.h)),
      width: r(p.w),
      height: r(p.h),
    });
  }
  return slots;
}

// ── preview 值映射 ──
function getPreview(count) {
  if (count <= 1) return 'full';
  if (count <= 2) return 'dual';
  if (count <= 3) return 'triple';
  if (count <= 4) return 'quad';
  return 'collage';
}

// ── 模板生成（双重去重 + 模式变体限制） ──
const templates = [];
let idCounter = 0;
let skippedVisualDup = 0;
let skippedPatternLimit = 0;
const generatedPatternSigs = new Map(); // pattern → count
const MAX_PER_PATTERN = 2; // 每种结构模式最多保留 2 个变体

function makeTemplate(slots, name, category, tags) {
  const count = slots.length;
  const preview = getPreview(count);

  // 去重 1：5% 网格精确签名（近似完全重复检测）
  const eSig = exactSignature(slots);
  if (existingExactSigs.has(eSig)) {
    skippedVisualDup++;
    return false;
  }
  for (const t of templates) {
    if (exactSignature(t.slots) === eSig) {
      skippedVisualDup++;
      return false;
    }
  }

  // 去重 2：10% 网格视觉签名（视觉相似去重）
  const vSig = visualSignature(slots);
  if (existingVisualSigs.has(vSig)) {
    skippedVisualDup++;
    return false;
  }
  for (const t of templates) {
    if (visualSignature(t.slots) === vSig) {
      skippedVisualDup++;
      return false;
    }
  }

  // 去重 3：结构模式签名，限制每种模式最多 MAX_PER_PATTERN 个变体
  // 1 图模板跳过模式限制（单矩形模式签名恒相同，靠 10% 视觉签名去重即可）
  if (count >= 2) {
    const pSig = patternSignature(slots);
    const existingCount = existingPatternSigs.get(pSig) || 0;
    const generatedCount = generatedPatternSigs.get(pSig) || 0;
    if (existingCount + generatedCount >= MAX_PER_PATTERN) {
      skippedPatternLimit++;
      return false;
    }
    generatedPatternSigs.set(pSig, generatedCount + 1);
  }

  // 通过去重，记录签名
  existingExactSigs.add(eSig);
  existingVisualSigs.add(vSig);

  // 生成唯一 ID
  let id;
  do {
    idCounter++;
    id = `gen-${count}p-${idCounter}`;
  } while (existingIds.has(id));
  existingIds.add(id);

  validateSlots(slots);
  templates.push({ id, name, category, slots, preview, tags });
  return true;
}

// ════════════════════════════════════════
// 模板生成：精选每个槽位数的高质量布局
// ════════════════════════════════════════

// ── 1 图（仅补充创意布局，现有 4 个已足够） ──
makeTemplate([{ id: 'main', x: 15, y: 15, width: 70, height: 70 }], '极简留白', 'classic', ['white-space', 'minimal']);
makeTemplate([{ id: 'main', x: 20, y: 20, width: 60, height: 60 }], '小方居中', 'personality', ['white-space', 'minimal']);

// ── 2 图（Mixbook 风格叠加布局） ──
makeTemplate(genAsymmetricOverlap(2, 0.4), '深叠双图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(2), '散落双图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genPolaroidPile(2), '宝丽来双图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(2), '阶梯双图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(2), '阶梯叠层双图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(2, 'left'), '杂志英雄双图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(2, 'top'), '上英雄双图', 'creative', ['magazine']);
makeTemplate([
  { id: 'tl', x: 5, y: 8, width: 60, height: 50 },
  { id: 'br', x: 35, y: 45, width: 60, height: 50 },
], '大对角叠图', 'creative', ['overlap']);
makeTemplate(genFilmstrip(2, 12, 65), '留白胶片双图', 'classic', ['filmstrip', 'white-space']);
makeTemplate([
  { id: 'l', x: 3, y: 5, width: 40, height: 90 },
  { id: 'r', x: 50, y: 5, width: 47, height: 90 },
], '不等宽双图', 'personality', ['grid']);

// ── 3 图 ──
makeTemplate(genAsymmetricOverlap(3, 0.3), '深叠三图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(3), '散落三图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genPolaroidPile(3), '宝丽来三图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(3), '阶梯三图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(3), '阶梯叠层三图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(3, 'left'), '杂志英雄三图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(3, 'top'), '上英雄三图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(3), '框中框三图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(3), '对角级联三图', 'personality', ['stagger', 'collage']);
makeTemplate(genSteppedFan(3), '扇形三图', 'creative', ['stagger', 'collage']);
makeTemplate(genMasonryStagger(3, 3), '瀑布三图', 'personality', ['stagger', 'masonry']);
makeTemplate(genFilmstrip(3, 12, 60), '留白胶片三图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(3), 'L 型三图', 'creative', ['stagger']);
makeTemplate([
  { id: 'l', x: 3, y: 5, width: 35, height: 90 },
  { id: 'rt', x: 42, y: 5, width: 55, height: 42 },
  { id: 'rb', x: 42, y: 52, width: 55, height: 43 },
], '左窄右品字', 'personality', ['grid']);

// ── 4 图 ──
makeTemplate(genAsymmetricOverlap(4, 0.28), '深叠四图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(4), '散落四图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genPolaroidPile(4), '宝丽来四图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(4), '阶梯四图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(4), '阶梯叠层四图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(4, 'left'), '杂志英雄四图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(4, 'top'), '上英雄四图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(4), '框中框四图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(4), '对角级联四图', 'personality', ['stagger', 'collage']);
makeTemplate(genSteppedFan(4), '扇形四图', 'creative', ['stagger', 'collage']);
makeTemplate(genShiftedCollage(4), '错位拼贴四图', 'personality', ['overlap', 'collage']);
makeTemplate(genMasonryStagger(4, 2), '两列瀑布四图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(4, 3), '三列瀑布四图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(4), '中心环绕四图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(4, 12, 60), '留白胶片四图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genTriptych(4), '三联加一', 'classic', ['grid']);
makeTemplate([
  { id: 'big', x: 3, y: 3, width: 55, height: 94 },
  { id: 'rt', x: 61, y: 3, width: 36, height: 29 },
  { id: 'rm', x: 61, y: 36, width: 36, height: 29 },
  { id: 'rb', x: 61, y: 69, width: 36, height: 28 },
], '左大右三横', 'creative', ['magazine']);

// ── 5 图 ──
makeTemplate(genAsymmetricOverlap(5, 0.25), '深叠五图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(5), '散落五图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genPolaroidPile(5), '宝丽来五图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(5), '阶梯五图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(5), '阶梯叠层五图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(5, 'left'), '杂志英雄五图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(5, 'top'), '上英雄五图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(5), '框中框五图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(5), '对角级联五图', 'personality', ['stagger', 'collage']);
makeTemplate(genSteppedFan(5), '扇形五图', 'creative', ['stagger', 'collage']);
makeTemplate(genShiftedCollage(5), '错位拼贴五图', 'personality', ['overlap', 'collage']);
makeTemplate(genMasonryStagger(5, 3), '三列瀑布五图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(5), '中心环绕五图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(5, 12, 55), '留白胶片五图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(5), 'L 型五图', 'creative', ['stagger']);
makeTemplate(genTriptych(5), '上大下四', 'classic', ['grid']);
makeTemplate([
  { id: 't1', x: 3, y: 8, width: 35, height: 40 },
  { id: 't2', x: 33, y: 3, width: 35, height: 40 },
  { id: 't3', x: 62, y: 10, width: 35, height: 40 },
  { id: 'b1', x: 15, y: 42, width: 38, height: 40 },
  { id: 'b2', x: 50, y: 48, width: 38, height: 40 },
], '错位叠加五图', 'creative', ['overlap', 'collage']);

// ── 6 图 ──
makeTemplate(genAsymmetricOverlap(6, 0.22), '深叠六图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(6), '散落六图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genPolaroidPile(6), '宝丽来六图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(6), '阶梯六图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(6), '阶梯叠层六图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(6, 'left'), '杂志英雄六图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(6, 'top'), '上英雄六图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(6), '框中框六图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(6), '对角级联六图', 'personality', ['stagger', 'collage']);
makeTemplate(genSteppedFan(6), '扇形六图', 'creative', ['stagger', 'collage']);
makeTemplate(genShiftedCollage(6), '错位拼贴六图', 'personality', ['overlap', 'collage']);
makeTemplate(genMasonryStagger(6, 3), '三列瀑布六图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(6, 2), '两列瀑布六图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(6), '中心环绕六图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(6, 12, 50), '留白胶片六图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(6), 'L 型六图', 'creative', ['stagger']);
makeTemplate([
  { id: 'big', x: 3, y: 3, width: 55, height: 55 },
  { id: 'r1', x: 61, y: 3, width: 36, height: 17 },
  { id: 'r2', x: 61, y: 23, width: 36, height: 17 },
  { id: 'r3', x: 61, y: 43, width: 36, height: 15 },
  { id: 'b1', x: 3, y: 62, width: 28, height: 35 },
  { id: 'b2', x: 34, y: 62, width: 28, height: 35 },
], '主图加五小', 'creative', ['magazine', 'collage']);

// ── 7 图 ──
makeTemplate(genAsymmetricOverlap(7, 0.2), '深叠七图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(7), '散落七图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(7), '阶梯七图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(7), '阶梯叠层七图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(7, 'left'), '杂志英雄七图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(7, 'top'), '上英雄七图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(7), '框中框七图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(7), '对角级联七图', 'personality', ['stagger', 'collage']);
makeTemplate(genShiftedCollage(7), '错位拼贴七图', 'personality', ['overlap', 'collage']);
makeTemplate(genMasonryStagger(7, 4), '四列瀑布七图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(7, 3), '三列瀑布七图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(7), '中心环绕七图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(7, 12, 45), '留白胶片七图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(7), 'L 型七图', 'creative', ['stagger']);
makeTemplate(genTriptych(7), '上大下六横', 'classic', ['grid']);
makeTemplate([
  { id: 'big', x: 3, y: 3, width: 50, height: 94 },
  { id: 'r1', x: 56, y: 3, width: 41, height: 14 },
  { id: 'r2', x: 56, y: 20, width: 41, height: 14 },
  { id: 'r3', x: 56, y: 37, width: 41, height: 14 },
  { id: 'r4', x: 56, y: 54, width: 41, height: 14 },
  { id: 'r5', x: 56, y: 71, width: 41, height: 14 },
  { id: 'r6', x: 56, y: 88, width: 41, height: 9 },
], '左大右六窄', 'creative', ['magazine']);

// ── 8 图 ──
makeTemplate(genAsymmetricOverlap(8, 0.18), '深叠八图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(8), '散落八图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(8), '阶梯八图', 'creative', ['stagger', 'collage']);
makeTemplate(genStaircaseStack(8), '阶梯叠层八图', 'creative', ['overlap', 'collage']);
makeTemplate(genMagazineCollage(8, 'left'), '杂志英雄八图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(8, 'top'), '上英雄八图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(8), '框中框八图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(8), '对角级联八图', 'personality', ['stagger', 'collage']);
makeTemplate(genShiftedCollage(8), '错位拼贴八图', 'personality', ['overlap', 'collage']);
makeTemplate(genMasonryStagger(8, 4), '四列瀑布八图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(8, 3), '三列瀑布八图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(8), '中心环绕八图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(8, 12, 45), '留白胶片八图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(8), 'L 型八图', 'creative', ['stagger']);
makeTemplate(genTriptych(8), '上大下七横', 'classic', ['grid']);
makeTemplate(genGrid(2, 4, 3, 2), '两列四行', 'classic', ['grid']);

// ── 9 图 ──
makeTemplate(genAsymmetricOverlap(9, 0.18), '深叠九图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(9), '散落九图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(9), '阶梯九图', 'creative', ['stagger', 'collage']);
makeTemplate(genMagazineCollage(9, 'left'), '杂志英雄九图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(9, 'top'), '上英雄九图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(9), '框中框九图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(9), '对角级联九图', 'personality', ['stagger', 'collage']);
makeTemplate(genMasonryStagger(9, 3), '三列瀑布九图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(9, 4), '四列瀑布九图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(9), '中心环绕九图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(9, 12, 40), '留白胶片九图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(9), 'L 型九图', 'creative', ['stagger']);
makeTemplate(genTriptych(9), '上大下八横', 'classic', ['grid']);
makeTemplate(genGrid(3, 3, 5, 1), '紧凑九宫', 'classic', ['grid']);

// ── 10 图 ──
makeTemplate(genAsymmetricOverlap(10, 0.15), '深叠十图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(10), '散落十图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(10), '阶梯十图', 'creative', ['stagger', 'collage']);
makeTemplate(genMagazineCollage(10, 'left'), '杂志英雄十图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(10, 'top'), '上英雄十图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(10), '框中框十图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(10), '对角级联十图', 'personality', ['stagger', 'collage']);
makeTemplate(genMasonryStagger(10, 5), '五列瀑布十图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(10, 4), '四列瀑布十图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(10), '中心环绕十图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(10, 12, 35), '留白胶片十图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(10), 'L 型十图', 'creative', ['stagger']);
makeTemplate(genTriptych(10), '上大下九横', 'classic', ['grid']);
makeTemplate(genGrid(5, 2, 5, 1.5), '紧凑十宫', 'classic', ['grid']);

// ── 11 图 ──
makeTemplate(genAsymmetricOverlap(11, 0.15), '深叠十一图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(11), '散落十一图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(11), '阶梯十一图', 'creative', ['stagger', 'collage']);
makeTemplate(genMagazineCollage(11, 'left'), '杂志英雄十一图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(11, 'top'), '上英雄十一图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(11), '框中框十一图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(11), '对角级联十一图', 'personality', ['stagger', 'collage']);
makeTemplate(genMasonryStagger(11, 4), '四列瀑布十一图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(11, 5), '五列瀑布十一图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(11), '中心环绕十一图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(11, 10, 30), '留白胶片十一图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(11), 'L 型十一图', 'creative', ['stagger']);
makeTemplate(genTriptych(11), '上大下十横', 'classic', ['grid']);
makeTemplate(genGrid(4, 3, 5, 1.5).slice(0, 11), '四列三行取十一', 'classic', ['grid']);

// ── 12 图 ──
makeTemplate(genAsymmetricOverlap(12, 0.12), '深叠十二图', 'creative', ['overlap', 'collage']);
makeTemplate(genPhotoPile(12), '散落十二图', 'personality', ['collage', 'scrapbook']);
makeTemplate(genCascadeStair(12), '阶梯十二图', 'creative', ['stagger', 'collage']);
makeTemplate(genMagazineCollage(12, 'left'), '杂志英雄十二图', 'creative', ['magazine']);
makeTemplate(genMagazineCollage(12, 'top'), '上英雄十二图', 'creative', ['magazine']);
makeTemplate(genFrameInFrame(12), '框中框十二图', 'personality', ['overlap', 'collage']);
makeTemplate(genDiagonalCascade(12), '对角级联十二图', 'personality', ['stagger', 'collage']);
makeTemplate(genMasonryStagger(12, 4), '四列瀑布十二图', 'personality', ['stagger', 'masonry']);
makeTemplate(genMasonryStagger(12, 6), '六列瀑布十二图', 'personality', ['stagger', 'masonry']);
makeTemplate(genCenterSurround(12), '中心环绕十二图', 'creative', ['stagger']);
makeTemplate(genFilmstrip(12, 10, 30), '留白胶片十二图', 'classic', ['filmstrip', 'white-space']);
makeTemplate(genLPattern(12), 'L 型十二图', 'creative', ['stagger']);
makeTemplate(genTriptych(12), '上大下十一横', 'classic', ['grid']);
makeTemplate(genGrid(4, 3, 5, 1.5), '紧凑十二宫', 'classic', ['grid']);

// ── 统计与校验 ──
const idSet = new Set();
for (const t of templates) {
  if (idSet.has(t.id)) throw new Error(`Duplicate ID: ${t.id}`);
  idSet.add(t.id);
  validateSlots(t.slots);
}

console.log(`\n=== 生成结果 ===`);
console.log(`Generated ${templates.length} templates`);
console.log(`Skipped: ${skippedVisualDup} visual duplicates, ${skippedPatternLimit} pattern limit`);
const byCount = {};
for (const t of templates) {
  const c = t.slots.length;
  byCount[c] = (byCount[c] || 0) + 1;
}
console.log('By photo count:', byCount);
console.log(`Total: 60 existing + ${templates.length} generated = ${60 + templates.length} templates`);

// ── 输出 TypeScript 文件 ──
const outputPath = path.join(__dirname, '..', 'src', 'types', 'generated-templates.ts');
const header = `/* eslint-disable */
/* 自动生成文件 - 请勿手动编辑，运行 node scripts/gen-templates.cjs 重新生成 */
/* v3: 10% 网格去重 + 模式变体限制(≤2) + Mixbook 风格创意叠加布局 */
import type { Template } from './index';

export const GENERATED_TEMPLATES: Template[] = `;

const tsContent = `${header}[
${templates.map(t => `  ${JSON.stringify(t).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/'(\[.*?\])'/g, '$1')},`).join('\n')}
];
`;

fs.writeFileSync(outputPath, tsContent, 'utf-8');
console.log(`\nWritten to ${outputPath}`);
