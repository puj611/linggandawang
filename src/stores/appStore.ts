// src/stores/appStore.ts
// 应用 FSM：四态切换，与架构设计 8.3 节一致
import { create } from 'zustand';
import type { AppState } from '@/types/state';
import type { SceneChoice } from '@/engine/types';

// 三模式系统：localStorage 持久化用户选择的场景
const SCENE_STORAGE_KEY = 'linggan_scene_choice';
function loadStoredSceneChoice(): SceneChoice {
  try {
    const v = localStorage.getItem(SCENE_STORAGE_KEY);
    if (v === 'ppt' || v === 'frontend-ui' || v === 'backend-api' || v === 'auto') return v;
  } catch {
    // 静默降级
  }
  return 'auto';
}

interface AppStore {
  state: AppState;
  settingsOpen: boolean;
  skipConfirmOpen: boolean;
  /** 三模式系统：全局共享的场景选择（ExpandedCard 写入，ReferenceImagePanel 等读取） */
  sceneChoice: SceneChoice;
  transition: (next: AppState) => void;
  toggleExpand: () => void;
  expand: () => void;
  collapse: () => void;
  backToExpanded: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openSkipConfirm: () => void;
  closeSkipConfirm: () => void;
  /** 三模式系统：设置场景选择并持久化到 localStorage */
  setSceneChoice: (s: SceneChoice) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  state: 'ball',
  settingsOpen: false,
  skipConfirmOpen: false,
  sceneChoice: loadStoredSceneChoice(),
  transition: (next) => set({ state: next }),
  toggleExpand: () => {
    const cur = get().state;
    if (cur === 'ball') set({ state: 'expanded' });
    else set({ state: 'ball' });
  },
  expand: () => set({ state: 'expanded' }),
  collapse: () => set({ state: 'ball', settingsOpen: false, skipConfirmOpen: false }),
  backToExpanded: () => set({ state: 'expanded', settingsOpen: false, skipConfirmOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openSkipConfirm: () => set({ skipConfirmOpen: true }),
  closeSkipConfirm: () => set({ skipConfirmOpen: false }),
  setSceneChoice: (s) => {
    set({ sceneChoice: s });
    try {
      localStorage.setItem(SCENE_STORAGE_KEY, s);
    } catch {
      // 静默降级
    }
  },
}));
