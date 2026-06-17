# 编辑器布局重构完成

## 变更摘要

基于原型图重新设计了编辑器的整体布局，主要变更如下：

### 1. 顶部工具栏简化
- 去掉了 **+页**、**删除页**、**预览** 三个按钮
- 左侧增加了 MemBook Logo + 主页返回按钮
- 文件标签、撤销/重做、自动排版保留
- 项目标题居中显示
- 导出手按钮保留（主按钮样式）

### 2. 左侧面板重构
- 从旧的 `LeftNav（Tab按钮） + BottomTabs（底部5个Tab）` 改为**垂直三Tab导航 + 面板内容区**
- 左侧64px窄条垂直排列：照片、模版、工具 三个Tab
- 点击Tab切换右侧面板内容（照片面板/模板面板/工具面板）
- 删除了底部 Tab 栏

### 3. 画布缩放联动
- Canvas 使用全局 `store.canvasZoom` 替代本地 state
- Ctrl+滚轮缩放 → 更新 store → 底部滑块同步
- 底部滑块拖拽 → 更新 store → 画布 Stage scale 同步
- 键盘快捷键：Ctrl+=/Ctrl+-/Ctrl+0

### 4. 底部导航栏重做
- 缩略图下方增加页码显示（1-12）
- 左移/右移挪页按钮
- 页码显示 `N/M`
- 缩放滑块（双向绑定 canvasZoom）
- 网格视图按钮

### 5. PRD 文档更新
- 整体布局图、工具栏、左侧面板、底部导航栏描述已同步更新
- 组件树更新为 V4 架构
- 功能清单状态更新

## 涉及文件
- `src/components/editor/Toolbar.tsx` — 重写
- `src/components/editor/LeftPanel.tsx` — 新增
- `src/components/editor/Canvas.tsx` — 重写（全局缩放联动）
- `src/components/editor/BottomNav.tsx` — 重写
- `src/components/views/EditorView.tsx` — 重写（整合新组件）
- `src/store/index.ts` — 增加 canvasZoom
- `PRD-MemBook-电子相册编辑器.md` — 同步更新
