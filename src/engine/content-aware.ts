/**
 * 内容感知模块：照片主体位置 / 人脸 / 主色 / 显著性分析
 * ──────────────────────────────────────────────────────
 * MemBook 智能排版优化的核心模块：让 cover-fit 从"居中裁切"升级为"主体感知裁切"。
 *
 * 设计原则：
 *   1. 渐进增强：所有方法都是 best-effort，无 contentInfo 时回退到居中
 *   2. 本地优先：所有 AI 能力本地推理，不上云（保留数据主权）
 *   3. 可缓存：结果可持久化到 IndexedDB，避免重复计算
 *
 * 当前实现：
 *   - analyzePhotoContent: 同步轻量分析（中心 + 主色），无需 AI 模型
 *   - analyzePhotoWithFaces: 异步人脸检测（动态加载 face-api.js，可选）
 *   - computeSubjectFocus: 从分析结果计算照片焦点（0-1 归一化坐标）
 *   - computeSmartObjectPosition: 替代 CSS object-position: center 的智能偏移
 *
 * 后续可扩展：
 *   - saliency map (OpenCV.js)
 *   - 地平线检测
 *   - 美学评分 (ONNX NIMA)
 */

import type { Photo } from '../types';
import { logger } from '../utils/logger';
import { createConcurrencyLimiter } from '../utils/concurrency';

/** 人脸/能量分析并发上限：face-api 检测是主线程重活，一次批量触发大量照片时
 *  排队执行，避免同时 N 张全分辨率图检测导致内存飙升与主线程卡顿。 */
const FACE_ANALYSIS_CONCURRENCY = 3;
const faceAnalysisLimiter = createConcurrencyLimiter(FACE_ANALYSIS_CONCURRENCY);

/** 照片内容信息：主体位置 / 人脸 / 主色 / 清晰度 */
export interface PhotoContentInfo {
  /** 焦点 X（0-1 归一化，0=左 0.5=中 1=右），默认 0.5 居中 */
  focusX: number;
  /** 焦点 Y（0-1 归一化，0=上 0.5=中 1=下），默认 0.5 居中 */
  focusY: number;
  /** 主色 RGB（0-255） */
  dominantColor: [number, number, number];
  /** 主色饱和度（0-1），用于评估照片鲜艳度 */
  saturation: number;
  /** 是否检测到人脸 */
  hasFaces: boolean;
  /** 人脸数量 */
  faceCount: number;
  /** P1-1 清晰度评分（0-1，Laplacian variance 归一化），>0.7 清晰 / 0.4-0.7 一般 / <0.4 模糊 */
  clarityScore: number;
  /** 分析方法：'sync' = 同步估测（仅主色+清晰度，焦点居中）/ 'face' = face-api.js 人脸检测 / 'energy' = 高频能量主体估算 */
  source: 'sync' | 'face' | 'energy';
}

/** 默认 contentInfo：居中、灰主色、无人脸、中等清晰度 */
export const DEFAULT_CONTENT_INFO: PhotoContentInfo = {
  focusX: 0.5,
  focusY: 0.5,
  dominantColor: [128, 128, 128],
  saturation: 0,
  hasFaces: false,
  faceCount: 0,
  clarityScore: 0.5,
  source: 'sync',
};

/* ══════════════════════════ 主体感知缓存层 ══════════════════════════
   渲染层（CanvasPhotoRenderer / sharedRender）需要在同步渲染时快速拿到
   contentInfo 用于计算主体感知偏移。analyzePhotoContent 是异步的，且
   face-api.js 可能未安装，因此采用「异步分析 + 同步缓存读取」模式：
   - ensurePhotoAnalyzed(photo)：非阻塞触发分析，结果写入 photoContentCache
   - getCachedContentInfo(photoId)：同步查询缓存，未命中返回 undefined（回退到居中）
   - 缓存按 photoId 索引，照片删除时由上层调用 invalidatePhotoContentCache 清理
   *
   * P1-fix: 缓存区分"有效结果"与"分析失败"
   *   - 有效结果（source='face' 或 'energy'）→ 写入 photoContentCache，不再重试
   *   - 分析失败（source='sync' 从 analyzePhotoWithFaces 返回，即图像加载失败等）
   *     → 记录到 failedAnalysisCache，允许按退避策略重试
   *   之前：失败结果也被永久缓存（hasFaces=false, focusY=0.5），
   *         导致竖图全身人像因小脸漏检后永远居中、无法重试
   * ══════════════════════════ */
const photoContentCache = new Map<string, PhotoContentInfo>();
/** 正在分析中的 photoId → Promise 映射，让多个调用者共享同一分析结果
 *  P1-fix: 之前用 Set<string>，第二个调用者直接返回 undefined，无法 await 已有的分析 */
const pendingAnalysis = new Map<string, Promise<PhotoContentInfo | undefined>>();

/** 失败分析追踪：photoId → { 失败次数, 上次尝试时间戳 } */
interface FailedAnalysisEntry { count: number; lastAttempt: number; }
const failedAnalysisCache = new Map<string, FailedAnalysisEntry>();
const MAX_RETRY_COUNT = 3;
const RETRY_BACKOFF_MS = 30_000; // 30s 退避，避免连续失败时频繁重试

/** 同步查询照片的内容信息缓存（未命中返回 undefined，调用方回退到居中） */
export function getCachedContentInfo(photoId: string): PhotoContentInfo | undefined {
  return photoContentCache.get(photoId);
}

/** 判断缓存中是否存在有效的主体焦点（focusX/Y 偏离中心，含人脸或能量分析） */
export function hasSmartFocus(photoId: string): boolean {
  const info = photoContentCache.get(photoId);
  if (!info) return false;
  return Math.abs(info.focusX - 0.5) > 0.02 || Math.abs(info.focusY - 0.5) > 0.02;
}

/**
 * 非阻塞触发照片内容分析，结果写入 photoContentCache。
 * - 已缓存有效结果时直接返回
 * - 分析失败时按退避策略重试（30s 间隔，最多 3 次）
 * - 返回 Promise，调用方可选 await（用于分析后触发重渲染）
 *
 * P0-fix: 之前返回 void（fire-and-forget），导致：
 *   1. 首次渲染时缓存未命中 → 居中
 *   2. 异步分析完成写入缓存 → React 不知道 → 永远居中
 *   现在返回 Promise，调用方 await 后 setState 触发重渲染
 *
 * P1-fix: 之前失败结果也被永久缓存，导致小脸漏检后永远居中。
 *   现在区分有效结果（face/energy）与失败结果（sync fallback），
 *   失败结果不写入 photoContentCache，允许后续重试。
 *
 * P1-fix-2: pendingAnalysis 从 Set 改为 Map<Promise>，让多个调用者
 *   能 await 同一个分析 Promise（拖拽动效需要等待分析完成后再启动）
 */
export function ensurePhotoAnalyzed(photo: Photo): Promise<PhotoContentInfo | undefined> {
  // 1. 有效缓存命中
  const cached = photoContentCache.get(photo.id);
  if (cached) return Promise.resolve(cached);

  // 2. 已有 pending 分析 → 共享同一 Promise（而非返回 undefined）
  const pending = pendingAnalysis.get(photo.id);
  if (pending) return pending;

  // 3. 失败退避检查：超过重试上限或在退避期内 → 跳过
  const failed = failedAnalysisCache.get(photo.id);
  if (failed) {
    if (failed.count >= MAX_RETRY_COUNT) return Promise.resolve(undefined);
    if (Date.now() - failed.lastAttempt < RETRY_BACKOFF_MS) return Promise.resolve(undefined);
  }

  if (photo.width <= 0 || photo.height <= 0) return Promise.resolve(undefined);

  // 4. 启动新分析，存入 pendingAnalysis 供其他调用者共享
  const promise = (async (): Promise<PhotoContentInfo | undefined> => {
    try {
      // 经并发限制器排队执行：批量触发大量照片时最多 FACE_ANALYSIS_CONCURRENCY 张同时分析
      const info = await faceAnalysisLimiter(() => analyzePhotoWithFaces(photo));
      // 有效结果：face-api 检测（含无人脸）或能量分析 → 缓存
      if (info.source === 'face' || info.source === 'energy') {
        photoContentCache.set(photo.id, info);
        failedAnalysisCache.delete(photo.id);
        return info;
      }
      // 失败结果（source='sync'，图像加载失败等）→ 记录失败，允许重试
      const prev = failedAnalysisCache.get(photo.id);
      failedAnalysisCache.set(photo.id, {
        count: (prev?.count ?? 0) + 1,
        lastAttempt: Date.now(),
      });
      return undefined;
    } catch {
      // 异常时记录失败，不缓存默认值（避免反复触发但允许重试）
      const prev = failedAnalysisCache.get(photo.id);
      failedAnalysisCache.set(photo.id, {
        count: (prev?.count ?? 0) + 1,
        lastAttempt: Date.now(),
      });
      return undefined;
    } finally {
      pendingAnalysis.delete(photo.id);
    }
  })();

  pendingAnalysis.set(photo.id, promise);
  return promise;
}

/** 照片删除时清理缓存（避免内存泄漏） */
export function invalidatePhotoContentCache(photoId: string): void {
  photoContentCache.delete(photoId);
  pendingAnalysis.delete(photoId);
  failedAnalysisCache.delete(photoId);
}

/** 批量清理（项目切换/相册重置时） */
export function clearPhotoContentCache(): void {
  photoContentCache.clear();
  pendingAnalysis.clear();
  failedAnalysisCache.clear();
}

/** face-api.js 最小类型定义（避免硬依赖，模块未安装时回退到同步分析） */
interface FaceApiBox { x: number; y: number; width: number; height: number; }
interface FaceApiDetection { box: FaceApiBox; }
interface FaceApiNet {
  tinyFaceDetector: { loadFromUri(uri: string): Promise<void> };
}
interface FaceApiModule {
  nets: FaceApiNet;
  detectAllFaces(
    img: HTMLImageElement | HTMLCanvasElement,
    options?: unknown,
  ): Promise<FaceApiDetection[]>;
  TinyFaceDetectorOptions: new (opts?: { inputSize?: number; scoreThreshold?: number }) => unknown;
}

/** 异步加载的 face-api.js 单例（按需加载，未安装时回退到同步分析） */
let faceApiModule: FaceApiModule | null = null;
let faceApiLoadPromise: Promise<FaceApiModule | null> | null = null;
let faceModelLoaded = false;

/**
 * 尝试加载 face-api.js（按需加载，失败时回退到同步分析）
 * 用户未安装 face-api.js 时本函数返回 null，上层回退到 analyzePhotoContent
 */
async function tryLoadFaceApi(): Promise<FaceApiModule | null> {
  if (faceApiModule) return faceApiModule;
  if (faceApiLoadPromise) return faceApiLoadPromise;

  faceApiLoadPromise = (async () => {
    try {
      // 使用 @vladmandic/face-api（face-api.js 维护版 fork，内置新版 tfjs）
      const mod = (await import('@vladmandic/face-api')) as unknown as FaceApiModule;
      faceApiModule = mod;
      // 加载模型（从 public/models 目录，可在线下载或本地存放）
      const modelUrl = '/models/face-detection';
      try {
        await mod.nets.tinyFaceDetector.loadFromUri(modelUrl);
        faceModelLoaded = true;
        logger.info('[content-aware] face-api 模型加载成功，人脸检测可用');
      } catch (err) {
        // 模型加载失败，回退到同步分析
        faceModelLoaded = false;
        logger.warn('[content-aware] face-api 模型加载失败，回退到同步分析（所有照片将居中）。请确认 public/models/face-detection/ 目录下存在 tiny_face_detector_model-shard1 和 tiny_face_detector_model-weights_manifest.json。错误:', err);
      }
      return mod;
    } catch (err) {
      // @vladmandic/face-api 未安装，回退到同步分析
      logger.warn('[content-aware] @vladmandic/face-api 未安装，回退到同步分析。错误:', err);
      return null;
    }
  })();

  return faceApiLoadPromise;
}

/**
 * 同步轻量分析：无需 AI 模型，从照片本身提取主色 + 清晰度 + 估测主体位置
 * ──────────────────────────────────────────────────
 * 策略：
 *   1. 主色：从中心区域采样像素取平均（降采样到 32×32 提速）
 *   2. 焦点：默认 0.5/0.5（居中），face-api 加载后会被覆盖
 *   3. 饱和度：主色的 HSV saturation 分量
 *   4. P1-1 清晰度：复用已加载图像做 64×64 Laplacian 方差（无需二次加载）
 *
 * 性能：单张 ~8-28ms，可在导入或进入智能编排时批量预处理
 */
export async function analyzePhotoContent(photo: Photo): Promise<PhotoContentInfo> {
  const img = await loadImageSafely(photo);
  return analyzePhotoContentFromImage(img);
}

/**
 * 从已加载的图像做同步轻量分析（主色 + 清晰度 + 默认焦点）。
 * 抽取自 analyzePhotoContent，供 analyzePhotoWithFaces 复用同一张已加载图，
 * 避免对同一照片二次全分辨率解码。
 */
function analyzePhotoContentFromImage(img: HTMLImageElement | null): PhotoContentInfo {
  if (!img) return { ...DEFAULT_CONTENT_INFO };
  try {
    // 降采样到 32×32 提取主色
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ...DEFAULT_CONTENT_INFO };
    canvas.width = 32;
    canvas.height = 32;
    ctx.drawImage(img, 0, 0, 32, 32);

    // 取中心 8×8 区域平均作为主色
    const data = ctx.getImageData(12, 12, 8, 8).data;
    let r = 0, g = 0, b = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / pixelCount);
    g = Math.round(g / pixelCount);
    b = Math.round(b / pixelCount);

    // 饱和度：HSV 的 S 分量
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max > 0 ? (max - min) / max : 0;

    // 清晰度：复用已加载的 img，避免二次加载
    const clarityScore = computeClarityFromImage(img);

    return {
      focusX: 0.5,
      focusY: 0.5,
      dominantColor: [r, g, b],
      saturation,
      hasFaces: false,
      faceCount: 0,
      clarityScore,
      source: 'sync',
    };
  } catch {
    return { ...DEFAULT_CONTENT_INFO };
  }
}

/**
 * 异步人脸检测：动态加载 face-api.js，从照片中检测人脸位置
 * ──────────────────────────────────────────────────
 * 当 face-api.js 未安装或模型加载失败时，回退到能量分析（computeSubjectFocusByEnergy）
 * 成功检测时，焦点取人脸中心（略微上移，避免裁掉头顶）
 *
 * P1-fix: 三项增强解决"竖图全身人像放入横图槽位时人脸被裁"问题：
 *   1. inputSize 224→416：TinyFaceDetector 输入分辨率翻倍，小脸（全身图中占比小）
 *      在 416px 输入下仍有 ~50px，高于检测下限 ~32px，大幅降低漏检率
 *   2. 大图分区域检测：全身竖图（高>宽且>800px）先全图检测，未命中则对上半 40%
 *      单独检测（人脸在全身图中通常位于上 1/3），相当于放大 2.5× 进一步提升小脸检出
 *   3. 无人脸时回退高频能量分析：覆盖 face-api 漏检（侧脸/遮挡/小脸）及无人脸主体
 *      （风景/建筑/宠物），用 Sobel 梯度+8×8 网格质心估算主体位置
 */
export async function analyzePhotoWithFaces(photo: Photo): Promise<PhotoContentInfo> {
  // P2：只加载一次图像，主色/清晰度分析与后续人脸/能量检测复用同一张图，
  // 避免对同一照片多次全分辨率解码（此前 analyzePhotoContent + detectAllFaces 各解码一次）。
  const img = await loadImageSafely(photo);
  const syncResult = analyzePhotoContentFromImage(img);
  const faceApi = await tryLoadFaceApi();
  if (!faceApi || !faceModelLoaded) {
    // face-api 不可用 → 能量分析回退（不返回 syncResult，避免被 ensurePhotoAnalyzed 当作失败）
    if (img) {
      const energyFocus = computeSubjectFocusByEnergy(img);
      if (energyFocus) {
        logger.debug(`[content-aware] face-api 不可用，能量分析回退: ${photo.name}, 焦点=(${energyFocus.focusX.toFixed(2)}, ${energyFocus.focusY.toFixed(2)})`);
        return {
          ...syncResult,
          focusX: energyFocus.focusX,
          focusY: energyFocus.focusY,
          hasFaces: false,
          faceCount: 0,
          source: 'energy',
        };
      }
    }
    return syncResult;
  }
  if (!img) return syncResult;

  try {
    const imgW = img.width || img.naturalWidth;
    const imgH = img.height || img.naturalHeight;

    // P1-fix-1: inputSize 416（原 224）+ scoreThreshold 0.4（原 0.5）
    //   416px 输入下全身竖图的小脸仍保有足够像素，降低漏检率
    let detections = await faceApi.detectAllFaces(
      img,
      new faceApi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }),
    );

    // P1-fix-2: 大图分区域检测——全身竖图（高>宽且>800px）全图未命中时，
    //   对上半 40% 单独检测（人脸在全身图中通常位于上 1/3）
    if (detections.length === 0 && imgH > 800 && imgH > imgW) {
      const upperCanvas = document.createElement('canvas');
      const upperCtx = upperCanvas.getContext('2d');
      if (upperCtx) {
        const upperH = Math.floor(imgH * 0.4);
        upperCanvas.width = imgW;
        upperCanvas.height = upperH;
        // 绘制原图上半部分到独立 canvas，face-api 以此为输入相当于放大 2.5× 检测上半区域
        upperCtx.drawImage(img, 0, 0, imgW, upperH, 0, 0, imgW, upperH);
        try {
          const upperDetections = await faceApi.detectAllFaces(
            upperCanvas,
            new faceApi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }),
          );
          if (upperDetections.length > 0) {
            // 上半 canvas 的坐标原点=原图(0,0)，box.y 已是原图坐标系，可直接使用
            detections = upperDetections;
            logger.debug(`[content-aware] 上半区域检测命中 ${upperDetections.length} 张脸: ${photo.name}`);
          }
        } catch {
          // 上半检测失败，继续走能量回退
        }
      }
    }

    if (detections.length === 0) {
      // P1-fix-3: 无人脸 → 能量分析回退（覆盖漏检的侧脸/小脸及无人脸主体）
      const energyFocus = computeSubjectFocusByEnergy(img);
      if (energyFocus) {
        logger.debug(`[content-aware] 未检测到人脸，能量分析回退: ${photo.name}, 焦点=(${energyFocus.focusX.toFixed(2)}, ${energyFocus.focusY.toFixed(2)})`);
        return {
          ...syncResult,
          focusX: energyFocus.focusX,
          focusY: energyFocus.focusY,
          hasFaces: false,
          faceCount: 0,
          source: 'energy',
        };
      }
      logger.debug(`[content-aware] 未检测到人脸且能量分析无显著主体: ${photo.name}`);
      return { ...syncResult, hasFaces: false, faceCount: 0, source: 'face' };
    }

    // 取最大人脸作为主焦点
    const mainFace = detections.reduce((largest: FaceApiDetection, d: FaceApiDetection) => {
      const area = d.box.width * d.box.height;
      const largestArea = largest.box.width * largest.box.height;
      return area > largestArea ? d : largest;
    });

    // 焦点 = 人脸中心，略微上移 10%（避免裁掉头顶）
    // face-api 返回的 box 是绝对像素坐标，需要归一化
    let focusX = (mainFace.box.x + mainFace.box.width / 2) / imgW;
    let focusY = (mainFace.box.y + mainFace.box.height / 2) / imgH - 0.1;
    focusX = Math.max(0, Math.min(1, focusX));
    focusY = Math.max(0, Math.min(1, focusY));

    logger.debug(`[content-aware] 检测到 ${detections.length} 张人脸: ${photo.name}, 焦点=(${focusX.toFixed(2)}, ${focusY.toFixed(2)})`);

    return {
      ...syncResult,
      focusX,
      focusY,
      hasFaces: true,
      faceCount: detections.length,
      source: 'face',
    };
  } catch (err) {
    logger.warn(`[content-aware] 人脸检测异常: ${photo.name}`, err);
    // 异常 → 能量分析回退（复用已加载的 img，不再二次解码）
    if (img) {
      const energyFocus = computeSubjectFocusByEnergy(img);
      if (energyFocus) {
        return {
          ...syncResult,
          focusX: energyFocus.focusX,
          focusY: energyFocus.focusY,
          hasFaces: false,
          faceCount: 0,
          source: 'energy',
        };
      }
    }
    return syncResult;
  }
}

/**
 * 从 contentInfo 计算 object-position 偏移（替代 CSS object-position: center）
 * ──────────────────────────────────────────────────
 * 输入：照片尺寸 + 槽位尺寸 + contentInfo
 * 输出：照片在槽位内的偏移量（px），用于 cover-fit 时让焦点对齐槽位中心
 *
 * 数学推导：
 *   cover-fit 缩放 scale = max(slotW/photoW, slotH/photoH)
 *   放大后的照片尺寸 = photoW*scale × photoH*scale
 *   照片中心点在槽位坐标系下的位置 = (offsetX + imgW/2, offsetY + imgH/2)
 *   要让焦点对齐槽位中心：
 *     offsetX + focusX * imgW = slotW/2
 *     offsetY + focusY * imgH = slotH/2
 *   即：offsetX = slotW/2 - focusX * imgW
 *       offsetY = slotH/2 - focusY * imgH
 *   最后 clamp 到不露白范围：
 *     minX = slotW - imgW, maxX = 0
 *     minY = slotH - imgH, maxY = 0
 */
export function computeSmartObjectPosition(
  photoW: number,
  photoH: number,
  slotW: number,
  slotH: number,
  contentInfo: PhotoContentInfo | undefined,
): { offsetX: number; offsetY: number } {
  // 无 contentInfo 时居中
  if (!contentInfo) {
    const scale = Math.max(slotW / photoW, slotH / photoH);
    const imgW = photoW * scale;
    const imgH = photoH * scale;
    return {
      offsetX: (slotW - imgW) / 2,
      offsetY: (slotH - imgH) / 2,
    };
  }

  const scale = Math.max(slotW / photoW, slotH / photoH);
  const imgW = photoW * scale;
  const imgH = photoH * scale;

  let offsetX = slotW / 2 - contentInfo.focusX * imgW;
  let offsetY = slotH / 2 - contentInfo.focusY * imgH;

  // clamp 到不露白范围
  const minX = slotW - imgW;
  const maxX = 0;
  const minY = slotH - imgH;
  const maxY = 0;
  offsetX = Math.max(minX, Math.min(maxX, offsetX));
  offsetY = Math.max(minY, Math.min(maxY, offsetY));

  return { offsetX, offsetY };
}

/**
 * 检查两页主色是否冲突（饱和度高且色相接近）
 * ──────────────────────────────────────────────────
 * 用于跨页色彩协调：连续两页都是大红色时，可以让其中一页换 pattern 减少色彩面积
 */
export function isColorConflict(
  a: PhotoContentInfo | undefined,
  b: PhotoContentInfo | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.saturation < 0.4 || b.saturation < 0.4) return false;

  const [h1] = rgbToHsl(...a.dominantColor);
  const [h2] = rgbToHsl(...b.dominantColor);
  const hueDiff = Math.abs(h1 - h2);
  // 色相差 < 25° 且饱和度都 > 0.4 视为冲突
  return hueDiff < 25 || hueDiff > 335;
}

/**
 * P1-1 清晰度评估：基于 Laplacian 方差估算照片锐度
 * ──────────────────────────────────────────────────
 * 原理：清晰图像的高频边缘多，Laplacian 算子响应方差大；失焦/模糊图像边缘弱，方差小。
 * 性能：降采样到 64×64 灰度图后做 3×3 Laplacian 卷积，单张 ~3-8ms，可在导入时批量预处理。
 * 输出：归一化到 0-1（经验阈值：>0.5 清晰 / 0.2-0.5 一般 / <0.2 模糊）
 *
 * 算法参考：Pech-Pacheco et al., "Diatom autofocusing in brightfield microscopy"
 *
 * P1-1 集成：已抽取 computeClarityFromImage 复用已加载图像，
 * analyzePhotoContent 直接调用它（避免二次加载图像），本函数保留为独立入口供导入管线使用。
 */
export async function computeClarityScore(photo: Photo): Promise<number> {
  try {
    const img = await loadImageSafely(photo);
    if (!img) return 0.5; // 加载失败给中等分，不偏激
    return computeClarityFromImage(img);
  } catch {
    return 0.5; // 异常时给中等分，不偏激
  }
}

/**
 * 从已加载的 HTMLImageElement 计算清晰度（Laplacian 方差归一化）。
 * 抽取自 computeClarityScore，供 analyzePhotoContent 复用已加载图像，避免二次解码。
 */
function computeClarityFromImage(img: HTMLImageElement): number {
  try {
    // 降采样到 64×64 提速
    const size = 64;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0.5;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);
    const gray = new Float32Array(size * size);
    for (let i = 0; i < gray.length; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      // Rec. 709 灰度
      gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    // 3×3 Laplacian 卷积：[[0,1,0],[1,-4,1],[0,1,0]]
    const laplacian = new Float32Array(size * size);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        laplacian[idx] =
          gray[idx - size] +      // 上
          gray[idx + size] +      // 下
          gray[idx - 1] +         // 左
          gray[idx + 1] -         // 右
          4 * gray[idx];          // 中心
      }
    }

    // 计算方差
    let mean = 0;
    const count = (size - 2) * (size - 2);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        mean += laplacian[y * size + x];
      }
    }
    mean /= count;

    let variance = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const v = laplacian[y * size + x] - mean;
        variance += v * v;
      }
    }
    variance /= count;

    // 归一化：经验值 Laplacian variance 范围 0-2000，sqrt 压缩后映射到 0-1
    // 使用 sqrt 让中段更敏感（人眼对中等清晰度差异更敏感）
    const normalized = Math.min(1, Math.sqrt(variance) / 30);
    return normalized;
  } catch {
    return 0.5;
  }
}

/**
 * P1-fix: 高频能量主体估算（Sobel 梯度 + 8×8 网格加权质心）
 * ──────────────────────────────────────────────────
 * 当 face-api.js 未检测到人脸（如全身竖图中小脸漏检、无人脸的风景/建筑照片）时，
 * 用图像高频能量分布估算主体位置：主体通常边缘密集（能量高），背景平坦（能量低）。
 *
 * 算法：
 *   1. 降采样到 64×64 灰度图
 *   2. Sobel 算子计算每个像素的梯度幅值（边缘强度）
 *   3. 划分 8×8 网格（每格 8×8 像素），累加每格能量
 *   4. 取能量高于 (均值+标准差) 的格子，按能量加权计算质心
 *   5. 质心坐标归一化到 0-1，clamp 到 [0.1, 0.9] 避免极端值
 *
 * 性能：单张 ~5-12ms，可在 face-api 漏检时即时回退，无额外加载开销
 *
 * 返回 null 的情况：canvas 不可用、全图能量均匀（无显著主体）
 */
function computeSubjectFocusByEnergy(img: HTMLImageElement): { focusX: number; focusY: number } | null {
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);
    const gray = new Float32Array(size * size);
    for (let i = 0; i < gray.length; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      // Rec. 709 灰度
      gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    // Sobel 梯度幅值
    const energy = new Float32Array(size * size);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        // Sobel X: [[-1,0,1],[-2,0,2],[-1,0,1]]
        const gx =
          -gray[idx - size - 1] + gray[idx - size + 1]
          - 2 * gray[idx - 1] + 2 * gray[idx + 1]
          - gray[idx + size - 1] + gray[idx + size + 1];
        // Sobel Y: [[-1,-2,-1],[0,0,0],[1,2,1]]
        const gy =
          -gray[idx - size - 1] - 2 * gray[idx - size] - gray[idx - size + 1]
          + gray[idx + size - 1] + 2 * gray[idx + size] + gray[idx + size + 1];
        energy[idx] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // 8×8 网格：每格累加能量
    const gridSize = 8;
    const cellSize = size / gridSize; // 8 像素/格
    const cellEnergy = new Float32Array(gridSize * gridSize);
    for (let cy = 0; cy < gridSize; cy++) {
      for (let cx = 0; cx < gridSize; cx++) {
        let sum = 0;
        for (let y = 0; y < cellSize; y++) {
          for (let x = 0; x < cellSize; x++) {
            sum += energy[(cy * cellSize + y) * size + (cx * cellSize + x)];
          }
        }
        cellEnergy[cy * gridSize + cx] = sum;
      }
    }

    // 统计均值+标准差，取高能量格子的加权质心
    let mean = 0;
    for (let i = 0; i < cellEnergy.length; i++) mean += cellEnergy[i];
    mean /= cellEnergy.length;
    let variance = 0;
    for (let i = 0; i < cellEnergy.length; i++) {
      variance += (cellEnergy[i] - mean) ** 2;
    }
    const std = Math.sqrt(variance / cellEnergy.length);
    const threshold = mean + std;

    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    for (let cy = 0; cy < gridSize; cy++) {
      for (let cx = 0; cx < gridSize; cx++) {
        const e = cellEnergy[cy * gridSize + cx];
        if (e > threshold) {
          // 格子中心的归一化坐标
          const cellCenterX = (cx + 0.5) / gridSize;
          const cellCenterY = (cy + 0.5) / gridSize;
          weightedX += cellCenterX * e;
          weightedY += cellCenterY * e;
          totalWeight += e;
        }
      }
    }

    if (totalWeight === 0) return null; // 全图能量均匀，无显著主体

    let focusX = weightedX / totalWeight;
    let focusY = weightedY / totalWeight;

    // clamp 到 [0.1, 0.9]，避免主体贴边时焦点极端化
    focusX = Math.max(0.1, Math.min(0.9, focusX));
    focusY = Math.max(0.1, Math.min(0.9, focusY));

    return { focusX, focusY };
  } catch {
    return null;
  }
}

/* ── 内部工具 ── */

async function loadImageSafely(photo: Photo): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // photo.src 可能是 blob: URL 或 asset:// URL
    if (photo.src) {
      img.src = photo.src;
    } else {
      resolve(null);
    }
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  const s = max === min ? 0 : l > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
  if (max !== min) {
    switch (max) {
      case r: h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / (max - min) + 2) * 60; break;
      case b: h = ((r - g) / (max - min) + 4) * 60; break;
    }
  }
  return [h, s, l];
}
