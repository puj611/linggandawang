// src/hooks/useHotkey.ts
// 全局热键：Tauri 注册 Alt+Shift+Space（避开 Windows Alt+Space 系统菜单），前端监听 global-shortcut-triggered 事件
import { useEffect } from 'react';
import { isTauri } from '@/lib/env';
import { getPreference, setPreference } from '@/lib/sqlite';

const DEFAULT_HOTKEY = 'Alt+Shift+Space';
const HOTKEY_KEY = 'hotkey';

let cachedHotkey: string | null = null;
let hotkeyLoaded = false;

export async function loadHotkey(): Promise<void> {
  if (hotkeyLoaded) return;
  cachedHotkey = await getPreference<string>(HOTKEY_KEY, DEFAULT_HOTKEY);
  hotkeyLoaded = true;
}

export function getHotkey(): string {
  return cachedHotkey ?? DEFAULT_HOTKEY;
}

export function setHotkey(key: string): void {
  cachedHotkey = key;
  setPreference(HOTKEY_KEY, key).catch(() => {
    /* noop */
  });
}

interface ShortcutEvent {
  visible: boolean;
}

export function useHotkey(onShow: () => void, onHide?: () => void) {
  useEffect(() => {
    loadHotkey().catch(() => {
      /* noop */
    });
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        const fn = await listen<ShortcutEvent>('global-shortcut-triggered', (event) => {
          if (event.payload.visible) {
            onShow();
          } else {
            onHide?.();
          }
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {}
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onShow, onHide]);
}

/** ESC 键回收到收起态 */
export function useEscKey(onEsc: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEsc();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEsc]);
}
