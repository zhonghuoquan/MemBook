# 技术债务清单

本清单记录当前代码与目标架构的差距。它不是新代码的豁免：新增或改动相关模块时，应避免扩大问题并尽量顺带修复。

## P1：架构边界

| 项目 | 当前情况 | 分阶段方案 |
| --- | --- | --- |
| `engine/storage` 与 `handle-store` | 同时承担算法、IndexedDB 与 DOM/I/O。 | 先定义 adapter 接口；再将 DB 实现迁到 `db/`；最后让纯算法只接收依赖。 |
| 跨 store 编排 | Canvas、EditorView 等组件存在跨 store 协调。 | 先抽取纯服务函数，再逐步迁入 `services/`，不做一次性大重写。 |
| Canvas 复杂度 | `Canvas.tsx` 是大型历史组件。 | 每次新增功能优先抽取节点、工具栏、事件和图层排序 hook。 |

## P2：类型、错误处理与性能

- 清理 `any`、空 `catch`、遗留 `console`，使用明确类型和 `logger`。
- 为高频 UI 和大列表补充 memo、细粒度 selector 或虚拟化。
- 审计 Blob URL、ImageBitmap 与 IndexedDB 事务的释放和失败路径。
- 为关键存储和跨 store 编排补充回归测试。

## 验收方式

- 每个债务项以独立提交或 PR 处理。
- 变更必须通过类型检查、测试和 lint 基线。
- 完成后从本清单删除，并在 CHANGELOG 或开发日志记录影响。
