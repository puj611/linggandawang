#!/usr/bin/env node
// scripts/copy-ort-wasm.mjs
// 把 onnxruntime-web 的 WASM 运行时（ort-wasm-simd-threaded.{mjs,wasm}）拷到 public/ort/，
// 由 Vite 原样复制进 dist/ort/，使 RAG 嵌入在 Tauri 生产包里从本地加载 WASM，
// 无需放行 cdn.jsdelivr.net。npm 的 prebuild/predev 生命周期自动触发本脚本。
// 二进制不入库：public/ort/ 已在 .gitignore 中忽略。

import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只拷默认（非 asyncify/jsep/jspi）构建：浏览器端 device 为 wasm，不需要 WebGPU 异步变体
const FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const outDir = join(projectRoot, 'public', 'ort');

/**
 * 定位 onnxruntime-web 的 dist 目录。
 * 兼容 npm 提升（node_modules/onnxruntime-web）与嵌套（@huggingface/transformers/node_modules/…）两种布局：
 * 优先用 Node 解析（与打包器看到的是同一个包），失败再退回磁盘直查。
 */
function resolveOrtDist() {
  const candidates = [];
  const requireFromRoot = createRequire(import.meta.url);
  const resolvers = [
    () => requireFromRoot.resolve('onnxruntime-web'),
    () => {
      const hfEntry = requireFromRoot.resolve('@huggingface/transformers');
      return createRequire(hfEntry).resolve('onnxruntime-web');
    },
  ];
  for (const resolveEntry of resolvers) {
    try {
      candidates.push(dirname(resolveEntry()));
    } catch {
      // 忽略：该布局不存在
    }
  }
  candidates.push(
    join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist'),
    join(projectRoot, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
  );
  for (const distDir of candidates) {
    if (FILES.every((f) => existsSync(join(distDir, f)))) return distDir;
  }
  throw new Error(
    `找不到 onnxruntime-web 的 WASM 运行时。已尝试：${candidates.join(' | ')}。请先 npm install。`,
  );
}

const ortDist = resolveOrtDist();
mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const name of FILES) {
  const src = join(ortDist, name);
  const dest = join(outDir, name);
  // 体积相同视为已是最新，避免每次 build 重复写 14MB 二进制
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied += 1;
  console.log(`[copy-ort-wasm] ${name} -> public/ort/ (${statSync(dest).size} bytes)`);
}
console.log(`[copy-ort-wasm] 完成：源 ${ortDist}，目标 public/ort/，本次复制 ${copied} 个文件`);
