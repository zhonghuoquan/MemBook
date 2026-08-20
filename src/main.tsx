import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './contexts/ThemeContext'
import { initSentry } from './utils/sentry'
import './i18n';  // 初始化 i18n（必须在 App 之前导入）

// Sentry 初始化：仅生产环境 + 配置了 DSN 时生效，必须最先执行
initSentry();

import App from './App'

// ⚠️ 不使用 <StrictMode>（有意决策，勿轻易开启）
//
// 根因：react-konva 19.x 的 <Transformer> 在 React 19 StrictMode 双挂载下偶发崩溃
//   "Cannot read properties of undefined (reading 'setAttrs')"，来自 Transformer 在
//   _fitNodesInto → node.getParent() 时拿到 undefined（被绑节点父级已被销毁/卸载）。
//   StrictMode 双挂载会放大该生命周期窗口，使整个 Konva Stage 崩掉、画布不渲染。
//   上游已知 issue（仍未修复）：https://github.com/konvajs/react-konva/issues/840
//
// 缓解（已落，见 src/components/editor/Canvas.tsx）：
//   - Transformer 绑定清理：在选中切换 / 阶段切换 / 组件卸载前先 nodes([]) 再销毁节点；
//   - 卸载时先释放 Transformer 绑定再 stage.destroy()，避免其引用已被拆的节点。
//
// 若日后想重新开启 <StrictMode>，请满足以下清单并人工逐项验证（无自动化兜底）：
//   1) 编辑器：选槽位→切编辑/非编辑→切页→删元素，全程无 setAttrs/undefined 报错；
//   2) 形状/文字/便利贴/贴纸的选中与缩放/旋转不变形、不漂移；
//   3) 预览/主页往返、冷启动进编辑器位图不残留、不出现 detached 位图报错。
// StrictMode 仅开发期生效，生产构建无影响。
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
