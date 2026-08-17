import type { Photo } from '../types';
import coverLandscape from '../assets/cover-landscape.jpg';

/**
 * 封面模板预设照片：批量生成默认封面风景照片（复用封面模板预览同一张 cover-landscape.jpg）。
 * 供 applyCoverTemplate / applyBackCoverTemplate 在相册照片不足以填满模板照片位时自动补齐，
 * 保证只要模板有照片位，每个槽位都有图可显示（用户可后续自行更换/删除）。
 *
 * @param count 需要生成的数量
 * @returns 生成的 Photo 数组；图片加载失败时返回空数组
 */
export async function createDefaultCoverPhotos(count: number): Promise<Photo[]> {
  if (count <= 0) return [];
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('cover landscape load failed'));
      img.src = coverLandscape;
    });
    const w = img.naturalWidth || 1200;
    const h = img.naturalHeight || 800;
    const date = new Date().toISOString().split('T')[0];
    return Array.from({ length: count }, () => ({
      id: `default-cover-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      src: coverLandscape,
      name: '封面预设.jpg',
      date,
      width: w,
      height: h,
      orientation: w >= h ? 'landscape' : 'portrait',
      storageMode: 'import',
      // 标记为封面预设照片：仅封面槽位显示，照片列表（PhotoPanel）过滤不展示，用户无感知
      isCoverPreset: true,
    }));
  } catch {
    return [];
  }
}