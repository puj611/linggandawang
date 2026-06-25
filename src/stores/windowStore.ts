// src/stores/windowStore.ts
// 窗口状态：位置记忆（T8.5：通过 Tauri 命令读写 window-position.json）
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { WindowPosition } from '@/types/state';

interface WindowStore {
  position: WindowPosition;
  alwaysOnTop: boolean;
  setPosition: (pos: WindowPosition) => Promise<void>;
  loadPosition: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  loadAlwaysOnTop: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<void>;
}

const DEFAULT_POSITION: WindowPosition = { x: -1, y: -1, screen: 'default' };

async function getInvoke() {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch {
    return null;
  }
}

async function getCurrentWindow() {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow: getWin } = await import('@tauri-apps/api/window');
    return getWin();
  } catch {
    return null;
  }
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  position: DEFAULT_POSITION,
  alwaysOnTop: true,
  setPosition: async (pos) => {
    set({ position: pos });
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('save_window_position', {
        payload: {
          x: pos.x,
          y: pos.y,
          screen: pos.screen,
        },
      });
    } catch (e) {
      console.warn('[windowStore] 保存窗口位置失败', e);
    }
  },
  loadPosition: async () => {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      const payload = await invoke<{
        x: number;
        y: number;
        screen?: string;
      } | null>('load_window_position');
      if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
        set({
          position: {
            x: payload.x,
            y: payload.y,
            screen: payload.screen ?? 'default',
          },
        });
      }
    } catch (e) {
      console.warn('[windowStore] 加载窗口位置失败', e);
    }
  },
  setAlwaysOnTop: async (value) => {
    set({ alwaysOnTop: value });
    const win = await getCurrentWindow();
    if (win) {
      try {
        await win.setAlwaysOnTop(value);
      } catch (e) {
        console.warn('[windowStore] setAlwaysOnTop failed', e);
      }
    }
    const invoke = await getInvoke();
    if (invoke) {
      try {
        await invoke('save_user_preference', { payload: { key: 'alwaysOnTop', value: String(value) } });
      } catch (e) {
        console.warn('[windowStore] 保存置顶偏好失败', e);
      }
    }
  },
  loadAlwaysOnTop: async () => {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      const value = await invoke<string | null>('load_user_preference', { key: 'alwaysOnTop' });
      const onTop = value === null ? true : value === 'true';
      set({ alwaysOnTop: onTop });
      const win = await getCurrentWindow();
      if (win) await win.setAlwaysOnTop(onTop);
    } catch (e) {
      console.warn('[windowStore] 加载置顶偏好失败', e);
    }
  },
  toggleAlwaysOnTop: async () => {
    await get().setAlwaysOnTop(!get().alwaysOnTop);
  },
}));
