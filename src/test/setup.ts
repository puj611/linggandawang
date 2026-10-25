// src/test/setup.ts - Vitest 全局设置
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 显式全局 cleanup：singleFork 模式下多个测试文件共享环境时，
// RTL 的自动清理不能完全兜住跨文件 DOM 残留（R05 实测 ui.test 出现重复元素）
afterEach(() => {
  cleanup();
});
