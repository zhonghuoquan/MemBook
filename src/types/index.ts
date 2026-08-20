/* ============================================================
   MemBook — 核心类型定义（barrel 聚合入口）
   各领域定义按子文件拆分，此处仅做聚合 re-export。
   对外导出集合与拆分前保持一致，`import ... from '../types'`
   仍可 100% 使用。
   ============================================================ */

export * from './album';
export * from './template';
export * from './photo';
export * from './elements';
export * from './background';
export * from './ui';
export * from './watermark';