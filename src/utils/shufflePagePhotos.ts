import type { AlbumPage, PhotoPlacement, SlotOverride } from '../types';
import { isGooglePhotosPage } from '../types';

/** 基于 seed 的确定性线性同余随机数生成器（全项目共享的唯一实现） */
export function createSeededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

/** Fisher–Yates 洗牌，使用 seed 保证可复现（全项目共享的唯一实现） */
export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const rnd = createSeededRandom(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 对 Google Photos 智能排版页面执行「照片位置重排」：
 * 保持槽位几何（x/y/width/height）不变，仅交换 photoId 的分配顺序。
 *
 * @returns 新的 placements / slotOverrides / mmLayout；不满足条件时返回 null
 */
export function shufflePagePhotos(
  page: AlbumPage,
  seed: number,
): { placements: PhotoPlacement[]; slotOverrides: Record<string, SlotOverride>; mmLayout: NonNullable<AlbumPage['googlePhotosMmLayout']> } | null {
  if (!isGooglePhotosPage(page)) return null;
  const photos = page.googlePhotosMmLayout ?? [];
  if (photos.length <= 1) return null;

  const ids = photos.map((p) => p.photoId);
  const shuffledIds = shuffleWithSeed(ids, seed);
  if (shuffledIds.length !== ids.length || new Set(shuffledIds).size !== ids.length) return null;

  const shuffledPhotos = photos.map((pr, i) => ({ ...pr, photoId: shuffledIds[i] }));

  const MM = 2;
  const placements: PhotoPlacement[] = [];
  const slotOverrides: Record<string, SlotOverride> = {};
  const mmLayout: NonNullable<AlbumPage['googlePhotosMmLayout']> = [];

  shuffledPhotos.forEach((pr, pi) => {
    const slotId = `gp-${pi}`;
    placements.push({ slotId, photoId: pr.photoId });
    slotOverrides[slotId] = {
      x: Math.round(pr.x * MM),
      y: Math.round(pr.y * MM),
      width: Math.round(pr.width * MM),
      height: Math.round(pr.height * MM),
    };
    mmLayout.push({ photoId: pr.photoId, x: pr.x, y: pr.y, width: pr.width, height: pr.height });
  });

  return { placements, slotOverrides, mmLayout };
}
