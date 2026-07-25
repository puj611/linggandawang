// Local LLM Store - 管理本地 llama-server sidecar 状态
// 通过 Tauri invoke 与 Rust 后端通信
// M10 增强：健康检查轮询 + 崩溃自动检测 + 重试启动

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/env';

const HEALTH_POLL_INTERVAL_MS = 30_000;
const AUTO_RESTART_DELAY_MS = 2_000;
const MAX_AUTO_RESTART_ATTEMPTS = 3;

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
  /** 自动重启剩余次数（防止无限重启循环） */
  autoRestartAttempts: number;

  loadStatus: () => Promise<void>;
  start: (modelPath?: string) => Promise<boolean>;
  stop: () => Promise<void>;
  checkHealth: () => Promise<void>;
  /** 启动健康检查轮询（应用启动时调用一次） */
  startHealthPolling: () => void;
  /** 停止健康检查轮询 */
  stopHealthPolling: () => void;
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

let healthPollTimer: ReturnType<typeof setInterval> | null = null;

export const useLocalLLMStore = create<LocalLLMState>((set, get) => ({
  status: null,
  loading: false,
  modelPath: '',
  contextSize: 2048,
  threads: 0,
  autoRestartAttempts: MAX_AUTO_RESTART_ATTEMPTS,

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
      set({ status, loading: false, modelPath: path, autoRestartAttempts: MAX_AUTO_RESTART_ATTEMPTS });
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

  startHealthPolling: () => {
    if (healthPollTimer) return;
    healthPollTimer = setInterval(async () => {
      const { status, autoRestartAttempts, modelPath, start: startLLM } = get();
      if (!status?.running) return;

      await get().checkHealth();

      // 检查健康检查后是否仍运行
      const afterHealth = get().status;
      if (afterHealth?.running === false && afterHealth?.error === '进程已退出') {
        // 进程崩溃了，尝试自动重启
        if (autoRestartAttempts > 0 && modelPath) {
          console.warn(`[LocalLLM] 进程崩溃，${AUTO_RESTART_DELAY_MS}ms 后自动重启（剩余 ${autoRestartAttempts} 次）`);
          set({ autoRestartAttempts: autoRestartAttempts - 1 });
          setTimeout(() => {
            startLLM(modelPath);
          }, AUTO_RESTART_DELAY_MS);
        }
      }
    }, HEALTH_POLL_INTERVAL_MS);
  },

  stopHealthPolling: () => {
    if (healthPollTimer) {
      clearInterval(healthPollTimer);
      healthPollTimer = null;
    }
  },
}));
