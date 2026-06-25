// src/stores/featureStore.ts
// 功能开关：运行时状态 + SQLite 持久化
import { create } from 'zustand';
import { getPreference, setPreference } from '@/lib/sqlite';

const FEATURE_KEY = 'features';

export interface FeatureFlags {
  screenshotDiagnosis: boolean;
  screenshotAdvanced: boolean; // 对齐/间距/字号 — Demo 默认关闭走兜底问题
}

const DEFAULT_FLAGS: FeatureFlags = {
  screenshotDiagnosis: true,
  screenshotAdvanced: false,
};

interface FeatureStore extends FeatureFlags {
  load: () => Promise<void>;
  set: (patch: Partial<FeatureFlags>) => void;
}

export const useFeatureStore = create<FeatureStore>((set) => ({
  ...DEFAULT_FLAGS,
  load: async () => {
    const persisted = await getPreference<Partial<FeatureFlags>>(FEATURE_KEY, {});
    set({ ...DEFAULT_FLAGS, ...persisted });
  },
  set: (patch) => {
    set((state) => {
      const next = { ...state, ...patch };
      // 异步持久化，不阻塞 UI
      setPreference(FEATURE_KEY, next).catch(() => {
        /* noop */
      });
      return next;
    });
  },
}));
