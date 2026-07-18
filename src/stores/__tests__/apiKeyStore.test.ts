// src/stores/__tests__/apiKeyStore.test.ts
// 测试 apiKeyStore 在 Web 预览模式下的 API Key 存取行为
// 覆盖所有 5 个 provider: openai / deepseek / tongyi / xiaomi / custom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock env 模块：默认模拟 Web 预览模式（isTauri = false）
vi.mock('@/lib/env', () => ({
  isTauri: () => false,
  isBrowser: () => true,
}));

// Mock @tauri-apps/api/core：Web 模式下 invoke 不应被调用
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock sqlite：模拟 Web 模式下的 localStorage fallback
const LS_PREF_PREFIX = 'sqlite_pref_';
vi.mock('@/lib/sqlite', () => ({
  getPreference: async <T,>(key: string, defaultValue: T): Promise<T> => {
    const raw = localStorage.getItem(LS_PREF_PREFIX + key);
    if (raw === null) return defaultValue;
    try { return JSON.parse(raw) as T; } catch { return defaultValue; }
  },
  setPreference: async (key: string, value: unknown): Promise<void> => {
    localStorage.setItem(LS_PREF_PREFIX + key, JSON.stringify(value));
  },
}));

import { useApiKeyStore } from '../apiKeyStore';
import { PROVIDER_PRESETS } from '@/lib/llm/types';

const WEB_API_KEY_PREFIX = 'linggandawang_apikey_';

describe('apiKeyStore - Web 预览模式', () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    // 重置 store 状态
    useApiKeyStore.setState({
      config: null,
      hasApiKey: false,
      loading: false,
      testing: false,
      testResult: 'idle',
      lastError: null,
      webKeyNotice: '当前为 Web 预览模式，API Key 仅临时保存在浏览器 localStorage 中；桌面端会写入系统安全钥匙串。',
    });
  });

  describe('webKeyNotice 提示', () => {
    it('Web 模式下应显示安全提示', () => {
      const state = useApiKeyStore.getState();
      expect(state.webKeyNotice).not.toBeNull();
      expect(state.webKeyNotice).toContain('Web 预览');
    });
  });

  describe('所有 provider 的 API Key 存取', () => {
    const testCases = PROVIDER_PRESETS.map((p) => ({
      provider: p.provider,
      label: p.label,
      baseUrl: p.baseUrl || 'https://custom.example.com/v1',
      model: p.defaultModel || 'custom-model',
      apiKey: `sk-test-${p.provider}-12345`,
    }));

    for (const tc of testCases) {
      it(`${tc.label} (${tc.provider}): 保存 API Key 到 localStorage`, async () => {
        // 先保存配置
        await useApiKeyStore.getState().saveConfig({
          provider: tc.provider as never,
          baseUrl: tc.baseUrl,
          model: tc.model,
        });

        // 保存 API Key
        await useApiKeyStore.getState().saveApiKey(tc.apiKey);

        // 验证写入了 localStorage
        const stored = localStorage.getItem(WEB_API_KEY_PREFIX + tc.provider);
        expect(stored).toBe(tc.apiKey);

        // 验证 hasApiKey 状态
        expect(useApiKeyStore.getState().hasApiKey).toBe(true);

        // 验证没有调用 Tauri invoke
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it(`${tc.label} (${tc.provider}): 读取已保存的 API Key`, async () => {
        // 先写入 localStorage
        localStorage.setItem(WEB_API_KEY_PREFIX + tc.provider, tc.apiKey);

        // 设置 config
        await useApiKeyStore.getState().saveConfig({
          provider: tc.provider as never,
          baseUrl: tc.baseUrl,
          model: tc.model,
        });

        // 读取
        const key = await useApiKeyStore.getState().getApiKey();
        expect(key).toBe(tc.apiKey);
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it(`${tc.label} (${tc.provider}): 删除 API Key`, async () => {
        // 先写入
        localStorage.setItem(WEB_API_KEY_PREFIX + tc.provider, tc.apiKey);

        // 设置 config
        await useApiKeyStore.getState().saveConfig({
          provider: tc.provider as never,
          baseUrl: tc.baseUrl,
          model: tc.model,
        });

        useApiKeyStore.setState({ hasApiKey: true });

        // 删除
        await useApiKeyStore.getState().deleteApiKey();

        // 验证 localStorage 已清空
        expect(localStorage.getItem(WEB_API_KEY_PREFIX + tc.provider)).toBeNull();
        expect(useApiKeyStore.getState().hasApiKey).toBe(false);
        expect(mockInvoke).not.toHaveBeenCalled();
      });
    }
  });

  describe('load() 在 Web 模式下', () => {
    it('localStorage 有 key 时 hasApiKey 应为 true', async () => {
      // 先保存配置（会写入 mock 的 localStorage）
      await useApiKeyStore.getState().saveConfig({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });
      // 写入 API Key 到 localStorage
      localStorage.setItem(WEB_API_KEY_PREFIX + 'deepseek', 'sk-test-load-12345');

      await useApiKeyStore.getState().load();

      expect(useApiKeyStore.getState().hasApiKey).toBe(true);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('localStorage 无 key 时 hasApiKey 应为 false', async () => {
      localStorage.clear();

      await useApiKeyStore.getState().load();

      expect(useApiKeyStore.getState().hasApiKey).toBe(false);
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('saveApiKey 边界校验', () => {
    it('空 API Key 应抛出错误', async () => {
      await useApiKeyStore.getState().saveConfig({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });

      await expect(useApiKeyStore.getState().saveApiKey('')).rejects.toThrow('不能为空');
    });

    it('过短 API Key（<5 字符）应抛出错误', async () => {
      await useApiKeyStore.getState().saveConfig({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });

      await expect(useApiKeyStore.getState().saveApiKey('ab')).rejects.toThrow('长度过短');
    });

    it('未配置服务商时保存 key 应抛出错误', async () => {
      useApiKeyStore.setState({ config: null });
      await expect(useApiKeyStore.getState().saveApiKey('sk-test-12345')).rejects.toThrow('未配置');
    });
  });

  describe('切换 provider 时 API Key 隔离性', () => {
    it('不同 provider 的 key 互不干扰', async () => {
      // 保存 deepseek 的 key
      await useApiKeyStore.getState().saveConfig({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });
      await useApiKeyStore.getState().saveApiKey('sk-deepseek-secret-12345');

      // 切换到 xiaomi，保存不同 key
      await useApiKeyStore.getState().saveConfig({
        provider: 'xiaomi',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2.5-pro',
      });
      await useApiKeyStore.getState().saveApiKey('sk-xiaomi-secret-67890');

      // 验证两个 key 都在 localStorage 中
      expect(localStorage.getItem(WEB_API_KEY_PREFIX + 'deepseek')).toBe('sk-deepseek-secret-12345');
      expect(localStorage.getItem(WEB_API_KEY_PREFIX + 'xiaomi')).toBe('sk-xiaomi-secret-67890');

      // 切回 deepseek，key 应该还在
      await useApiKeyStore.getState().saveConfig({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });
      const deepseekKey = await useApiKeyStore.getState().getApiKey();
      expect(deepseekKey).toBe('sk-deepseek-secret-12345');
    });
  });

  describe('PROVIDER_PRESETS 完整性', () => {
    it('应包含 5 个预设（含小米 MiMo）', () => {
      expect(PROVIDER_PRESETS).toHaveLength(5);
      const providers = PROVIDER_PRESETS.map((p) => p.provider);
      expect(providers).toContain('openai');
      expect(providers).toContain('deepseek');
      expect(providers).toContain('tongyi');
      expect(providers).toContain('xiaomi');
      expect(providers).toContain('custom');
    });

    it('小米 MiMo 预设配置正确', () => {
      const xiaomi = PROVIDER_PRESETS.find((p) => p.provider === 'xiaomi');
      expect(xiaomi).toBeDefined();
      expect(xiaomi!.label).toBe('小米 MiMo');
      expect(xiaomi!.baseUrl).toBe('https://api.xiaomimimo.com/v1');
      expect(xiaomi!.models.length).toBeGreaterThanOrEqual(1);
    });
  });
});
