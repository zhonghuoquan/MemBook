import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import checker from 'vite-plugin-checker'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import obfuscator from 'javascript-obfuscator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 生产构建关键文件检查列表（index.html 通过 script 标签直接加载）
const CRITICAL_ASSETS = ['heic2any.min.js']

interface ObfuscatorOptions {
  /** 是否启用混淆 */
  enabled?: boolean
  /** 需要跳过的 chunk 名称子串 */
  skipPatterns?: RegExp[]
}

/**
 * 对构建产物中的主应用 JS 入口进行轻量混淆，提升前端代码被直接阅读/篡改的门槛。
 * 设计原则：
 * 1. 仅处理主应用入口 index-*.js，避开 vendor、worker、runtime 等易损文件。
 * 2. 关闭 transformObjectKeys、selfDefending 等高危选项，避免破坏运行时逻辑。
 * 3. 对混淆结果做基本校验：空内容或体积骤降时回退到原始代码，防止安装包白屏。
 */
function createObfuscatorPlugin(options: ObfuscatorOptions = {}): Plugin {
  const { enabled = true, skipPatterns = [/\.es/, /worker/, /runtime/] } = options

  return {
    name: 'vite-plugin-obfuscator',
    apply: 'build',
    closeBundle() {
      if (!enabled) return

      const assetsDir = path.resolve(__dirname, 'dist/assets')
      if (!fs.existsSync(assetsDir)) return

      const files = fs.readdirSync(assetsDir).filter((f) => {
        if (!f.endsWith('.js')) return false
        if (!/^index-[A-Za-z0-9_-]+\.js$/.test(f)) return false
        if (skipPatterns.some((p) => p.test(f))) return false
        return true
      })

      for (const file of files) {
        const filePath = path.join(assetsDir, file)
        const originalCode = fs.readFileSync(filePath, 'utf-8')

        // 基础校验：空文件或过小文件跳过
        if (!originalCode || originalCode.length < 100) {
          console.warn(`[obfuscator] 跳过空文件或过小文件: ${file}`)
          continue
        }

        try {
          const result = obfuscator.obfuscate(originalCode, {
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            debugProtection: false,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            rotateStringArray: true,
            selfDefending: false,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.5,
            transformObjectKeys: false,
            unicodeEscapeSequence: false,
          })

          const obfuscatedCode = result.getObfuscatedCode()

          // 混淆后校验：内容丢失或体积异常时回退原代码
          if (!obfuscatedCode || obfuscatedCode.length < originalCode.length * 0.3) {
            console.warn(`[obfuscator] 混淆结果异常，已回退原代码: ${file}`)
            continue
          }

          fs.writeFileSync(filePath, obfuscatedCode)
          console.log(
            `[obfuscator] ${file} (${originalCode.length} -> ${obfuscatedCode.length} bytes)`
          )
        } catch (err) {
          console.error(`[obfuscator] 处理失败，保留原代码: ${file}`, err)
        }
      }
    },
  }
}

/**
 * 校验构建产物中关键资源是否存在，避免安装包运行时缺失依赖。
 */
function verifyCriticalAssetsPlugin(): Plugin {
  return {
    name: 'vite-plugin-verify-assets',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')
      let allOk = true
      for (const asset of CRITICAL_ASSETS) {
        const assetPath = path.join(distDir, asset)
        if (!fs.existsSync(assetPath)) {
          console.error(`[verify-assets] 缺失关键资源: ${asset}`)
          allOk = false
        } else {
          const stats = fs.statSync(assetPath)
          console.log(`[verify-assets] ${asset} (${(stats.size / 1024).toFixed(1)} KB)`)
        }
      }
      if (!allOk) {
        throw new Error('构建产物缺少关键资源，请检查 public 目录')
      }
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    tailwindcss(),
    // 开发时实时类型检查，浏览器叠加层显示错误
    // ESLint 由 VS Code 扩展实时处理，不在此处集成以避免历史代码阻断构建
    checker({
      typescript: true,
      overlay: {
        initialIsOpen: false,
      },
    }),
    // 混淆插件默认禁用：javascript-obfuscator 处理 800KB 主 chunk 时内存峰值可达 10GB+，
    // 在当前机器上会导致构建不稳定。如需启用，设置环境变量 OBFUSCATE=true。
    ...(process.env.OBFUSCATE === 'true' ? [createObfuscatorPlugin()] : []),
    verifyCriticalAssetsPlugin(),
    // 构建产物体积可视化分析（仅 build 时生成）
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 显式列出所有前端依赖，强制 Vite 在启动时一次性完成依赖预构建（esbuild）。
  // 预打包后所有依赖均写入缓存，首次加载页面时无需等待运行时按需优化，
  // 显著减少首屏请求数与等待时间。
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      'react-konva',
      'konva',
      'dexie',
      'zustand',
      'jspdf',
      'html2canvas-pro',
      'exifr',
      'heic2any',
      'react-virtuoso',
      'jszip',
      'piexifjs',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      '@tauri-apps/api',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/plugin-shell',
    ],
  },
  // Vite 无需监听 Rust 工程；忽略 src-tauri/target/dist 显著降低监听负担
  server: {
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**', '**/dist/**'],
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-konva') || id.includes('react-dom') || id.includes('/react/')) {
            return 'react-vendor'
          }
          if (id.includes('konva')) return 'konva-vendor'
          if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('jszip')) {
            return 'editor-vendor'
          }
          if (id.includes('exifr')) return 'media-vendor'
          if (id.includes('@dnd-kit')) return 'dnd-vendor'
          if (id.includes('dexie')) return 'db-vendor'
          return undefined
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
