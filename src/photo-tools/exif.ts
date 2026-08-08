/**
 * EXIF 读取与写入
 *
 * 读取：exifr（支持 JPEG/HEIC/RAW 等多种格式）
 * 写入：piexifjs（仅 JPEG，非破坏性修改 EXIF 段）
 */

import exifr from 'exifr';
import piexif from 'piexifjs';
import { logger } from '../utils/logger';

/** EXIF 日期格式: "2024:01:15 14:30:00" */
function formatDateForExif(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}:${p(date.getMonth() + 1)}:${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** ArrayBuffer → dataURL（piexifjs 需要 dataURL 格式） */
function arrayBufferToDataURL(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** dataURL → ArrayBuffer */
function dataURLToArrayBuffer(dataURL: string): ArrayBuffer {
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 读取 EXIF 拍摄时间（增强版）
 *
 * 优先级（业界通用）：
 * 1. SubSecDateTimeOriginal（iPhone 子秒级精度，含时区偏移）
 * 2. DateTimeOriginal（标准拍摄时间）
 * 3. CreateDate / DateTimeDigitized（数字化时间）
 * 4. DateTime（TIFF/IFD0 修改时间）
 * 5. GPSDateStamp + GPSTimeStamp（GPS 时间，跨时区时可能不准但比没有强）
 *
 * 增强：
 * - 日期有效性验证（排除全零 "0000:00:00 00:00:00" 等无效日期）
 * - 年份合理性检查（≥2000，避免传感器噪声产生的乱码日期）
 * - 接受 ArrayBuffer | Uint8Array（兼容 Tauri readFile 返回的 Uint8Array）
 *
 * @param data 图片二进制数据（前 64KB 即可，EXIF 段在文件头部）
 */
export async function readExifDate(data: ArrayBuffer | Uint8Array): Promise<Date | null> {
  try {
    // 用对象形式指定 IFD 段，比数组更灵活，能获取 SubSec* 和 GPS 字段
    const result = await exifr.parse(data, {
      tiff: true,   // IFD0: DateTime
      exif: true,   // Exif IFD: DateTimeOriginal, DateTimeDigitized, SubSec*
      gps: true,    // GPS IFD: GPSDateStamp, GPSTimeStamp
    });

    if (result) {
      // 按优先级遍历候选日期字段
      const candidates: unknown[] = [
        result.SubSecDateTimeOriginal,
        result.DateTimeOriginal,
        result.CreateDate,
        result.DateTime,
      ];

      for (const c of candidates) {
        const d = pickValidDate(c);
        if (d) return d;
      }

      // GPS 时间作为最后 fallback
      if (result.GPSDateStamp) {
        const d = gpsToDate(result.GPSDateStamp, result.GPSTimeStamp);
        if (d) return d;
      }
    }
  } catch {
    // 解析失败静默处理
  }
  return null;
}

/**
 * 验证并转换日期值
 * - 排除全零 "0000:00:00 00:00:00" 等无效日期
 * - 年份必须 ≥2000（避免传感器噪声产生的乱码日期）
 */
function pickValidDate(v: unknown): Date | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    if (v.getFullYear() < 2000) return null;
    return v;
  }
  if (typeof v === 'number') {
    // exifr 可能返回 Unix 时间戳（秒或毫秒）
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
    return d;
  }
  if (typeof v === 'string') {
    // EXIF 日期格式: "2024:01:15 14:30:00" 或 "2024-01-15 14:30:00"
    const m = v.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const year = +m[1];
      if (year < 2000) return null;
      const d = new Date(year, +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (isNaN(d.getTime())) return null;
      return d;
    }
    // 尝试标准 Date 解析
    const d = new Date(v);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
  }
  return null;
}

/**
 * GPS 日期时间 → Date
 * GPSDateStamp 格式: "2024:01:15"
 * GPSTimeStamp exifr 可能返回字符串 "14:30:00" 或有理数数组 [[14,1],[30,1],[0,1]]
 */
function gpsToDate(dateStamp: string, timeStamp?: unknown): Date | null {
  const dm = typeof dateStamp === 'string'
    ? dateStamp.match(/^(\d{4}):(\d{2}):(\d{2})/)
    : null;
  if (!dm) return null;
  const year = +dm[1], month = +dm[2], day = +dm[3];
  if (year < 2000) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let hour = 12, minute = 0, second = 0;

  if (timeStamp) {
    if (typeof timeStamp === 'string') {
      const tm = timeStamp.match(/^(\d{1,2}):(\d{2}):(\d{2})/);
      if (tm) {
        hour = +tm[1]; minute = +tm[2]; second = +tm[3];
      }
    } else if (Array.isArray(timeStamp) && timeStamp.length >= 3) {
      // exifr 可能返回有理数数组 [[14,1],[30,1],[0,1]]
      const toNum = (v: unknown): number => {
        if (typeof v === 'number') return v;
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') return v[0] / v[1];
        return 0;
      };
      hour = Math.floor(toNum(timeStamp[0]));
      minute = Math.floor(toNum(timeStamp[1]));
      second = Math.floor(toNum(timeStamp[2]));
    }
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    hour = 12; minute = 0; second = 0;
  }

  const d = new Date(year, month - 1, day, hour, minute, second);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 读取拍摄日期（增强版：EXIF + 文件名 fallback）
 *
 * 先尝试 EXIF 读取（5 个字段 + GPS 时间），全部失败后从文件名解析日期。
 * 适用于扫描时填充 dateTaken 字段——很多照片（如微信保存的截图）EXIF 被剥离，
 * 但文件名包含日期信息（如 "2025-05-05 100649.jpg"）。
 *
 * @param data 图片二进制（前 64KB 即可）
 * @param filename 文件名（用于 fallback 解析）
 * @returns ISO 字符串（可直接填入 PhotoFileInfo.dateTaken），全失败返回 null
 */
export async function readExifDateWithFallback(
  data: ArrayBuffer | Uint8Array,
  filename: string,
): Promise<string | null> {
  // 1. EXIF 读取
  const d = await readExifDate(data);
  if (d) return d.toISOString();

  // 2. 文件名解析 fallback
  const { parseFilenameDate } = await import('./filename-time');
  const d2 = parseFilenameDate(filename);
  if (d2) return d2.toISOString();

  return null;
}

/** 读取完整 EXIF 信息（含 GPS、相机型号等） */
export async function readExifFull(data: ArrayBuffer): Promise<Record<string, unknown> | null> {
  try {
    return await exifr.parse(data, true);
  } catch {
    return null;
  }
}

/** 读取 EXIF GPS 坐标 */
export async function readExifGps(data: ArrayBuffer): Promise<{ lon: number; lat: number } | null> {
  try {
    const gps = await exifr.gps(data);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return { lon: gps.longitude, lat: gps.latitude };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 将拍摄日期写入 JPEG 的 EXIF（非破坏性，仅修改 EXIF 段）
 * @param jpegData 原始 JPEG 数据
 * @param date 新日期（保留原始时分秒，如 date 只有日期则用 12:00:00）
 * @param preserveTime 是否保留原照片的时分秒（仅改日期）
 * @returns 修改后的 JPEG ArrayBuffer
 */
export async function writeExifDateToJpeg(
  jpegData: ArrayBuffer,
  date: Date,
  preserveTime?: Date,
): Promise<ArrayBuffer> {
  const finalDate = preserveTime
    ? new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        preserveTime.getHours(),
        preserveTime.getMinutes(),
        preserveTime.getSeconds(),
      )
    : date;

  const dataURL = arrayBufferToDataURL(jpegData);
  let exifObj: Record<string, Record<string, unknown>>;
  try {
    exifObj = piexif.load(dataURL) as Record<string, Record<string, unknown>>;
  } catch {
    // 无 EXIF 则创建空结构
    exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {} };
  }

  const dateStr = formatDateForExif(finalDate);
  exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = dateStr;
  exifObj['Exif'][piexif.ExifIFD.DateTimeDigitized] = dateStr;
  exifObj['0th'][piexif.ImageIFD.DateTime] = dateStr;

  const exifBytes = piexif.dump(exifObj);
  const newDataURL = piexif.insert(exifBytes, dataURL);
  const result = dataURLToArrayBuffer(newDataURL);

  // 验证：用 exifr 读回 DateTimeOriginal 确认日期已写入
  // 注意：piexifjs 的 load 返回 ASCII 值为字节数组（非字符串），不能直接用 piexif.load 比对
  try {
    const readBack = await exifr.parse(result, ['DateTimeOriginal']);
    const actualDate = readBack?.DateTimeOriginal;
    if (!actualDate) {
      throw new Error('读回的 EXIF 中无 DateTimeOriginal');
    }
    const actualStr = formatDateForExif(actualDate instanceof Date ? actualDate : new Date(actualDate));
    if (actualStr !== dateStr) {
      throw new Error(`日期验证不匹配（期望 "${dateStr}"，实际 "${actualStr}"）`);
    }
  } catch (verifyErr) {
    throw new Error(
      `EXIF 写入后验证失败，修改未生效: ${verifyErr instanceof Error ? verifyErr.message : verifyErr}`,
    );
  }

  return result;
}

/**
 * 将 GPS 坐标写入 JPEG 的 EXIF
 */
export async function writeExifGpsToJpeg(
  jpegData: ArrayBuffer,
  lon: number,
  lat: number,
): Promise<ArrayBuffer> {
  const dataURL = arrayBufferToDataURL(jpegData);
  let exifObj: Record<string, Record<string, unknown>>;
  try {
    exifObj = piexif.load(dataURL) as Record<string, Record<string, unknown>>;
  } catch {
    exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {} };
  }

  // 十进制转 DMS (度分秒)
  const lonDeg = Math.abs(lon);
  const latDeg = Math.abs(lat);
  const gpsData: Record<string, unknown> = {
    [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? 'N' : 'S',
    [piexif.GPSIFD.GPSLatitude]: degToDMS(latDeg),
    [piexif.GPSIFD.GPSLongitudeRef]: lon >= 0 ? 'E' : 'W',
    [piexif.GPSIFD.GPSLongitude]: degToDMS(lonDeg),
  };
  exifObj['GPS'] = { ...exifObj['GPS'], ...gpsData };

  const exifBytes = piexif.dump(exifObj);
  const newDataURL = piexif.insert(exifBytes, dataURL);
  return dataURLToArrayBuffer(newDataURL);
}

/** 十进制度数 → EXIF 有理数 DMS 数组 [[度,1],[分,1],[秒,10000]] */
function degToDMS(deg: number): [[number, number], [number, number], [number, number]] {
  const d = Math.floor(deg);
  const minFloat = (deg - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
}

// ── 多格式 EXIF 写入（PNG / WebP） ──────────────────────────

/** 支持写入 EXIF 的格式集合 */
export const EXIF_WRITABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** CRC-32 查表（PNG chunk 校验用） */
let _crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  _crcTable = table;
  return table;
}

/** 计算 CRC-32（PNG chunk 使用） */
function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 将 piexif.dump() 返回的二进制字符串转为 Uint8Array */
function piexifDumpToBytes(exifObj: Record<string, Record<string, unknown>>): Uint8Array {
  const dumpStr = piexif.dump(exifObj) as string;
  const bytes = new Uint8Array(dumpStr.length);
  for (let i = 0; i < dumpStr.length; i++) {
    bytes[i] = dumpStr.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * 将 EXIF 字节插入 PNG 文件的 eXIf chunk。
 * eXIf chunk 位于 IHDR 之后、IDAT 之前；若已存在 eXIf 则替换。
 */
function insertExifIntoPng(pngData: ArrayBuffer, exifBytes: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(pngData);
  const view = new DataView(pngData);

  // 验证 PNG 签名 (89 50 4E 47 0D 0A 1A 0A)
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('不是有效的 PNG 文件');
  }

  let offset = 8; // 跳过 8 字节签名
  let ihdrEnd = -1;
  let existingExifStart = -1;
  let existingExifTotal = 0;

  while (offset + 8 <= bytes.length) {
    const chunkLen = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
    );
    const chunkTotal = 12 + chunkLen; // length(4) + type(4) + data + crc(4)

    if (chunkType === 'IHDR') {
      ihdrEnd = offset + chunkTotal;
    }
    if (chunkType === 'eXIf') {
      existingExifStart = offset;
      existingExifTotal = chunkTotal;
      break;
    }
    // eXIf 必须在 IDAT 之前，遇到 IDAT 停止
    if (chunkType === 'IDAT') break;

    offset += chunkTotal;
  }

  // 插入位置：替换现有 eXIf，或紧跟 IHDR 之后
  const insertPos = existingExifStart >= 0 ? existingExifStart : ihdrEnd;
  if (insertPos < 0) throw new Error('无法确定 eXIf chunk 插入位置');

  // 构造 eXIf chunk: length(4) + "eXIf"(4) + data + crc(4)
  const dataLen = exifBytes.length;
  const newChunk = new Uint8Array(12 + dataLen);
  const newView = new DataView(newChunk.buffer);
  newView.setUint32(0, dataLen);
  newChunk[4] = 0x65; newChunk[5] = 0x58; newChunk[6] = 0x49; newChunk[7] = 0x66; // "eXIf"
  newChunk.set(exifBytes, 8);
  newView.setUint32(8 + dataLen, crc32(newChunk.subarray(4, 8 + dataLen)));

  if (existingExifStart >= 0) {
    // 替换现有 eXIf chunk
    const result = new Uint8Array(bytes.length - existingExifTotal + newChunk.length);
    result.set(bytes.subarray(0, existingExifStart), 0);
    result.set(newChunk, existingExifStart);
    result.set(bytes.subarray(existingExifStart + existingExifTotal), existingExifStart + newChunk.length);
    return result.buffer;
  }
  // 插入新 eXIf chunk
  const result = new Uint8Array(bytes.length + newChunk.length);
  result.set(bytes.subarray(0, insertPos), 0);
  result.set(newChunk, insertPos);
  result.set(bytes.subarray(insertPos), insertPos + newChunk.length);
  return result.buffer;
}

/**
 * 将 EXIF 字节插入 WebP 文件的 EXIF chunk。
 * EXIF chunk 位于 VP8X 之后、VP8/VP8L 之前；若已存在 EXIF 则替换。
 */
function insertExifIntoWebp(webpData: ArrayBuffer, exifBytes: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(webpData);
  const view = new DataView(webpData);

  // 验证 RIFF 签名
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) {
    throw new Error('不是有效的 WebP 文件');
  }

  let offset = 12; // 跳过 RIFF(4) + size(4) + WEBP(4)
  let existingExifStart = -1;
  let existingExifTotal = 0;
  let insertPos = -1;

  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(
      bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
    );
    const chunkSize = view.getUint32(offset + 4, true); // little-endian
    const paddedSize = chunkSize + (chunkSize % 2); // RIFF 要求偶数对齐
    const chunkTotal = 8 + paddedSize;

    if (chunkType === 'EXIF') {
      existingExifStart = offset;
      existingExifTotal = chunkTotal;
      break;
    }
    // EXIF 应在 VP8X 之后、VP8/VP8L 之前
    if (chunkType === 'VP8X' && insertPos === -1) {
      insertPos = offset + chunkTotal; // VP8X 之后
    }
    if ((chunkType === 'VP8 ' || chunkType === 'VP8L') && insertPos === -1) {
      insertPos = offset; // VP8/VP8L 之前
    }

    offset += chunkTotal;
  }

  const finalPos = existingExifStart >= 0 ? existingExifStart : insertPos;
  if (finalPos < 0) throw new Error('无法确定 EXIF chunk 插入位置');

  // 构造 EXIF chunk: "EXIF"(4) + size(4,LE) + data + padding(0或1)
  const dataLen = exifBytes.length;
  const padding = dataLen % 2;
  const newChunk = new Uint8Array(8 + dataLen + padding);
  newChunk[0] = 0x45; newChunk[1] = 0x58; newChunk[2] = 0x49; newChunk[3] = 0x46; // "EXIF"
  const newView = new DataView(newChunk.buffer);
  newView.setUint32(4, dataLen, true);
  newChunk.set(exifBytes, 8);
  if (padding) newChunk[8 + dataLen] = 0;

  if (existingExifStart >= 0) {
    const result = new Uint8Array(bytes.length - existingExifTotal + newChunk.length);
    result.set(bytes.subarray(0, existingExifStart), 0);
    result.set(newChunk, existingExifStart);
    result.set(bytes.subarray(existingExifStart + existingExifTotal), existingExifStart + newChunk.length);
    // 更新 RIFF 文件大小（little-endian）
    new DataView(result.buffer).setUint32(4, result.length - 8, true);
    return result.buffer;
  }
  const result = new Uint8Array(bytes.length + newChunk.length);
  result.set(bytes.subarray(0, finalPos), 0);
  result.set(newChunk, finalPos);
  result.set(bytes.subarray(finalPos), finalPos + newChunk.length);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result.buffer;
}

/** 构建"修改拍摄日期"的 EXIF 字节（用于 PNG/WebP） */
function buildDateExifBytes(date: Date, preserveTime?: Date): Uint8Array {
  const finalDate = preserveTime
    ? new Date(
        date.getFullYear(), date.getMonth(), date.getDate(),
        preserveTime.getHours(), preserveTime.getMinutes(), preserveTime.getSeconds(),
      )
    : date;

  const exifObj: Record<string, Record<string, unknown>> = {
    '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {},
  };
  const dateStr = formatDateForExif(finalDate);
  exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = dateStr;
  exifObj['Exif'][piexif.ExifIFD.DateTimeDigitized] = dateStr;
  exifObj['0th'][piexif.ImageIFD.DateTime] = dateStr;
  return piexifDumpToBytes(exifObj);
}

/** 构建"写入 GPS"的 EXIF 字节（用于 PNG/WebP） */
function buildGpsExifBytes(lon: number, lat: number): Uint8Array {
  const exifObj: Record<string, Record<string, unknown>> = {
    '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {},
  };
  const lonDeg = Math.abs(lon);
  const latDeg = Math.abs(lat);
  exifObj['GPS'][piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0];
  exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
  exifObj['GPS'][piexif.GPSIFD.GPSLatitude] = degToDMS(latDeg);
  exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W';
  exifObj['GPS'][piexif.GPSIFD.GPSLongitude] = degToDMS(lonDeg);
  return piexifDumpToBytes(exifObj);
}

/**
 * 通用：写入拍摄日期（根据文件格式自动分发）
 * - JPEG: piexifjs 直接修改（保留原有 EXIF）
 * - PNG: 插入/替换 eXIf chunk
 * - WebP: 插入/替换 EXIF chunk
 */
export async function writeExifDate(
  data: ArrayBuffer,
  ext: string,
  date: Date,
  preserveTime?: Date,
): Promise<ArrayBuffer> {
  if (ext === '.jpg' || ext === '.jpeg') {
    return writeExifDateToJpeg(data, date, preserveTime);
  }
  const finalDate = preserveTime
    ? new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        preserveTime.getHours(),
        preserveTime.getMinutes(),
        preserveTime.getSeconds(),
      )
    : date;
  const expectedDateStr = formatDateForExif(finalDate);
  const exifBytes = buildDateExifBytes(finalDate, undefined);
  let result: ArrayBuffer;
  if (ext === '.png') result = insertExifIntoPng(data, exifBytes);
  else if (ext === '.webp') result = insertExifIntoWebp(data, exifBytes);
  else throw new Error(`不支持写入 EXIF 的格式: ${ext}`);

  // 验证：用 exifr 读回 DateTimeOriginal 确认日期已写入
  try {
    const readBack = await exifr.parse(result, ['DateTimeOriginal']);
    const actualDate = readBack?.DateTimeOriginal;
    if (!actualDate) {
      throw new Error('读回的 EXIF 中无 DateTimeOriginal');
    }
    const actualStr = formatDateForExif(actualDate instanceof Date ? actualDate : new Date(actualDate));
    if (actualStr !== expectedDateStr) {
      throw new Error(`日期验证不匹配（期望 "${expectedDateStr}"，实际 "${actualStr}"）`);
    }
  } catch (verifyErr) {
    throw new Error(
      `EXIF 写入后验证失败，修改未生效: ${verifyErr instanceof Error ? verifyErr.message : verifyErr}`,
    );
  }

  return result;
}

/**
 * 通用：写入 GPS 坐标（根据文件格式自动分发）
 */
export async function writeExifGps(
  data: ArrayBuffer,
  ext: string,
  lon: number,
  lat: number,
): Promise<ArrayBuffer> {
  if (ext === '.jpg' || ext === '.jpeg') {
    return writeExifGpsToJpeg(data, lon, lat);
  }
  const exifBytes = buildGpsExifBytes(lon, lat);
  if (ext === '.png') return insertExifIntoPng(data, exifBytes);
  if (ext === '.webp') return insertExifIntoWebp(data, exifBytes);
  throw new Error(`不支持写入 EXIF 的格式: ${ext}`);
}

// ── 格式转换后保留原始 EXIF（exifr 解析结果 → 写回 JPEG） ──────────

function pickDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}
function pickStr(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && isFinite(v)) return String(v);
  return null;
}
function pickInt(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Math.round(Number(v));
  return null;
}
/** 十进制数 / 小数串 / [num,den] → EXIF 有理数 [num,den] */
function toRational(v: unknown): [number, number] | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && !isNaN(Number(v))) n = Number(v);
  else if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
  else return null;
  if (!isFinite(n)) return null;
  const scale = 10000;
  return [Math.round(n * scale), scale];
}
/** exifr 的 GPS 坐标可能为十进制数 / 小数串 / [度,分,秒] → 十进制数 */
function toDeg(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
  if (Array.isArray(v) && v.length >= 1 && typeof v[0] === 'number') {
    if (v.length === 1) return v[0];
    if (v.length === 2) return v[0] + v[1] / 60;
    return v[0] + v[1] / 60 + v[2] / 3600;
  }
  return null;
}
function refOf(v: unknown, val: number, pos: string, neg: string): string {
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s.startsWith(neg)) return neg;
    if (s.startsWith(pos)) return pos;
  }
  return val >= 0 ? pos : neg;
}

/**
 * 将 exifr 解析出的原始 EXIF（Record 形式）写回一张已转换好的 JPEG。
 * 用于格式转换（HEIC→JPG 等）后保留相机/日期/GPS 等参数。
 * 任意字段解析或写入失败都将被跳过；整体失败则原样返回 jpegData（不阻断转换）。
 */
export function embedExifIntoJpeg(
  jpegData: ArrayBuffer,
  parsed: Record<string, unknown> | null | undefined,
): ArrayBuffer {
  if (!parsed) return jpegData;
  try {
    let exifObj: Record<string, Record<string, unknown>>;
    try {
      exifObj = piexif.load(arrayBufferToDataURL(jpegData)) as Record<string, Record<string, unknown>>;
    } catch {
      exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {} };
    }
    const O = exifObj['0th'];
    const E = exifObj['Exif'];
    const G = exifObj['GPS'];

    // 日期（优先级：DateTimeOriginal → CreateDate → DateTime）
    const shot = pickDate(parsed.DateTimeOriginal) ?? pickDate(parsed.CreateDate) ?? pickDate(parsed.DateTime);
    if (shot) {
      const ds = formatDateForExif(shot);
      E[piexif.ExifIFD.DateTimeOriginal] = ds;
      E[piexif.ExifIFD.DateTimeDigitized] = ds;
      O[piexif.ImageIFD.DateTime] = ds;
    }

    // 相机 / 基本信息
    const make = pickStr(parsed.Make); if (make) O[piexif.ImageIFD.Make] = make;
    const model = pickStr(parsed.Model); if (model) O[piexif.ImageIFD.Model] = model;
    const sw = pickStr(parsed.Software); if (sw) O[piexif.ImageIFD.Software] = sw;
    const orient = pickInt(parsed.Orientation); if (orient !== null) O[piexif.ImageIFD.Orientation] = orient;
    const artist = pickStr(parsed.Artist); if (artist) O[piexif.ImageIFD.Artist] = artist;
    const copyright = pickStr(parsed.Copyright); if (copyright) O[piexif.ImageIFD.Copyright] = copyright;
    const xr = toRational(parsed.XResolution); if (xr) O[piexif.ImageIFD.XResolution] = xr;
    const yr = toRational(parsed.YResolution); if (yr) O[piexif.ImageIFD.YResolution] = yr;
    const ru = pickInt(parsed.ResolutionUnit); if (ru !== null) O[piexif.ImageIFD.ResolutionUnit] = ru;

    // 曝光参数
    const lm = pickStr(parsed.LensModel); if (lm) E[piexif.ExifIFD.LensModel] = lm;
    const et = toRational(parsed.ExposureTime); if (et) E[piexif.ExifIFD.ExposureTime] = et;
    const fn = toRational(parsed.FNumber); if (fn) E[piexif.ExifIFD.FNumber] = fn;
    const iso = pickInt(parsed.ISOSpeedRatings) ?? pickInt(parsed.ISO); if (iso !== null) E[piexif.ExifIFD.ISOSpeedRatings] = iso;
    const fl = toRational(parsed.FocalLength); if (fl) E[piexif.ExifIFD.FocalLength] = fl;
    const fl35 = pickInt(parsed.FocalLengthIn35mmFilm); if (fl35 !== null) E[piexif.ExifIFD.FocalLengthIn35mmFilm] = fl35;
    const flash = pickInt(parsed.Flash); if (flash !== null) E[piexif.ExifIFD.Flash] = flash;
    const wb = pickInt(parsed.WhiteBalance); if (wb !== null) E[piexif.ExifIFD.WhiteBalance] = wb;
    const mm = pickInt(parsed.MeteringMode); if (mm !== null) E[piexif.ExifIFD.MeteringMode] = mm;
    const ep = pickInt(parsed.ExposureProgram); if (ep !== null) E[piexif.ExifIFD.ExposureProgram] = ep;

    // GPS
    const lat = toDeg(parsed.GPSLatitude);
    const lon = toDeg(parsed.GPSLongitude);
    if (lat !== null && lon !== null) {
      G[piexif.GPSIFD.GPSLatitudeRef] = refOf(parsed.GPSLatitudeRef, lat, 'N', 'S');
      G[piexif.GPSIFD.GPSLatitude] = degToDMS(Math.abs(lat));
      G[piexif.GPSIFD.GPSLongitudeRef] = refOf(parsed.GPSLongitudeRef, lon, 'E', 'W');
      G[piexif.GPSIFD.GPSLongitude] = degToDMS(Math.abs(lon));
      const alt = toRational(parsed.GPSAltitude);
      if (alt) {
        G[piexif.GPSIFD.GPSAltitude] = alt;
        const altRef = pickInt(parsed.GPSAltitudeRef);
        G[piexif.GPSIFD.GPSAltitudeRef] = altRef !== null ? (altRef > 0 ? 1 : 0) : 0;
      }
    }

    const bytes = piexif.dump(exifObj);
    const newUrl = piexif.insert(bytes, arrayBufferToDataURL(jpegData));
    return dataURLToArrayBuffer(newUrl);
  } catch (err) {
    logger.warn('[exif] 元数据写回 JPEG 失败，已跳过（不影响转换结果）', err);
    return jpegData;
  }
}
