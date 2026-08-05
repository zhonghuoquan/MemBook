import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target', 'src-tauri/gen', '**/*.min.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 配合 verbatimModuleSyntax，统一 type import（不需要类型信息，轻量）
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // 允许 dev 专用 console，warn/error 不限制
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 历史代码大量 catch 未附加 cause，暂不强制（可后续增量修复）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/only-throw-error': 'off',
      // 历史代码大量 catch 重新抛错未附加 cause，暂不强制
      '@typescript-eslint/preserve-caught-error': 'off',
    },
  },
  // 配置文件（vite/eslint/vitest config）允许 console
  {
    files: ['*.config.ts', 'eslint.config.js', 'scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  // Prettier 兼容：关闭所有与 Prettier 冲突的格式化规则
  prettier,
])
