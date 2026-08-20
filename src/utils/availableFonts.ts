/**
 * 可用字体探测 / 本机已装字体枚举
 *
 * 设计（A+B 方案）：
 * - A（基线，无需授权）：用 `document.fonts.check`（兜底宽高测量）探测一批"常见系统字体",
 *   只返回本机确实可用的项——绕过固定名单里"没装就回退"的问题。
 * - B（覆盖最多）：调用 Local Font Access `window.queryLocalFonts()` 枚举系统**全部已装字体
 *   （含用户自装第三方）**。需在用户手势中调用（可能一次性授权）；不支持或拒绝时返回空 → 仅用 A。
 *
 * 四端一致性说明：A/B 得到的都是"本机已安装的系统字体"，编辑器画布 / 导出 Canvas / 预览 /
 * 缩略图（Worker + OffscreenCanvas）均走同一浏览器 OS 字体栈，可保持一致渲染
 * （Worker 无法访问 document.fonts 的仅指 @font-face 内嵌字体；系统字体不受影响）。
 */

/** 内置艺术字体名（与 fonts.css 的 @font-face 一一对应），恒显示、不受探测过滤 */
export const BUNDLED_FONT_NAMES: ReadonlySet<string> = new Set([
  // 中文艺术
  '站酷快乐体',
  '马善政毛笔楷书',
  '柳建毛草体',
  '站酷庆科黄油体',
  '龙藏体',
  '直播星体',
  '站酷小薇体',
  '新蒂小丸子体',
  // 英文艺术
  'Playfair Display',
  'Cormorant Garamond',
  'Dancing Script',
  'Great Vibes',
  'Caveat',
  'Pacifico',
  'Montserrat',
  // 自备英文艺术
  'Azedo Light',
  'Beyno',
  'Big John',
  'Comfortaa',
  'Hagin Caps Thin',
  'Hitch-hike',
  'Intro Cond Light',
  'Jokerman',
  'Mr. Jackson Rankenstein',
  'Rage',
  'Corbelli',
  'Segoe UI SemiBold',
]);

/** 超出基础名单的常见系统字体候选（仅用于探测，探测到才显示） */
export const EXTRA_SYSTEM_FONT_CANDIDATES: readonly string[] = [
  // 中文
  'Microsoft YaHei UI',
  '华文仿宋',
  '华文宋体',
  '华文中宋',
  '华文新宋',
  '方正舒体',
  '方正姚体',
  '楷体_GB2312',
  '仿宋_GB2312',
  // 拉丁 / Windows 常见
  'Arial Black',
  'Book Antiqua',
  'Cambria',
  'Cambria Math',
  'Century',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Franklin Gothic Medium',
  'Garamond',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Tahoma',
  'Ebrima',
  'Gadugi',
  'Malgun Gothic',
  'Meiryo',
  'MingLiU',
  'PMingLiU',
  'MS Gothic',
  'MS Mincho',
  'Bahnschrift',
  'Sitka Text',
  'Yu Gothic',
  'Yu Mincho',
];

/** 是否内置艺术字体 */
export function isBundledFont(name: string): boolean {
  return BUNDLED_FONT_NAMES.has(name);
}

/**
 * 探测单个字体在本机是否可用。
 * 优先 document.fonts.check（系统字体可用即返回 true）；不支持时回退宽高测量法；
 * 极端环境再兜底返回 true（宁可不误hidden也不误藏）。
 */
export function probeSystemFontAvailable(family: string): boolean {
  try {
    if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.check === 'function') {
      return document.fonts.check(`16px "${family.replace(/"/g, '\\"')}"`);
    }
  } catch { /* 继续走测量法 */ }

  try {
    if (typeof document === 'undefined') return true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const sample = /[\u4e00-\u9fff]/.test(family) ? '\u4e2d\u6587\u6d4b\u8bd5' : 'AQWXyx0';
    ctx.font = `16px ${family}, monospace`;
    const withFont = ctx.measureText(sample).width;
    ctx.font = '16px monospace';
    const fallback = ctx.measureText(sample).width;
    return Math.abs(withFont - fallback) > 0.5;
  } catch {
    return true;
  }
}

/** 从基础名单过滤出"可用"：内置艺术字体恒显示，系统项按探测结果过滤 */
export function filterByAvailability(base: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of base) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (isBundledFont(f) || probeSystemFontAvailable(f)) out.push(f);
  }
  return out;
}

/** 额外候选里探测到的可用系统字体（追加到列表尾部） */
export function detectExtraSystemFonts(): string[] {
  return EXTRA_SYSTEM_FONT_CANDIDATES.filter(probeSystemFontAvailable);
}

/** Local Font Access 最小类型（不在标准 lib 中） */
interface LocalFontDescriptor {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

function supportsLocalFonts(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as {
    queryLocalFonts?: () => Promise<LocalFontDescriptor[]>;
  }).queryLocalFonts === 'function';
}

/** 已缓存的"已授权枚举"结果，避免每次打开重复触发授权/查询 */
let cachedInstalled: string[] | null = null;

/**
 * 枚举系统全部已装字体（含第三方）。需在用户手势中调用（可能一次性授权）。
 * - 不支持 / 无权限 / 被拒绝 / 异常 → 返回 []（回退到 A 探测结果）。
 */
export async function queryInstalledFontFamilies(): Promise<string[]> {
  if (cachedInstalled) return cachedInstalled;
  if (!supportsLocalFonts()) {
    cachedInstalled = [];
    return cachedInstalled;
  }
  try {
    // 权限已明确拒绝则不重复弹出
    const perms = typeof navigator !== 'undefined' && navigator.permissions
      ? await navigator.permissions.query({ name: 'local-fonts' as PermissionName }).catch(() => null)
      : null;
    if (perms && perms.state === 'denied') {
      cachedInstalled = [];
      return cachedInstalled;
    }
    const fonts = await (window as unknown as {
      queryLocalFonts(): Promise<LocalFontDescriptor[]>;
    }).queryLocalFonts();
    const families = [...new Set((fonts ?? []).map((f) => f.family))];
    cachedInstalled = families;
    return cachedInstalled;
  } catch {
    cachedInstalled = [];
    return cachedInstalled;
  }
}