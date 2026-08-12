/**
 * 人脸聚类（face-cluster）单元测试
 *
 * 覆盖纯逻辑部分（不依赖 face-api 模型 / 图片解码）：
 *  - recluster：基于检测结果的聚类分组、代表性人脸选择、无人脸照片归类
 *  - 空输入 / 边界情况
 *
 * 说明：euclideanDistance / agglomerativeCluster 为内部函数未导出，
 * 通过 recluster 的聚类结果间接验证其行为。
 */
import { describe, it, expect } from 'vitest';
import { recluster } from './face-cluster';
import type { FaceRecord, FaceDetectionResult, PhotoFileInfo } from './types';

/** 构造人脸记录 */
function face(descriptor: number[], photoId: string, opts: Partial<FaceRecord> = {}): FaceRecord {
  return {
    descriptor: new Float32Array(descriptor),
    x: opts.x ?? 0.2,
    y: opts.y ?? 0.3,
    width: opts.width ?? 0.5,
    height: opts.height ?? 0.6,
    score: opts.score ?? 0.95,
    photoId,
  };
}

function photo(id: string, name = `${id}.jpg`): PhotoFileInfo {
  return {
    id,
    name,
    size: 1024,
    ext: '.jpg',
    mimeType: 'image/jpeg',
  };
}

describe('recluster', () => {
  it('无检测结果时返回空聚类', () => {
    const photos = [photo('p1'), photo('p2')];
    const detection: FaceDetectionResult = {
      faces: [],
      photosWithFacesSet: new Set(),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 2,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(0);
    expect(res.noFacePhotos).toHaveLength(2);
    expect(res.totalPhotos).toBe(2);
    expect(res.photosWithFaces).toBe(0);
  });

  it('同一人（相似 descriptor）聚为一组', () => {
    // 两张几乎相同的 face descriptor → 属于同一人
    const f1 = face([0.1, 0.2, 0.3, 0.4, 0.5], 'p1');
    const f2 = face([0.11, 0.21, 0.31, 0.41, 0.51], 'p2');
    const photos = [photo('p1'), photo('p2')];
    const detection: FaceDetectionResult = {
      faces: [f1, f2],
      photosWithFacesSet: new Set(['p1', 'p2']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 2,
    };
    const res = recluster(detection, 0.5, photos);
    // 距离很小，应合并为 1 组
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0].photoCount).toBe(2);
    expect(res.noFacePhotos).toHaveLength(0);
  });

  it('不同人（差异大 descriptor）分为多组', () => {
    // 两个差异很大的 descriptor → 分为 2 组
    const f1 = face([0.9, 0.9, 0.9, 0.9, 0.9], 'p1');
    const f2 = face([0.1, 0.1, 0.1, 0.1, 0.1], 'p2');
    const photos = [photo('p1'), photo('p2')];
    const detection: FaceDetectionResult = {
      faces: [f1, f2],
      photosWithFacesSet: new Set(['p1', 'p2']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 2,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(2);
  });

  it('单张照片只有一个人脸时成单组', () => {
    const f1 = face([0.5, 0.5, 0.5, 0.5], 'p1');
    const photos = [photo('p1')];
    const detection: FaceDetectionResult = {
      faces: [f1],
      photosWithFacesSet: new Set(['p1']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 1,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0].photoCount).toBe(1);
    expect(res.noFacePhotos).toHaveLength(0);
  });

  it('无任何人脸时所有照片归入无人脸列表', () => {
    const photos = [photo('p1'), photo('p2'), photo('p3')];
    const detection: FaceDetectionResult = {
      faces: [],
      photosWithFacesSet: new Set(),
      failedCount: 1,
      modelLoadFailed: false,
      totalPhotos: 3,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(0);
    expect(res.noFacePhotos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(res.failedPhotos).toBe(1);
  });

  it('代表性人脸选择面积最大且置信度最高的', () => {
    // 同一组内，较大人脸应被选为代表
    const small = face([0.5, 0.5, 0.5, 0.5, 0.5], 'p1', { width: 0.2, height: 0.2, score: 0.5 });
    const big = face([0.5, 0.5, 0.5, 0.5, 0.5], 'p2', { width: 0.8, height: 0.8, score: 0.9 });
    const photos = [photo('p1'), photo('p2')];
    const detection: FaceDetectionResult = {
      faces: [small, big],
      photosWithFacesSet: new Set(['p1', 'p2']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 2,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(1);
    // 代表性人脸应是较大的人脸
    expect(res.clusters[0].representativeFace.width).toBe(0.8);
    expect(res.clusters[0].representativeFace.height).toBe(0.8);
  });

  it('同一照片多个人脸时照片在组内去重', () => {
    // p1 有两个人脸，p2 有一个人脸，全部相似
    const f1 = face([0.5, 0.5, 0.5, 0.5], 'p1');
    const f2 = face([0.5, 0.5, 0.5, 0.5], 'p1');
    const f3 = face([0.5, 0.5, 0.5, 0.5], 'p2');
    const photos = [photo('p1'), photo('p2')];
    const detection: FaceDetectionResult = {
      faces: [f1, f2, f3],
      photosWithFacesSet: new Set(['p1', 'p2']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 2,
    };
    const res = recluster(detection, 0.5, photos);
    expect(res.clusters).toHaveLength(1);
    // 照片去重：p1 只出现一次
    expect(res.clusters[0].photos.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(res.clusters[0].photoCount).toBe(2);
  });

  it('没有对应照片的 face 记录被过滤', () => {
    // p1 有 face，但 p2 在 photos 列表中不存在
    const f1 = face([0.5, 0.5, 0.5, 0.5], 'p1');
    const fGhost = face([0.5, 0.5, 0.5, 0.5], 'ghost');
    const photos = [photo('p1')];
    const detection: FaceDetectionResult = {
      faces: [f1, fGhost],
      photosWithFacesSet: new Set(['p1', 'ghost']),
      failedCount: 0,
      modelLoadFailed: false,
      totalPhotos: 1,
    };
    const res = recluster(detection, 0.5, photos);
    // ghost 无对应照片，被过滤后只剩 p1 一组
    expect(res.clusters.some((c) => c.photos.some((p) => p.id === 'ghost'))).toBe(false);
    expect(res.noFacePhotos).toHaveLength(0);
  });
});
