// Local LLM Store - 管理本地 llama-server sidecar 状态
// 通过 Tauri invoke 与 Rust 后端通信

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/env';

export interface LocalLLMStatus {
  running: boolean;
  port: number;
  pid: number | null;
  model_path: string | null;
  error: string | null;
}

interface LocalLLMState {
  status: LocalLLMStatus | null;
  loading: boolean;
  modelPath: string;
  contextSize: number;
  threads: number;

  loadStatus: () => Promise<void>;
  start: (modelPath?: string) => Promise<boolean>;
  stop: () => Promise<void>;
  checkHealth: () => Promise<void>;
  setModelPath: (path: string) => void;
  setContextSize: (size: number) => void;
  setThreads: (threads: number) => void;
}

const DEFAULT_STATUS: LocalLLMStatus = {
  running: false,
  port: 11434,
  pid: null,
  model_path: null,
  error: null,
};

export const useLocalLLMStore = create<LocalLLMState>((set, get) => ({
  status: null,
  loading: false,
  modelPath: '',
  contextSize: 2048,
  threads: 0,

  loadStatus: async () => {
    if (!isTauri()) {
      set({ status: DEFAULT_STATUS });
      return;
    }
    try {
      const status = await invoke<LocalLLMStatus>('get_local_llm_status');
      set({ status });
      if (status.model_path) {
        set({ modelPath: status.model_path });
      }
    } catch {
      set({ status: DEFAULT_STATUS });
    }
  },

  start: async (modelPath?: string) => {
    const { modelPath: storedPath, contextSize, threads } = get();
    const path = modelPath || storedPath;
    if (!path) {
      set((s) => ({
        status: { ...s.status, ...DEFAULT_STATUS, error: '请先选择模型文件' },
      }));
      return false;
    }

    set({ loading: true });
    try {
      const status = await invoke<LocalLLMStatus>('start_local_llm', {
        modelPath: path,
        port: 11434,
        nCtx: contextSize,
        nThreads: threads || undefined,
      });
      set({ status, loading: false, modelPath: path });
      return status.running;
    } catch (e) {
      set({
        status: { ...DEFAULT_STATUS, error: String(e) },
        loading: false,
      });
      return false;
    }
  },

  stop: async () => {
    if (!isTauri()) return;
    set({ loading: true });
    try {
      const status = await invoke<LocalLLMStatus>('stop_local_llm');
      set({ status, loading: false });
    } catch {
      set({ status: DEFAULT_STATUS, loading: false });
    }
  },

  checkHealth: async () => {
    if (!isTauri()) return;
    try {
      const status = await invoke<LocalLLMStatus>('check_local_llm_health');
      set({ status });
    } catch {
      // 静默失败
    }
  },

  setModelPath: (path) => set({ modelPath: path }),
  setContextSize: (size) => set({ contextSize: size }),
  setThreads: (threads) => set({ threads }),
}));
