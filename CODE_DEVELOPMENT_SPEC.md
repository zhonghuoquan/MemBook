# MemBook 代码开发规范

> 本规范基于 MemBook 项目当前代码现状提炼，后续所有代码开发**必须严格执行**本规范。
> 规范冲突时：硬约束 > 工程约定 > 风格约定。违反规范需在 PR 中显式说明理由。

最后更新：2026-07-28

---

## 一、项目技术栈与架构

### 1.1 技术栈

| 层级   | 技术                             | 版本约束    |
| ------ | -------------------------------- | ----------- |
| 框架   | React 18 + TypeScript 5.x        | strict 模式 |
| 构建   | Vite 5.x                         | —          |
| 桌面   | Tauri 2.x                        | 桌面壳层    |
| 状态   | Zustand（slices 模式）           | —          |
| 画布   | react-konva + Konva              | —          |
| 持久化 | Dexie.js (IndexedDB)             | —          |
| 国际化 | react-i18next                    | —          |
| 样式   | Tailwind + CSS Custom Properties | —          |

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

| 层              | 职责                  | 禁止                              |
| --------------- | --------------------- | --------------------------------- |
| `components/` | UI 渲染 + 事件派发    | 直接操作 IndexedDB；跨 store 编排 |
| `store/`      | 单一 store 的状态更新 | 跨 store 编排；调用 DOM API       |
| `services/`   | 跨 store / 异步编排   | 持有 React 状态                   |
| `engine/`     | 纯算法（无副作用）    | 调用 store / DOM / DB             |
| `db/`         | IndexedDB CRUD        | 调用 store / 组件                 |
| `hooks/`      | 复用逻辑封装          | 持久化业务数据                    |

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

| 类型        | 命名风格                      | 示例                                              |
| ----------- | ----------------------------- | ------------------------------------------------- |
| 组件文件    | PascalCase.tsx                | `ToolsPanel.tsx`、`CanvasPhotoRenderer.tsx`   |
| Hook 文件   | camelCase.ts，以 use 开头     | `usePhotoImport.ts`、`useStickerSrc.ts`       |
| Store slice | camelCaseSlice.ts             | `pageSlice.ts`、`selectionSlice.ts`           |
| 工具/引擎   | camelCase.ts 或 kebab-case.ts | `alignment-engine.ts`、`pageLayoutService.ts` |
| 类型文件    | index.ts（统一入口）          | `src/types/index.ts`                            |
| 常量文件    | camelCase.ts                  | `templatePalette.ts`                            |
| 测试文件    | 同名 +`.test.ts`            | `pageSlice.test.ts`                             |

### 3.2 标识符命名

| 类型             | 风格                | 示例                                         |
| ---------------- | ------------------- | -------------------------------------------- |
| 组件             | PascalCase          | `function Canvas() {}`                     |
| Hook             | camelCase，use 前缀 | `usePanZoom`                               |
| Store action     | camelCase，动词开头 | `setSelectedSlot`、`bringSlotToFront`    |
| Store state 字段 | camelCase 名词      | `selectedSlotId`、`currentPageIndex`     |
| 常量             | UPPER_SNAKE_CASE    | `DEFAULT_SLOT_CORNER_RADIUS`、`MM_TO_PX` |
| 类型/接口        | PascalCase          | `AlbumPage`、`BrushStroke`               |
| CSS 变量         | --kebab-case        | `--color-brand`、`--z-dropdown`          |
| 事件 handler     | handle* / on*       | `handleSave`、`onPageChange`             |
| 私有 helper      | _前缀或就近命名     | `_collectElements`、`collectAllElements` |

### 3.3 i18n Key 命名

- 采用点分层命名空间：`<域>.<子域>.<key>`，如 `editor.toolbar.bringToFront`、`home.nav.projects`。
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

- 所有改变 pages 且被用户感知为「一次操作」的 action **必须在 set 之后调用 `pushSnapshot(get)`**——含封面设置确认、间距/边距/圆角调整、页面增删改、元素增删/移动等。
- 连续/滑块类操作统一用 **`recordHistory` 参数**（已替代旧 mergeKey 方案，禁止再用 `pushSnapshot(get, key)`）：
  - 相关 update 函数签名带 `recordHistory?: boolean`，内部 `if (recordHistory !== false) pushSnapshot(get)`（默认记历史）。
  - **元素类 update（text/sticky/sticker/shape）必须仅在实际修改到元素时才压快照**（`map` 标记 `changed`）：元素不存在（如切模板/撤销后已被移除，TextDomNode 卸载清理仍会补提交）时不得压「冗余快照」，否则历史栈多出一条无效条目，第一次撤销会恢复到错误状态。
  - 滑块 `onChange` 传 `recordHistory=false`（拖动实时更新、不入历史），松手 `onPointerUp` 传 `true` 提交一条快照，避免一次拖动刷屏历史。
  - 覆盖：文字（字号/行距/字距）、形状（圆角/切角/透明度/旋转/描边宽）、照片（亮度/对比度/滤镜强度/旋转/缩放 pan 等）。
- contentEditable 编辑态（文字/便利贴/水印等）下 `Ctrl+Z`/`Ctrl+Y` **放行给浏览器原生文本撤销/重做**（编辑中撤销字符，退出编辑后再撤销整次操作，PPT 行为）；应用级 undo 仅在非编辑态拦截（`editingTextId` 或 `document.activeElement.isContentEditable` 判定，且**编辑元素必须仍存在于当前页**，残留 `editingTextId` 不拦截、撤销前 `setEditingTextId(null)` 防文字被隐藏渲染）。
- **切换封面/封底模板必须完整保留用户内容**（applyCoverTemplate/applyBackCoverTemplate 切换分支）：照片编辑属性按 photoId 用 `makePlacementMigrator` + `calcCoverOverrides` 迁移（pan/缩放/裁剪/旋转/滤镜/明暗/阴影，按新旧槽位尺寸重映射 pan）；**场景1 书脊规则**——`spineWidth`/`spineAnchorMm` 沿用旧封面不重置，**`spineColor`/`spineLogoColor` 重置为新模板默认**（底色=`template.spineColor`、logo 色=空=按底色深浅自动黑/白）；书脊文字沿用用户版本；贴纸/便利贴随切换迁移。**场景2 撤销/重做**：切换压一次快照（封面+封底成套），撤销精确还原切换前、重做完整还原切换后。
- 跨 store 编排（如 photoService）下沉到 services 层，service 内部调用 `pushSnapshot`。

### 4.4 选区互斥

- 选区状态（`selectedSlotId` / `selectedTextId` / `selectedStickyId` / `selectedStickerId`）**必须互斥**：设置一个时清空其他。
- 统一通过 `clearSelection()` 全清，不要单独清空各字段。

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

| 实体       | 前缀                 | 示例                                  |
| ---------- | -------------------- | ------------------------------------- |
| 页面       | `page-`            | `page-1785220826000-a1b2c3`         |
| 槽位       | `slot-`            | `slot-1785220826000-d4e5f6`         |
| 文字元素   | `text-`            | `text-1785220826000-g7h8i9`         |
| 便利贴     | `sticky-`          | `sticky-1785220826000-j1k2l3`       |
| 贴纸元素   | `sticker-elem-`    | `sticker-elem-1785220826000-m4n5o6` |
| 画笔笔迹   | `brush-`           | `brush-1785220826000-p7q8r9`        |
| 项目       | `project-`         | `project-1785220826000`             |
| 照片       | `photo-`           | `photo-1785220826000-s0t1u2`        |
| 自定义模板 | `custom-template-` | `custom-template-1785220826000`     |

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

| 令牌             | 值  | 用途            |
| ---------------- | --- | --------------- |
| `--z-base`     | 0   | 默认            |
| `--z-flat`     | 1   | 头部/工具栏容器 |
| `--z-raised`   | 10  | 抬升元素        |
| `--z-sticky`   | 20  | 吸顶/吸底       |
| `--z-dropdown` | 30  | 下拉菜单        |
| `--z-overlay`  | 50  | 遮罩            |
| `--z-modal`    | 100 | 模态框          |
| `--z-toast`    | 200 | Toast           |
| `--z-tooltip`  | 300 | Tooltip         |

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

- 单文件超过 **800 行**需考虑拆分。`Canvas.tsx` 2400 行属于历史债务，新增功能优先拆到 `canvas/` 子目录的 hook/组件中。
- 拆分方向：按职责（渲染层 / 事件处理 / 坐标计算 / 键盘交互）拆为自定义 hook 或子组件。

### 8.4 事件 Handler

- DOM 事件 handler 用 `useCallback` 包裹，依赖项完整。
- Konva 事件可在 JSX 中内联，但需注意每次渲染生成新引用会触发子节点重渲染（可接受，但高频场景需优化）。
- 全局事件（如 `document.addEventListener('click', ...)`）必须在 `useEffect` cleanup 中移除。

---

## 九、性能与渲染

### 9.1 Canvas 渲染

- 槽位（slot）按 `slotOrder` 排序，装饰元素（画笔/文字/便利贴/贴纸）按 `zIndex` 排序。
- 装饰元素与槽位是**两套独立的层级系统**：装饰元素的 `bringToFront` 不影响槽位顺序，反之亦然。
- 如需跨类型调整层级（如让照片槽位在文字之上），需扩展统一的 zIndex 系统（见 P1 修复计划）。
- Konva Stage 卸载时必须调用 `stage.destroy()` 释放位图引用（见 Canvas.tsx P0-fix）。

### 9.2 图片加载

- 大图加载使用 `createImageBitmap` 异步加载，避免阻塞主线程。
- Blob URL 使用完毕后必须 `URL.revokeObjectURL()` 释放。
- 缩略图缓存使用 LRU 策略，上限 200 条（可配置）。

### 9.3 避免重复渲染

- Selector 订阅最小切片（见 4.2）。
- 跨组件传递的回调用 `useCallback`。
- 大数组的 `map` 渲染考虑虚拟化（如页面缩略图列表超过 100 项）。

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

### 13.2 构建脚本约定

- 构建脚本（`build-exe-now.ps1`、`build-exe.ps1`、`after-reboot-build.ps1`）必须：
  1. 清理旧 bundle 文件（`Remove-Item .../bundle/nsis/*`）。
  2. 设置 `TAURI_BUNDLER_TIMEOUT=360`（6 分钟超时）。
  3. 设置 GitHub 镜像环境变量。
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
