/**
 * 文件名时间解析
 *
 * 移植自 Python 脚本 1-整理相册.py 的 parse_filename_datetime()
 * 支持 macOS 导出、iPhone/Android 相机、截图、WhatsApp 等 9 种常见命名格式
 */

const CURRENT_YEAR = new Date().getFullYear();

/** 年份合理性检查 */
function isYearPlausible(year: number): boolean {
  return year >= 2000 && year <= CURRENT_YEAR + 1;
}

/** 文件名时间正则模式（按优先级从高到低） */
const FILENAME_DT_PATTERNS: Array<{ re: RegExp; groups: number }> = [
  // 1. 分隔符日期+分隔符时间: 2023-01-15 14.30.00
  { re: /(\d{4})-(\d{2})-(\d{2})[ _T.-](\d{2})[._-](\d{2})[._-](\d{2})/, groups: 6 },
  // 2. 分隔符日期+连续时间: 2018-01-04 224040
  { re: /(\d{4})-(\d{2})-(\d{2})[ _T.-](\d{2})(\d{2})(\d{2})/, groups: 6 },
  // 3. 设备前缀+数字日期时间: IMG_20230115_143000
  { re: /(?:IMG|VID|PANO|mmexport)\d*[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, groups: 6 },
  // 3b. 截图/微信前缀+数字日期时间: Screenshot_20230115-143000, 微信图片_20230203123836
  { re: /(?:Screenshot|截图|微信图片|微信视频|mmexport|export)[_\s-](\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, groups: 6 },
  // 4. 连续14位数字 YYYYMMDDHHMMSS
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 6 },
  // 5. 纯数字日期+时间: 20230115_143000
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 6 },
  // 6. 连续12位数字 YYYYMMDDHHMM
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 5 },
  // 7. WhatsApp: IMG-20230115-WA0001 (仅日期)
  { re: /(?:IMG|VID|PANO)[_-](\d{4})(\d{2})(\d{2})[_-]WA\d+/, groups: 3 },
  // 8. 分隔符纯日期: 2023-01-15
  { re: /(?:^|(?<=\D))(\d{4})-(\d{2})-(\d{2})(?:$|(?=\D))/, groups: 3 },
  // 9. 纯数字日期: 20230115
  { re: /(?:^|(?<=\D))(\d{4})(\d{2})(\d{2})(?:$|(?=\D))/, groups: 3 },
];

/**
 * 从文件名中解析拍摄时间
 * @param filename 文件名（含或不含扩展名）
 * @returns Date 对象，解析失败返回 null
 */
export function parseFilenameDate(filename: string): Date | null {
  // 去掉扩展名
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
    // groups === 3 时用默认 12:00:00

    // 合理性校验
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
