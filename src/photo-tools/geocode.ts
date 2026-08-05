/**
 * 地理编码：地名 → GPS 坐标
 *
 * 使用 Nominatim (OpenStreetMap) 免费服务
 * Tauri 端用 plugin-http 绕过 webview CORS 限制
 */

import { logger } from '../utils/logger';

export interface GeoResult {
  lon: number;
  lat: number;
  displayName: string;
}

// 简易内存缓存，避免重复查询同一地名
const cache = new Map<string, GeoResult | null>();

/** 上次请求时间戳，用于节流 */
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1100; // 1.1s 节流

/** 检测 Tauri 环境 */
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 地名 → 坐标
 * @param placeName 地名（如 "北京天安门"、"上海外滩"）
 * @returns 坐标结果，未找到返回 null
 */
export async function geocode(placeName: string): Promise<GeoResult | null> {
  const key = placeName.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  // 节流：确保两次请求间隔 ≥ 1.1s
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1&accept-language=zh-CN`;

  try {
    // Tauri 端用 plugin-http 绕过 CORS，Web 端用原生 fetch
    let resp: Response;
    if (isTauriEnv()) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      resp = await tauriFetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
    } else {
      resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      const result: GeoResult = {
        lon: parseFloat(data[0].lon),
        lat: parseFloat(data[0].lat),
        displayName: data[0].display_name,
      };
      cache.set(key, result);
      return result;
    }
  } catch (err) {
    logger.warn('[geocode] 查询失败:', err);
  }

  cache.set(key, null);
  return null;
}
