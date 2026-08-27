# MemBook UI 与 UX 设计规范

> 本文件是 MemBook 的 UI/UX 设计规范，与 [MemBook 代码开发规范](MemBook 代码开发规范.md) 配套使用。
> 技术实现层面的强制项见代码规范；本文聚焦视觉与交互层面的统一约定。
> 设计令牌唯一来源：`src/styles/design-tokens.css`（**改动令牌必须同步本文档对应章节**）。

---

## 一、设计基调

- **Canva 风格现代创意工具设计系统**（蓝紫调）。
- 品牌主色：`#6C63FF`（`--color-brand`）。
- 观感关键词：柔和、清爽、专业创意、本地优先。
- **硬性要求：颜色/尺寸/阴影一律引用 `design-tokens.css` 令牌，禁止硬编码**（Tailwind 中用 `var(--color-*)` 或 `var(--shadow-*)`）。

---

## 二、视觉令牌规范

### 2.1 颜色
| 通道 | 令牌 | 说明 |
|---|---|---|
| 品牌主色 | `--color-brand` `#6C63FF` | 主按钮/选中/高亮 |
| 品牌深色 | `--color-brand-dark` | hover/active 用 |
| 品牌淡背景 | `--color-brand-bg` `#F0EFFF` | 选中底色、淡填充 |
| Primary 梯队 | `--color-primary-50…900` | 蓝紫 10 阶 |
| 中性灰 | `--color-gray-25…900` | 13 阶 |
| 语义色 | `success / warning / error / info` | 每色含 `main / -light / -dark / -border` |
| 多彩 accent | mint 粉/绿/橙/青/红 | 每色含 `main / -soft / -border`，用于多彩标签/分类/状态 |

### 2.2 字体
| 用途 | 字体栈 |
|---|---|
| 正文 | `Noto Sans SC`（`--font-sans`） |
| 展示 | `Quicksand` + `Noto Sans SC`（`--font-display`） |
| 衬线 | `Noto Serif SC`（`--font-serif`） |
| 等宽 | `JetBrains Mono`（`--font-mono`） |

### 2.3 字号（Major Third 1.25）
`--text-nano 11px` → `caption 12px` → `body-sm 13px` → `body 14px` → `body-lg 15px` → `h1 24px` → `hero 32px`。正文基准 `14px`。

### 2.4 间距
4px 基准：`--space-1…16`（4/8/12/16/20/24/32/40/48/64）。内容区常用 `p-6`/`gap-4`、控件内边距 `px-3 py-2`。

### 2.5 圆角
`--radius-xs 4 / sm 6 / md 8 / lg 10 / xl 12 / 2xl 16 / full 9999`。按钮/输入框 `rounded-lg`，卡片 `rounded-xl/2xl`。

### 2.6 阴影
品牌紫投影（非纯黑）：`--shadow-xs…xl`。卡片 hover 用 `--shadow-card-hover`。

### 2.7 动效
- 过渡：颜色 150ms、阴影 150ms、变换 200ms、基础 200ms、慢 300ms。
- 缓动：`--ease-default / decelerate / accelerate`。
- **克制用动画**，仅交互必要处（hover、进出场、进度）使用。

---

## 三、Z-Index 层级系统
| 层 | 值 | 用途 |
|---|---|---|
| `--z-modal` | 100 | 全屏弹窗/对话框 |
| `--z-toast` | 200 | 轻提示 |
| `--z-tooltip` | 300 | 气泡 |
| `--z-toolbar` | 60 | 画布顶部工具栏 |
| `--z-overlay` | 50 | 通用遮罩层 |

**强制**：
- 所有弹窗/确认框必须 `z-[var(--z-modal)]`（100）或更高，**禁止固定 `z-50`**。
- 弹窗内再弹确认框须 `calc(var(--z-modal)+1)`。

---

## 四、明暗主题

- 亮/暗主题通过 `[data-theme="dark"]` 覆盖整套令牌，**禁用魔法数**，统一走令牌。
- 暗色：低饱和蓝紫品牌 + 蓝灰(Slate)中性色，柔和去纯黑。
- 新增组件必须同时在亮/暗两套下验证对比度与可读性。

---

## 五、布局常量
`--layout-nav-width 64` / `panel 440(650)` / `edit-flyout 260` / `toolbar 56` / `bottom-nav 72(36)` / `home-header 56`。导航、工具栏、侧栏宽度以这些常量为准。

---

## 六、组件规范

1. **图标**：统一 inline SVG（`stroke="currentColor"`，`strokeWidth` 1.5~2），尺寸用 `w-*/h-*`。
2. **按钮/输入框**：统一圆角 `rounded-lg`、禁用态 `opacity-40 + cursor-not-allowed`、聚焦态品牌色描边 + 柔光 `focus:`。
3. **面板复用单一来源**：文字/便利贴/形状属性 = `TextProperties/StickyProperties/ShapeProperties`，ToolsPanel 与右侧对象面板共用，改一处两处同步。
4. **弹窗层级**：见第三节，禁止遮罩层屏蔽画布交互（封面设置等场景）。

---

## 七、UX 交互约定

1. **文字编辑**：PPT 式**单层可见文字**——contentEditable 浮层直接显示真实文字（纯色 `color`、渐变 `background-clip:text`），隐藏 Konva 文字。光标原生对齐、零跳动，编辑时隐藏元素选中/hover 框。
2. **字体下拉**：自定义 `FontFamilySelect`（中文在上英文在下分组、顶部搜索、**选项以自身字体渲染**实现 PPT 式预览、高度自适应不溢出），**禁止回退原生 `<select>`**。
3. **封面/封底成套**：封面与封底同背景/字体/配色/圆角，不拆开独立选择；封面圆角独立设置不受全局应用影响。
4. **大列表**：一律懒加载（`useLazyList`），滚动增量，禁止 slice 截断 + 静态提示。
5. **撤销系统**：确认类操作才 `pushSnapshot`；滑块等连续操作 `recordHistory=false`，松手提交一次。
6. **性能**：长任务分批让出主线程 + 并发控制 + 只读文件头，禁止主线程长run冻结 UI；分析类大列表也接入懒加载。
7. **状态反馈**：操作执行中禁用相关入口并给出加载态；无目标时的入口置灰而非隐藏提示条（具体跟随各功能规范）。

---

## 八、文案与国际化

- **所有用户可见文案必须走 `t()`**（i18n），包括按钮、Tooltip、Toast、占位符、错误提示。
- 注释、日志、内部数据（如字体名）不需要 i18n。
- 新增文案需同步中（`zh-CN.json`）英（`en-US.json`）两套。

---

## 九、图片资源（网页/预览场景）

- 需展示的图片走设计系统：`https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt={url编码的prompt}&image_size={size}`，禁止占位图。
- 本规范适用于界面主调与组件；照片内容、封面素材等产品资源遵循各功能自身规范。

---

> 维护说明：本规范与 `design-tokens.css`、`MemBook 代码开发规范.md` 保持同步；任何 UI/UX 约定调整需同步更新文档。