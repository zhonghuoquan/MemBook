/**
 * 重复模板分析脚本：使用多种粒度检测视觉相似模板
 * - 5% 网格签名（精确结构重复）
 * - 10% 网格签名（视觉相似重复）
 * - 结构模式签名（相同布局模式，不同边距）
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 读取 generated-templates.ts 解析模板
const generatedContent = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'types', 'generated-templates.ts'),
  'utf-8'
);

// 提取所有模板对象（按行分割，每行一个模板）
const generatedTemplates = [];
const lines = generatedContent.split('\n');
for (const line of lines) {
  const idMatch = line.match(/id:\s*'([^']+)'/);
  const nameMatch = line.match(/name:\s*'([^']+)'/);
  if (!idMatch) continue;
  // 提取 slots 数组
  const slotsMatch = line.match(/slots:\s*\[(.+?)\]/);
  if (!slotsMatch) continue;
  const slotsStr = slotsMatch[1];
  // 匹配每个 slot 对象（字段间可能有空格）
  const slotMatches = slotsStr.matchAll(/\{id:\s*'([^']+)',\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)\}/g);
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
  if (slots.length > 0) generatedTemplates.push({ id: idMatch[1], name: nameMatch?.[1] || '', slots });
}

console.log(`Loaded ${generatedTemplates.length} generated templates`);

// 读取现有 60 模板（从 index.ts 提取）
const indexContent = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'types', 'index.ts'),
  'utf-8'
);

// 提取 TEMPLATES 数组中的模板（手动定义部分，不含 GENERATED_TEMPLATES）
const templatesStart = indexContent.indexOf('export const TEMPLATES: Template[] = [');
const templatesEnd = indexContent.indexOf('/* ========= 生成器批量扩展模板');
const existingBlock = indexContent.slice(templatesStart, templatesEnd);

// 解析手动定义的模板
const existingTemplateMatches = existingBlock.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?slots:\s*\[(.+?)\][^}]*?\}/gs);
const existingTemplates = [];
for (const m of existingTemplateMatches) {
  const id = m[1];
  const slotsStr = m[2];
  const slotMatches = slotsStr.matchAll(/\{[^}]*?id:\s*'([^']+)'[^}]*?x:\s*([\d.]+)[^}]*?y:\s*([\d.]+)[^}]*?width:\s*([\d.]+)[^}]*?height:\s*([\d.]+)[^}]*?\}/g);
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
  if (slots.length > 0) existingTemplates.push({ id, slots });
}

console.log(`Loaded ${existingTemplates.length} existing templates`);

// ── 签名函数 ──

// 5% 网格签名（精确）
function sig5(slots) {
  const n = slots.map(s => ({
    x: Math.round(s.x / 5) * 5,
    y: Math.round(s.y / 5) * 5,
    w: Math.round(s.width / 5) * 5,
    h: Math.round(s.height / 5) * 5,
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

// 10% 网格签名（视觉相似）
function sig10(slots) {
  const n = slots.map(s => ({
    x: Math.round(s.x / 10) * 10,
    y: Math.round(s.y / 10) * 10,
    w: Math.round(s.width / 10) * 10,
    h: Math.round(s.height / 10) * 10,
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

// 结构模式签名：忽略边距，只看槽位相对关系
function patternSig(slots) {
  if (slots.length === 0) return '';
  // 找到边界
  const xs = slots.map(s => s.x);
  const ys = slots.map(s => s.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...slots.map(s => s.x + s.width));
  const maxY = Math.max(...slots.map(s => s.y + s.height));
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  // 归一化到 10x10 网格
  const n = slots.map(s => ({
    x: Math.round(((s.x - minX) / w) * 10),
    y: Math.round(((s.y - minY) / h) * 10),
    w: Math.round((s.width / w) * 10),
    h: Math.round((s.height / h) * 10),
  }));
  n.sort((a, b) => a.y - b.y || a.x - b.x);
  return n.map(s => `${s.x},${s.y},${s.w},${s.h}`).join('|');
}

// ── 检测重复 ──

const all = [...existingTemplates.map(t => ({ ...t, source: 'existing' })), 
             ...generatedTemplates.map(t => ({ ...t, source: 'generated' }))];

console.log('\n=== 5% 网格精确重复 ===');
const bySig5 = new Map();
for (const t of all) {
  const s = sig5(t.slots);
  if (!bySig5.has(s)) bySig5.set(s, []);
  bySig5.get(s).push(t);
}
let exactDups = 0;
for (const [sig, ts] of bySig5) {
  if (ts.length > 1) {
    exactDups++;
    console.log(`  [${sig}]: ${ts.map(t => `${t.source}:${t.id}`).join(', ')}`);
  }
}
console.log(`Total exact duplicates: ${exactDups}`);

console.log('\n=== 10% 网格视觉相似重复 ===');
const bySig10 = new Map();
for (const t of all) {
  const s = sig10(t.slots);
  if (!bySig10.has(s)) bySig10.set(s, []);
  bySig10.get(s).push(t);
}
let visualDups = 0;
for (const [sig, ts] of bySig10) {
  if (ts.length > 1) {
    visualDups++;
    console.log(`  [${sig}]: ${ts.map(t => `${t.source}:${t.id}`).join(', ')}`);
  }
}
console.log(`Total visual duplicate groups: ${visualDups}`);

console.log('\n=== 结构模式重复（相同布局模式，不同边距） ===');
const byPattern = new Map();
for (const t of all) {
  const s = patternSig(t.slots);
  if (!byPattern.has(s)) byPattern.set(s, []);
  byPattern.get(s).push(t);
}
let patternDups = 0;
const patternGroups = [];
for (const [sig, ts] of byPattern) {
  if (ts.length > 2) { // 只看超过 2 个的组
    patternDups++;
    patternGroups.push({ sig, ts, count: ts.length });
  }
}
patternGroups.sort((a, b) => b.count - a.count);
for (const g of patternGroups.slice(0, 20)) {
  console.log(`  [${g.count}个] ${g.sig.slice(0, 60)}...`);
  console.log(`    ${g.ts.map(t => `${t.source}:${t.id}`).join(', ')}`);
}
console.log(`Total pattern duplicate groups (>2): ${patternDups}`);

// 按槽位数统计
console.log('\n=== 按槽位数统计 ===');
const byCount = {};
for (const t of all) {
  const c = t.slots.length;
  if (!byCount[c]) byCount[c] = { existing: 0, generated: 0 };
  if (t.source === 'existing') byCount[c].existing++;
  else byCount[c].generated++;
}
for (const c of Object.keys(byCount).sort((a, b) => +a - +b)) {
  console.log(`  ${c}图: 现有 ${byCount[c].existing} + 生成 ${byCount[c].generated} = ${byCount[c].existing + byCount[c].generated}`);
}
