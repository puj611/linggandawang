// src/stores/projectStore.ts
// 项目指纹 store：当前绑定项目 + 持久化
import { create } from 'zustand';
import { getPreference, setPreference } from '@/lib/sqlite';
import type { ProjectFingerprint } from '@/types/project';
import { EMPTY_FINGERPRINT } from '@/types/project';

const PREF_KEY = 'current_project';

interface ProjectStoreState {
  fingerprint: ProjectFingerprint | null;
  loaded: boolean;
  scanning: boolean;
  error: string | null;

  load: () => Promise<void>;
  setFingerprint: (fp: ProjectFingerprint) => Promise<void>;
  clear: () => Promise<void>;
  setScanning: (v: boolean) => void;
  setError: (msg: string | null) => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  fingerprint: null,
  loaded: false,
  scanning: false,
  error: null,

  load: async () => {
    try {
      const raw = await getPreference<string | null>(PREF_KEY, null);
      if (raw) {
        try {
          const fp = JSON.parse(raw) as ProjectFingerprint;
          set({ fingerprint: fp, loaded: true, error: null });
          return;
        } catch (e) {
          // v2.3：数据损坏时记录日志，便于诊断，仍 fallthrough 到 null 重置
          // P2-3：暴露 error 字段供 UI 提示用户
          console.warn('[projectStore] 项目指纹 JSON 解析失败，重置为空', e);
          set({ fingerprint: null, loaded: true, error: '项目指纹数据损坏，已重置' });
          return;
        }
      }
      set({ fingerprint: null, loaded: true, error: null });
    } catch (e) {
      // v2.3：getPreference 整体异常时也兜底，避免 unhandled rejection
      console.warn('[projectStore] 加载项目指纹失败', e);
      set({ fingerprint: null, loaded: true, error: '加载项目指纹失败' });
    }
  },

  setFingerprint: async (fp) => {
    try {
      await setPreference(PREF_KEY, JSON.stringify(fp));
      set({ fingerprint: fp, error: null });
    } catch (e) {
      // v2.3：持久化失败时记录错误并暴露给 UI（调用方可读 error 字段）
      console.warn('[projectStore] 保存项目指纹失败', e);
      set({ error: '保存项目指纹失败' });
    }
  },

  clear: async () => {
    try {
      await setPreference(PREF_KEY, null);
      set({ fingerprint: null });
    } catch (e) {
      console.warn('[projectStore] 清除项目指纹失败', e);
    }
  },

  setScanning: (v) => set({ scanning: v }),
  setError: (msg) => set({ error: msg }),
}));

// 便捷 selector：是否已绑定项目
export function useHasProject(): boolean {
  const fp = useProjectStore((s) => s.fingerprint);
  return !!fp && !!fp.path;
}

export { EMPTY_FINGERPRINT };
