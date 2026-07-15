// src/stores/requirementStore.ts
// 需求同步器状态管理
// 持久化需求文档到 SQLite（Tauri）或 localStorage（Web）
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { Requirement, SubtaskStatus, RequirementFilter } from '@/types/requirement';

const STORAGE_KEY = 'linggan_requirements';
const MAX_REQUIREMENTS = 20;

async function getInvoke() {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch {
    return null;
  }
}

interface RequirementState {
  /** 所有需求 */
  requirements: Requirement[];
  /** 当前选中的需求 ID */
  activeRequirementId: string | null;
  /** 筛选条件 */
  filter: RequirementFilter;
  /** 是否已加载 */
  loaded: boolean;

  // Actions
  load: () => Promise<void>;
  save: () => Promise<void>;
  addRequirement: (req: Requirement) => Promise<void>;
  removeRequirement: (id: string) => Promise<void>;
  setActiveRequirement: (id: string | null) => void;
  updateSubtaskStatus: (requirementId: string, subtaskId: string, status: SubtaskStatus) => Promise<void>;
  setFilter: (filter: RequirementFilter) => void;
  clear: () => Promise<void>;
  getActiveRequirement: () => Requirement | null;
}

export const useRequirementStore = create<RequirementState>((set, get) => ({
  requirements: [],
  activeRequirementId: null,
  filter: {},
  loaded: false,

  load: async () => {
    const invoke = await getInvoke();
    if (invoke) {
      try {
        const data = await invoke<{ requirements: Requirement[] }>('load_requirements');
        if (data?.requirements) {
          set({ requirements: data.requirements, loaded: true });
          return;
        }
      } catch (e) {
        console.warn('[requirementStore] Tauri load 失败，降级到 localStorage', e);
      }
    }
    // Web 降级
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const requirements = JSON.parse(raw) as Requirement[];
        set({ requirements, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  save: async () => {
    const { requirements } = get();
    const invoke = await getInvoke();
    if (invoke) {
      try {
        await invoke('save_requirements', { requirements });
        return;
      } catch (e) {
        console.warn('[requirementStore] Tauri save 失败，降级到 localStorage', e);
      }
    }
    // Web 降级
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(requirements));
    } catch (e) {
      console.warn('[requirementStore] localStorage save 失败', e);
    }
  },

  addRequirement: async (req: Requirement) => {
    const { requirements } = get();
    const next = [req, ...requirements].slice(0, MAX_REQUIREMENTS);
    set({ requirements: next, activeRequirementId: req.id });
    await get().save();
  },

  removeRequirement: async (id: string) => {
    const { requirements, activeRequirementId } = get();
    const next = requirements.filter((r) => r.id !== id);
    set({
      requirements: next,
      activeRequirementId: activeRequirementId === id ? (next[0]?.id ?? null) : activeRequirementId,
    });
    await get().save();
  },

  setActiveRequirement: (id: string | null) => {
    set({ activeRequirementId: id });
  },

  updateSubtaskStatus: async (requirementId: string, subtaskId: string, status: SubtaskStatus) => {
    const { requirements } = get();
    const req = requirements.find((r) => r.id === requirementId);
    if (!req) return;

    const now = new Date().toISOString();
    const subtasks = req.subtasks.map((st) => {
      if (st.id === subtaskId) {
        return {
          ...st,
          status,
          updated_at: now,
          completed_at: status === 'done' ? now : undefined,
        };
      }
      return st;
    });

    // 自动推进阻塞任务
    const updatedSubtasks = subtasks.map((st) => {
      if (st.status === 'blocked' || st.status === 'pending') {
        const allDepsDone = st.dependencies.every((depId) => {
          const dep = subtasks.find((s) => s.id === depId);
          return dep?.status === 'done' || dep?.status === 'skipped';
        });
        if (allDepsDone && st.status === 'blocked') {
          return { ...st, status: 'pending' as SubtaskStatus, updated_at: now };
        }
      }
      return st;
    });

    const allDone = updatedSubtasks.every((st) => st.status === 'done' || st.status === 'skipped');
    const hasInProgress = updatedSubtasks.some((st) => st.status === 'in_progress');

    const updatedReq: Requirement = {
      ...req,
      subtasks: updatedSubtasks,
      status: allDone ? 'completed' : hasInProgress ? 'in_progress' : 'ready',
      updated_at: now,
    };

    const next = requirements.map((r) => (r.id === requirementId ? updatedReq : r));
    set({ requirements: next });
    await get().save();
  },

  setFilter: (filter: RequirementFilter) => {
    set({ filter });
  },

  clear: async () => {
    set({ requirements: [], activeRequirementId: null });
    await get().save();
  },

  getActiveRequirement: () => {
    const { requirements, activeRequirementId } = get();
    if (!activeRequirementId) return null;
    return requirements.find((r) => r.id === activeRequirementId) ?? null;
  },
}));
