/**
 * Demo 示例数据
 * 内置占位照片 + 示例项目，让用户打开编辑器就能看到内容
 */
import type { AlbumPage, Photo } from '../types';
import { TEMPLATES } from '../types';

/**
 * 生成彩色 SVG 占位照片（带字母标识）
 * 不需要真实图片文件，程序化生成
 */
function placeholderPhoto(index: number, label: string, hue: number): string {
  const sat = 45 + (index * 8) % 30;
  const lig = 55 + (index * 5) % 25;
  const bg = `hsl(${hue}, ${sat}%, ${lig}%)`;
  const textColor = lig > 60 ? '#333' : '#fff';

  return (
    `data:image/svg+xml,` +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="${bg}"/>
        <rect x="20" y="20" width="360" height="260" rx="8" fill="rgba(255,255,255,0.1)"/>
        <text x="200" y="130" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="${textColor}" opacity="0.8">${label}</text>
        <text x="200" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="${textColor}" opacity="0.5">${400}×${300}</text>
      </svg>`
    )
  );
}

/** 生成示例照片列表 */
export function getDemoPhotos(): Photo[] {
  const labels = ['春樱', '夏海', '秋叶', '冬雪', '晨光', '黄昏'];
  const hues = [340, 200, 30, 220, 45, 10];

  return labels.map((label, i) => ({
    id: `demo-photo-${i}`,
    src: placeholderPhoto(i, label, hues[i]),
    name: `${label}.jpg`,
    date: new Date(2026, 4 + i, 10 + i).toISOString().split('T')[0],
    width: 400,
    height: 300,
    orientation: 'landscape' as const,
  }));
}

/** 基于模板创建示例页面 */
function createDemoPage(templateId: string, bg: string, photoIndex: number): AlbumPage {
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  return {
    id: `demo-page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    templateId,
    background: bg,
    placements: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: `demo-photo-${(photoIndex + i) % 6}`,
    })),
  };
}

/** 生成示例相册项目 */
export function getDemoProject() {
  return {
    id: 'demo-project-1',
    name: '我的旅行回忆',
    size: {
      id: 'v-210',
      name: '竖版',
      width: 210,
      height: 280,
      desc: '210×280 mm · 标准竖版',
    },
    pages: [
      createDemoPage('single', '#FFF8E7', 0),
      createDemoPage('dual', '#FFFFFF', 1),
      createDemoPage('full', '#1A1A1A', 2),
      createDemoPage('triple', '#FFFFFF', 3),
      createDemoPage('quad', '#FFF0F0', 4),
      createDemoPage('collage', '#FFFFFF', 5),
      createDemoPage('top-bottom', '#F8F9FA', 0),
    ],
  };
}
