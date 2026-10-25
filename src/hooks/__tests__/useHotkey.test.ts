// src/hooks/__tests__/useHotkey.test.ts
// R07 ratchet：useHotkey 模块测试——默认热键、偏好持久化（localStorage 降级路径）、ESC 钩子
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  getHotkey,
  setHotkey,
  useEscKey,
} from '../useHotkey';

// 纯浏览器环境（isTauri=false）：useHotkey 的 Tauri 事件订阅分支自然跳过
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe('hotkey 偏好（localStorage 降级路径）', () => {
  beforeEach(() => {
    localStorage.clear();
    // 模块级缓存重置：vi.resetModules 不能直接作用于已导入绑定，改用内部状态可测路径
  });

  it('默认热键为 Alt+Shift+Space', () => {
    expect(getHotkey()).toBe('Alt+Shift+Space');
  });

  it('setHotkey 更新缓存并持久化（异步落盘后可见）', async () => {
    setHotkey('Ctrl+Alt+K');
    expect(getHotkey()).toBe('Ctrl+Alt+K');
    // setPreference 异步写 localStorage，等一个微任务+定时器节奏
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem('sqlite_pref_hotkey')).toBe('"Ctrl+Alt+K"');
  });
});

describe('useEscKey', () => {
  it('按 ESC 触发回调并 preventDefault；其他键不触发', () => {
    const onEsc = vi.fn();
    renderHook(() => useEscKey(onEsc));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(esc);
    expect(onEsc).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it('卸载后移除监听', () => {
    const onEsc = vi.fn();
    const { unmount } = renderHook(() => useEscKey(onEsc));
    unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onEsc).not.toHaveBeenCalled();
  });
});
