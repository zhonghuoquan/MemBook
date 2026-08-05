/**
 * Demo 示例数据
 * 内置占位照片 + 示例项目，让用户打开编辑器就能看到内容
 */
import type { AlbumPage, Photo } from '../types';
import { TEMPLATES, PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT } from '../types';

/**
 * 生成彩色 SVG 占位照片（带字母标识）
 * 不需要真实图片文件，程序化生成
 */
function placeholderPhoto(index: number, label: string, hue: number): string {
  const W = 1200, H = 900;
  const sat = 45 + (index * 8) % 30;
  const lig = 55 + (index * 5) % 25;
  const bg = `hsl(${hue}, ${sat}%, ${lig}%)`;
  const textColor = lig > 60 ? '#333' : '#fff';

  return (
    `data:image/svg+xml,` +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <rect width="${W}" height="${H}" fill="${bg}"/>
        <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="16" fill="rgba(255,255,255,0.1)"/>
        <text x="${W / 2}" y="${H * 0.44}" text-anchor="middle" font-family="Arial, sans-serif" font-size="140" font-weight="bold" fill="${textColor}" opacity="0.8">${label}</text>
        <text x="${W / 2}" y="${H * 0.6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="${textColor}" opacity="0.5">${W}×${H}</text>
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
    width: 1200,
    height: 900,
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
    margin: { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT },
    size: {
      id: 'v-210',
      name: '竖版',
      width: 210,
      height: 280,
      desc: '210×280 mm · 标准竖版',
    },
    pages: [
      createDemoPage('full', '#FFF8E7', 0),
      createDemoPage('dual-half', '#FFFFFF', 1),
      createDemoPage('full', '#1A1A1A', 2),
      createDemoPage('pin-shape', '#FFFFFF', 3),
      createDemoPage('quad-grid', '#FFF0F0', 4),
      createDemoPage('five-left3-right2', '#FFFFFF', 5),
      createDemoPage('dual-half', '#F8F9FA', 0),
    ],
  };
}
