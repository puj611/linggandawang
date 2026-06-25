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
    const raw = await getPreference<string | null>(PREF_KEY, null);
    if (raw) {
      try {
        const fp = JSON.parse(raw) as ProjectFingerprint;
        set({ fingerprint: fp, loaded: true });
        return;
      } catch {
        /* fallthrough to null */
      }
    }
    set({ fingerprint: null, loaded: true });
  },

  setFingerprint: async (fp) => {
    await setPreference(PREF_KEY, JSON.stringify(fp));
    set({ fingerprint: fp, error: null });
  },

  clear: async () => {
    await setPreference(PREF_KEY, null);
    set({ fingerprint: null });
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
