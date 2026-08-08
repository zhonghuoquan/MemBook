/**
 * 感知哈希（Perceptual Hash, pHash）引擎
 *
 * 用于识别「视觉相同但字节不同」的照片，弥补 SHA256 精确匹配的盲区：
 * - EXIF 元数据被剥离 / 重新写入（如通过 IM 传输后保存）
 * - JPEG 重新编码（不同压缩质量、不同量化表）
 * - 嵌入缩略图差异
 * - 轻微裁剪 / 旋转 / 缩放
 *
 * 算法（业界标准 pHash，参考 Dr. Neal Krawetz 2011）：
 *   1. 缩放到 32×32 灰度图（消除尺寸 / 颜色差异）
 *   2. 二维 DCT-II 变换（提取频域特征）
 *   3. 取左上 8×8 低频分量（高频对内容变化不敏感）
 *   4. 排除 DC 分量（首项，仅反映整体亮度）
 *   5. 以中位数为阈值二值化 → 63 位哈希（实际存储 64 位，DC 位固定为 0）
 *   6. 比较两哈希的汉明距离，≤ 阈值即视为视觉重复
 *
 * 性能：单张 ~5-15ms（createImageBitmap 直接缩放到 32×32，避免大图绘制）。
 *       1000 张约 5-15 秒，配合进度回调可在主线程运行。
 */

import { logger } from '../utils/logger';

/** pHash 缩放尺寸（32×32，DCT 后取 8×8 低频） */
const HASH_SIZE = 32;
/** DCT 后保留的低频块尺寸 */
const LOW_FREQ_SIZE = 8;
/** 输出哈希位数 */
export const PHASH_BITS = 64;

/**
 * 计算图片数据的感知哈希
 *
 * @param data 图片二进制（JPEG/PNG/HEIC 等任意可解码格式）
 * @returns 64 位 pHash（十六进制字符串，16 字符），失败返回 null
 */
export async function computePHash(data: ArrayBuffer): Promise<string | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    // createImageBitmap 直接缩放到 32×32，避免大图绘制开销
    // resizeQuality: 'low' 足够（pHash 只关心低频结构）
    bitmap = await createImageBitmap(new Blob([data]), {
      resizeWidth: HASH_SIZE,
      resizeHeight: HASH_SIZE,
      resizeQuality: 'low',
    });
    return await computePHashFromBitmap(bitmap);
  } catch (err) {
    // HEIC/RAW 等格式浏览器可能无法直接解码，调用方需 fallback
    logger.debug('[pHash] 图片解码失败', err);
    return null;
  } finally {
    if (bitmap) {
      try { bitmap.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 从 ImageBitmap 计算 pHash（已解码后的位图）
 */
export async function computePHashFromBitmap(bitmap: ImageBitmap): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, HASH_SIZE, HASH_SIZE);
    const imageData = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    const gray = new Float64Array(HASH_SIZE * HASH_SIZE);

    // 转灰度（ITU-R BT.601 luma）
    const px = imageData.data;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }

    // 二维 DCT-II
    const dct = computeDCT2D(gray, HASH_SIZE);

    // 取左上 8×8 低频分量
    const lowFreq: number[] = [];
    for (let u = 0; u < LOW_FREQ_SIZE; u++) {
      for (let v = 0; v < LOW_FREQ_SIZE; v++) {
        lowFreq.push(dct[u * HASH_SIZE + v]);
      }
    }

    // 排除 DC 分量（lowFreq[0]），对其余 63 个值取中位数二值化
    const withoutDC = lowFreq.slice(1);
    const median = computeMedian(withoutDC);

    // 构建 64 位哈希：DC 位固定 0，其余位 > median = 1, ≤ median = 0
    let bits = '';
    bits += '0'; // DC 位
    for (let i = 1; i < lowFreq.length; i++) {
      bits += lowFreq[i] > median ? '1' : '0';
    }

    // 转十六进制字符串（16 字符）
    return bitsToHex(bits);
  } catch (err) {
    logger.debug('[pHash] 计算失败', err);
    return null;
  }
}

/**
 * 二维 DCT-II 变换（可分离实现，数学结果与标准 2D DCT 完全一致）
 *
 * 标准公式：
 *   X[u][v] = α(u)·α(v) · ΣΣ x[i][j]·cos((2i+1)uπ/2N)·cos((2j+1)vπ/2N)
 *
 * 利用 2D DCT 的可分离性拆分为两次 1D DCT：
 *   1. 沿 j 方向（列）：temp[i][v] = α(v) · Σ_j x[i][j]·cos((2j+1)vπ/2N)
 *   2. 沿 i 方向（行）：X[u][v] = α(u) · Σ_i temp[i][v]·cos((2i+1)uπ/2N)
 *
 * 复杂度 O(2·N³)，N=32 时约 6.5 万次乘加，比原 O(N⁴)=100 万次快约 15 倍。
 * 结果与标准 2D DCT 逐位等价（仅计算顺序不同，浮点误差可忽略）。
 */
function computeDCT2D(matrix: Float64Array, N: number): Float64Array {
  // 预计算 cos 基（避免重复 Math.cos 调用）
  const cosTable = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      cosTable[i * N + k] = Math.cos(((2 * i + 1) * k * Math.PI) / (2 * N));
    }
  }
  // 预计算 α(k)
  const alpha = new Float64Array(N);
  alpha[0] = Math.sqrt(1 / N);
  for (let k = 1; k < N; k++) alpha[k] = Math.sqrt(2 / N);

  // Pass 1: 沿 j 方向做 1D DCT → temp[i*N + v]
  const temp = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    const rowOffset = i * N;
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let j = 0; j < N; j++) {
        sum += matrix[rowOffset + j] * cosTable[j * N + v];
      }
      temp[rowOffset + v] = alpha[v] * sum;
    }
  }

  // Pass 2: 沿 i 方向做 1D DCT → result[u*N + v]
  const result = new Float64Array(N * N);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += temp[i * N + v] * cosTable[i * N + u];
      }
      result[u * N + v] = alpha[u] * sum;
    }
  }
  return result;
}

/** 计算中位数（不含 DC 分量） */
function computeMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** 二进制串 → 十六进制字符串 */
function bitsToHex(bits: string): string {
  // 补齐到 64 位
  const padded = bits.padEnd(PHASH_BITS, '0').slice(0, PHASH_BITS);
  let hex = '';
  for (let i = 0; i < padded.length; i += 4) {
    hex += parseInt(padded.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * 计算两个 pHash 的汉明距离（不同位的数量）
 *
 * 阈值参考（业界经验值）：
 *   - 0  : 视觉完全相同（仅元数据/压缩差异）
 *   - ≤5 : 高度相似，几乎可断定为同一张照片
 *   - ≤10: 相似（可能是裁剪/旋转/轻微修改）
 *   - >10: 不同照片
 *
 * @returns 距离值（0-64），输入无效返回 64（视为完全不同）
 */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return PHASH_BITS;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i], 16);
    const xb = parseInt(b[i], 16);
    // 异或后统计 1 的个数
    let xor = xa ^ xb;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/** 默认视觉重复判定阈值（汉明距离 ≤ 5 视为重复） */
export const DEFAULT_PHASH_THRESHOLD = 5;
