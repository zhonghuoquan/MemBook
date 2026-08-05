/**
 * MemBook — Konva Stage 全局句柄
 *
 * 替代 window.__KONVA_STAGE__ 全局变量，集中管理 Stage 引用：
 * 由 Canvas 挂载/卸载时写入，供导出工具等非 React 上下文读取。
 */
import type Konva from 'konva';

let stage: Konva.Stage | null = null;

export function setKonvaStage(node: Konva.Stage | null): void {
  stage = node;
}

export function getKonvaStage(): Konva.Stage | null {
  return stage;
}
