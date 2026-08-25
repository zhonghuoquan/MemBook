# 架构说明

本文件描述当前架构事实，不把尚未完成的重构目标写成既有实现。新代码规则见[代码开发规范](../MemBook%20代码开发规范.md)，待治理问题见[技术债务清单](technical-debt.md)。

## 分层与职责

| 层 | 主要目录 | 当前职责 |
| --- | --- | --- |
| UI | `src/components/`、`src/contexts/` | React 界面、事件入口与视图状态。 |
| 状态 | `src/store/` | Zustand 编辑器、照片库、历史和 UI 状态。 |
| 编排 | `src/services/`、部分 hooks | 跨 store、异步流程与用户操作协调。 |
| 算法 | `src/engine/`、`src/utils/` | 布局、选择、几何和渲染计算。`engine/storage` 目前包含 I/O，是待拆分的历史边界。 |
| 持久化 | `src/db/`、`src/engine/storage/` | Dexie/IndexedDB 与本地文件访问。 |
| 原生 | `src-tauri/src/` | Tauri 命令、HEIC、打印、授权与系统能力。 |

## 关键设计

- 本地优先：项目、元数据和导入照片主要使用 IndexedDB；direct 模式可引用用户本地文件。
- 图像分级：thumb / preview / full 按视图加载，降低大型相册内存压力。
- 渲染一致性：编辑器使用 Konva；导出和缩略图使用共享的 Canvas 2D 渲染规则。
- 状态分片：编辑器 store 按页面、放置、选区、装饰、工具和相册元信息拆分。

## 事实来源

| 信息 | 唯一事实来源 |
| --- | --- |
| 依赖版本与命令 | `package.json` / `package-lock.json` |
| Tauri 打包、CSP、更新器 | `src-tauri/tauri.conf.json` |
| CI 与发布 | `.github/workflows/` |
| 开发规则 | `MemBook 代码开发规范.md` |
| 已知债务 | `docs/technical-debt.md` |

修改上述来源时，必须同步更新受影响文档，而不是在 README 复制参数。
