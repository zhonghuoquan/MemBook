/**
 * 模板缩略图预览渲染
 * 在模板市场的 mini 预览中显示各模板的布局示意图
 */
import type React from 'react';

export function templatePreview(templateId: string): React.ReactNode {
  const previews: Record<string, React.ReactNode> = {
    single: (
      <div className="w-full h-full bg-[var(--color-primary-100)] rounded-[2px]" />
    ),
    dual: (
      <div className="flex gap-1 w-full h-full">
        <div className="flex-1 bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="flex-1 bg-[var(--color-primary-200)] rounded-[2px]" />
      </div>
    ),
    triple: (
      <div className="flex flex-col gap-1 w-full h-full">
        <div className="flex-1 bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="flex gap-1 flex-1">
          <div className="flex-1 bg-[var(--color-primary-200)] rounded-[2px]" />
          <div className="flex-1 bg-[var(--color-primary-300)] rounded-[2px]" />
        </div>
      </div>
    ),
    quad: (
      <div className="grid grid-cols-2 gap-1 w-full h-full">
        <div className="bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="bg-[var(--color-primary-200)] rounded-[2px]" />
        <div className="bg-[var(--color-primary-300)] rounded-[2px]" />
        <div className="bg-[var(--color-primary-100)] rounded-[2px]" />
      </div>
    ),
    full: (
      <div className="w-full h-full bg-[var(--color-primary-100)] rounded-[2px]" />
    ),
    'top-bottom': (
      <div className="flex flex-col gap-1 w-full h-full">
        <div className="flex-1 bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="flex-1 bg-[var(--color-primary-200)] rounded-[2px]" />
      </div>
    ),
    collage: (
      <div className="flex gap-1 w-full h-full">
        <div className="flex-[3] bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="flex-[2] flex flex-col gap-1">
          <div className="flex-1 bg-[var(--color-primary-200)] rounded-[2px]" />
          <div className="flex-1 bg-[var(--color-primary-300)] rounded-[2px]" />
        </div>
      </div>
    ),
    circle: (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-3/4 h-3/4 rounded-full bg-[var(--color-primary-100)]" />
      </div>
    ),
    overlap: (
      <div className="w-full h-full relative">
        <div className="absolute inset-0 w-[70%] h-full bg-[var(--color-primary-100)] rounded-[2px]" />
        <div className="absolute right-0 top-[15%] w-[50%] h-[70%] bg-[var(--color-primary-200)] rounded-[2px]" />
      </div>
    ),
  };

  return previews[templateId] || previews.single;
}
