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

async function loadImageFromData(data: ArrayBuffer, photoName: string): Promise<{ img: HTMLImageElement; url: string } | null> {
  try {
    let blob: Blob;
    if (isHeicFile(photoName)) {
      try {
        const file = new File([data], photoName, { type: 'image/heic' });
        const jpegFile = await ensureSupportedFormat(file);
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

  const loaded = await loadImageFromData(data, photo.name);
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
 * 对人脸 descriptor 进行层次聚类（complete linkage）
 *
 * complete linkage：两个簇合并当且仅当它们之间所有 face pair 的距离都 <= 阈值
 * 相比 single linkage，能防止"链式效应"（A~B, B~C → ABC 同组，即使 A 和 C 差异大）
 *
 * 实现：最小生成树（Prim）+ 阈值切边
 * 但切边时不仅看 MST 边，还检查簇间最小距离（complete linkage 语义）
 *
 * 复杂度 O(n²)，n < 5000 可接受
 */
function agglomerativeCluster(
  faces: FaceRecord[],
  threshold: number,
): FaceRecord[][] {
  const n = faces.length;
  if (n === 0) return [];
  if (n === 1) return [faces];

  // 硬限制：人脸数超过 5000 时截断
  const MAX_FACES = 5000;
  if (n > MAX_FACES) {
    logger.warn(`[face-cluster] 人脸数 ${n} 超过上限 ${MAX_FACES}，截断前 ${MAX_FACES} 个`);
    faces = faces.slice(0, MAX_FACES);
  }

  const limitedN = faces.length;

  // 预计算距离矩阵（对称），O(n²)
  // 必须先初始化所有行，再填充距离值。
  // 否则当 i=0, j=1 时 distMatrix[1] 还是 undefined，
  // 执行 distMatrix[1][0] = dist 会抛 "Cannot set properties of undefined (setting '0')"
  const distMatrix: Float32Array[] = new Array(limitedN);
  for (let i = 0; i < limitedN; i++) {
    distMatrix[i] = new Float32Array(limitedN);
  }
  for (let i = 0; i < limitedN; i++) {
    for (let j = i + 1; j < limitedN; j++) {
      const dist = euclideanDistance(faces[i].descriptor, faces[j].descriptor);
      distMatrix[i][j] = dist;
      distMatrix[j][i] = dist;
    }
  }

  // ── 并查集 ──
  const parent: number[] = Array.from({ length: limitedN }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // ── Complete linkage 聚类 ──
  // 按距离从小到大排序所有 pair，依次尝试合并
  // 合并条件：两簇间所有 pair 距离都 <= threshold
  // 实现：按距离升序处理 pair，合并时检查跨簇最小距离是否 <= threshold

  // 收集所有 pair 并按距离升序排序
  const pairs: Array<{ i: number; j: number; dist: number }> = [];
  for (let i = 0; i < limitedN; i++) {
    for (let j = i + 1; j < limitedN; j++) {
      pairs.push({ i, j, dist: distMatrix[i][j] });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  // 按距离升序合并：只合并距离 <= threshold 的 pair
  // complete linkage：合并前检查两簇间最大距离是否 <= threshold
  // 由于按距离升序处理，当前 pair 的距离是两簇间最小的未处理距离
  // 如果当前 pair 距离已 > threshold，后续 pair 只会更大，跳过
  for (const { i, j, dist } of pairs) {
    if (dist > threshold) break; // 后续 pair 距离更大，全部跳过

    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue; // 已在同簇

    // Complete linkage 检查：两簇间所有 pair 的最大距离是否 <= threshold
    // 收集两簇所有成员
    const membersI: number[] = [];
    const membersJ: number[] = [];
    for (let k = 0; k < limitedN; k++) {
      if (find(k) === ri) membersI.push(k);
      else if (find(k) === rj) membersJ.push(k);
    }

    // 检查跨簇最大距离
    let maxDist = 0;
    for (const mi of membersI) {
      for (const mj of membersJ) {
        if (distMatrix[mi][mj] > maxDist) maxDist = distMatrix[mi][mj];
      }
    }

    if (maxDist <= threshold) {
      union(i, j);
    }
    // 如果 maxDist > threshold，不合并，继续处理下一个 pair
    // 后续可能有更近的 pair 能合并其他簇
  }

  // 按 root 分组得到簇
  const groups = new Map<number, FaceRecord[]>();
  for (let i = 0; i < limitedN; i++) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(faces[i]);
    groups.set(root, arr);
  }
  return [...groups.values()];
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

    // 顺序提取 descriptor（串行）
    //
    // 为什么必须串行：tfjs 推理依赖全局可变执行状态（graph runner、当前 tensor、内存管理器）。
    // 若并发执行 detectAllFaces→withFaceLandmarks→withFaceDescriptors，多个推理任务
    // 会通过 await 交错执行，互相污染共享状态，导致
    //   "Cannot set properties of undefined (setting 'o')"
    // 这类随机 TypeError（WebGL 与 CPU 后端均会出现）。
    //
    // 且 JS 为单线程：CPU 后端下"并发"只是时间片切换，无真实并行，反而因状态竞争更慢；
    // WebGL 后端也是通过主线程串行提交到 GPU。因此串行既不损失速度，又彻底消除竞态。
    onProgress?.({ phase: 'detecting', current: 0, total: photos.length, message: '检测人脸...' });
    const allFaces: FaceRecord[] = [];
    const photosWithFacesSet = new Set<string>();
    let failedCount = 0;
    let doneCount = 0;

    for (const photo of photos) {
      if (signal?.aborted) break;
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
    }

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
export function recluster(
  detection: FaceDetectionResult,
  threshold: number,
  photos: PhotoFileInfo[],
): FaceClusterResult {
  const clusteredGroups = agglomerativeCluster(detection.faces, threshold);

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

  const result = recluster(detection, threshold, photos);

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
