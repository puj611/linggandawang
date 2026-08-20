// mcp-server/vite.config.ts
// MCP server 独立构建配置：把 mcp-server/index.ts 连同其 import 的 src/engine
// 引擎链打包为单个 ESM 产物（mcp-server/dist/index.js），供 node 直接运行。
// 为什么需要预构建：引擎侧 QuestionLoader/AdjectiveClusterLoader 使用了
// Vite 专属的 *.yaml?raw 导入与 @ 别名，tsx/裸 node 无法解析；
// 而 stdio server 需要零依赖、快启动的运行时形态。
// vite lib 模式会自动 external 化根 package.json 的 dependencies
//（uuid/yaml/zustand/react/@tauri-apps/* 等运行时从 node_modules 解析）。
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(mcpDir, '..');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(mcpDir, 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'mcp-server/dist',
    target: 'node18',
    minify: false,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      // 产物运行在 node 下：内置模块保持 external，
      // 避免被浏览器构建替换成 __vite-browser-external 空壳
      external: [/^node:/],
    },
  },
});
