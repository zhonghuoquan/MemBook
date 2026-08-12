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
import { detectScreenshots } from './screenshot';
import type { PhotoFileInfo } from './types';

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
