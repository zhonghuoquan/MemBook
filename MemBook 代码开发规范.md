# MemBook 代码开发规范

> 本规范基于 MemBook 项目当前代码现状提炼，后续所有代码开发**必须严格执行**本规范。
> 规范冲突时：硬约束 > 工程约定 > 风格约定。违反规范需在 PR 中显式说明理由。

最后更新：2026-08-15（新增 9.8 封面/封底模板设计规范）

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

### 9.5 React 约束（硬约束）

- **禁止使用 `<StrictMode>`**：React 19 开发期 StrictMode 双挂载会使 react-konva 19.x 的 `<Transformer>` 抛 `Cannot read properties of undefined (reading 'setAttrs')`，导致**整个 Konva Stage 崩溃、画布不渲染**（形状/槽位等全部不显示）。入口 [main.tsx](file:///f:/N-编程/MenBook开发项目/MemBook/src/main.tsx) 已移除 StrictMode（仅开发期生效，生产构建无影响）。若 reintroduce，必须显式在 PR 说明理由并验证画布渲染。
- **Konva 渐变 stop 必须使用扁平数组** `[offset, color, offset, color]`（`fillLinearGradientColorStops` / `fillRadialGradientColorStops`），禁止嵌套数组 `[[offset, color], ...]`。嵌套数组会导致 `addColorStop` 收到数组而渐变填充失败、形状在画布不可见（缩略图/导出用 Canvas2D 逐 stop 填充，不受此影响，故易漏判）。

### 9.6 封面/书脊域规范

- **概念解耦**：相册封面（主页项目展示）与封面页（打印导出）分离；`AlbumProject` 用 `coverImageId`/`coverPageId` 解耦。
- **书脊是页面左侧物理扩展**（`AlbumPage.spineWidth` mm + `spineColor`），非装饰 shape；用户可在书脊区自由添加文字/形状。**仅封面页显示**，封底不显示（渲染判断仅 `isCoverPage`；封底模板无 `spineColor`，`applyBackCoverTemplate` 的 `spineWidth=0`）。默认 `DEFAULT_SPINE_WIDTH_MM=18`。全链路（画布/导出/打印）宽度 `+= spineWidth`。
- **封面模板成套**：`Template.backCover` 关联配套封底；`applyCoverTemplate` 自动同步调用 `applyBackCoverTemplate`。封底与封面同背景/字体/配色，不拆开独立选择。
- **预设元素坐标转换**：位置 `posX` 含 `spineOffsetX` 偏移，尺寸 `scale` 不含偏移——两者必须区分，否则元素被放大且居中偏移。
- **封面/封底页设置隔离**：`batchPageSettings` / `setPageSlotCornerRadius` 对 `isCoverOrBackCoverPage` 直接跳过；封面/封底仅在 `setAlbumSize`（改尺寸）时自适应。封面圆角独立设置区（CoverSettings 弹窗）不受 `applyAll` 影响。
- **槽位圆角每角单独**：`slotCornerRadius` 类型 `number | [tl,tr,br,bl]`；不支持每角单独的场景（缩略图/预览/SmartLayout）用 `normalizeSlotCornerRadius(r)` 取四角平均值归一化。
- **封面预览**：用共享组件 `components/common/CoverPreview.tsx`（铰链折痕/落地投影/照片位打印纹理），仅组件层叠加，不写入数据。
- **封面书脊印刷一体连续（2026-08-15）**：封面页书脊背面与封面正面是**印刷一体连续设计**（无视觉间隙 `SPINE_GAP_MM`），编辑器/导出/打印画布宽度 = 页面宽 + 书脊宽；编辑器在 `x=spineWidth` 处用**虚线折叠线**标记书脊/封面交界（仅视觉标记，不占宽度）。封面正面内容偏移量 = `spineWidth`（**禁止**再加间隙）。缩略图/网格/全屏只显示封面正面（去书脊偏移，偏移量 = `spineWidth`）。旧版含间隙数据用 `migrateCoverSpineGapOnce`（db）一次性迁移。

### 9.7 文字元素渲染规范（单一 DOM 排版引擎，2026-08-15）

- **显示与编辑必须是同一个 DOM 节点**：文字元素由 [TextDomNode.tsx](file:///f:/N-编程/MenBook开发项目/MemBook/src/components/editor/canvas/TextDomNode.tsx) 常驻渲染（Canvas 的「文字 DOM 层」容器内，页面左上角锚定）。显示态只读 + `pointer-events` 穿透；进入编辑仅切换 `contentEditable` + 聚焦光标。**禁止**恢复「Konva 渲染显示 + DOM 浮层编辑」双引擎方案，**禁止** reintroduce half-leading / 基线 / 列容量等任何双引擎补偿公式（两套排版引擎存在固有差异，补偿无法覆盖所有字号/行高/字距/对齐/断行/用户缩放组合，历史教训见开发日志 2026-08-15）。
- **Konva TextElementNode 仅承载命中/选中/控制点**（透明 Rect 命中区），不得渲染文字内容；导出（exportEngine）与缩略图（thumbnailCore）沿用 Canvas 2D 公式，必须与 DOM 排版公式同源（见下）。
- **尺寸计算单一来源**：`fitTextSize`（TextDomNode.tsx 导出）与显示层块几何**完全同源**——竖排每列容量 `perCol = floor((height×MM_TO_PX − 2×4px) / (fontSize+letterSpacing))`（无 +1）、列宽 `stepX = fontSize×lineHeight`、字步进 `stepY = fontSize+letterSpacing`、显式 `\n` 即换列（`numCols = Σ ceil(段长/perCol)`）；横排行高 `fontSize×lineHeight`、断行用共享 `wrapTextLines`（CJK 逐字可断、Latin 按空格断）。**单位硬约束**：`el.width/height` 为 mm、`fontSize/letterSpacing` 为逻辑 px，任何公式比较前必须经 `MM_TO_PX` 换算到同一单位（历史 bug：mm 除以 px 导致退出编辑盒尺寸爆炸）。
- **断行测量必须计入 letterSpacing**：`wrapTextLines` 用 Canvas `measureText` 断行，但 `measureText` 不含 `letter-spacing`，**必须**用 `measureText(s) + s.length×letterSpacing` 判断是否超宽；调用方 contentWpx 需减去末尾一个字距。否则字距较大的多行文本会少算行数 → 文本框高度不足、多行文字被裁剪（历史教训见开发日志 2026-08-15）。
- **编辑进入路径禁止重算文本框尺寸**：`fitTextSize` 仅在退出编辑且文本已修改时调用；盒子只增不减、左上角不动（竖排宽度按列数增长、高度按最长列增长；横排宽度固定、高度按行数增长）。文本未修改则完全不提交（纯进/出编辑零变化、零空历史快照）。
- **编辑期间 contentEditable children 由 DOM 自管理**：React 渲染 `undefined` 不触碰已有内容（防光标重置）；文本实时同步走 `onLiveText`（不记录历史），退出统一提交（记录历史）。
- **竖排语义（与 PPT 一致）**：`writing-mode: vertical-rl` + `text-orientation: upright`；`align` = 列内垂直对齐（断行未满列生效）`verticalAlign` = 列组水平分布；竖排内层 div 必须显式 `box-sizing: content-box`（防全局 border-box 使 height 含 padding）。
- **封面模板文字排版链路（2026-08-15）**：`PresetTextElement` 支持 `lineHeight`/`letterSpacing`/`verticalAlign`，经 `presetTextToPageElements` 透传为 `PageTextElement`，`CoverPreview.TextPreview` 读取同一套字段渲染。**三处必须同源**——模板预设、转换、预览，禁止预览层硬编码字距/nowrap（历史教训见开发日志 2026-08-15）。多行模板文字用 `\n` 分隔，预览用 `white-space:pre-line` 真实换行，与画布一致。
- **模板文字应用时按内容自适应**：模板预设 `height` 是偏小占位值，应用模板时 `presetTextToPageElements` 必须对每个**非空**文字元素调用 `fitTextSize` 把文本框撑到 `max(预设高度, 实际文字高度)`，避免超框被 `overflow:hidden` 裁剪。封面/封底共用此函数，同时生效。空文字保持占位尺寸。
- **封面/封底多尺寸适配**：模板按竖版 210×280 基准设计。应用模板时字号用 `coverFontScale = clamp(min(宽/210, 高/280), 0.5, 1.6)`（**禁止只按宽度缩放**，否则横版/方形页面文字过大）。切换相册尺寸（`setAlbumSize`）时，必须对封面/封底页文字/形状按新旧尺寸等比重映射（`rescaleCoverDecorations`）：正文元素 x 减书脊偏移按 kx 缩放再加回、y/height 按 ky、fontSize 按 kx（书脊元素 `spine-text-*` 书脊宽固定、x 保持、y/height/fontSize 按 ky），文字重映射后重新 `fitTextSize` 撑高。
- **封面/封底图层 zIndex 约定**：统一用 `COVER_Z = { shape:50, spine:100, text:100 }`（禁止魔法数字）。层级：槽位照片(z≈0) < 模板形状/蒙版(50) < 书脊元素(100) < 模板文字(100)。蒙版/形状必须低于文字，保证标题清晰可读；用户后加元素用 `getGlobalMaxZ`（动态 >100）置于模板之上。
- **文本框最小尺寸（PPT 逻辑，2026-08-15）**：仅保留极小下限、按方向区分——横排最小 8×4mm、竖排最小 4×8mm。**resize、Konva 命中区（TextElementNode）、DOM 渲染层（TextDomNode）三处必须用同一套 `MIN_W_MM`/`MIN_H_MM` 常量**，禁止某处单独硬编码更大下限（否则"所见非所得"、用户无法缩小）。缩小后未编辑文字退出编辑不触发 `fitTextSize`，框保持缩小尺寸。

### 9.8 封面/封底模板设计规范（2026-08-15）

**坐标与基准**
- 模板所有元素（`slots` 槽位、`presetTextElements` 预设文字、`presetShapeElements` 预设形状）均为**百分比坐标 0-100**，相对封面整页。
- 设计基准为竖版 210×280（`REFERENCE_COVER_WIDTH_MM`/`REFERENCE_COVER_HEIGHT_MM`）。文字 `fontSize` 为基于该基准的 mm 值，应用时用 `coverFontScale = clamp(min(宽/210, 高/280), 0.5, 1.6)` 等比缩放。

**跨尺寸适配（等比 vs 拉伸）——核心规则**
- 原则：**按元素视觉语义分类**。区域/背景型拉伸铺满（颜色/渐变平滑，无视觉破坏）；图形/局部型等比保持宽高比（防图形变形，如圆形必须保持圆形）。
- 统一走 `utils/coverScale.ts` 的 `coverElementSize()` / `coverSlotSize()`，**禁止三处各自硬编码**：
  - 蒙版形状（id 含 `mask`）、全幅照片槽：按轴拉伸铺满。
  - 装饰形状（圆形/菱形/星形/圆角矩形）、局部照片槽：等比（`min(kx,ky)`）保持宽高比。
  - 槽位**逐轴适配**：某一边 ≥95%（与页面该边一致，如恋恋故事 `48×100` 的高度 100%）该边按页面拉伸，否则该边等比。
- 三处转换必须共用 coverScale：`presetShapeToPageElements`（模板→mm）、`rescaleCoverDecorations`（切换尺寸）、`calcCoverOverrides`（槽位→px）。位置按页面轴映射（x→宽、y→高），保证随页面定位。

**锚点感知定位（异宽高比页面保持视觉关系）**
- 尺寸适配后，位置由 `coverAnchorPosition(box, pageW, pageH, w, h)` **锚点感知**重新定位，禁止仅按页面百分比映射（会破坏贴边/居中视觉）：
  - 贴边元素（原 x≈0 左贴 / x+width≈100 右贴 / y≈0 顶贴 / y+height≈100 底贴）保持贴边；
  - 居中元素（中心≈50%）保持页面居中；
  - 其余元素按页面百分比定位。
- 槽位（`calcCoverOverrides`）、模板形状（`presetShapeToPageElements`）、尺寸切换形状（`rescaleCoverDecorations`）三处必须共用 `coverAnchorPosition`，禁止各自硬编码位置公式。

**封面槽位预设照片**
- `applyCoverTemplate`/`applyBackCoverTemplate` 为 **async**，用 `ensureCoverSlotPhotos` 保证**只要模板有照片位，所有槽位都有图**：相册照片不足时用 `createDefaultCoverPhotos`（`utils/coverPresetPhoto.ts`，复用预览 cover-landscape.jpg）补齐并加入 photoStore。
- 调用端（HomeView/CoverLibraryPanel/GridView）必须 `await`，避免在预设照片补齐前读取 pages/photos。
- 预设照片标记 `isCoverPreset: true`：**仅封面槽位显示，不出现在照片列表**（PhotoPanel 过滤 `!p.isCoverPreset`），画布/缩略图/导出仍按 photoId 正常渲染。

**照片槽位圆角**
- 用 `Template.slotCornerRadius?: number | [tl,tr,br,bl]`（px）按各模板设计美观性自定义，缺省 4。**必须按每个模板独立审美设定，禁止所有模板统一同一值**。
- 经验值：
  - 全幅照片槽圆角 0（铺满不圆角）。
  - 局部/居中照片大圆角（8-12）。
  - 贴边/全高槽：贴页面边的角为 0（避免贴边露背景）、内侧角按审美——如恋恋故事右半幅全高 `x:52 w:48 h:100` 四周全直角 `0`（内侧硬边 + 右侧/上下贴边）。
- `applyCoverTemplate`/`applyBackCoverTemplate` 必须用 `template.slotCornerRadius ?? 4`；封面库预览 `CoverPreview` 用 `slotRadiusCss` 体现同一圆角，预览与实际一致。

**图层层级**
- 统一用 `COVER_Z = { shape:50, spine:100, text:100 }`（禁魔法数字）。层级：槽位照片(z≈0) < 模板形状/蒙版(50) < 书脊元素(100) < 模板文字(100)。蒙版/形状必须低于文字，保证标题清晰可读；用户后加元素用 `getGlobalMaxZ` 置于模板之上。

**文字排版**
- 模板文字支持 `lineHeight`/`letterSpacing`/`verticalAlign`，`presetTextToPageElements` 透传、`CoverPreview.TextPreview` 同源渲染——**三处同源**，禁止预览层硬编码字距/nowrap。
- 多行模板文字用 `\n` 分隔，预览用 `white-space:pre-line` 真实换行，与画布一致。
- 应用模板时对每个**非空**文字调用 `fitTextSize` 撑高（`max(预设高度, 实际文字高度)`），避免超框裁剪；空文字保持占位尺寸。

**封面预览形状与画布同源**
- `CoverPreview.ShapePreview` 圆角矩形的圆角半径必须与画布一致：`cornerRadius*min(w,h)/2`（cqw，正圆角），禁止用 `cornerRadius*50%`（椭圆角，随宽高不同导致与画布不一致）。
- 描边粗细必须 `strokeWidth/2.1`cqw 随封面等比缩放（对应画布 2px/mm），禁止固定像素。

**成套**
- `Template.backCover` 关联配套封底；`applyCoverTemplate` 自动同步调用 `applyBackCoverTemplate`。封底与封面同背景/字体/配色/圆角语言，不拆开独立选择。

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
