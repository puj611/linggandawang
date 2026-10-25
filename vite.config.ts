import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // v2.3：拆分 vendor 包，利用浏览器缓存，减少主包体积
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'zustand-vendor': ['zustand'],
        },
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // R07 质量门：只统计业务源码（engine/lib/stores/hooks/components/data），
      // 排除入口挂载、类型声明与测试基建
      include: ['src/engine/**', 'src/lib/**', 'src/stores/**', 'src/hooks/**', 'src/components/**', 'src/data/**'],
      exclude: ['src/types/**', 'src/test/**', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // R07 首期门槛 = 实测基线设防（锁住不回退），路线图 75% 目标由后续版本逐步 ratchet：
        // 每次新增测试后手动上调对应数字。engine 已达路线图 G2 要求的 85%。
        // 注意：vitest 对象式门槛中 glob 键做分区统计，必须覆盖全部 include 目录
        'src/engine/**': { lines: 84 },
        'src/lib/**': { lines: 45 },
        'src/stores/**': { lines: 35 },
        'src/hooks/**': { lines: 2 },
        'src/components/**': { lines: 0.5 },
        'src/data/**': { lines: 0 },
      },
    },
  },
});
