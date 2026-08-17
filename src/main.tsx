import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './contexts/ThemeContext'
import { initSentry } from './utils/sentry'
import './i18n';  // 初始化 i18n（必须在 App 之前导入）

// Sentry 初始化：仅生产环境 + 配置了 DSN 时生效，必须最先执行
initSentry();

import App from './App'

// 不使用 <StrictMode>：react-konva 19.x 的 <Transformer> 在 React 19 StrictMode
// 双挂载下会抛 "Cannot read properties of undefined (reading 'setAttrs')"，
// 导致整个 Konva Stage 崩溃、画布不渲染（形状/槽位等全部不显示）。
// StrictMode 仅开发期生效，生产构建无影响，此处移除以规避该 react-konva 兼容问题。
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
