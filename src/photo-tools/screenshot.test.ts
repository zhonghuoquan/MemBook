/**
 * 截图识别引擎单元测试
 *
 * 由于 createImageBitmap / EXIF 解析依赖真实图片数据（jsdom 无法解码），
 * 这里主要覆盖：
 *  - 纯文件名信号（无需读取数据）即可判定为截图
 *  - 无信号时归为正常照片
 *  - 读取失败时标记 failedPhotos 且不误删
 *  - 读取函数 / 中止信号 / 进度回调的调用行为
 */
import { describe, it, expect, vi } from 'vitest';
import { detectScreenshots, classify, isScreenRatio, isScreenResolution } from './screenshot';
import type { PhotoFileInfo, ScreenshotSignal } from './types';

function makePhoto(name: string, ext = '.png'): PhotoFileInfo {
  return {
    id: `id-${name}`,
    name,
    size: 1024,
    ext,
    mimeType: `image/${ext.slice(1)}`,
  };
}

describe('detectScreenshots', () => {
  it('根据文件名关键词识别截图（无需读取数据）', async () => {
    const photos = [
      makePhoto('Screenshot_20230115-143000.png'),
      makePhoto('IMG_20230115_143000.jpg', '.jpg'),
      makePhoto('微信图片_20230203123836.png'),
    ];
    const readData = vi.fn().mockResolvedValue(null);

    const res = await detectScreenshots(photos, { readData });

    expect(res.totalPhotos).toBe(3);
    // 文件名含截图关键词的归为截图
    expect(res.screenshots.map((s) => s.photo.name)).toEqual([
      'Screenshot_20230115-143000.png',
      '微信图片_20230203123836.png',
    ]);
    // 正常相机命名归为正常照片
    expect(res.normalPhotos.map((p) => p.name)).toEqual(['IMG_20230115_143000.jpg']);
    expect(res.suspects).toHaveLength(0);
  });

  it('无任何信号时归为正常照片', async () => {
    const photos = [makePhoto('DSC_0001.jpg', '.jpg'), makePhoto('IMG_2022.jpg', '.jpg')];
    const readData = vi.fn().mockResolvedValue(null);

    const res = await detectScreenshots(photos, { readData });

    expect(res.screenshots).toHaveLength(0);
    expect(res.normalPhotos).toHaveLength(2);
  });

  it('读取失败时标记 failedPhotos 且不误判为截图', async () => {
    const photos = [
      makePhoto('IMG_0001.jpg', '.jpg'),
      makePhoto('Screenshot_x.png'), // 文件名命中但读取失败
    ];
    const readData = vi.fn().mockResolvedValue(null); // 模拟读取失败

    const res = await detectScreenshots(photos, { readData });

    // 文件名命中仍判为截图
    expect(res.screenshots).toHaveLength(1);
    // 读取失败的照片计入 failedPhotos
    expect(res.failedPhotos).toBeGreaterThan(0);
  });

  it('支持进度回调与中止信号', async () => {
    const photos = [makePhoto('a.png'), makePhoto('b.png'), makePhoto('c.png')];
    const readData = vi.fn().mockResolvedValue(null);
    const onProgress = vi.fn();
    const controller = new AbortController();

    await detectScreenshots(photos, { readData, onProgress, signal: controller.signal });

    expect(onProgress).toHaveBeenCalled();
    // 最后进度应到达 total
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(last.total).toBe(3);
    expect(last.current).toBe(3);
  });

  it('空照片列表返回空结果', async () => {
    const readData = vi.fn();
    const res = await detectScreenshots([], { readData });
    expect(res.totalPhotos).toBe(0);
    expect(res.screenshots).toHaveLength(0);
    expect(res.normalPhotos).toHaveLength(0);
  });
});

describe('classify —— 截图置信度判定（准确率防护）', () => {
  const classifyC = (signals: ScreenshotSignal[]) =>
    classify(signals)!.confidence;

  it('无信号返回 null（归为正常照片）', () => {
    expect(classify([])).toBeNull();
  });

  it('文件名命中 → 高置信度截图', () => {
    expect(classifyC(['filename'])).toBe('high');
    expect(classifyC(['filename', 'noCamera', 'screenRes'])).toBe('high');
  });

  it('软件特征 + 精确屏幕分辨率 → 高置信度', () => {
    expect(classifyC(['software', 'screenRes'])).toBe('high');
  });

  it('软件特征 + 屏幕比例 → 高置信度', () => {
    expect(classifyC(['software', 'screenRatio'])).toBe('high');
  });

  it('无相机信息 + 精确屏幕分辨率 + PNG 无 EXIF → 高置信度', () => {
    expect(classifyC(['noCamera', 'screenRes', 'pngNoExif'])).toBe('high');
  });

  it('无相机信息 + 精确屏幕分辨率 + 软件特征 → 高置信度', () => {
    expect(classifyC(['noCamera', 'screenRes', 'software'])).toBe('high');
  });

  // —— 以下为本次修复的核心：真实照片（无相机信息但分辨率恰为常见屏幕尺寸）不应误判 ——
  it('仅「无相机信息 + 精确屏幕分辨率」→ 降级为疑似，不判为高置信度', () => {
    // 典型误判场景：真实照片经 App 重存/下载/扫描后丢失相机信息，分辨率恰为 1080×1920
    expect(classifyC(['noCamera', 'screenRes'])).toBe('suspect');
  });

  it('仅「无相机信息 + 屏幕比例」→ 疑似', () => {
    expect(classifyC(['noCamera', 'screenRatio'])).toBe('suspect');
  });

  it('仅「精确屏幕分辨率」→ 疑似（不单独判为截图）', () => {
    expect(classifyC(['screenRes'])).toBe('suspect');
  });

  it('仅「PNG 无 EXIF」→ 疑似', () => {
    expect(classifyC(['pngNoExif'])).toBe('suspect');
  });

  it('「无相机信息 + PNG 无 EXIF」无屏幕特征 → 疑似', () => {
    expect(classifyC(['noCamera', 'pngNoExif'])).toBe('suspect');
  });
});

describe('屏幕分辨率/比例识别 —— 收紧比例避免误判真实照片', () => {
  it('精确匹配常见屏幕分辨率 → true', () => {
    expect(isScreenResolution(1080, 1920)).toBe(true);
    expect(isScreenResolution(1920, 1080)).toBe(true);
    expect(isScreenResolution(1170, 2532)).toBe(true);
  });

  it('相机常见分辨率（4:3 等）不匹配屏幕分辨率', () => {
    // 4000×3000、4032×3024 等是手机/相机常见输出分辨率，不应判为屏幕尺寸
    expect(isScreenResolution(4000, 3000)).toBe(false);
    expect(isScreenResolution(4032, 3024)).toBe(false);
    expect(isScreenResolution(3024, 4032)).toBe(false);
  });

  it('16:9 / 19.5:9 / 20:9 → 匹配屏幕比例', () => {
    expect(isScreenRatio(1920, 1080)).toBe(true); // 16:9
    expect(isScreenRatio(2340, 1080)).toBe(true); // 19.5:9
    expect(isScreenRatio(2400, 1080)).toBe(true); // 20:9
  });

  it('4:3 / 3:4 相机比例不再匹配屏幕比例（避免误判）', () => {
    expect(isScreenRatio(4000, 3000)).toBe(false); // 4:3
    expect(isScreenRatio(3000, 4000)).toBe(false); // 3:4
    expect(isScreenRatio(4032, 3024)).toBe(false); // 4:3
  });

  it('16:10 相机比例不再匹配屏幕比例', () => {
    expect(isScreenRatio(1920, 1200)).toBe(false); // 16:10
  });
});
