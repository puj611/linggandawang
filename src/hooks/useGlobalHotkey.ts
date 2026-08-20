// src/hooks/useGlobalHotkey.ts
// Phase 3 Task 13：全局唤起热键 Alt+Shift+I —— 任意应用下按热键，灵感大王置顶展开并聚焦输入
// 与 useHotkey 的 Alt+Shift+Space（Rust 侧注册，唤起/隐藏窗口）互补：
// 本热键由前端通过 plugin-global-shortcut 注册，仅悬浮球态唤起，不打断提问/结果流程
import { useEffect } from 'react';
import type { ShortcutEvent } from '@tauri-apps/plugin-global-shortcut';
import { isTauri } from '@/lib/env';
import { useAppStore } from '@/stores/appStore';

/** 全局唤起热键（固定，不做自定义录制） */
export const GLOBAL_WAKE_HOTKEY = 'Alt+Shift+I';
/** 展开后聚焦输入框的跨组件事件（ExpandedCard 监听） */
export const EXPAND_FOCUS_EVENT = 'linggan:expand-focus';
/** 等待 ExpandedCard 挂载并绑定监听、窗口获得系统焦点后再派发聚焦事件 */
const FOCUS_DELAY_MS = 250;

export function useGlobalHotkey() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unregisterFn: (() => void) | undefined;

    (async () => {
      try {
        const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (cancelled) return;
        const win = getCurrentWindow();

        const handler = (event: ShortcutEvent) => {
          if (event.state !== 'Pressed') return; // 忽略按键释放
          const app = useAppStore.getState();
          // 仅悬浮球态可被唤起；展开/提问/结果态不打断当前流程
          if (app.state !== 'ball') return;
          app.toggleExpand();
          // 确保窗口置顶可见（可能被其他窗口遮挡或处于隐藏态）
          win.setAlwaysOnTop(true).catch(() => {});
          win.show().catch(() => {});
          win.setFocus().catch(() => {});
          // 延迟派发：ExpandedCard 挂载并绑定监听后再聚焦输入框
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent(EXPAND_FOCUS_EVENT));
          }, FOCUS_DELAY_MS);
        };

        // 幂等注册：先清掉可能残留的旧注册（热重载 / StrictMode 双挂载）
        await unregister(GLOBAL_WAKE_HOTKEY).catch(() => {});
        if (cancelled) return;
        await register(GLOBAL_WAKE_HOTKEY, handler);
        if (cancelled) {
          unregister(GLOBAL_WAKE_HOTKEY).catch(() => {});
          return;
        }
        unregisterFn = () => {
          unregister(GLOBAL_WAKE_HOTKEY).catch(() => {});
        };
      } catch (e) {
        // 注册失败（如热键被其他应用占用）：降级为无全局唤起，不影响应用其他功能
        console.warn(`[useGlobalHotkey] 注册全局热键 ${GLOBAL_WAKE_HOTKEY} 失败`, e);
      }
    })();

    return () => {
      cancelled = true;
      unregisterFn?.();
    };
  }, []);
}
