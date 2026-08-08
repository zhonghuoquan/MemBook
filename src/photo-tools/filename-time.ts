/**
 * 文件名时间解析（增强版）
 *
 * 支持的命名格式（按优先级从高到低匹配）：
 *
 * 【带设备/应用前缀 + 完整日期时间】
 *   IMG_2023-01-15_14-30-00.jpg        相机/手机（分隔符日期+时间）
 *   IMG_20230115_143000.jpg            相机/手机（连续数字日期+时间）
 *   IMG_2023-01-15_14-30.jpg           相机/手机（无秒）
 *   IMG_20230115_1430.jpg              相机/手机（无秒）
 *   Screenshot_20230115-143000.jpg     截图
 *   微信图片_20230203123836.jpg         微信
 *   QQ图片20230115143000.jpg           QQ
 *   微博图片_20230115_143000.jpg        微博
 *   photo_2023-01-15_14-30-00.jpg      Telegram
 *   mmexport123_20230115_143000.jpg    微信导出
 *   MT_20230115143000.jpg              美图
 *   BeautyCam_20230115_143000.jpg      美颜相机
 *   轻颜相机_20230115_143000.jpg        轻颜
 *
 * 【带前缀 + 仅日期】
 *   IMG-20230115-WA0001.jpg            WhatsApp
 *   IMG_20230115.jpg                    相机（仅日期）
 *   微信图片_20230115.jpg               微信（仅日期）
 *
 * 【无前缀 + 完整日期时间】
 *   2023-01-15 14.30.00.jpg            分隔符日期+分隔符时间
 *   2023/01/15 14:30:00.jpg            斜杠日期+冒号时间
 *   2023.01.15_14-30-00.jpg            点号日期+混合时间
 *   2023-1-5 14:30:00.jpg              单数字月日
 *   2018-01-04 224040.jpg              分隔符日期+连续时间
 *   2023-01-15 14:30.jpg               无秒
 *   2023-01-15 1430.jpg                无秒连续
 *
 * 【纯数字日期时间】
 *   20230115143000.jpg                 14位连续 YYYYMMDDHHMMSS
 *   20230115_143000.jpg                日期+分隔符+时间
 *   202301151430.jpg                   12位连续 YYYYMMDDHHMM
 *   20230115_1430.jpg                  日期+分隔符+时分
 *
 * 【仅日期】
 *   2023-01-15.jpg                     分隔符纯日期
 *   2023/1/5.jpg                       斜杠单数字
 *   2023.01.15.jpg                     点号日期
 *   20230115.jpg                       纯数字日期
 */

const CURRENT_YEAR = new Date().getFullYear();

/** 年份合理性检查 */
function isYearPlausible(year: number): boolean {
  return year >= 2000 && year <= CURRENT_YEAR + 1;
}

/**
 * 已知设备/应用前缀（匹配时大小写敏感，photo/Photo 分别列出）
 * 前缀后允许 0 个或多个分隔符（[_\s-]*），兼容 IMG_、IMG-、photo_ 等写法
 */
const KNOWN_PREFIX =
  '(?:IMG|VID|PANO|DSC|Screenshot|截图|屏幕截图|微信图片|微信视频|QQ图片|QQ视频|微博图片|微博视频|mmexport|export|photo|Photo|MT|美图|BeautyCam|轻颜相机)';

/** 日期分隔符：- / . _ */
const D_SEP = '[-/._]';
/** 时间分隔符：: . _ - */
const T_SEP = '[:._-]';
/** 日期与时间之间的连接符：空格 _ T t . - */
const DT_JOIN = '[ _Tt.-]';

/**
 * 文件名时间正则模式（按优先级从高到低）
 *
 * 优先级原则：
 * 1. 带前缀的优先于无前缀的（前缀提供上下文，减少误识别）
 * 2. 完整日期时间（6组/含秒）优先于无秒（5组）
 * 3. 带分隔符的优先于纯数字的
 * 4. 仅日期（3组）优先级最低（避免从长数字中误提取）
 *
 * 边界控制：
 * - 带前缀模式不要求结尾边界（文件名可能有副本后缀等）
 * - 纯数字模式要求结尾边界 (?:$|(?=\D))，避免从长数字串中提取子串
 * - 无秒模式用 (?!\d) 确保不误匹配有秒场景（6组模式已在前优先匹配）
 */
const FILENAME_DT_PATTERNS: Array<{ re: RegExp; groups: number }> = [
  // ── 优先级 1：已知前缀 + 完整日期时间（6组，含秒） ──
  // 1a. 前缀+分隔符日期+分隔符时间: IMG_2023-01-15_14-30-00, photo_2023.01.15 14.30.00
  {
    re: new RegExp(
      `${KNOWN_PREFIX}[_\\s-]*(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{1,2})${T_SEP}(\\d{1,2})${T_SEP}(\\d{1,2})`,
    ),
    groups: 6,
  },
  // 1b. 前缀+连续数字日期+分隔符时间: IMG_20230115_143000, Screenshot_20230115-143000, 微信图片_20230203123836
  {
    re: new RegExp(
      `${KNOWN_PREFIX}[_\\s-]*(\\d{4})(\\d{2})(\\d{2})[_\\s-](\\d{1,2})(\\d{2})(\\d{2})`,
    ),
    groups: 6,
  },

  // ── 优先级 2：已知前缀 + 日期时间（5组，无秒） ──
  // 2a. 前缀+分隔符日期+时分: IMG_2023-01-15_14-30, photo_2023.01.15 14:30
  {
    re: new RegExp(
      `${KNOWN_PREFIX}[_\\s-]*(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{1,2})${T_SEP}(\\d{1,2})(?!\\d)`,
    ),
    groups: 5,
  },
  // 2b. 前缀+连续数字日期+时分: IMG_20230115_1430
  {
    re: new RegExp(
      `${KNOWN_PREFIX}[_\\s-]*(\\d{4})(\\d{2})(\\d{2})[_\\s-](\\d{1,2})(\\d{2})(?!\\d)`,
    ),
    groups: 5,
  },

  // ── 优先级 3：已知前缀 + 仅日期 ──
  // 3a. WhatsApp: IMG-20230115-WA0001 (仅日期，特殊后缀)
  { re: /(?:IMG|VID|PANO)[_\s-](\d{4})(\d{2})(\d{2})[_\s-]WA\d+/, groups: 3 },
  // 3b. 前缀+连续8位日期: IMG_20230115, 微信图片_20230115
  {
    re: new RegExp(`${KNOWN_PREFIX}[_\\s-]*(\\d{4})(\\d{2})(\\d{2})(?!\\d)`),
    groups: 3,
  },

  // ── 优先级 4：无前缀 + 完整日期时间（6组，含秒） ──
  // 4a. 分隔符日期+分隔符时间: 2023-01-15 14.30.00, 2023/1/5 14:30:00, 2023.01.15_14-30-00
  {
    re: new RegExp(
      `(?:^|(?<=\\D))(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{1,2})${T_SEP}(\\d{1,2})${T_SEP}(\\d{1,2})`,
    ),
    groups: 6,
  },
  // 4b. 分隔符日期+连续6位时间: 2018-01-04 224040
  {
    re: new RegExp(
      `(?:^|(?<=\\D))(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{2})(\\d{2})(\\d{2})`,
    ),
    groups: 6,
  },

  // ── 优先级 5：无前缀 + 日期时间（5组，无秒） ──
  // 5a. 分隔符日期+时分: 2023-01-15 14:30, 2023/1/5 14.30
  {
    re: new RegExp(
      `(?:^|(?<=\\D))(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{1,2})${T_SEP}(\\d{1,2})(?!\\d)`,
    ),
    groups: 5,
  },
  // 5b. 分隔符日期+连续4位时分: 2023-01-15 1430
  {
    re: new RegExp(
      `(?:^|(?<=\\D))(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})${DT_JOIN}(\\d{2})(\\d{2})(?!\\d)`,
    ),
    groups: 5,
  },

  // ── 优先级 6：纯数字日期+时间（无前缀，无日期分隔符） ──
  // 6a. 14位连续数字 YYYYMMDDHHMMSS: 20230115143000
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 6 },
  // 6b. 纯数字日期+分隔符+时间: 20230115_143000, 20230115-143000
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})[_\s-](\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 6 },
  // 6c. 12位连续数字 YYYYMMDDHHMM: 202301151430
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 5 },
  // 6d. 纯数字日期+分隔符+时分: 20230115_1430
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})[_\s-](\d{2})(\d{2})(?:$|(?=\D))/, groups: 5 },

  // ── 优先级 7：仅日期（最低优先级，避免误识别） ──
  // 7a. 分隔符纯日期: 2023-01-15, 2023/1/5, 2023.01.15
  {
    re: new RegExp(`(?:^|(?<=\\D))(\\d{4})${D_SEP}(\\d{1,2})${D_SEP}(\\d{1,2})(?:$|(?=\\D))`),
    groups: 3,
  },
  // 7b. 纯数字日期: 20230115
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 3 },
];

/**
 * 从文件名中解析拍摄时间
 * @param filename 文件名（含或不含扩展名）
 * @returns Date 对象，解析失败返回 null
 */
export function parseFilenameDate(filename: string): Date | null {
  // 去掉扩展名（取最后一个点之前的部分）
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot);

  for (const { re, groups } of FILENAME_DT_PATTERNS) {
    const m = stem.match(re);
    if (!m) continue;

    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);

    let hour = 12, minute = 0, second = 0;
    if (groups >= 6) {
      hour = parseInt(m[4], 10);
      minute = parseInt(m[5], 10);
      second = parseInt(m[6], 10);
    } else if (groups === 5) {
      hour = parseInt(m[4], 10);
      minute = parseInt(m[5], 10);
      second = 0;
    }
    // groups === 3 时用默认 12:00:00（仅日期，时间未知，用正午避免时区偏移导致日期变化）

    // 合理性校验（拒绝 2023-13-45 25:99:99 等非法值）
    if (!isYearPlausible(year)) continue;
    if (month < 1 || month > 12) continue;
    if (day < 1 || day > 31) continue;
    if (hour < 0 || hour > 23) continue;
    if (minute < 0 || minute > 59) continue;
    if (second < 0 || second > 59) continue;

    return new Date(year, month - 1, day, hour, minute, second);
  }

  return null;
}
