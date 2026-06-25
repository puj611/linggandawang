// src/stores/windowStore.ts
// 窗口状态：位置记忆（T8.5：通过 Tauri 命令读写 window-position.json）
// P1.5：新增悬浮窗宽度 width 持久化（key: window_width）
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { WindowPosition } from '@/types/state';

interface WindowStore {
  position: WindowPosition;
  alwaysOnTop: boolean;
  // P1.5：悬浮窗宽度（默认 420，范围 380~600）
  width: number;
  setPosition: (pos: WindowPosition) => Promise<void>;
  loadPosition: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  loadAlwaysOnTop: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<void>;
  // P1.5：设置宽度并持久化
  setWidth: (width: number) => Promise<void>;
}

const DEFAULT_POSITION: WindowPosition = { x: -1, y: -1, screen: 'default' };
// P1.5：默认宽度与持久化 key
const DEFAULT_WIDTH = 420;
const WIDTH_PREF_KEY = 'window_width';
export const MIN_WINDOW_WIDTH = 380;
export const MAX_WINDOW_WIDTH = 600;

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
  // P1.5：初始宽度，loadPosition 时会从偏好覆盖
  width: DEFAULT_WIDTH,
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
    // P1.5：同步加载宽度偏好（复用 user_preferences 表）
    try {
      const raw = await invoke<string | null>('load_user_preference', { key: WIDTH_PREF_KEY });
      if (raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          const clamped = Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(parsed)));
          set({ width: clamped });
        }
      }
    } catch (e) {
      console.warn('[windowStore] 加载窗口宽度失败', e);
    }
  },
  // P1.5：设置宽度（自动 clamp），持久化到 user_preferences
  setWidth: async (width) => {
    const clamped = Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(width)));
    set({ width: clamped });
    const invoke = await getInvoke();
    if (invoke) {
      try {
        await invoke('save_user_preference', { payload: { key: WIDTH_PREF_KEY, value: String(clamped) } });
      } catch (e) {
        console.warn('[windowStore] 保存窗口宽度失败', e);
      }
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
