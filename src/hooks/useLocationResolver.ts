import { useEffect, useRef } from 'react';
import { usePhotoStore } from '../store';
import { isTauri } from '../engine/storage-engine';
import { savePhotoChanges, getCurrentProjectId } from '../db';
import { parseBigDataCloudLocation } from '../utils/locationParser';
import type { Photo } from '../types';

const resolvingIds = new Set<string>();

async function resolveLocation(lat: number, lng: number): Promise<string | null> {
  if (!isTauri()) {
    try {
      const resp = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return parseBigDataCloudLocation(data);
    } catch {
      return null;
    }
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('reverse_geocode', { latitude: lat, longitude: lng });
  } catch {
    return null;
  }
}

/**
 * 监听照片库，自动为已有 GPS 坐标但缺少地点名称的照片补全逆地理编码。
 * 作为导入时逆地理编码失败的兜底修复，确保时间水印能正常显示地点。
 */
export function useLocationResolver() {
  const photos = usePhotoStore((s) => s.photos);
  const seenRef = useRef<Map<string, { lat?: number; lng?: number; location?: string; status?: string }>>(new Map());

  useEffect(() => {
    const projectId = getCurrentProjectId() || undefined;
    const changed: Photo[] = [];

    for (const p of photos) {
      const prev = seenRef.current.get(p.id);
      const next = {
        lat: p.latitude,
        lng: p.longitude,
        location: p.location,
        status: p.locationStatus,
      };
      seenRef.current.set(p.id, next);

      if (p.latitude == null || p.longitude == null) continue;
      if (p.location) continue;
      if (p.locationStatus === 'pending') continue;
      if (resolvingIds.has(p.id)) continue;

      // 该照片从未见过，或坐标/状态发生了变化，需要尝试解析
      const needsResolve =
        !prev ||
        prev.lat !== p.latitude ||
        prev.lng !== p.longitude ||
        prev.status !== p.locationStatus;
      if (needsResolve) {
        changed.push(p);
      }
    }

    for (const p of changed) {
      resolvingIds.add(p.id);
      resolveLocation(p.latitude!, p.longitude!)
        .then((location) => {
          usePhotoStore.getState().updatePhoto(p.id, {
            location: location ?? undefined,
            locationStatus: location ? 'success' : 'failed',
          });
          if (location) {
            const updated = usePhotoStore.getState().photoMap.get(p.id);
            if (updated) {
              savePhotoChanges([updated], projectId).catch(() => {});
            }
          }
        })
        .finally(() => {
          resolvingIds.delete(p.id);
        });
    }
  }, [photos]);
}
