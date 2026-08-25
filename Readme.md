# MemBook — 本地优先的电子相册编辑器

> 在桌面端制作电子相册。照片和项目数据默认保存在本机，不依赖业务服务器。

[![CI](https://github.com/zhonghuoquan/membook/actions/workflows/ci.yml/badge.svg)](https://github.com/zhonghuoquan/membook/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-1.2.2-blue)
![Tech](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2019%20%2B%20Rust-8B5CF6)

## 项目状态

- 当前版本：`1.2.2`
- 应用标识符：`app.membook.desktop`
- 核心技术：Tauri 2、React 19、TypeScript 6、Vite 7、Konva 10、Zustand 5、Tailwind 4、Dexie 4、Rust
- Windows 安装包：仅发布 NSIS `.exe`；不发布 WiX/MSI。
- macOS 发布由独立 CI 流程显式构建，不受 Windows 的 NSIS 目标影响。

## 核心能力

- 项目与模板：项目管理、模板画廊、自定义模板、封面/封底和书脊设计。
- 编辑器：Konva 画布、照片槽位、文字、贴纸、形状、对齐参考线、多选、缩放与全屏预览。
- 自动编排：按照片数量、比例与内容质量生成多种一键成册方案。
- 照片整理：导入、去重、EXIF/GPS、HEIC/HEIF、格式转换、截图和人脸等整理工具。
- 输出：PDF、高清图片和本地打印。

功能以当前稳定版本为准；详细迭代记录见 [开发日志](开发日志.md)。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- Rust stable
- Windows SDK 和 MSVC Build Tools（Windows 桌面打包需要）

### 常用命令

```bash
npm ci
npm run dev
npm run desktop:dev
npm run typecheck
npm test
npm run lint:baseline
npm run build
npm run desktop:build
```

`npm run desktop:build` 生成 Windows NSIS 安装包，默认位置为
`src-tauri/target/release/bundle/nsis/`。发布环境需要配置 Tauri 更新签名密钥。

## 文档导航

- [代码开发规范](MemBook%20代码开发规范.md)：唯一有效的开发规则。
- [架构说明](docs/architecture.md)：目录职责、状态与存储边界。
- [发布说明](docs/release.md)：Windows NSIS 发布与更新流程。
- [质量治理](docs/quality-governance.md)：测试、lint 基线和 CI 演进方式。
- [技术债务清单](docs/technical-debt.md)：已知问题与分阶段治理计划。
- [变更记录](CHANGELOG.md)：面向发布的用户可见改动。

## 贡献约定

1. 新代码遵循[代码开发规范](MemBook%20代码开发规范.md)。
2. 提交前至少运行 `npm run typecheck`、`npm test` 与 `npm run lint:baseline`。
3. 提交信息使用 Conventional Commits，例如 `feat(editor): add page guides`。
4. 涉及依赖版本、npm scripts、Tauri 配置、缓存参数或发布流程时，同步更新对应文档。

## 仓库同步

本地仓库为准，`main` 分支同步推送至 GitHub 与 cnb.cool。产品主页和安装包发布流程见[发布说明](docs/release.md)。

## 许可证

版权所有 © 2026 MemBook。未经授权不得复制、分发或用于商业用途。
