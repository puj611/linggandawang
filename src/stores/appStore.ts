// src/stores/appStore.ts
// 应用 FSM：四态切换，与架构设计 8.3 节一致
import { create } from 'zustand';
import type { AppState } from '@/types/state';

interface AppStore {
  state: AppState;
  settingsOpen: boolean;
  skipConfirmOpen: boolean;
  transition: (next: AppState) => void;
  toggleExpand: () => void;
  expand: () => void;
  collapse: () => void;
  backToExpanded: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openSkipConfirm: () => void;
  closeSkipConfirm: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // 大赛审核场景：打开链接后默认居中展开，避免右下角悬浮球被忽略
  state: 'expanded',
  settingsOpen: false,
  skipConfirmOpen: false,
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
}));
