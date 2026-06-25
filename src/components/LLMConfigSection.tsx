// LLM 配置分区 - 设置面板中的 LLM 服务商/密钥配置
import { useState, useEffect } from 'react';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { PROVIDER_PRESETS } from '@/lib/llm/types';
import type { LLMProvider } from '@/lib/llm/types';

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
      <div className="text-[11px] text-text-secondary">AI 模型配置</div>

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
        密钥通过 Windows Credential Manager 安全存储，不会明文保存。
        配置信息保存在本地 SQLite 数据库中。
      </div>
    </div>
  );
}
