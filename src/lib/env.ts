// src/lib/env.ts
// 环境检测：判断是否在 Tauri 桌面环境中运行

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isBrowser(): boolean {
  return !isTauri();
}
