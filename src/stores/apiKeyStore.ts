// API Key Store - 管理 LLM 服务商配置和密钥
// 密钥通过 keyring 安全存储（Windows Credential Manager）
// 非敏感配置（provider/baseUrl/model）存储在 SQLite user_preferences

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getPreference, setPreference } from '@/lib/sqlite';
import type { LLMProvider, ProviderConfig } from '@/lib/llm/types';
import { PROVIDER_PRESETS } from '@/lib/llm/types';
import { getAdapter } from '@/lib/llm';

const PREF_KEY = 'llm_config';

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
}

interface ApiKeyState {
  config: LLMConfig | null;
  hasApiKey: boolean;
  loading: boolean;
  testing: boolean;
  testResult: 'idle' | 'success' | 'fail';

  load: () => Promise<void>;
  saveConfig: (config: LLMConfig) => Promise<void>;
  saveApiKey: (apiKey: string) => Promise<void>;
  getApiKey: () => Promise<string | null>;
  deleteApiKey: () => Promise<void>;
  testConnection: () => Promise<boolean>;
  getProviderPreset: () => ProviderConfig | undefined;
}

export const useApiKeyStore = create<ApiKeyState>((set, get) => ({
  config: null,
  hasApiKey: false,
  loading: false,
  testing: false,
  testResult: 'idle',

  load: async () => {
    set({ loading: true });
    try {
      const raw = await getPreference<string>(PREF_KEY, '');
      let config: LLMConfig | null = null;
      if (raw) {
        try {
          config = JSON.parse(raw);
        } catch {
          config = null;
        }
      }

      let hasApiKey = false;
      if (config) {
        const key = await invoke<string | null>('load_api_key', {
          provider: config.provider,
        });
        hasApiKey = !!key;
      }

      set({ config, hasApiKey, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  saveConfig: async (config: LLMConfig) => {
    await setPreference(PREF_KEY, JSON.stringify(config));
    set({ config });
  },

  saveApiKey: async (apiKey: string) => {
    const { config } = get();
    if (!config) throw new Error('未配置 LLM 服务商');
    await invoke('save_api_key', {
      provider: config.provider,
      apiKey,
    });
    set({ hasApiKey: true });
  },

  getApiKey: async () => {
    const { config } = get();
    if (!config) return null;
    return invoke<string | null>('load_api_key', { provider: config.provider });
  },

  deleteApiKey: async () => {
    const { config } = get();
    if (!config) return;
    await invoke('delete_api_key', { provider: config.provider });
    set({ hasApiKey: false });
  },

  testConnection: async () => {
    const { config } = get();
    if (!config) return false;

    set({ testing: true, testResult: 'idle' });
    try {
      const apiKey = await get().getApiKey();
      if (!apiKey) {
        set({ testing: false, testResult: 'fail' });
        return false;
      }

      const adapter = getAdapter(config.provider);
      const ok = await adapter.testConnection(apiKey, config.baseUrl);
      set({ testing: false, testResult: ok ? 'success' : 'fail' });
      return ok;
    } catch {
      set({ testing: false, testResult: 'fail' });
      return false;
    }
  },

  getProviderPreset: () => {
    const { config } = get();
    if (!config) return undefined;
    return PROVIDER_PRESETS.find((p) => p.provider === config.provider);
  },
}));
