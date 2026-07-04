// LLM 配置分区 - 设置面板中的 LLM 服务商/密钥配置
import { useState, useEffect } from 'react';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { PROVIDER_PRESETS } from '@/lib/llm/types';
import type { LLMProvider } from '@/lib/llm/types';
import { isTauri } from '@/lib/env';

export function LLMConfigSection() {
  const {
    config,
    hasApiKey,
    loading,
    testing,
    testResult,
    load,
    saveConfig,
    saveApiKey,
    deleteApiKey,
    testConnection,
  } = useApiKeyStore();

  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [provider, setProvider] = useState<LLMProvider>(config?.provider ?? 'deepseek');
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
    }
  }, [config]);

  const preset = PROVIDER_PRESETS.find((p) => p.provider === provider);

  const onProviderChange = (p: LLMProvider) => {
    setProvider(p);
    const pre = PROVIDER_PRESETS.find((x) => x.provider === p);
    if (pre) {
      setBaseUrl(pre.baseUrl);
      setModel(pre.defaultModel);
    }
  };

  const onSave = async () => {
    setError(null);
    try {
      await saveConfig({ provider, baseUrl, model });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存配置失败');
    }
  };

  const onSaveKey = async () => {
    if (!apiKeyInput.trim()) return;
    setError(null);
    try {
      await saveApiKey(apiKeyInput.trim());
      setApiKeyInput('');
      setShowKeyInput(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存密钥失败');
    }
  };

  const onDeleteKey = async () => {
    setError(null);
    try {
      await deleteApiKey();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除密钥失败');
    }
  };

  const onTest = async () => {
    await testConnection();
  };

  if (loading) {
    return (
      <div className="text-[11px] text-text-secondary py-2">加载中…</div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 标题行：「可选」徽章 + 当前模式 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-secondary">AI 模型配置</span>
          {/* 可选标识：明确告诉用户不配置也能用 */}
          <span className="px-1.5 py-0.5 text-[9px] rounded bg-surface-3 text-text-tertiary border border-border-light">
            可选
          </span>
        </div>
        {/* 当前模式徽章 */}
        <span
          className={`px-2 py-0.5 text-[10px] rounded-full border ${
            hasApiKey
              ? 'bg-semantic-success/10 text-semantic-success border-semantic-success/30'
              : 'bg-surface-2 text-text-tertiary border-border'
          }`}
        >
          {hasApiKey ? '智能模式' : '基础模式'}
        </span>
      </div>

      {/* 模式说明：让用户清楚两种模式的差异 */}
      <div className="px-3 py-2 rounded-btn bg-surface-2 border border-border text-[10px] text-text-tertiary leading-relaxed">
        {hasApiKey ? (
          <>
            已启用 LLM 智能增强：意图分析、动态追问、图片拆解等高级功能可用。
            <br />
            移除密钥后将自动降级到基础模式，仍可正常使用核心提问流程。
          </>
        ) : (
          <>
            <span className="text-text-secondary">当前为基础模式，无需配置即可使用核心功能。</span>
            <br />
            配置 LLM 后可获得：智能意图分析、动态追问题、图片提示词拆解等高级能力。
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 rounded-btn bg-semantic-error/10 border border-semantic-error/30 text-semantic-error text-[10px]">
          {error}
        </div>
      )}

      {/* 服务商选择 */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">服务商</div>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as LLMProvider)}
          className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label} - {p.description}
            </option>
          ))}
        </select>
      </div>

      {/* Base URL */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">API 地址</div>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
        />
      </div>

      {/* 模型选择 */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">模型</div>
        {preset && preset.models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
          >
            {preset.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {model && !preset.models.includes(model) && (
              <option value={model}>{model}</option>
            )}
          </select>
        ) : (
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="模型名称"
            className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
          />
        )}
      </div>

      {/* 保存配置按钮 */}
      <button
        onClick={onSave}
        className="w-full px-3 py-1.5 text-xs rounded-btn bg-brand-soft text-brand hover:bg-brand/20 transition-colors font-medium"
      >
        {saved ? '已保存 ✓' : '保存配置'}
      </button>

      {/* API Key 管理 */}
      <div className="pt-2 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-text-tertiary">API 密钥</span>
          <span className={`text-[10px] ${hasApiKey ? 'text-semantic-success' : 'text-text-tertiary'}`}>
            {hasApiKey ? '已设置' : '未设置'}
          </span>
        </div>

        {showKeyInput ? (
          <div className="space-y-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="输入 API Key..."
              className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={onSaveKey}
                className="flex-1 px-3 py-1.5 text-xs rounded-btn bg-brand text-white hover:bg-brand-strong transition-colors"
              >
                保存密钥
              </button>
              <button
                onClick={() => { setShowKeyInput(false); setApiKeyInput(''); }}
                className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-secondary hover:text-text-primary transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setShowKeyInput(true)}
              className="flex-1 px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-surface-2 transition-colors"
            >
              {hasApiKey ? '更换密钥' : '设置密钥'}
            </button>
            {hasApiKey && (
              <button
                onClick={onDeleteKey}
                className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-tertiary hover:text-semantic-error transition-colors"
              >
                删除
              </button>
            )}
          </div>
        )}

        {/* 测试连接 */}
        {hasApiKey && (
          <button
            onClick={onTest}
            disabled={testing}
            className={`w-full mt-2 px-3 py-1.5 text-xs rounded-btn transition-colors ${
              testResult === 'success'
                ? 'bg-semantic-success/20 text-semantic-success'
                : testResult === 'fail'
                ? 'bg-semantic-error/20 text-semantic-error'
                : 'border border-border text-text-primary hover:bg-surface-2'
            } disabled:opacity-50`}
          >
            {testing ? '测试中…' : testResult === 'success' ? '连接成功 ✓' : testResult === 'fail' ? '连接失败 ✗' : '测试连接'}
          </button>
        )}
      </div>

      <div className="text-[10px] text-text-tertiary leading-relaxed">
        {isTauri() ? (
          <>
            密钥通过 Windows Credential Manager 安全存储，不会明文保存。配置信息保存在本地 SQLite 数据库中。
            <br />
            <span className="text-text-tertiary">
              ⚠️ 出于安全考虑，仅支持预设服务商（DeepSeek/OpenAI/通义千问）与本地地址（http://localhost:* / http://127.0.0.1:*）。
              自定义 HTTPS 服务商当前不在 CSP 白名单内，会被浏览器引擎拦截。
            </span>
          </>
        ) : (
          <>
            ⚠️ 浏览器演示模式：密钥存储在浏览器 sessionStorage 中（关闭浏览器即清除），仅供本地演示使用。
            桌面版会通过 Windows Credential Manager 安全存储。
          </>
        )}
        <br />
        <span className="text-text-tertiary">
          💡 不配置 LLM 也能完整使用核心提问流程，配置后可获得智能增强。
        </span>
      </div>
    </div>
  );
}
