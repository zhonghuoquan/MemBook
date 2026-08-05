/**
 * MemBook — Tauri 环境共享工具
 *
 * 统一 Tauri 环境检测和通用工具函数，避免在多个文件中重复定义。
 */

import { logger } from './logger';

/** 当前是否运行在 Tauri 桌面端 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 判断 URL 是否为本地同源资源，无需设置 crossOrigin */
function isLocalImageUrl(src: string): boolean {
  return (
    src.startsWith('blob:') ||
    src.startsWith('asset:') ||
    src.startsWith('file:') ||
    src.startsWith('data:')
  );
}

export interface LoadImageOptions {
  /**
   * crossOrigin 模式。
   * - 'auto'（默认）：本地协议（blob/asset/file/data）不设置，避免 WebView2/Tauri 中 local scheme 与 CORS 冲突导致加载失败；
   *   远程协议（http/https）设置 'anonymous' 防止 Canvas 污染。
   * - 'anonymous' / 'use-credentials' / ''：显式指定。
   */
  crossOrigin?: 'anonymous' | 'use-credentials' | '' | 'auto';
  /** 加载超时（毫秒），默认 15000。Tauri asset:// URL 在某些情况下不会触发 onerror，必须超时保护 */
  timeout?: number;
}

/** 加载图片为 HTMLImageElement（默认按 URL scheme 自动决定是否设置 crossOrigin） */
export function loadImage(src: string, options: LoadImageOptions = {}): Promise<HTMLImageElement> {
  // P1-4 请求去重：同一 src 并发加载时共享同一个 Promise，避免重复解码与网络请求。
  // 典型场景：网格视图 100+ 页同时进入视口、Canvas 多实例切换时同一照片被多次请求。
  // 去重 key 包含 crossOrigin 模式（同一 URL 不同 CORS 策略视为不同请求）。
  // 超时时间不进入 key：取调用方传入的最大超时，确保去重命中时不会因某次短超时提前失败。
  const mode = options.crossOrigin ?? 'auto';
  const timeoutMs = options.timeout ?? 15000;
  const dedupKey = `${mode}|${src}`;
  const pending = pendingImageLoads.get(dedupKey);
  if (pending) return pending;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    if (mode === 'anonymous') {
      el.crossOrigin = 'anonymous';
    } else if (mode === 'use-credentials') {
      el.crossOrigin = 'use-credentials';
    } else if (mode === 'auto') {
      // 本地 scheme 不设置 crossOrigin：blob/asset/file/data 在 WebView2 中带 CORS 容易触发加载失败
      if (!isLocalImageUrl(src)) {
        el.crossOrigin = 'anonymous';
      }
    }
    // mode === '' 时显式不设置 crossOrigin

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      el.src = '';
      reject(new Error(`图片加载超时: ${src.slice(0, 80)}`));
    }, timeoutMs);

    el.onload = () => {
      cleanup();
      resolve(el);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error(`图片加载失败: ${src.slice(0, 80)}`));
    };
    el.onabort = () => {
      cleanup();
      reject(new Error(`图片加载被中止: ${src.slice(0, 80)}`));
    };
    el.src = src;
  });

  pendingImageLoads.set(dedupKey, p);
  // 无论成功失败都清理去重表，让后续重试可以重新发起
  const clearDedup = () => { pendingImageLoads.delete(dedupKey); };
  p.then(clearDedup, clearDedup);
  return p;
}

/** P1-4：loadImage 并发去重表。key = `${crossOriginMode}|${src}` */
const pendingImageLoads = new Map<string, Promise<HTMLImageElement>>();

/** 通过 Tauri fs 插件读取本地文件并转为 blob URL（绕过跨域限制和 asset 协议失败） */
export async function readFileAsBlobUrl(path: string): Promise<string | null> {
  try {
    if (!isTauri()) return null;
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(path);
    const ext = path.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : ext === 'bmp' ? 'image/bmp'
      : 'image/jpeg';
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch (err) {
    logger.warn(`[tauri] 读取文件失败: ${path}`, err);
    return null;
  }
}

/** 保存文件：Tauri 环境用 fs 插件写入，浏览器用 a.download 下载 */
export interface SaveFileResult {
  /** 最终保存路径（Tauri 模式下） */
  path: string | null;
  /** 是否通过对话框保存（false 表示使用用户指定目录） */
  picked: boolean;
}

export async function saveFile(blob: Blob, filename: string, outputPath?: string): Promise<SaveFileResult> {
  try {
    if (isTauri()) {
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const pickedPath = outputPath
        ? `${outputPath.replace(/[/\\]$/, '')}/${filename}`
        : (await (await import('@tauri-apps/plugin-dialog')).save({ defaultPath: filename }));
      if (!pickedPath) return { path: null, picked: false };
      const buf = await blob.arrayBuffer();
      await writeFile(pickedPath, new Uint8Array(buf));
      return { path: pickedPath, picked: true };
    }
  } catch (err) {
    logger.warn('[tauri] 写入文件失败，降级到浏览器下载:', err);
  }
  // 浏览器降级：通过 <a> 标签下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch { /* already removed */ }
    URL.revokeObjectURL(url);
  }, 1000);
  return { path: null, picked: false };
}

/**
 * 安全调用 Tauri event listener 的 unlisten 函数。
 *
 * 修复 `Cannot read properties of undefined (reading 'handlerId')` 报错：
 *   组件卸载时调用 unlisten，但 Tauri 内部 handler 可能已被清理（应用关闭、
 *   StrictMode 双重挂载等），导致 unregisterListener 访问 undefined.handlerId。
 *   用 try-catch 包裹，静默吞掉此类错误。
 */
export function safeUnlisten(unlisten: (() => void) | undefined | null): void {
  if (!unlisten) return;
  try {
    unlisten();
  } catch {
    // Tauri 内部 handler 已被清理，忽略
  }
}
