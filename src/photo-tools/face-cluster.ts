/**
 * 人脸聚类模块（功能1：按人物归类）
 * ──────────────────────────────────────────────────────
 *
 * 基于 @vladmandic/face-api（face-api.js 维护版 fork）的
 * TinyFaceDetector + FaceLandmark68Net + FaceRecognitionNet：
 *   1. 检测人脸位置（TinyFaceDetector）
 *   2. 提取 68 个面部关键点（FaceLandmark68Net）
 *   3. 计算 128 维人脸 descriptor（FaceRecognitionNet）
 *   4. 欧氏距离 + complete linkage 层次聚类
 *
 * 关键设计：
 *   - 检测与聚类分离：detectFaces 只提取 descriptor，recluster 只做聚类
 *     调阈值时仅重跑 recluster（毫秒级），无需重新检测
 *   - 使用 complete linkage 替代 single linkage，防止链式合并
 *   - 阈值使用欧氏距离，默认 0.5；检测输入尺寸 416、置信度阈值 0.35，
 *     提升小尺寸/模糊人脸检测准确率
 *   - 使用 @vladmandic/face-api 替代已停止维护的 face-api.js 0.22.2
 *     原因：face-api.js 0.22.2 依赖 tfjs-core 1.7.0（2020年），
 *     在 Tauri WebView2 中有兼容性问题（"Cannot set properties of undefined"）
 */

import type { PhotoFileInfo, FaceRecord, FaceCluster, FaceClusterResult, FaceDetectionResult, ToolProgress } from './types';
import { logger } from '../utils/logger';
import { ensureSupportedFormat } from '../engine/storage/heic-converter';
import { isHeicFile } from '../engine/storage/utils';
import { runInChunks, yieldToMain } from './async-utils';

// ── face-api.js 类型定义（仅声明用到的部分） ────────────────

interface FaceApiDescriptor {
  descriptor: Float32Array;
  detection: {
    box: { x: number; y: number; width: number; height: number };
    score: number;
  };
}

interface TfTensor {
  dataSync(): Float32Array | Int32Array | Uint8Array;
  dispose(): void;
}

interface TfEngine {
  startScope(): void;
  endScope(): void;
  /** 当前未释放的 tensor 数量（诊断用） */
  state: { numTensors: number };
}

interface TfModule {
  ready(): Promise<void>;
  setBackend(name: string): Promise<boolean>;
  getBackend(): string;
  env(): { setFlags(flags: Record<string, unknown>): void };
  tensor1d(values: number[]): TfTensor;
  add(a: TfTensor, b: TfTensor): TfTensor;
  dispose(t: TfTensor): void;
  engine(): TfEngine;
  /** 释放所有非变量 tensor（清理中间结果） */
  tidy<T>(fn: () => T): T;
}

interface FaceApiModule {
  nets: {
    tinyFaceDetector: { loadFromUri(uri: string): Promise<void> };
    faceLandmark68Net: { loadFromUri(uri: string): Promise<void> };
    faceRecognitionNet: { loadFromUri(uri: string): Promise<void> };
  };
  detectAllFaces(
    img: HTMLImageElement | HTMLCanvasElement,
    options?: unknown,
  ): {
    withFaceLandmarks(): { withFaceDescriptors(): Promise<FaceApiDescriptor[]> };
  };
  TinyFaceDetectorOptions: new (opts?: { inputSize?: number; scoreThreshold?: number }) => unknown;
  /** face-api.js 0.22 暴露的 tf 命名空间，用于初始化 backend */
  tf: TfModule;
}

// ── face-api.js 单例加载 ──────────────────────────────────

let faceApiModule: FaceApiModule | null = null;
let faceApiLoadPromise: Promise<FaceApiModule | null> | null = null;
let recognitionModelLoaded = false;
/** 缓存最近一次加载失败的具体原因，供 UI 显示 */
let lastLoadError: string | null = null;

// ── tfjs 后端回退（WebGL → CPU）─────────────────────────
// @vladmandic/face-api 内置新版 tfjs，在部分 WebView 的 WebGL 后端下
// 推理仍可能抛异常。一旦检测到推理异常，切换到 CPU 后端重试一次。
let cpuBackendTried = false;

/**
 * 切换 tfjs 到 CPU 后端（仅尝试一次）。
 * 使用 faceApiModule.tf（@vladmandic/face-api 导出的 tf 命名空间）
 * @returns 是否成功切换（true 表示已切换，调用方可重试推理）
 */
async function trySwitchToCpuBackend(): Promise<boolean> {
  if (cpuBackendTried) return false;
  cpuBackendTried = true;
  try {
    if (!faceApiModule) return false;
    const current = faceApiModule.tf.getBackend();
    if (current && current !== 'cpu') {
      await faceApiModule.tf.setBackend('cpu');
      logger.warn(`[face-cluster] 推理异常，已切换 tfjs 后端 ${current} → cpu（较慢但稳定），后续人脸识别将用 CPU 完成`);
      return true;
    }
  } catch (err) {
    logger.warn('[face-cluster] 切换 CPU 后端失败:', err);
  }
  return false;
}

/**
 * 加载 face-api.js + 所需模型（TinyFaceDetector + FaceLandmark68 + FaceRecognition）
 * 模型路径：
 *   - TinyFaceDetector: /models/face-detection/（复用 content-aware 已加载的）
 *   - Landmark + Recognition: /models/face-recognition/
 */
async function loadFaceApiForClustering(): Promise<FaceApiModule | null> {
  if (faceApiModule && recognitionModelLoaded) return faceApiModule;
  if (faceApiLoadPromise) return faceApiLoadPromise;

  faceApiLoadPromise = (async () => {
    try {
      // 使用 @vladmandic/face-api（face-api.js 维护版 fork，内置新版 tfjs）
      // 原始 face-api.js 0.22.2 依赖 tfjs-core 1.7.0（2020年），在 Tauri WebView2 中崩溃
      const mod = (await import('@vladmandic/face-api')) as unknown as FaceApiModule;

      // ── 关键：初始化 TensorFlow.js backend ──
      // @vladmandic/face-api 内置新版 tfjs（4.x），backend 注册更可靠
      // 优先 WebGL（GPU 加速），失败时回退 CPU
      // setBackend 返回 Promise<boolean>，false 表示初始化失败（不抛错）
      logger.info('[face-cluster] 正在初始化 TF.js backend...');

      // 尝试顺序：webgl → cpu（GPU 推理比 CPU 快 5-10 倍；推理已串行化，无并发竞态，WebGL 稳定可用）
      const candidates = ['webgl', 'cpu'];
      let backendReady = false;
      let lastError: unknown = null;

      for (const name of candidates) {
        try {
          const ok = await mod.tf.setBackend(name);
          if (!ok) {
            logger.warn(`[face-cluster] setBackend('${name}') 返回 false`);
            continue;
          }
          await mod.tf.ready();
          const current = mod.tf.getBackend();
          if (current !== name) {
            logger.warn(`[face-cluster] setBackend('${name}') 后实际 backend 为 '${current}'`);
            continue;
          }
          // 验证 backend 是否真正可用（做一次小运算）
          try {
            const a = mod.tf.tensor1d([1, 2, 3]);
            const b = mod.tf.tensor1d([4, 5, 6]);
            const c = mod.tf.add(a, b);
            // 注意：tfjs-core 1.7.0 中 dataSync 是 tensor 实例方法，不是 tf 命名空间方法
            const result = c.dataSync();
            a.dispose();
            b.dispose();
            c.dispose();
            if (!result || result.length !== 3 || result[0] !== 5 || result[1] !== 7 || result[2] !== 9) {
              throw new Error(`运算结果错误: ${result ? Array.from(result).join(',') : 'null'}`);
            }
            logger.info(`[face-cluster] backend '${name}' 验证通过: [1,2,3]+[4,5,6]=[${Array.from(result).join(',')}]`);
            backendReady = true;
            break;
          } catch (verifyErr) {
            logger.warn(`[face-cluster] backend '${name}' 运算验证失败:`, verifyErr);
            lastError = verifyErr;
          }
        } catch (e) {
          logger.warn(`[face-cluster] setBackend('${name}') 抛错:`, e);
          lastError = e;
        }
      }

      if (!backendReady) {
        throw new Error(`所有 TF.js backend 均不可用。最后错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      }

      logger.info(`[face-cluster] TF backend 已就绪: ${mod.tf.getBackend()}`);

      // ── 加载模型 ──
      const detectionUrl = '/models/face-detection';
      const recognitionUrl = '/models/face-recognition';
      try {
        await mod.nets.tinyFaceDetector.loadFromUri(detectionUrl);
        logger.info('[face-cluster] TinyFaceDetector 模型加载成功');
      } catch (e) {
        throw new Error(`加载 TinyFaceDetector 模型失败: ${(e as Error).message}`, { cause: e });
      }
      try {
        await mod.nets.faceLandmark68Net.loadFromUri(recognitionUrl);
        logger.info('[face-cluster] FaceLandmark68 模型加载成功');
      } catch (e) {
        throw new Error(`加载 FaceLandmark68 模型失败: ${(e as Error).message}`, { cause: e });
      }
      try {
        await mod.nets.faceRecognitionNet.loadFromUri(recognitionUrl);
        logger.info('[face-cluster] FaceRecognition 模型加载成功');
      } catch (e) {
        throw new Error(`加载 FaceRecognition 模型失败: ${(e as Error).message}`, { cause: e });
      }
      faceApiModule = mod;
      recognitionModelLoaded = true;
      logger.info('[face-cluster] face-api 模型全部加载成功（detection + landmark + recognition）');
      return mod;
    } catch (err) {
      faceApiModule = null;
      recognitionModelLoaded = false;
      logger.error('[face-cluster] face-api 初始化失败:', err);
      // 缓存失败原因，供 UI 显示具体错误
      lastLoadError = err instanceof Error ? err.message : String(err);
      return null;
    }
  })();

  const result = await faceApiLoadPromise;
  if (!result) faceApiLoadPromise = null;
  return result;
}

// ── 图片加载 ──────────────────────────────────────────────

async function loadImageFromData(
  data: ArrayBuffer,
  photoName: string,
  originalPath?: string,
): Promise<{ img: HTMLImageElement; url: string } | null> {
  try {
    let blob: Blob;
    if (isHeicFile(photoName)) {
      try {
        const file = new File([data], photoName, { type: 'image/heic' });
        // 传入原始路径，让 Tauri 桌面端优先走 Rust/WIC、Rust/libheif 原生解码（快、省内存），
        // 避免回退到 heic2any WASM（主线程解码，又慢又吃内存，是 HEIC 人脸识别“卡住/极慢”的主因）
        const jpegFile = await ensureSupportedFormat(file, undefined, originalPath);
        blob = new Blob([await jpegFile.arrayBuffer()], { type: 'image/jpeg' });
      } catch (err) {
        logger.warn(`[face-cluster] HEIC 转换失败 ${photoName}:`, err);
        return null;
      }
    } else {
      blob = new Blob([data], { type: 'image/jpeg' });
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
      return { img, url };
    } catch {
      // 加载失败立即释放
      URL.revokeObjectURL(url);
      return null;
    }
  } catch {
    return null;
  }
}

// ── descriptor 提取 ───────────────────────────────────────

export interface FaceClusterOptions {
  /** 进度回调 */
  onProgress?: (p: ToolProgress) => void;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 读取照片数据 */
  readData?: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /**
   * 聚类距离阈值（欧氏距离，<= 该值视为同一人），默认 0.5
   * 值越小越严格（分出更多组，减少误合并），值越大越宽松（合并更多）
   */
  similarityThreshold?: number;
  /** TinyFaceDetector 输入尺寸，默认 416（TinyFaceDetector 支持的档位之一，兼顾精度与速度）
   * 相比 320 能更好检测小尺寸人脸，提升识别准确率 */
  inputSize?: number;
  /** 检测置信度阈值，默认 0.35（略微降低以捕获更多模糊/小尺寸人脸） */
  scoreThreshold?: number;
}

/**
 * 从单张照片中提取人脸 descriptor
 * @returns FaceRecord[]（可能多个人脸），无人脸返回空数组
 */
export async function extractFaceDescriptors(
  photo: PhotoFileInfo,
  readData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>,
  inputSize = 416,
  scoreThreshold = 0.35,
): Promise<FaceRecord[]> {
  const mod = await loadFaceApiForClustering();
  if (!mod) return [];

  const data = await readData(photo);
  if (!data) return [];

  const loaded = await loadImageFromData(data, photo.name, photo.path);
  if (!loaded) return [];
  const { img, url } = loaded;

  // 将图片绘制到 Canvas，避免 face-api.js 直接处理 HTMLImageElement
  // 时可能出现的跨域/ tainted canvas 问题，同时限制尺寸防止超大图 OOM
  let canvas: HTMLCanvasElement | null = null;
  try {
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    // 限制输入图片尺寸，防止超大图导致 WebGL 纹理溢出或 OOM，同时加快 CPU 解码与绘制
    // 人脸识别对分辨率不敏感（descriptor 由 128 维特征决定），800px 足够且大幅提速
    const MAX_DIM = 800;
    let scale = 1;
    if (imgW > MAX_DIM || imgH > MAX_DIM) {
      scale = MAX_DIM / Math.max(imgW, imgH);
    }
    const cw = Math.round(imgW * scale);
    const ch = Math.round(imgH * scale);
    canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      logger.warn(`[face-cluster] 无法创建 Canvas 2D context: ${photo.name}`);
      URL.revokeObjectURL(url);
      return [];
    }
    ctx.drawImage(img, 0, 0, cw, ch);
  } catch (err) {
    logger.warn(`[face-cluster] Canvas 绘制失败 ${photo.name}:`, err);
    URL.revokeObjectURL(url);
    return [];
  }

  // 推理：首次失败时自动切换到 CPU 后端重试一次（WebGL 兼容性问题）
  const runInference = () =>
    mod
      .detectAllFaces(canvas!, new mod.TinyFaceDetectorOptions({ inputSize, scoreThreshold }))
      .withFaceLandmarks()
      .withFaceDescriptors();

  let detections: FaceApiDescriptor[];
  try {
    detections = await runInference();
  } catch (err) {
    // 推理失败：很可能是 WebGL 后端兼容性问题，切换到 CPU 后端重试一次
    logger.warn(`[face-cluster] 首次推理失败 ${photo.name}:`, err);
    if (await trySwitchToCpuBackend()) {
      detections = await runInference();
    } else {
      throw err;
    }
  }

  try {
    if (!detections || detections.length === 0) return [];

    const cw = canvas!.width;
    const ch = canvas!.height;

    // 提前拷贝 descriptor 数据（Float32Array），避免后续访问可能被释放的 tensor
    const faces: FaceRecord[] = detections.map((d) => {
      // descriptor 是 Float32Array，slice() 创建独立拷贝
      const descriptorCopy = d.descriptor.slice(0) as Float32Array;
      return {
        descriptor: descriptorCopy,
        x: d.detection.box.x / cw,
        y: d.detection.box.y / ch,
        width: d.detection.box.width / cw,
        height: d.detection.box.height / ch,
        score: d.detection.score,
        photoId: photo.id,
      };
    });

    return faces;
  } catch (err) {
    logger.warn(`[face-cluster] 提取 descriptor 失败 ${photo.name}:`, err);
    return [];
  } finally {
    // 显式释放 Canvas 和 Image，减少内存压力
    // 关键：不释放会导致处理 70+ 张照片后内存耗尽，
    // tfjs 内部对象变为 undefined，抛出 "Cannot set properties of undefined"
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.src = '';
    URL.revokeObjectURL(url);
  }
}

// ── 欧氏距离 ────────────────────────────────────────────

/**
 * 计算两个 descriptor 的欧氏距离
 * face-api.js 的 descriptor 是 L2 归一化的，欧氏距离范围 [0, 2]
 * 0 = 完全相同，2 = 完全相反
 *
 * face-api.js FaceMatcher 默认阈值 0.6
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ── 层次聚类（Complete Linkage） ──────────────────────────

/**
 * 三角形距离矩阵中 (i<j) 的扁平下标
 * 行优先存储仅上三角：idx = i*n - i*(i+1)/2 - i - 1 + j
 */
function pairIndex(i: number, j: number, n: number): number {
  return i * n - (i * (i + 1)) / 2 - i - 1 + j;
}

/**
 * 对人脸 descriptor 进行层次聚类（complete linkage）
 *
 * complete linkage：两个簇合并当且仅当它们之间所有 face pair 的距离都 <= 阈值
 * 相比 single linkage，能防止"链式效应"（A~B, B~C → ABC 同组，即使 A 和 C 差异大）
 *
 * 大批量优化（上万张人脸不卡死）：
 * 1. 距离矩阵 O(n²) 计算改为分批，每批之间 yieldToMain 让出主线程
 * 2. 矩阵用三角形扁平存储（仅保留 i<j），内存减半
 * 3. 「防爆表」：只收集距离 <= 阈值的 pair（距离更大的 pair 本就不可能合并），
 *    且用类型化数组存储 + 距离升序索引排序，避免原先「构建 O(n²) 个对象再 sort」
 *    的内存/时间爆炸；超过 MAX_CLOSE_PAIRS 时按比例截断人脸集并告警
 * 4. complete linkage 跨簇检查用「簇成员表 + 生成计数器 memo」：
 *    同一对簇首次检查后缓存结果，簇成员变化（gen 变化）才重算，
 *    避免 O(³) 的全量两两重扫（历史爆表主因）
 * 5. 合并循环分批 + yieldToMain，处理中 UI 保持响应
 */
async function agglomerativeCluster(
  faces: FaceRecord[],
  threshold: number,
): Promise<FaceRecord[][]> {
  const n = faces.length;
  if (n === 0) return [];
  if (n === 1) return [faces];

  // 硬限制：人脸数超过上限时截断
  const MAX_FACES = 5000;
  if (n > MAX_FACES) {
    logger.warn(`[face-cluster] 人脸数 ${n} 超过上限 ${MAX_FACES}，截断前 ${MAX_FACES} 个`);
    faces = faces.slice(0, MAX_FACES);
  }

  const limitedN = faces.length;
  const totalPairs = (limitedN * (limitedN - 1)) / 2;

  // ── 距离矩阵分批计算（三角形扁平存储，O(n²) 分批让出主线程） ──
  const distFlat = new Float32Array(totalPairs);
  const MATRIX_BATCH_ROWS = 200; // 每批计算多少行，批间让出主线程
  for (let r0 = 0; r0 < limitedN; r0 += MATRIX_BATCH_ROWS) {
    const rEnd = Math.min(r0 + MATRIX_BATCH_ROWS, limitedN);
    for (let i = r0; i < rEnd; i++) {
      const fi = faces[i].descriptor;
      for (let j = i + 1; j < limitedN; j++) {
        distFlat[pairIndex(i, j, limitedN)] = euclideanDistance(fi, faces[j].descriptor);
      }
    }
    if (rEnd < limitedN) await yieldToMain();
  }

  // ── 收集距离 <= 阈值的 pair（防爆表） ──
  // 先统计数量，再分配类型化数组填充，避免动态 push 开销
  let closeCount = 0;
  for (let k = 0; k < totalPairs; k++) {
    if (distFlat[k] <= threshold) closeCount++;
  }

  /** 防爆上限：最多收集 300 万对（约 24MB×2 + 排序索引 12MB），超限降级截断 */
  const MAX_CLOSE_PAIRS = 3_000_000;
  if (closeCount > MAX_CLOSE_PAIRS) {
    // 极端情况：几乎所有人脸都互相接近（如全部同一个人）。为保证内存/时间有界，
    // 只保留前 K 个人脸参与聚类（K(K-1)/2 <= MAX_CLOSE_PAIRS），其余忽略并告警。
    const reducedN = Math.floor((1 + Math.sqrt(1 + 8 * MAX_CLOSE_PAIRS)) / 2);
    logger.warn(
      `[face-cluster] 阈值内 pair 数 ${closeCount} 超过上限 ${MAX_CLOSE_PAIRS}，聚类人脸截断为前 ${Math.min(reducedN, limitedN)} 个`,
    );
    if (reducedN < limitedN) {
      faces = faces.slice(0, reducedN);
      return agglomerativeCluster(faces, threshold);
    }
  }

  // 分配类型化数组 + 索引排序（避免构建 O(n²) 对象数组导致内存爆炸）
  const pairI = new Uint32Array(closeCount);
  const pairJ = new Uint32Array(closeCount);
  const order = new Uint32Array(closeCount);
  let pi = 0;
  for (let i = 0; i < limitedN; i++) {
    for (let j = i + 1; j < limitedN; j++) {
      const d = distFlat[pairIndex(i, j, limitedN)];
      if (d <= threshold) {
        pairI[pi] = i;
        pairJ[pi] = j;
        pi++;
      }
    }
  }
  for (let k = 0; k < closeCount; k++) order[k] = k;
  // 按距离升序排序（浮点差值排序，稳定）
  order.sort((a, b) => distFlat[pairIndex(pairI[a], pairJ[a], limitedN)] - distFlat[pairIndex(pairI[b], pairJ[b], limitedN)]);

  // ── 并查集 + 簇成员表 ──
  const parent = new Uint32Array(limitedN);
  for (let i = 0; i < limitedN; i++) parent[i] = i;
  const members: number[][] = faces.map((_, i) => [i]);
  /** 每簇生成计数器：簇成员变化（合并）时自增，用于使缓存失效 */
  const gen = new Uint32Array(limitedN);

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    // 路径压缩
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };

  /** 合并两簇，小簇并入大簇，更新成员表与生成计数器 */
  const unionWithMembers = (a: number, b: number): void => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (members[ra].length < members[rb].length) {
      const tmp = ra;
      ra = rb;
      rb = tmp;
    }
    parent[rb] = ra;
    for (const m of members[rb]) members[ra].push(m);
    members[rb] = [];
    gen[ra]++;
    gen[rb]++;
  };

  // ── Complete linkage 跨簇检查（带 memo，防爆表） ──
  // 同一对簇的检查结果缓存；任一簇成员变化（gen 变化）后自动失效重算
  const mergeMemo = new Map<string, { genA: number; genB: number; result: boolean }>();
  const checkMergeable = (raIn: number, rbIn: number): boolean => {
    if (raIn === rbIn) return true;
    const ra = raIn < rbIn ? raIn : rbIn;
    const rb = raIn < rbIn ? rbIn : raIn;
    const key = `${ra},${rb}`;
    const memo = mergeMemo.get(key);
    if (memo && memo.genA === gen[ra] && memo.genB === gen[rb]) {
      return memo.result;
    }
    const listA = members[ra];
    const listB = members[rb];
    let maxCross = 0;
    let allClose = true;
    outer:
    for (let x = 0; x < listA.length; x++) {
      const ax = listA[x];
      for (let y = 0; y < listB.length; y++) {
        const by = listB[y];
        const d = distFlat[pairIndex(Math.min(ax, by), Math.max(ax, by), limitedN)];
        if (d > maxCross) {
          maxCross = d;
          if (d > threshold) {
            allClose = false;
            break outer;
          }
        }
      }
    }
    // memo 有界：过大时清空（牺牲一点缓存命中换取内存安全）
    if (mergeMemo.size > 200_000) mergeMemo.clear();
    mergeMemo.set(key, { genA: gen[ra], genB: gen[rb], result: allClose });
    return allClose;
  };

  // ── 按距离升序合并（分批 + 让出主线程） ──
  const MERGE_CHUNK = 100_000;
  for (let start = 0; start < closeCount; start += MERGE_CHUNK) {
    const end = Math.min(start + MERGE_CHUNK, closeCount);
    for (let k = start; k < end; k++) {
      const i = pairI[order[k]];
      const j = pairJ[order[k]];
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue; // 已在同簇
      if (checkMergeable(ri, rj)) {
        unionWithMembers(i, j);
      }
      // 距离 > 阈值的 pair 未收集，无需 break
    }
    if (end < closeCount) await yieldToMain();
  }

  // 按 root 分组得到簇
  const rootToIndex = new Map<number, number>();
  const groups: FaceRecord[][] = [];
  for (let i = 0; i < limitedN; i++) {
    const root = find(i);
    let gi = rootToIndex.get(root);
    if (gi === undefined) {
      gi = groups.length;
      rootToIndex.set(root, gi);
      groups.push([]);
    }
    groups[gi].push(faces[i]);
  }
  return groups;
}

// ── 人脸检测（分离检测与聚类） ────────────────────────────

/**
 * 人脸检测：从照片列表中提取所有人脸 descriptor
 * 与聚类分离，检测结果可缓存，调阈值时只需重跑 recluster
 */
export async function detectFaces(
  photos: PhotoFileInfo[],
  options: FaceClusterOptions = {},
): Promise<FaceDetectionResult> {
  const { onProgress, signal } = options;
  const inputSize = options.inputSize ?? 416;
  const scoreThreshold = options.scoreThreshold ?? 0.35;
  const readData = options.readData;

  if (photos.length === 0) {
    return { faces: [], photosWithFacesSet: new Set(), failedCount: 0, modelLoadFailed: false, totalPhotos: 0 };
  }
  if (!readData) {
    logger.warn('[face-cluster] 缺少 readData，无法提取人脸');
    return { faces: [], photosWithFacesSet: new Set(), failedCount: 0, modelLoadFailed: false, totalPhotos: photos.length };
  }

  try {
    // 加载模型
    onProgress?.({ phase: 'loading', current: 0, total: 1, message: '加载人脸识别模型...' });
    const mod = await loadFaceApiForClustering();
    if (!mod) {
      return { faces: [], photosWithFacesSet: new Set(), failedCount: 0, modelLoadFailed: true, totalPhotos: photos.length, loadErrorMessage: lastLoadError ?? '未知错误' };
    }

    // 顺序提取 descriptor（分批串行 + 让出主线程）
    //
    // 为什么必须串行：tfjs 推理依赖全局可变执行状态（graph runner、当前 tensor、内存管理器）。
    // 若并发执行 detectAllFaces→withFaceLandmarks→withFaceDescriptors，多个推理任务
    // 会通过 await 交错执行，互相污染共享状态，导致
    //   "Cannot set properties of undefined (setting 'o')"
    // 这类随机 TypeError（WebGL 与 CPU 后端均会出现）。
    //
    // 且 JS 为单线程：CPU 后端下"并发"只是时间片切换，无真实并行，反而因状态竞争更慢；
    // WebGL 后端也是通过主线程串行提交到 GPU。因此串行既不损失速度，又彻底消除竞态。
    //
    // 大批量优化：每批照片之间 yieldToMain 让出主线程，UI 可渲染/响应输入事件，
    // 避免上万张照片时主线程长时间被占导致"卡死"；进度按批次更新（平滑、不逐张刷屏）。
    const FACE_DETECT_BATCH = 10; // 每批处理照片数，批间让出主线程
    onProgress?.({ phase: 'detecting', current: 0, total: photos.length, message: '检测人脸...' });
    const allFaces: FaceRecord[] = [];
    const photosWithFacesSet = new Set<string>();
    let failedCount = 0;
    let doneCount = 0;

    await runInChunks(
      photos,
      FACE_DETECT_BATCH,
      async (batch) => {
        for (const photo of batch) {
          try {
            const faces = await extractFaceDescriptors(photo, readData, inputSize, scoreThreshold);
            if (faces.length > 0) {
              allFaces.push(...faces);
              photosWithFacesSet.add(photo.id);
            }
          } catch (err) {
            logger.warn(`[face-cluster] 处理失败 ${photo.name}:`, err);
            failedCount++;
          }
          doneCount++;
        }
        // onProgress 放在 try/catch 内部，防止回调错误逃逸到顶层 catch
        try {
          onProgress?.({
            phase: 'detecting',
            current: doneCount,
            total: photos.length,
            message: `检测人脸 ${doneCount}/${photos.length}`,
          });
        } catch {
          // 忽略进度回调错误（如 React state 更新异常）
        }
      },
      signal,
    );

    if (signal?.aborted) {
      throw new DOMException('已取消', 'AbortError');
    }

    // 诊断日志：输出距离矩阵统计
    if (allFaces.length > 1) {
      let minDist = Infinity, maxDist = 0, avgDist = 0, count = 0;
      for (let i = 0; i < allFaces.length; i++) {
        for (let j = i + 1; j < allFaces.length; j++) {
          const d = euclideanDistance(allFaces[i].descriptor, allFaces[j].descriptor);
          if (d < minDist) minDist = d;
          if (d > maxDist) maxDist = d;
          avgDist += d;
          count++;
        }
      }
      avgDist /= count || 1;
      logger.info(`[face-cluster] 距离统计: min=${minDist.toFixed(3)} max=${maxDist.toFixed(3)} avg=${avgDist.toFixed(3)} faces=${allFaces.length} threshold=${options.similarityThreshold ?? 0.6}`);
    }

    return {
      faces: allFaces,
      photosWithFacesSet,
      failedCount,
      modelLoadFailed: false,
      totalPhotos: photos.length,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // 未预期的错误（如 TF.js backend 异常），转为 modelLoadFailed 返回
    logger.error('[face-cluster] detectFaces 未预期错误:', err);
    return {
      faces: [],
      photosWithFacesSet: new Set(),
      failedCount: 0,
      modelLoadFailed: true,
      totalPhotos: photos.length,
      loadErrorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 重新聚类：基于已检测的 descriptor 重新聚类（调阈值时调用，毫秒级）
 */
export async function recluster(
  detection: FaceDetectionResult,
  threshold: number,
  photos: PhotoFileInfo[],
): Promise<FaceClusterResult> {
  const clusteredGroups = await agglomerativeCluster(detection.faces, threshold);

  const photoById = new Map<string, PhotoFileInfo>();
  for (const p of photos) photoById.set(p.id, p);

  const clusters: FaceCluster[] = clusteredGroups
    .map((faces, idx) => {
      const photoIds = [...new Set(faces.map((f) => f.photoId))];
      const clusterPhotos = photoIds
        .map((id) => photoById.get(id))
        .filter((p): p is PhotoFileInfo => p !== undefined);

      const representativeFace = faces.reduce((best, f) => {
        const bestScore = best.width * best.height * best.score;
        const fScore = f.width * f.height * f.score;
        return fScore > bestScore ? f : best;
      });

      return {
        clusterId: `face-${idx}`,
        faces,
        photos: clusterPhotos,
        representativeFace,
        photoCount: clusterPhotos.length,
      };
    })
    .sort((a, b) => b.photoCount - a.photoCount);

  const noFacePhotos = photos.filter((p) => !detection.photosWithFacesSet.has(p.id));

  return {
    clusters,
    noFacePhotos,
    totalPhotos: detection.totalPhotos,
    photosWithFaces: detection.photosWithFacesSet.size,
    failedPhotos: detection.failedCount,
    modelLoadFailed: detection.modelLoadFailed,
  };
}

// ── 完整聚类流程（兼容旧接口） ────────────────────────────

/**
 * 人脸聚类主入口（检测 + 聚类一体化）
 * 推荐使用 detectFaces + recluster 分离调用以支持调阈值即时重聚类
 */
export async function clusterFaces(
  photos: PhotoFileInfo[],
  options: FaceClusterOptions = {},
): Promise<FaceClusterResult> {
  const { onProgress, signal } = options;
  const threshold = options.similarityThreshold ?? 0.5;

  if (photos.length === 0) {
    return { clusters: [], noFacePhotos: [], totalPhotos: 0, photosWithFaces: 0, failedPhotos: 0 };
  }

  const detection = await detectFaces(photos, options);

  if (signal?.aborted) {
    throw new DOMException('已取消', 'AbortError');
  }

  onProgress?.({ phase: 'clustering', current: 0, total: detection.faces.length, message: `聚类 ${detection.faces.length} 个人脸...` });

  const result = await recluster(detection, threshold, photos);

  onProgress?.({
    phase: 'done',
    current: result.clusters.length,
    total: result.clusters.length,
    message: `找到 ${result.clusters.length} 个人脸组，${result.noFacePhotos.length} 张无人脸`,
  });

  return result;
}

/** findFaceClusters 是 clusterFaces 的别名 */
export const findFaceClusters = clusterFaces;
