import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * 剔除运行时用不到的 ONNX Runtime WASM 变体（当前实测只有 asyncify，25.62MB）。
 *
 * 成因：onnxruntime-web 的 ort.mjs 用三元链把各变体都写成
 *   new URL("ort-wasm-simd-threaded.{jsep,jspi,asyncify,默认}.wasm", import.meta.url)
 * （见 ort.mjs:17715 与 asyncify glue 模块的 locateFile 兜底），
 * Vite 的静态分析不看分支可达性，无条件把这些资产 emit 进 assets/。
 * 但 src/lib/vectorStore.ts 的 useLocalWasm() 在 pipeline() 之前就把
 * env.backends.onnx.wasm.wasmPaths 原地改写成 /ort/ort-wasm-simd-threaded.{mjs,wasm}，
 * 因此 dist/assets/ 下的任何 ort-wasm* 变体在运行时都不会被请求。
 *
 * 可靠性依据：本插件只在 bundle 生成后、落盘前按文件名剔除 Rollup 产物，且只匹配
 * 实测唯一的死重变体 asyncify；真正在用的 dist/ort/ort-wasm-simd-threaded.wasm 来自
 * public/ort/（prebuild 由 scripts/copy-ort-wasm.mjs 生成），由 Vite 直接复制、
 * 根本不进入 bundle，因此不可能被这里误删。
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'drop-unused-ort-wasm',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm[^/]*asyncify[^/]*\.wasm$/.test(fileName)) {
          delete bundle[fileName];
          this.info(`[drop-unused-ort-wasm] 剔除未使用的 WASM 变体：${fileName}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dropUnusedOrtWasm()],
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
        // R07 门槛 = 实测基线设防（锁住不回退），路线图 75% 目标由后续版本逐步 ratchet：
        // 每次新增测试后手动上调对应数字。engine 已达路线图 G2 要求的 85%。
        // 2026-10-25 第一轮 ratchet：R05/R06 补测后 lib 45→57、hooks 2→5、components 0.5→6
        // 注意：vitest 对象式门槛中 glob 键做分区统计，必须覆盖全部 include 目录
        'src/engine/**': { lines: 84 },
        'src/lib/**': { lines: 57 },
        'src/stores/**': { lines: 36 },
        'src/hooks/**': { lines: 5 },
        'src/components/**': { lines: 6 },
        'src/data/**': { lines: 0 },
      },
    },
  },
});
