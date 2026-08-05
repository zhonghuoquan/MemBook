/**
 * 模板验证脚本：检查所有模板的槽位重叠、越界、间距问题
 * 运行: node scripts/validate-templates.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 解析 TS 文件中的模板（支持单行和多行格式）
function parseTemplates(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const templates = [];
  // 匹配 id 和 name（跨行），然后找到对应的 slots 数组
  const idRegex = /id:\s*'([^']+)'[^}]*?name:\s*'([^']+)'/gs;
  let idMatch;
  while ((idMatch = idRegex.exec(content)) !== null) {
    const id = idMatch[1];
    const name = idMatch[2];
    if (id.startsWith('__')) continue;
    // 从 idMatch 的结束位置往后找 slots 数组
    const afterId = content.slice(idMatch.index);
    const slotsMatch = afterId.match(/slots:\s*\[([\s\S]*?)\]/);
    if (!slotsMatch) continue;
    const slotsStr = slotsMatch[1];
    const slotMatches = slotsStr.matchAll(/\{[^}]*?id:\s*'([^']+)'[^}]*?x:\s*([\d.]+)[^}]*?y:\s*([\d.]+)[^}]*?width:\s*([\d.]+)[^}]*?height:\s*([\d.]+)/g);
    const slots = [];
    for (const sm of slotMatches) {
      slots.push({
        id: sm[1],
        x: parseFloat(sm[2]),
        y: parseFloat(sm[3]),
        width: parseFloat(sm[4]),
        height: parseFloat(sm[5]),
      });
    }
    // 解析 tags（用于跳过 overlay 模板的重叠检查）
    const tagsMatch = afterId.match(/tags:\s*\[([^\]]*)\]/);
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')) : [];
    if (slots.length > 0) templates.push({ id, name, slots, tags });
  }
  return templates;
}

// 检查两个矩形是否重叠
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// 计算重叠面积
function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

// 检查最小间距（相邻槽位间的最小间隙）
function minGap(a, b) {
  // 水平间距：a 在 b 左边
  if (a.x + a.width <= b.x) return b.x - (a.x + a.width);
  if (b.x + b.width <= a.x) return a.x - (b.x + b.width);
  // 垂直间距：a 在 b 上边
  if (a.y + a.height <= b.y) return b.y - (a.y + a.height);
  if (b.y + b.height <= a.y) return a.y - (b.y + b.height);
  // 重叠
  return -1;
}

const genTemplates = parseTemplates(path.join(__dirname, '..', 'src', 'types', 'generated-templates.ts'));
const indexTemplates = parseTemplates(path.join(__dirname, '..', 'src', 'types', 'index.ts'));
const allTemplates = [...indexTemplates, ...genTemplates];

console.log(`\n验证 ${allTemplates.length} 个模板 (${indexTemplates.length} 内置 + ${genTemplates.length} 生成)\n`);

let hasErrors = false;
let hasWarnings = false;

for (const tpl of allTemplates) {
  const issues = [];

  // 1. 检查越界
  for (const s of tpl.slots) {
    if (s.x < 0 || s.y < 0) issues.push(`  [越界] ${s.id}: x=${s.x}, y=${s.y} (负值)`);
    if (s.x + s.width > 100.5) issues.push(`  [越界] ${s.id}: x+w=${(s.x + s.width).toFixed(1)} > 100`);
    if (s.y + s.height > 100.5) issues.push(`  [越界] ${s.id}: y+h=${(s.y + s.height).toFixed(1)} > 100`);
    if (s.width <= 0 || s.height <= 0) issues.push(`  [无效] ${s.id}: 零或负尺寸`);
  }

  // overlay 模板（照片位叠加留白）有意设计重叠，跳过重叠/间距检查
  const isOverlay = tpl.tags.includes('overlay');

  // 2. 检查重叠（overlay 模板跳过）
  if (!isOverlay) {
    for (let i = 0; i < tpl.slots.length; i++) {
      for (let j = i + 1; j < tpl.slots.length; j++) {
        const a = tpl.slots[i];
        const b = tpl.slots[j];
        if (rectsOverlap(a, b)) {
          const area = overlapArea(a, b);
          if (area > 0.5) {
            issues.push(`  [重叠] ${a.id} ↔ ${b.id}: 重叠面积=${area.toFixed(1)}%`);
            hasErrors = true;
          }
        }
      }
    }
  }

  // 3. 检查间距过小（< 1%，可能视觉上贴在一起）；overlay 模板跳过
  if (!isOverlay) {
    for (let i = 0; i < tpl.slots.length; i++) {
      for (let j = i + 1; j < tpl.slots.length; j++) {
        const a = tpl.slots[i];
        const b = tpl.slots[j];
        const gap = minGap(a, b);
        if (gap >= 0 && gap < 1) {
          // 仅在两槽位有正交重叠时才报告（真正相邻）
          const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (xOverlap > 0 || yOverlap > 0) {
            issues.push(`  [间距小] ${a.id} ↔ ${b.id}: 间隙=${gap.toFixed(2)}%`);
            hasWarnings = true;
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    console.log(`[${tpl.id}] ${tpl.name} (${tpl.slots.length}槽位)`);
    for (const issue of issues) console.log(issue);
    console.log('');
  }
}

console.log('════════════════════════════════════');
if (hasErrors) {
  console.log('❌ 发现重叠错误，需要修复');
} else if (hasWarnings) {
  console.log('⚠️  发现间距警告（间隙 < 1%），建议检查');
} else {
  console.log('✅ 所有模板验证通过，无重叠/越界/间距问题');
}
