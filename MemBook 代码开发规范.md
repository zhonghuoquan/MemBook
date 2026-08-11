# MemBook 代码开发规范

> 本规范基于 MemBook 项目当前代码现状提炼，后续所有代码开发**必须严格执行**本规范。
> 规范冲突时：硬约束 > 工程约定 > 风格约定。违反规范需在 PR 中显式说明理由。

最后更新：2026-07-29（新增 9.4 缩略图渲染统一规范）

---

## 一、项目技术栈与架构

### 1.1 技术栈

| 层级 | 技术 | 版本约束 |
|---|---|---|
| 框架 | React 19 + TypeScript 5.x | strict 模式 |
| 构建 | Vite 5.x | — |
| 桌面 | Tauri 2.x | 桌面壳层 |
| 状态 | Zustand 5.x（slices 模式） | — |
| 画布 | react-konva + Konva 10.x | — |
| 持久化 | Dexie.js 4.x (IndexedDB) | — |
| 国际化 | react-i18next | — |
| 样式 | Tailwind 4.x + CSS Custom Properties | — |

### 1.2 目录架构

```
src/
├── components/      # UI 组件（按域分组：common / editor / home / views）
├── store/           # Zustand store（editorStore 按 slice 拆分）
│   └── editorStore/
│       ├── index.ts          # combineSlices
│       ├── types.ts          # Slice 接口定义
│       ├── helpers.ts        # pushSnapshot 等跨 slice 工具
│       └── *Slice.ts         # 各业务 slice
├── services/        # 跨 store 编排层（photoService / pageLayoutService 等）
├── engine/          # 纯算法/引擎（alignment-engine / layout-engine 等）
├── hooks/           # 自定义 Hook
├── types/           # 全局类型定义
├── utils/           # 纯工具函数
├── i18n/locales/    # zh-CN.json / en-US.json
├── styles/          # design-tokens.css / globals.css
└── db/              # IndexedDB 持久化层
```

### 1.3 分层职责边界

| 层 | 职责 | 禁止 |
|---|---|---|
| `components/` | UI 渲染 + 事件派发 | 直接操作 IndexedDB；跨 store 编排 |
| `store/` | 单一 store 的状态更新 | 跨 store 编排；调用 DOM API |
| `services/` | 跨 store / 异步编排 | 持有 React 状态 |
| `engine/` | 纯算法（无副作用） | 调用 store / DOM / DB |
| `db/` | IndexedDB CRUD | 调用 store / 组件 |
| `hooks/` | 复用逻辑封装 | 持久化业务数据 |

> 经验教训：使用 koa-connect wrapper 导致 ctx 泄漏；原生 Koa 重写是必需的。同理，分层边界不可用 wrapper 模糊。

---

## 二、TypeScript 规范

### 2.1 严格模式

- 始终启用 `strict: true`，禁止 `// @ts-ignore`，必要时用 `// @ts-expect-error <原因>` 并附 issue 链接。
- 禁止 `any`，确需时使用 `unknown` 并收窄类型。
- 类型检查命令：`tsc --noEmit -p tsconfig.app.json`（注意：根 `tsconfig.json` 使用 project references 且 `files: []`，直接 `tsc --noEmit` 会误报 0 错误）。

### 2.2 类型定义

- 全局共享类型集中定义在 `src/types/index.ts`，禁止在组件内 `export interface` 全局复用类型。
- 组件内部私有类型可就地定义，命名以组件名前缀（如 `ToolbarProps`、`CanvasRenderItem`）。
- Zustand slice 接口必须在 `store/editorStore/types.ts` 中声明，slice 实现时 `import type` 引入。

### 2.3 类型导入

- 仅类型导入使用 `import type { ... }`，运行时导入使用 `import { ... }`。
- 混合导入时拆分为两条：`import { foo } from '...'; import type { FooType } from '...';`。

---

## 三、命名规范

### 3.1 文件命名

| 类型 | 命名风格 | 示例 |
|---|---|---|
| 组件文件 | PascalCase.tsx | `ToolsPanel.tsx`、`CanvasPhotoRenderer.tsx` |
| Hook 文件 | camelCase.ts，以 use 开头 | `usePhotoImport.ts`、`useStickerSrc.ts` |
| Store slice | camelCaseSlice.ts | `pageSlice.ts`、`selectionSlice.ts` |
| 工具/引擎 | camelCase.ts 或 kebab-case.ts | `alignment-engine.ts`、`pageLayoutService.ts` |
| 类型文件 | index.ts（统一入口） | `src/types/index.ts` |
| 常量文件 | camelCase.ts | `templatePalette.ts` |
| 测试文件 | 同名 + `.test.ts` | `pageSlice.test.ts` |

### 3.2 标识符命名

| 类型 | 风格 | 示例 |
|---|---|---|
| 组件 | PascalCase | `function Canvas() {}` |
| Hook | camelCase，use 前缀 | `usePanZoom` |
| Store action | camelCase，动词开头 | `setSelectedSlot`、`bringSlotToFront` |
| Store state 字段 | camelCase 名词 | `selectedSlotId`、`currentPageIndex` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_SLOT_CORNER_RADIUS`、`MM_TO_PX` |
| 类型/接口 | PascalCase | `AlbumPage`、`BrushStroke` |
| CSS 变量 | --kebab-case | `--color-brand`、`--z-dropdown` |
| 事件 handler | handle* / on* | `handleSave`、`onPageChange` |
| 私有 helper | _前缀或就近命名 | `_collectElements`、`collectAllElements` |

### 3.3 i18n Key 命名

- 采用点分层命名空间：`<域>.<子域>.<key>`，如 `editor.toolbar.bringToFront`、`home.nav.albums`。
- 数组渲染的 label 字段：模块级数组用 `labelKey` 存 i18n key 字符串，渲染时 `t(item.labelKey)`；组件作用域内数组可直接 `t()`。
- 插值使用 i18next 标准 `{{varName}}` 占位符。

---

## 四、状态管理（Zustand）

### 4.1 Slice 拆分原则

- 每个 slice 仅管理**一个业务域**的状态：`pageSlice`（页面增删改查）、`placementSlice`（照片/槽位编辑）、`selectionSlice`（选区）、`decorationsSlice`（画笔/文字/便利贴/贴纸/层级）、`toolsSlice`（工具状态）、`albumMetaSlice`（相册元数据）、`watermarkSlice`（水印）。
- Slice 之间禁止直接相互 import state；跨 slice 编排通过 `services/` 层。
- 跨 slice 工具函数（如 `pushSnapshot`）放在 `helpers.ts`。

### 4.2 Selector 使用

- **必须使用 selector 订阅最小切片**，禁止 `useEditorStore()` 全量订阅。
- 多个字段可用 `useShallow` 或分别订阅：
  ```ts
  // ✅ 推荐
  const currentPage = useEditorStore((s) => s.pages[s.currentPageIndex]);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);

  // ❌ 禁止
  const store = useEditorStore();
  ```
- 命令式读取（非订阅）使用 `useEditorStore.getState()`，避免在事件 handler 中触发重渲染。

### 4.3 历史快照（pushSnapshot）

- 所有改变 pages 的 action **必须在 set 之后调用 `pushSnapshot(get)`**。
- 连续滑动操作（pan / 调整 / 滤镜强度）使用去重 key：`pushSnapshot(get, 'adj-${pageIndex}-${slotId}')`，300ms 内同 key 合并。
- 跨 store 编排（如 photoService）下沉到 services 层，service 内部调用 `pushSnapshot`。

### 4.4 选区互斥与多选协议

- 单选状态（`selectedSlotId` / `selectedTextId` / `selectedStickyId` / `selectedStickerId`）**必须互斥**：设置一个时清空其他。
- 统一通过 `clearSelection()` 全清，不要单独清空各字段。
- **跨类型多选**（`multiSelectedElements: SelectedElement[]`）：
  - Ctrl+click 元素时调用 `toggleMultiSelect({ type, id })`，首次多选时自动将当前单选元素加入列表。
  - `multiSelectedElements.length >= 2` 时为多选模式，各 `selectedXxxId` 必须为 `null`；toggle 后仅剩 1 个元素时自动回退为单选模式。
  - 同类型多选（≥2）显示浮动工具栏（置顶/置底/删除）；跨类型多选仅支持移动，不显示工具栏。
  - 点击空白区域调用 `clearMultiSelect()` 清除多选。
  - 框选仍使用 `multiSelectedSlots`（仅槽位），与 `multiSelectedElements` 并存。

---

## 五、ID 生成规范

### 5.1 统一规则

所有运行时生成的 ID **必须**使用 `前缀-时间戳-随机后缀` 格式：

```ts
// ✅ 正确
const pageId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slotId = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const textId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ❌ 禁止：纯 Date.now() 在快速连点时会碰撞
const id = `page-${Date.now()}`;
```

### 5.2 前缀约定

| 实体 | 前缀 | 示例 |
|---|---|---|
| 页面 | `page-` | `page-1785220826000-a1b2c3` |
| 槽位 | `slot-` | `slot-1785220826000-d4e5f6` |
| 文字元素 | `text-` | `text-1785220826000-g7h8i9` |
| 便利贴 | `sticky-` | `sticky-1785220826000-j1k2l3` |
| 贴纸元素 | `sticker-elem-` | `sticker-elem-1785220826000-m4n5o6` |
| 画笔笔迹 | `brush-` | `brush-1785220826000-p7q8r9` |
| 项目 | `project-` | `project-1785220826000` |
| 照片 | `photo-` | `photo-1785220826000-s0t1u2` |
| 自定义模板 | `custom-template-` | `custom-template-1785220826000` |

### 5.3 ID 生成位置

- 运行时 ID 在调用 `add*` action 时由**调用方**生成并传入，action 内部不重新生成（保证 ID 可预期，便于后续选中/编辑）。
- 持久化层（`db/index.ts`）的 `generateId` helper 仅用于 db 内部生成项目/照片 ID，组件层不得直接调用。

---

## 六、样式规范

### 6.1 设计令牌（CSS Custom Properties）

- **必须使用 `src/styles/design-tokens.css` 中定义的令牌**，禁止硬编码颜色/尺寸/阴影值。
- 新增令牌先在 `design-tokens.css` 的对应分组中声明，再在组件中使用。

### 6.2 颜色使用

```tsx
// ✅ 推荐
<div className="bg-[var(--color-surface)] text-[var(--color-gray-700)]" />

// ❌ 禁止
<div className="bg-white text-[#495057]" />
```

### 6.3 Z-Index 层级

使用预定义令牌，禁止裸数字：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--z-base` | 0 | 默认 |
| `--z-flat` | 1 | 平铺元素 |
| `--z-raised` | 10 | 抬升元素 |
| `--z-sticky` | 20 | 吸顶/吸底 |
| `--z-dropdown` | 30 | 下拉菜单 |
| `--z-overlay` | 50 | 遮罩 / 画布编辑模式 |
| `--z-toolbar` | 60 | 顶部工具栏（高于画布编辑层，低于模态） |
| `--z-modal` | 100 | 模态框 |
| `--z-toast` | 200 | Toast |
| `--z-tooltip` | 300 | Tooltip |

**注意**：z-index 受 stacking context 影响。若父容器有 `z-index` 或特定 `transform`/`opacity`，子元素的 z-index 仅在父级上下文内生效。下拉菜单需放在不受父级限制的位置，或父级不设 z-index。

### 6.4 圆角/间距

- 圆角使用令牌：`--radius-sm/md/lg/xl/2xl`。
- 间距优先 Tailwind 工具类（`gap-1`、`px-3`、`py-2`），自定义值用 `var(--layout-*)`。

### 6.5 Tailwind 任意值

- 需要精确像素值时使用 `[]` 语法：`text-[12px]`、`w-[var(--layout-nav-width)]`。
- 颜色透明度用 `/` 语法：`bg-[var(--color-error)]/10`。

---

## 七、国际化（i18n）

### 7.1 强制规则

- **所有用户可见的 UI 文案必须通过 `t()` 渲染**，包括按钮文字、Tooltip、Toast、占位符、错误提示。
- 注释、日志、内部数据（如字体名）不需要 i18n。
- 新增组件**必须**在函数体开头调用 `const { t } = useTranslation();`，否则切换语言时不会重渲染。

### 7.2 Locale 文件维护

- `zh-CN.json` 和 `en-US.json` **必须同步更新**，新增 key 两边都要加。
- 命名空间按域划分：`common.*`、`home.*`、`editor.*`、`license.*`、`theme.*`。
- 插值变量使用驼峰：`{ remainingDays }`、`{ count }`。

### 7.3 语言切换入口

- 语言切换按钮仅在主页（HomeView）顶部挂载。
- **编辑器内禁止挂载语言切换按钮**（用户反馈：编辑器内不需要）。
- `LanguageSwitcher` 组件必须用 `useTranslation()` hook 订阅语言状态，禁止用 `getCurrentLanguage()` 同步读取。

---

## 八、组件规范

### 8.1 函数组件

- 一律使用函数声明 + named export，禁止 `export default`：
  ```tsx
  // ✅
  export function Toolbar({ onBack }: ToolbarProps) { ... }

  // ❌
  const Toolbar = ({ onBack }: ToolbarProps) => { ... };
  export default Toolbar;
  ```
- Props 接口以组件名 + Props 命名，紧邻组件定义。

### 8.2 性能优化

- **大列表/画布节点必须使用 `React.memo`**：`StickerNode`、`StickyNoteNode`、`TextElementNode` 等节点型组件。
- 内联回调破坏 memo：高频事件 handler 用 `useCallback`，依赖项要完整。
- 复杂计算（排序、过滤、合并渲染项）用 `useMemo` 缓存。
- Canvas 内部大循环（如 `globalLayerElements`）使用 `useMemo`，依赖项覆盖数据源。

### 8.3 文件大小

- 单文件超过 **800 行**需考虑拆分。`Canvas.tsx` 当前 2633 行属于历史债务，新增功能优先拆到 `canvas/` 子目录的 hook/组件中。
- 拆分方向：按职责（渲染层 / 事件处理 / 坐标计算 / 键盘交互）拆为自定义 hook 或子组件。
- **优先拆分目标**（按收益排序）：
  1. `canvas/ElementToolbar.tsx`（文字/便利贴/贴纸浮动工具栏，~200 行）
  2. `canvas/SlotToolbar.tsx` + `canvas/WatermarkToolbar.tsx`（~250 行）
  3. `canvas/MultiSelectToolbar.tsx`（多选浮动工具栏，~100 行）
  4. `hooks/useCanvasEvents.ts`（8 个 useEffect 合并，~200 行）
  5. `hooks/useGlobalLayerElements.ts`（全局图层元素收集与排序，~300 行）

### 8.4 事件 Handler

- DOM 事件 handler 用 `useCallback` 包裹，依赖项完整。
- Konva 事件可在 JSX 中内联，但需注意每次渲染生成新引用会触发子节点重渲染（可接受，但高频场景需优化）。
- 全局事件（如 `document.addEventListener('click', ...)`）必须在 `useEffect` cleanup 中移除。

---

## 九、性能与渲染

### 9.1 Canvas 渲染

- 槽位（slot）按 `slotOrder` 排序，装饰元素（画笔/文字/便利贴/贴纸）按 `zIndex` 排序。
- 装饰元素与槽位是**两套独立的层级系统**：装饰元素的 `bringToFront` 不影响槽位顺序，反之亦然。
- **统一 zIndex 系统**：新增槽位（`addPhotoSlot`）和粘贴槽位时通过 `getGlobalMaxZ(page)` 计算全局最大 zIndex，新槽位设为 `maxZ + 1` 确保顶层显示。`getGlobalMaxZ` 定义在 `decorationsSlice.ts`，考虑所有槽位（`slotZIndices`）和装饰元素（`stickerElements/textElements/stickyNotes/brushStrokes`）的 zIndex。
- **页面显示模式**：`pageDisplayMode: 'full' | 'page'`（uiStore）。`'page'` 模式下用 Konva `<Group clipFunc>` 裁剪 `globalLayerElements` 到页面边界 `(0, 0, CANVAS_W, CANVAS_H)`；UI 元素（Transformer/框选/编辑遮罩）不受裁剪影响。
- Konva Stage 卸载时必须调用 `stage.destroy()` 释放位图引用（见 Canvas.tsx P0-fix）。

### 9.2 图片加载

- 大图加载使用 `createImageBitmap` 异步加载，避免阻塞主线程。
- Blob URL 使用完毕后必须 `URL.revokeObjectURL()` 释放。
- **缓存容量**：`imageBitmapLoader` LRU 上限 100 条（`BITMAP_CACHE_CAPACITY`）；`gridThumbnailRenderer` 缩略图 LRU 上限 80 条（`THUMBNAIL_CACHE_CAPACITY`）；`blobUrlCache` 按引用计数管理（无容量上限，引用归零时 revoke）。

### 9.3 避免重复渲染

- Selector 订阅最小切片（见 4.2）。
- 跨组件传递的回调用 `useCallback`。
- 大数组的 `map` 渲染考虑虚拟化（如页面缩略图列表超过 100 项）。

### 9.4 缩略图渲染统一规范

- **所有页面缩略图场景**（网格视图 PageCard、底部导航 BottomNav、主页项目封面、全屏浏览）统一使用 Canvas 2D 渲染，禁止新增 CSS 定位缩略图组件。
- 通用组件 `components/common/CanvasPageThumbnail.tsx` 封装了渲染流程（缓存查询 → 预加载 → Worker 渲染），新场景直接复用。
- 底层渲染函数 `renderPageThumbnailInWorker`（`utils/gridThumbnailRenderer.ts`）内部消耗传入的 ImageBitmap（transfer 或 release），调用方**不可**在调用后再次释放。
- 不同场景通过 `cacheSuffix` 隔离缓存命名空间（如 `'nav'`、`'home'`、`'fs'`），避免缓存冲突。

---

## 十、错误处理与日志

### 10.1 错误处理

- 边界错误（数据加载失败、持久化失败）必须 `try/catch` 并通过 `addToast` 提示用户。
- 内部不变量（如 `pages[pageIndex]` 不存在）使用 early return，不要 throw。
- 禁止空 `catch {}`，必须有注释说明为何忽略，或调用 `logger.warn`。

### 10.2 日志

- 使用 `src/utils/logger.ts` 的 `logger.info/warn/error`，禁止 `console.log`。
- 日志前缀用 `[模块名]`：`logger.info('[db] IndexedDB 已持久化')`。

---

## 十一、测试规范

### 11.1 测试范围

- 纯算法 / 引擎层**必须有单元测试**：`engine/alignment-engine.ts`、`engine/google-photos-layout.ts`、`utils/photoGeometry.ts`、`utils/lruCache.ts`。
- Store slice 的关键 action 建议有测试：`store/editorStore/helpers.test.ts`。
- 组件 UI 测试暂不强制。

### 11.2 测试命令

```bash
# 类型检查
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json

# 单元测试
npm test
```

---

## 十二、Git 提交规范

### 12.1 提交信息格式

```
<type>(<scope>): <subject>

<body>
```

- type：`feat` / `fix` / `refactor` / `style` / `docs` / `test` / `chore` / `perf`
- scope：模块名（如 `editor` / `canvas` / `i18n` / `db`）
- subject：祈使句，不超过 50 字

### 12.2 提交粒度

- 一个提交解决一个问题，禁止混合多个不相关改动。
- 重构与功能改动分开提交，便于 review 和回滚。

---

## 十三、构建与发布

### 13.1 构建脚本

- 构建 EXE 安装包必须在**系统 PowerShell**（非 TRAE 终端）中运行，避免 TRAE sandbox 拦截文件操作。
- 必须设置系统环境变量：
  ```
  TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://gh-proxy.com/https://github.com
  ```
  防止 NSIS 下载超时。
- `tauri.conf.json` 的 bundle targets 必须为 `["nsis"]`，跳过 WiX/MSI 减少依赖。
- **CSP 配置硬约束**：`tauri.conf.json` 的 `connect-src` 指令**必须包含 `blob:`**，否则 `imageBitmapLoader.ts` 中 `fetch(blob:url)` 会被 CSP 拦截，导致 GP 模式重排后照片加载失败、React 渲染崩溃（error #300）。

### 13.2 构建脚本约定

- 构建脚本（`build-exe-now.ps1`、`build-exe.ps1`、`after-reboot-build.ps1`）必须：
  1. 清理旧 bundle 文件（`Remove-Item .../bundle/nsis/*`）。
  2. 设置 `TAURI_BUNDLER_TIMEOUT=360`（6 分钟超时）。
  3. 设置 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR` GitHub 镜像环境变量。
  4. 输出构建结果路径和文件大小。

---

## 十四、开发日志规范

- 每次开发会话**必须更新** `开发日志.md`，按时间倒序追加在文件顶部。
- 日志条目格式：
  ```markdown
  ## YYYY-MM-DD · 简短标题

  ### 背景
  <为什么做这次改动>

  ### 修改内容
  <具体改了什么，按文件/模块列出>

  ### 验证
  <如何验证改动有效，类型检查/测试结果>

  ### 涉及文件
  - `path/to/file.ts` — 改动说明
  ```
- 涉及的文件路径使用 markdown 链接语法 `[file.ts](file:///absolute/path)` 便于跳转。

---

## 十五、违规处理

- 新代码违反本规范：code review 时打回，修改后合并。
- 历史代码违反规范：在修改该文件时顺手修正，不专门发起重构 PR（除非列入 P1+ 优先级）。
- 规范本身需更新时：在 PR 中同步修改本文档，并说明更新理由。

---

## 附录：常用命令速查

```bash
# 开发
npm run dev

# 类型检查（必须用 -p 指定子配置）
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json

# 单元测试
npm test

# 桌面端开发
npm run desktop:dev

# 构建 EXE（在系统 PowerShell 中运行，非 TRAE 终端）
npm run desktop:build
```

---

## 附录：已知技术债务与优化方向（2026-07-29 审查）

> 基于全项目代码审查，按严重程度分级。新增功能时优先修复相关 P1 项。

### P1（架构/类型问题，需优先修复）

| 编号 | 问题 | 文件 | 建议 |
|---|---|---|---|
| P1-1 | `store/uiStore.ts` 多处 localStorage + `getComputedStyle(document.documentElement)` 违反 store 禁 DOM 规范 | uiStore.ts:134,145,174,180,195,206,208,295 | localStorage 读写抽到 `utils/persistence.ts`；`getComputedStyle` 上移到组件层 |
| P1-2 | `engine/handle-store.ts` + `engine/storage/*` 直接操作 IndexedDB/DOM，违反 engine 无副作用规范 | handle-store.ts:19,42-50；content-aware.ts:128,328；direct-access.ts:52,59；heic-converter.ts:25；image-compressor.ts:120 | `handle-store.ts` 迁移到 `db/`；engine 的 DOM 依赖通过依赖注入 |
| P1-3 | `components/Canvas.tsx` 等 12 个文件跨 4 store 编排 | Canvas.tsx:5；EditorView.tsx:15；BottomNav.tsx:2 等 | 跨 store 编排下沉到 `services/canvasOrchestrator.ts` |
| P1-4 | `placementSlice.ts:4` + `pageSlice.ts:6` 跨 slice 直接 import decorationsSlice | placementSlice.ts:4；pageSlice.ts:6 | `getGlobalMaxZ/getGlobalMinZ` 迁移到 `helpers.ts` |
| P1-5 | `pageSlice.ts:14-31` setCurrentPage 懒计算分支修改 pages 未调用 pushSnapshot | pageSlice.ts:14-31 | `return;` 前补 `pushSnapshot(get, \`margin-${index}\`)` |
| P1-6 | `WatermarkSettings.tsx:29,51` + `ActivationDialog.tsx:40` 的 `as any` 表明 store 类型缺失 watermarkSettings 合并 | WatermarkSettings.tsx:29,51；ActivationDialog.tsx:40 | 检查 `store/editorStore/types.ts` 是否合并 `WatermarkSlice` 类型 |

### P2（可维护性隐患，修改相关文件时顺手修复）

| 编号 | 问题 | 范围 | 建议 |
|---|---|---|---|
| P2-1 | `any` 类型使用（7 处）+ `as any` 断言（6 处） | SmartLayoutView.tsx、Canvas.tsx、exportUtils.ts 等 | 改用具体类型或 `unknown` 收窄 |
| P2-2 | 空 catch 块无注释（3 处） | exportUtils.ts:78,79,225 | 加 `/* ignore */` 注释或调用 logger.warn |
| P2-3 | `console.log/warn/error` 残留（7 处） | i18n/index.ts:76、lruCache.ts、ErrorBoundary.tsx:28、ExportDialog.tsx:294 | 替换为 `logger.warn/error`（ErrorBoundary 早期阶段可保留+注释） |
| P2-4 | 硬编码中文字符串（2 处） | WatermarkSettings.tsx:44,45 | 抽取为 `t('editor.watermark.previewDate/previewLocation')` |
| P2-5 | StickerGallery 未虚拟化 | StickerGallery.tsx:184 | 引入 `react-window` 或 `react-virtual` |
| P2-6 | Canvas.tsx globalLayerElements deps 粒度粗（含 currentPage 整对象） | Canvas.tsx:1480-1490 | 拆为多个细粒度 selector 订阅 |
| P2-7 | `handle-store.ts` 事务缺 `tx.onabort/onerror` | handle-store.ts:42-51 | 补事务错误监听或迁移到 Dexie |
| P2-8 | `import-store.ts` 疑似 blob URL 泄漏（`_previewUrl` 命名） | import-store.ts:81,125,212,342,375 | 排查并补 revoke 路径 |

### P3（优化建议）

| 编号 | 问题 | 建议 |
|---|---|---|
| P3-1 | `@ts-ignore` 应改 `@ts-expect-error <原因>` | engine/content-aware.ts:89 |
| P3-2 | Tauri 全局类型未声明 | 在 `types/` 补 `__TAURI_INTERNALS__` 声明 |
| P3-3 | Canvas.tsx 内联 button 回调（30+ 处） | 工具栏抽到子组件并 memo 化 |
| P3-4 | Canvas.tsx 2633 行历史债务 | 按 8.3 节优先拆分目标执行 |
