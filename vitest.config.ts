import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom 环境支持 localStorage、document、navigator 等 DOM API，
    // 既能测纯函数（引擎层），也能测依赖 DOM 的模块（db/store）
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['fake-indexeddb/auto'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
