// API Key Store - 管理 LLM 服务商配置和密钥
// 密钥通过 keyring 安全存储（Windows Credential Manager）
// 非敏感配置（provider/baseUrl/model）存储在 SQLite user_preferences
// 浏览器降级：密钥存 sessionStorage（关闭浏览器即清除，降低持久化泄露风险）

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/env';
import { getPreference, setPreference } from '@/lib/sqlite';
import type { LLMProvider, ProviderConfig } from '@/lib/llm/types';
import { PROVIDER_PRESETS } from '@/lib/llm/types';
import { getAdapter } from '@/lib/llm';

const PREF_KEY = 'llm_config';
// P1-3 安全：浏览器模式从 localStorage 改为 sessionStorage，关闭浏览器即清除
const SS_APIKEY_PREFIX = 'llm_apikey_';

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
        // 本地模型不需要 API Key
        if (config.provider === 'local') {
          hasApiKey = true;
        } else if (isTauri()) {
          const key = await invoke<string | null>('load_api_key', {
            provider: config.provider,
          });
          hasApiKey = !!key;
        } else {
          hasApiKey = !!sessionStorage.getItem(SS_APIKEY_PREFIX + config.provider);
        }
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
    if (isTauri()) {
      await invoke('save_api_key', {
        provider: config.provider,
        apiKey,
      });
    } else {
      // P1-3 安全：浏览器降级存入 sessionStorage，关闭浏览器即清除
      sessionStorage.setItem(SS_APIKEY_PREFIX + config.provider, apiKey);
    }
    set({ hasApiKey: true });
  },

  getApiKey: async () => {
    const { config } = get();
    if (!config) return null;
    if (isTauri()) {
      return invoke<string | null>('load_api_key', { provider: config.provider });
    }
    // P1-3 安全：浏览器降级从 sessionStorage 读取
    return sessionStorage.getItem(SS_APIKEY_PREFIX + config.provider);
  },

  deleteApiKey: async () => {
    const { config } = get();
    if (!config) return;
    if (isTauri()) {
      await invoke('delete_api_key', { provider: config.provider });
    } else {
      // P1-3 安全：浏览器降级从 sessionStorage 删除
      sessionStorage.removeItem(SS_APIKEY_PREFIX + config.provider);
    }
    set({ hasApiKey: false });
  },

  testConnection: async () => {
    const { config } = get();
    if (!config) return false;

    set({ testing: true, testResult: 'idle' });
    try {
      // 本地模型不需要 API Key
      const apiKey = config.provider === 'local' ? '' : await get().getApiKey();
      if (config.provider !== 'local' && !apiKey) {
        set({ testing: false, testResult: 'fail' });
        return false;
      }

      const adapter = getAdapter(config.provider);
      const ok = await adapter.testConnection(apiKey || '', config.baseUrl);
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
