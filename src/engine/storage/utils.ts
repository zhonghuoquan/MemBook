/* ── 支持的图片扩展名 ── */
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.gif']);

/** 判断文件是否为 HEIC/HEIF 格式 */
export function isHeicFile(name: string): boolean {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  return ext === '.heic' || ext === '.heif';
}

/** 读取图片尺寸 */
export function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 通过文件魔数判断真实格式，避免 .heic 扩展名与实际格式不符。
 * HEIC/HEIF: 偏移 4 为 'ftyp'，且 major brand 为常见 HEIC brand。
 */
export async function isActuallyHeicFile(file: File): Promise<boolean> {
  if (!isHeicFile(file.name)) return false;
  try {
    const slice = file.slice(0, 16);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const text = (start: number, len: number) =>
      Array.from(bytes.slice(start, start + len))
        .map((b) => String.fromCharCode(b))
        .join('');
    // 先排除常见格式（避免扩展名被改错）
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return false; // JPEG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return false; // PNG
    if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return false; // WebP
    if (text(4, 4) !== 'ftyp') return false;
    const brand = text(8, 4);
    const heicBrands = new Set(['heic', 'heix', 'hevc', 'mif1', 'msf1']);
    return heicBrands.has(brand);
  } catch {
    return isHeicFile(file.name);
  }
}

/** 尝试直接用浏览器解码文件并读取尺寸（用于 HEIC 转换失败时的兜底） */
export async function tryLoadNativeImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageDimensions(url);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 根据尺寸判断方向 */
export function getOrientation(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  if (width > height) return 'landscape';
  if (width < height) return 'portrait';
  return 'square';
}
