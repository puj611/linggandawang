// src/stores/windowStore.ts
// 窗口状态：位置记忆（T8.5：通过 Tauri 命令读写 window-position.json）
// P1.5：新增悬浮窗宽度 width 持久化（key: window_width）
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { WindowPosition } from '@/types/state';

interface WindowStore {
  position: WindowPosition;
  alwaysOnTop: boolean;
  // P1.5：悬浮窗宽度（默认 400，范围 360~560）
  width: number;
  // v5：悬浮窗高度（默认 680，范围 480~800），与 OS 窗口同步
  height: number;
  setPosition: (pos: WindowPosition) => Promise<void>;
  loadPosition: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  loadAlwaysOnTop: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<void>;
  // P1.5：设置宽度并持久化
  setWidth: (width: number) => Promise<void>;
  // v5：设置高度并持久化
  setHeight: (height: number) => Promise<void>;
  // v5：把 OS 窗口尺寸同步为当前面板 width/height（面板态挂载时调用）
  applyPanelSize: () => Promise<void>;
  // v5：回收起态恢复 OS 窗口为悬浮球默认尺寸（Ball 挂载时调用）
  resetToBallSize: () => Promise<void>;
}

const DEFAULT_POSITION: WindowPosition = { x: -1, y: -1, screen: 'default' };
const DEFAULT_WIDTH = 400;
const WIDTH_PREF_KEY = 'window_width';
export const MIN_WINDOW_WIDTH = 360;
export const MAX_WINDOW_WIDTH = 560;
// v5：高度常量（与 tauri.conf.json 默认 680 对齐）
export const DEFAULT_WINDOW_HEIGHT = 680;
export const MIN_WINDOW_HEIGHT = 480;
export const MAX_WINDOW_HEIGHT = 800;
const HEIGHT_PREF_KEY = 'window_height';

// 布局三层结构：OS 窗口尺寸 = 面板尺寸 + 四周安全边距×2
// Layer1 窗口(overflow hidden 兜底) → Layer2 安全区(padding) → Layer3 面板卡片(圆角12)
// 面板不贴窗口物理边缘：解决"太方"无呼吸感 + DPI 舍入导致的边缘按钮热区裁剪
export const SAFETY_PADDING = 10;
export const WINDOW_SIZE_OVERHEAD = SAFETY_PADDING * 2;

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
  height: DEFAULT_WINDOW_HEIGHT,
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
    // v5：同步加载高度偏好
    try {
      const raw = await invoke<string | null>('load_user_preference', { key: HEIGHT_PREF_KEY });
      if (raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          const clamped = Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, Math.round(parsed)));
          set({ height: clamped });
        }
      }
    } catch (e) {
      console.warn('[windowStore] 加载窗口高度失败', e);
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
  // v5：设置高度（自动 clamp），持久化到 user_preferences
  setHeight: async (height) => {
    const clamped = Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, Math.round(height)));
    set({ height: clamped });
    const invoke = await getInvoke();
    if (invoke) {
      try {
        await invoke('save_user_preference', { payload: { key: HEIGHT_PREF_KEY, value: String(clamped) } });
      } catch (e) {
        console.warn('[windowStore] 保存窗口高度失败', e);
      }
    }
  },
  // v5：面板态挂载时把 OS 窗口同步为面板尺寸+安全边距（窗口边缘 != 面板边缘，
  // 中间 10px 透明呼吸区，防止 DPI 舍入裁剪边缘按钮热区）
  applyPanelSize: async () => {
    const win = await getCurrentWindow();
    if (!win) return;
    const { width, height } = get();
    try {
      const { LogicalSize } = await import('@tauri-apps/api/window');
      await win.setSize(
        new LogicalSize(width + WINDOW_SIZE_OVERHEAD, height + WINDOW_SIZE_OVERHEAD),
      );
    } catch (e) {
      console.warn('[windowStore] 同步面板尺寸到窗口失败', e);
    }
  },
  // v5：回收起态恢复悬浮球默认窗口尺寸（400×680，与 tauri.conf.json 对齐）
  resetToBallSize: async () => {
    const win = await getCurrentWindow();
    if (!win) return;
    try {
      const { LogicalSize } = await import('@tauri-apps/api/window');
      await win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_WINDOW_HEIGHT));
    } catch (e) {
      console.warn('[windowStore] 恢复悬浮球窗口尺寸失败', e);
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
