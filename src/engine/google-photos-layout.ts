/* ═══════════════════════════════════════
   Google Photos 智能编排引擎 V2 — 收口导出
   ──────────────────────────────────────
   本文件为对外公开入口，实际实现已拆分为子模块：
   - 所有类型定义       → ./googlePhotosLayout/types
   - 叶子级原语/行生成  → ./googlePhotosLayout/primitives
   - 编排 + 公开 API    → ./googlePhotosLayout/index
   这里仅做 `export * from './googlePhotosLayout'`，
   保持 `import ... from '../engine/google-photos-layout'` 继续可用、API 完全不变。
   ═══════════════════════════════════════ */

export * from './googlePhotosLayout';