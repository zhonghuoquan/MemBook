# MemBook — 本地优先的电子相册编辑器

> 一款运行在桌面的电子相册制作工具，所有数据保存在你的设备上，不上传服务器。支持自定义尺寸、一键成册、模板套用、滤镜调色、HEIC 解码、PDF 导出、直连打印等完整工作流。

- **版本**：1.0.0
- **标识符**：`app.membook.desktop`
- **技术栈**：Tauri 2 + React 19 + TypeScript + Konva 10 + Zustand 5 + Tailwind 4 + Dexie 4 (IndexedDB) + Rust
- **平台**：Windows（主要）/ macOS 10.15+ / Linux

---

## 一、主要功能

### 1. 项目管理（主页）

- 多项目管理、模板画廊、自定义模板创建
- 项目封面实时渲染第一页内容
- 照片整理工具集：去重 / EXIF 查看 / 格式转换 / LIVP 转换 / 智能归类

### 2. 相册编辑器

- **Canvas 画布**：基于 Konva 的高性能 2D 渲染，支持缩放/平移/键盘快捷键
- **模板系统**：184 种版式（120 内置 + 64 生成，1-12 图，覆盖留白/胶片/杂志英雄/瀑布流/中心环绕/L 型/网格阵列等有呼吸感版式）、自定义模板创建器（拖拽/缩放槽位）、自定义模板分组筛选（首页与编辑模式均可用）、智能切换、模板内置照片位可删除至空白
- **主题系统**：背景色 / 装饰元素 / 水印（时间地点水印，自动逆地理编码）
- **照片操作**：拖拽填充、旋转、缩放、平移、移除、批量操作
- **多选系统**：Ctrl+点击与鼠标框选统一的跨类型多选（照片位/文字/便利贴/贴纸），同类型≥2 弹出浮动工具栏（组合缩放/移动/置顶/置底/删除），跨类型仅支持移动；框选缩放时自动重算照片 pan 确保铺满不漏白
- **页面显示模式**：全显模式（显示页面外内容）/ 页面模式（裁剪到页面边界），右上角眼睛图标切换
- **添加照片位**：顶部工具栏按钮，新增槽位居中显示并置于顶层
- **网格视图**：100+ 页缩略图虚拟滚动浏览
- **全屏预览**：相邻图片预加载，零延迟切换
- **导出**：PDF（jsPDF）/ 高清图片（Canvas 2D 直渲）
- **打印**：直连系统打印机（SumatraPDF 静默打印，支持双面/份数）

### 3. 一键成册

- Google Photos 布局算法自适应照片数量与宽高比
- 一键成册整本相册

### 4. 照片管理

- **双轨存储**：
  - `direct` 模式：File System Access API / Tauri asset 协议，直接引用原文件
  - `import` 模式：压缩后存入 IndexedDB（Dexie），完全离线可用
- **HEIC/HEIF 解码**：三级回退链（Windows WIC → Rust libheif → 前端 heic2any WASM）
- **EXIF/GPS**：自动提取拍摄时间、GPS 坐标、逆地理编码为地点名称
- **LOD 三级图片体系**：thumb(256px) / preview(1200px) / full(4096px)

### 5. 工程化能力

- **自动更新**：Tauri Updater + 公钥签名 + 被动安装模式 + 24h 冷却
- **错误监控**：Sentry（仅生产环境，敏感信息脱敏）
- **离线授权**：RSA-PKCS1-v1_5 激活码 + 双锚点试用期（文件 + 注册表）
- **国际化**：i18next 中英文
- **代码混淆**：javascript-obfuscator（可选，环境变量 `OBFUSCATE=true` 启用）

---

## 二、技术架构

### 分层架构

```
┌─────────────────────────────────────────────────────┐
│                     UI 层 (components/)             │
│  home / editor / views / common                     │
├─────────────────────────────────────────────────────┤
│                   服务层 (services/)                │
│  photoService / slotEditService / pageLayoutService │
├─────────────────────────────────────────────────────┤
│                   引擎层 (engine/)                  │
│  storage-engine / layout-engine / selection-engine  │
│  google-photos-layout / alignment-engine            │
├─────────────────────────────────────────────────────┤
│      存储层 (store/ + db/ + engine/storage/)        │
│  Zustand stores + Dexie (IndexedDB) + 双轨存储      │
├─────────────────────────────────────────────────────┤
│                 工具层 (utils/ + hooks/)            │
│  LRU 缓存 / Web Worker / LOD / 导出引擎 / 打印     │
├─────────────────────────────────────────────────────┤
│              Rust 原生层 (src-tauri/src/)           │
│  HEIC 解码 / 逆地理编码 / 打印 / 窗口控制 / 授权    │
└─────────────────────────────────────────────────────┘
```

### 核心设计原则

| 原则                         | 实现                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| **本地优先**           | 所有数据存 IndexedDB / localStorage，不上传服务器                     |
| **引擎/UI 分离**       | `engine/` 纯逻辑，`components/` 仅渲染，可独立测试                |
| **双轨存储**           | direct（引用原文件）/ import（压缩入库），按场景选择                  |
| **LOD 分级加载**       | thumb/preview/full 三档，按视图档位加载合适分辨率                     |
| **LRU 内存管控**       | imageCache(150) / blobUrlCache(200) / thumbnailCache 限制内存无限增长 |
| **虚拟滚动**           | react-virtuoso 仅渲染可见项，100+ 页流畅浏览                          |
| **细粒度订阅**         | Zustand useShallow 选择器，避免不必要重渲染                           |
| **Web Worker 渲染**    | 缩略图/PNG 编码移至 Worker，主线程不阻塞                              |
| **IndexedDB 持久化**   | 缩略图跨会话缓存，避免重载时重新渲染                                  |
| **引用计数**           | blobUrlCache 显式 acquire/release，防止虚拟滚动场景下图片裂图         |
| **Canvas 2D 直渲导出** | 导出走 Canvas 2D，避免 React 异步渲染问题                             |

### 状态管理（Zustand Slices）

```
store/
├── editorStore/          # 编辑器主状态（拆分为多个 slice）
│   ├── albumMetaSlice    # 相册元信息
│   ├── pageSlice         # 页面数据
│   ├── placementSlice    # 照片放置
│   ├── selectionSlice    # 选择状态
│   ├── decorationsSlice  # 装饰元素
│   ├── toolsSlice        # 工具状态
│   ├── watermarkSlice    # 水印配置
│   └── helpers           # 几何计算辅助
├── photoStore            # 照片库（photoMap O(1) 查找）
├── historyStore          # 撤销/重做
└── uiStore               # UI 临时状态
```

### 数据持久化（Dexie v4）

```
MemBookDB (IndexedDB)
├── projects          # 项目
├── photos            # 照片元数据
├── customTemplates   # 自定义模板
├── photoBlobs        # 照片二进制（preview/original/thumb）
└── thumbnails        # 页面缩略图缓存（P2-1，跨会话持久化）
```

---

## 三、项目文件树

```
membook-backup/
├── .cargo/                    # Cargo 配置（限制并行编译任务数降低内存峰值）
│   └── config.toml
├── .github/workflows/
│   └── ci.yml                 # GitHub Actions: lint + typecheck + test + build
├── .tauri/                    # Tauri 签名密钥（私钥不提交，仅提交公钥）
│   └── membook-updater.key.pub
├── public/                    # 静态资源
│   ├── heic2any.min.js        # HEIC WASM 解码（index.html 直接加载）
│   ├── favicon.svg
│   └── icons.svg
├── scripts/                   # 构建辅助脚本
│   ├── extract-ico.ps1
│   ├── make-icons.cjs
│   └── tauri-build.ps1        # Windows SDK/MSVC 环境配置 + tauri build
├── src-tauri/                 # Rust 后端
│   ├── capabilities/
│   │   └── default.json       # Tauri 权限配置（fs/dialog/http/updater/process）
│   ├── icons/                 # 应用图标（Windows/macOS/iOS/Android 全平台）
│   ├── resources/
│   │   └── sm.exe             # SumatraPDF（静默打印 PDF）
│   ├── src/
│   │   ├── lib.rs             # Tauri 入口 + 命令（HEIC/地理编码/打印/授权/窗口）
│   │   └── main.rs
│   ├── Cargo.toml             # Rust 依赖（tauri/plugins/reqwest/winreg/sha2/windows）
│   ├── build.rs
│   └── tauri.conf.json        # Tauri 配置（窗口/CSP/bundle/updater）
├── src/                       # 前端源码
│   ├── components/            # UI 组件（81 个文件）
│   │   ├── common/            # 通用组件（Modal/Toast/Button/ErrorBoundary/UpdateDialog）
│   │   ├── editor/            # 编辑器组件（Canvas/GridView/PhotoPanel/ExportDialog）
│   │   │   ├── canvas/        # Konva 画布相关（渲染/拖拽/缩放/快捷键）
│   │   │   └── tools/         # 工具面板（背景/笔刷/颜色/便签样式）
│   │   ├── home/              # 主页组件（项目网格/模板画廊/整理工具）
│   │   │   └── organize/      # 照片整理工具（去重/EXIF/转换/归类）
│   │   └── views/             # 顶层视图（HomeView/EditorView/SmartLayoutView）
│   ├── config/                # 应用配置
│   ├── constants/             # 常量（模板调色板）
│   ├── contexts/              # React Context（ThemeContext）
│   ├── db/                    # Dexie 数据库封装
│   ├── engine/                # 引擎层（纯逻辑）
│   │   ├── storage/           # 存储引擎（direct-access/import-store/heic-converter/image-compressor）
│   │   ├── alignment-engine   # 对齐引擎
│   │   ├── drag-manager       # 拖拽管理
│   │   ├── google-photos-layout # 智能布局算法
│   │   ├── layout-engine      # 布局引擎
│   │   ├── selection-engine   # 选择引擎
│   │   └── storage-engine     # 存储统一入口
│   ├── hooks/                 # React Hooks（usePhotoSrc/useHotkeys/usePhotoImport 等）
│   ├── i18n/                  # 国际化
│   │   └── locales/           # en-US.json / zh-CN.json
│   ├── license/               # 离线授权（RSA 激活码 + 试用期）
│   ├── photo-tools/           # 照片工具（EXIF/哈希/地理编码/LIVP 转换/整理）
│   ├── services/              # 服务层（跨 store 协调）
│   ├── store/                 # Zustand 状态管理
│   │   └── editorStore/       # 编辑器 slice 拆分
│   ├── styles/                # 全局样式 + 设计 tokens
│   ├── types/                 # TypeScript 类型定义
│   ├── utils/                 # 工具层（24 个文件）
│   │   ├── lruCache           # LRU 缓存
│   │   ├── imageBitmapLoader  # ImageBitmap 加载（显式 close 释放内存）
│   │   ├── gridThumbnailRenderer # 网格缩略图渲染
│   │   ├── thumbnailCore      # 缩略图共享渲染逻辑
│   │   ├── thumbnail.worker   # Web Worker 缩略图渲染
│   │   ├── exportEngine       # Canvas 2D 导出引擎
│   │   ├── printEngine        # 打印引擎
│   │   ├── updater            # Tauri 自动更新
│   │   ├── sentry             # Sentry 错误监控
│   │   └── ...
│   ├── App.tsx                # 根组件（页面切换/许可证/更新检查）
│   ├── main.tsx               # 入口（Sentry 初始化 + React 渲染）
│   └── version.ts             # 版本号与构建信息
├── .gitignore
├── eslint.config.js           # ESLint Flat Config
├── index.html                 # HTML 入口
├── package.json
├── setup-tauri.ps1            # 一键环境配置脚本
├── tsconfig.json              # TS 项目引用
├── tsconfig.app.json          # 前端 TS 配置
├── vite.config.ts             # Vite 配置（混淆/资源校验/分块/预构建）
└── vitest.config.ts           # Vitest 配置（jsdom + fake-indexeddb）
```

---

## 四、开发与构建

### 环境要求

- **Node.js** ≥ 20
- **Rust** stable（rustup 安装）
- **Windows SDK** + **MSVC Build Tools**（仅 Windows 桌面打包）
- **Tauri CLI** 2.x

### 常用命令

```bash
# 安装依赖
npm install

# 前端开发（仅浏览器）
npm run dev

# 桌面端开发（Tauri + 前端热重载）
npm run desktop:dev

# 类型检查
npm run typecheck

# Lint
npm run lint

# 测试
npm test                    # 单次运行
npm run test:watch          # 监听模式

# 生产构建
npm run build               # 仅前端
npm run desktop:build       # 桌面端安装包（NSIS .exe，需在系统 PowerShell 中运行）
npm run desktop:build:debug # 调试版桌面端

# Windows 一键环境配置
.\setup-tauri.ps1
```

### 构建产物

- **前端**：`dist/`（Vite 构建，主 chunk ~1MB / gzip ~290KB）
- **桌面安装包**（仅 NSIS，跳过 WiX/MSI 减少依赖）：
  - `src-tauri/target/release/bundle/nsis/MemBook_1.0.0_x64-setup.exe`（约 13MB）
- **签名**：`.sig` 文件用于自动更新校验

### 测试

- **框架**：Vitest 4 + jsdom + fake-indexeddb
- **覆盖**：6 个测试文件，84 个用例（引擎层 + Store + DB）
- **配置**：[vitest.config.ts](file:///f:/N-编程/MenBook开发项目/MemBook/vitest.config.ts)

### CI

- **平台**：GitHub Actions（[.github/workflows/ci.yml](file:///f:/N-编程/MenBook开发项目/MemBook/.github/workflows/ci.yml)）
- **流程**：Lint → TypeCheck → Test → Build
- **触发**：push/PR 到 main/master

---

## 五、性能优化要点

针对 300+ 照片 / 100+ 页场景的优化（详见 [开发日志.md](file:///f:/N-编程/MenBook开发项目/MemBook/开发日志.md)）：

| 优化项           | 说明                                                            |
| ---------------- | --------------------------------------------------------------- |
| LRU 缓存         | imageBitmapLoader(100) / thumbnailCache(80) 限制内存无限增长    |
| 虚拟滚动         | react-virtuoso 仅渲染可见项                                     |
| LOD 三级图片     | thumb/preview/full 按视图档位加载                               |
| Web Worker 渲染  | 缩略图/PNG 编码移至 Worker，主线程不阻塞                        |
| IndexedDB 持久化 | 缩略图跨会话缓存                                                |
| 引用计数         | blobUrlCache 显式 acquire/release（无容量上限，按引用计数管理） |
| 细粒度订阅       | Zustand selector 选择器，禁止全量订阅                           |
| 请求去重         | loadImage/loadImageBitmap 防止并发重复加载                      |
| photoMap 归一化  | O(1) 查找替代 O(n) find                                         |
| ImageBitmap      | 显式 close() 释放内存                                           |

---

## 六、关键约束

- 私钥（`.tauri/membook-updater.key`）绝不提交，仅提交公钥
- 激活码生成器（`tools/license-generator/`）含 RSA 私钥，不提交
- Canvas 2D 渲染需 `ensureCanvasSafeUrl` 转换非同源 URL，避免 canvas 污染
- Tauri 自动更新需 CSP 允许 `updates.membook.app` 和 GitHub 域名
- CSP `connect-src` 必须包含 `blob:`，否则 `fetch(blob:url)` 加载 ImageBitmap 会被拦截导致页面崩溃
- `tauri.conf.json` 的 bundle targets 必须为 `["nsis"]`，跳过 WiX/MSI 减少依赖
- 进行一轮需求优化修复调整后，自己完成exe安装包构建，如构建过程中出现报错，需要优化解决。
- Sentry 仅生产环境初始化，敏感 URL 需脱敏
- 导入 >100 张照片时，存储模式对话框必须在文件选择后立即弹出
- 照片导入进度需显示三阶段：读取文件 / 导入 / 加载缩略图
