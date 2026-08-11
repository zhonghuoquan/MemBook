/**
 * 人脸聚类模块（功能1：按人物归类）
 * ──────────────────────────────────────────────────────
 *
 * 基于 face-api.js 的 TinyFaceDetector + FaceLandmark68Net + FaceRecognitionNet：
 *   1. 检测人脸位置（TinyFaceDetector，复用 content-aware.ts 已加载的模型）
 *   2. 提取 68 个面部关键点（FaceLandmark68Net）
 *   3. 计算 128 维人脸 descriptor（FaceRecognitionNet）
 *   4. 余弦相似度 + 层次聚类（agglomerative clustering）
 *
 * 模型文件：
 *   - TinyFaceDetector：public/models/face-detection/（已存在，content-aware 使用）
 *   - FaceLandmark68Net：public/models/face-recognition/face_landmark_68_model-*.json
 *   - FaceRecognitionNet：public/models/face-recognition/face_recognition_model-*.json
 *
 * 模型加载策略：用户选择"打包进安装包"，模型随应用发布，首次使用无需下载。
 */

import type { PhotoFileInfo, FaceRecord, FaceCluster, FaceClusterResult, ToolProgress } from './types';
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
}

// ── face-api.js 单例加载 ──────────────────────────────────

let faceApiModule: FaceApiModule | null = null;
let faceApiLoadPromise: Promise<FaceApiModule | null> | null = null;
let recognitionModelLoaded = false;

// ── tfjs 后端回退（WebGL → CPU）─────────────────────────
// face-api.js 0.22 依赖的 tfjs-core 1.7 在部分浏览器/WebView 的 WebGL 后端下，
// landmark/recognition 推理会抛 “Cannot set properties of undefined” 之类的 TypeError。
// 一旦检测到推理异常，切换到 CPU 后端重试一次，保证人脸聚类功能可用。
interface TfCoreLike {
  getBackend: () => string;
  setBackend: (name: string) => Promise<boolean> | void;
}

let tfCoreModule: TfCoreLike | null = null;
let cpuBackendTried = false;

async function getTfCore(): Promise<TfCoreLike> {
  if (!tfCoreModule) {
    tfCoreModule = (await import('@tensorflow/tfjs-core')) as unknown as TfCoreLike;
  }
  return tfCoreModule;
}

/**
 * 切换 tfjs 到 CPU 后端（仅尝试一次）。
 * @returns 是否成功切换（true 表示已切换，调用方可重试推理）
 */
async function trySwitchToCpuBackend(): Promise<boolean> {
  if (cpuBackendTried) return false;
  cpuBackendTried = true;
  try {
    const tf = await getTfCore();
    const current = tf.getBackend();
    if (current && current !== 'cpu') {
      await tf.setBackend('cpu');
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
      // @ts-expect-error - face-api.js 为可选依赖
      const mod = (await import(/* @vite-ignore */ 'face-api.js')) as FaceApiModule;

      // 加载模型
      const detectionUrl = '/models/face-detection';
      const recognitionUrl = '/models/face-recognition';
      await mod.nets.tinyFaceDetector.loadFromUri(detectionUrl);
      await mod.nets.faceLandmark68Net.loadFromUri(recognitionUrl);
      await mod.nets.faceRecognitionNet.loadFromUri(recognitionUrl);
      faceApiModule = mod;
      recognitionModelLoaded = true;
      logger.info('[face-cluster] face-api 模型全部加载成功（detection + landmark + recognition）');
      return mod;
    } catch (err) {
      // 失败时重置所有状态，允许下次调用重新加载（模型文件补全后无需重启应用即可重试）
      faceApiModule = null;
      recognitionModelLoaded = false;
      logger.warn('[face-cluster] face-api 或模型加载失败，人脸聚类暂不可用，可重试。请确认 public/models/face-recognition/ 目录下存在 face_landmark_68_model 和 face_recognition_model 文件。错误:', err);
      return null;
    }
  })();

  const result = await faceApiLoadPromise;
  // 加载失败时清除 promise，避免后续调用复用失败结果导致永远无法重试
  if (!result) faceApiLoadPromise = null;
  return result;
}

// ── 图片加载 ──────────────────────────────────────────────

/**
 * 从数据加载图片，返回图片对象 + blob URL
 * URL 由调用方在检测完成后调用 revokeObjectURL 释放（见 extractFaceDescriptors）
 *
 * 支持 HEIC 格式：浏览器无法原生解码 HEIC，需先用 ensureSupportedFormat 转换为 JPEG。
 * photoName 用于判断是否为 HEIC 文件。
 */
async function loadImageFromData(data: ArrayBuffer, photoName: string): Promise<{ img: HTMLImageElement; url: string } | null> {
  try {
    let blob: Blob;
    // HEIC 格式浏览器无法原生解码，需先转换为 JPEG
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
  /** 聚类相似度阈值（余弦相似度，> 该值视为同一人），默认 0.6 */
  similarityThreshold?: number;
  /** TinyFaceDetector 输入尺寸，默认 416 */
  inputSize?: number;
  /** 检测置信度阈值，默认 0.4 */
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
  scoreThreshold = 0.4,
): Promise<FaceRecord[]> {
  const mod = await loadFaceApiForClustering();
  if (!mod) return [];

  const data = await readData(photo);
  if (!data) return [];

  const loaded = await loadImageFromData(data, photo.name);
  if (!loaded) return [];
  const { img, url } = loaded;

  const runInference = () =>
    mod
      .detectAllFaces(img, new mod.TinyFaceDetectorOptions({ inputSize, scoreThreshold }))
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

    // 归一化人脸位置到 0-1
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    return detections.map((d) => ({
      descriptor: d.descriptor,
      x: d.detection.box.x / imgW,
      y: d.detection.box.y / imgH,
      width: d.detection.box.width / imgW,
      height: d.detection.box.height / imgH,
      score: d.detection.score,
      photoId: photo.id,
    }));
  } catch (err) {
    logger.warn(`[face-cluster] 提取 descriptor 失败 ${photo.name}:`, err);
    return [];
  } finally {
    // 检测完成（成功或失败）后立即释放 blob URL，避免 5 秒定时器在解码过程中提前释放
    URL.revokeObjectURL(url);
  }
}

// ── 余弦相似度 ────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── 层次聚类（Agglomerative Clustering） ──────────────────

/**
 * 对人脸 descriptor 进行层次聚类（single linkage）
 *
 * 算法（数学等价于最大生成树 + 阈值切边）：
 * single linkage 每次合并"簇间相似度最高"的两个簇，等价于按边权从大到小
 * 构建生成树（Prim/Kruskal），聚类结果 = 生成树中保留权值 ≥ 阈值 的边后
 * 得到的连通分量。
 *
 * 因此用 Prim 算法在 O(n²) 内构建最大生成树（MST），再按阈值切边，
 * 替代暴力层次聚类的 O(n³)（n=2000 时原实现约 8×10⁹ 次操作，会卡死主线程）。
 *
 * 复杂度 O(n²)，n < 5000 可接受
 */
function agglomerativeCluster(
  faces: FaceRecord[],
  threshold: number,
): FaceRecord[][] {
  const n = faces.length;
  if (n === 0) return [];

  // 硬限制：人脸数超过 5000 时截断，防止 O(n²) 矩阵导致 OOM
  // 5000 张人脸约需 5000² × 8 bytes ≈ 200MB 的 simMatrix，仍在合理范围
  // 实际场景中，5000 张人脸对应约 5000 张照片（多数无/1人脸），已达极限
  const MAX_FACES = 5000;
  if (n > MAX_FACES) {
    logger.warn(`[face-cluster] 人脸数 ${n} 超过上限 ${MAX_FACES}，截断前 ${MAX_FACES} 个`);
    faces = faces.slice(0, MAX_FACES);
  }

  const limitedN = faces.length;
  // 预计算相似度矩阵（对称），O(n²)
  const simMatrix: number[][] = Array.from({ length: limitedN }, () => new Array(limitedN).fill(0));
  for (let i = 0; i < limitedN; i++) {
    for (let j = i + 1; j < limitedN; j++) {
      const sim = cosineSimilarity(faces[i].descriptor, faces[j].descriptor);
      simMatrix[i][j] = sim;
      simMatrix[j][i] = sim;
    }
  }

  // ── Prim 最大生成树，O(n²) ──
  const inTree = new Array(limitedN).fill(false);
  const bestEdge = new Array(limitedN).fill(-Infinity); // 节点到树的最大相似度
  const parentNode: number[] = new Array(limitedN).fill(-1); // 树中父节点
  bestEdge[0] = 0;

  // 记录 MST 的树边（相似度 < 阈值的边将不参与连通分量）
  const treeEdges: Array<{ a: number; b: number; sim: number }> = [];

  for (let iter = 0; iter < limitedN; iter++) {
    // 选择 bestEdge 最大的未入树节点（贪心）
    let u = -1;
    let best = -Infinity;
    for (let i = 0; i < limitedN; i++) {
      if (!inTree[i] && bestEdge[i] > best) {
        best = bestEdge[i];
        u = i;
      }
    }
    if (u === -1) break;
    inTree[u] = true;
    if (iter > 0 && parentNode[u] >= 0) {
      treeEdges.push({ a: parentNode[u], b: u, sim: best });
    }
    // 松弛：更新未入树节点的最大相似度
    for (let v = 0; v < limitedN; v++) {
      if (!inTree[v] && simMatrix[u][v] > bestEdge[v]) {
        bestEdge[v] = simMatrix[u][v];
        parentNode[v] = u;
      }
    }
  }

  // ── 按阈值切边，连通分量即簇 ──
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

  for (const e of treeEdges) {
    if (e.sim >= threshold) union(e.a, e.b);
  }

  const groups = new Map<number, FaceRecord[]>();
  for (let i = 0; i < limitedN; i++) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(faces[i]);
    groups.set(root, arr);
  }
  return [...groups.values()];
}

// ── 完整聚类流程 ──────────────────────────────────────────

/**
 * 人脸聚类主入口
 *
 * 流程：
 * 1. 加载 face-api + 模型
 * 2. 并发提取所有照片的 face descriptor
 * 3. 层次聚类
 * 4. 构建聚类结果
 */
export async function clusterFaces(
  photos: PhotoFileInfo[],
  options: FaceClusterOptions = {},
): Promise<FaceClusterResult> {
  const { onProgress, signal } = options;
  const threshold = options.similarityThreshold ?? 0.6;
  const inputSize = options.inputSize ?? 416;
  const scoreThreshold = options.scoreThreshold ?? 0.4;
  const readData = options.readData;

  if (photos.length === 0) {
    return { clusters: [], noFacePhotos: [], totalPhotos: 0, photosWithFaces: 0, failedPhotos: 0 };
  }
  if (!readData) {
    logger.warn('[face-cluster] 缺少 readData，无法提取人脸');
    return { clusters: [], noFacePhotos: photos, totalPhotos: photos.length, photosWithFaces: 0, failedPhotos: 0 };
  }

  // 加载模型
  onProgress?.({ phase: 'loading', current: 0, total: 1, message: '加载人脸识别模型...' });
  const mod = await loadFaceApiForClustering();
  if (!mod) {
    return { clusters: [], noFacePhotos: photos, totalPhotos: photos.length, photosWithFaces: 0, failedPhotos: 0 };
  }

  // ── 并发提取 descriptor ──
  onProgress?.({ phase: 'detecting', current: 0, total: photos.length, message: '检测人脸...' });
  const allFaces: FaceRecord[] = [];
  const photosWithFacesSet = new Set<string>();
  let failedCount = 0;
  let doneCount = 0;
  const CONCURRENCY = 4; // descriptor 提取较重，限制并发

  const queue = [...photos.map((p, i) => ({ photo: p, index: i }))];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const item = queue.shift();
      if (!item) break;
      try {
        const faces = await extractFaceDescriptors(item.photo, readData, inputSize, scoreThreshold);
        if (faces.length > 0) {
          allFaces.push(...faces);
          photosWithFacesSet.add(item.photo.id);
        }
      } catch (err) {
        logger.warn(`[face-cluster] 处理失败 ${item.photo.name}:`, err);
        failedCount++;
      }
      doneCount++;
      onProgress?.({
        phase: 'detecting',
        current: doneCount,
        total: photos.length,
        message: `检测人脸 ${doneCount}/${photos.length}`,
      });
    }
  });
  await Promise.all(workers);

  if (signal?.aborted) {
    throw new DOMException('已取消', 'AbortError');
  }

  // ── 层次聚类 ──
  onProgress?.({ phase: 'clustering', current: 0, total: allFaces.length, message: `聚类 ${allFaces.length} 个人脸...` });
  const clusteredGroups = agglomerativeCluster(allFaces, threshold);

  // ── 构建聚类结果 ──
  const photoById = new Map<string, PhotoFileInfo>();
  for (const p of photos) photoById.set(p.id, p);

  const clusters: FaceCluster[] = clusteredGroups
    .map((faces, idx) => {
      // 关联照片（去重）
      const photoIds = [...new Set(faces.map((f) => f.photoId))];
      const clusterPhotos = photoIds
        .map((id) => photoById.get(id))
        .filter((p): p is PhotoFileInfo => p !== undefined);

      // 选代表性人脸：面积最大 × 置信度最高
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
    // 按照片数降序排列
    .sort((a, b) => b.photoCount - a.photoCount);

  // 未识别人脸的照片
  const noFacePhotos = photos.filter((p) => !photosWithFacesSet.has(p.id));

  onProgress?.({
    phase: 'done',
    current: clusters.length,
    total: clusters.length,
    message: `找到 ${clusters.length} 个人脸组，${noFacePhotos.length} 张无人脸`,
  });

  return {
    clusters,
    noFacePhotos,
    totalPhotos: photos.length,
    photosWithFaces: photosWithFacesSet.size,
    failedPhotos: failedCount,
  };
}

/** findFaceClusters 是 clusterFaces 的别名 */
export const findFaceClusters = clusterFaces;
