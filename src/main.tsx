import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './contexts/ThemeContext'
import { initSentry } from './utils/sentry'
import './i18n';  // 初始化 i18n（必须在 App 之前导入）

// Sentry 初始化：仅生产环境 + 配置了 DSN 时生效，必须最先执行
initSentry();

import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
