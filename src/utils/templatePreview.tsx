/**
 * 模板缩略图预览渲染
 * 通过模板的实际槽位坐标动态生成布局示意图
 */
import type React from 'react';
import { TEMPLATES } from '../types';

export function templatePreview(templateId: string): React.ReactNode {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template || template.slots.length === 0) {
    return <div className="w-full h-full bg-[var(--color-primary-100)] rounded-[2px]" />;
  }

  return (
    <div className="w-full h-full relative">
      {template.slots.map((slot, i) => {
        const opacity = 1 - (i * 0.12);
        return (
          <div
            key={slot.id}
            className="absolute rounded-[2px] border border-white/20"
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width: `${slot.width}%`,
              height: `${slot.height}%`,
              backgroundColor: `var(--color-primary-${i % 3 === 0 ? 100 : i % 3 === 1 ? 200 : 300})`,
              opacity: Math.max(0.4, opacity),
            }}
          />
        );
      })}
    </div>
  );
}
