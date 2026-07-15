// LLM 配置分区 - 设置面板中的 LLM 服务商/密钥配置
// 支持云端 API 和本地 llama-server sidecar
import { useState, useEffect, useCallback } from 'react';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useLocalLLMStore } from '@/stores/localLLMStore';
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

  const {
    status: localStatus,
    loading: localLoading,
    modelPath,
    contextSize,
    threads,
    loadStatus,
    start: startLocal,
    stop: stopLocal,
    setModelPath,
    setContextSize,
    setThreads,
  } = useLocalLLMStore();

  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [provider, setProvider] = useState<LLMProvider>(config?.provider ?? 'deepseek');
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocal = provider === 'local';

  useEffect(() => {
    load();
    loadStatus();
  }, [load, loadStatus]);

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
    }
  }, [config]);

  const preset = PROVIDER_PRESETS.find((p) => p.provider === provider);

  const onPickModelFile = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'GGUF Model', extensions: ['gguf'] }],
      });
      if (selected) {
        setModelPath(selected as string);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择文件失败');
    }
  }, [setModelPath]);

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

      {/* 本地模型专属配置 */}
      {isLocal ? (
        <LocalModelConfig
          modelPath={modelPath}
          contextSize={contextSize}
          threads={threads}
          status={localStatus}
          loading={localLoading}
          onPickFile={onPickModelFile}
          onSetModelPath={setModelPath}
          onSetContextSize={setContextSize}
          onSetThreads={setThreads}
          onStart={startLocal}
          onStop={stopLocal}
        />
      ) : (
        <>
          {/* 云端模型配置 */}
          <div>
            <div className="text-[10px] text-text-tertiary mb-1">API 地址</div>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
            />
          </div>

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
        </>
      )}

      <div className="text-[10px] text-text-tertiary leading-relaxed">
        {isLocal ? (
          <>
            本地模型通过 llama.cpp 推理，数据不出机器，零 API 成本。
            <br />
            首次使用需下载 GGUF 格式模型文件（推荐 Qwen2.5 1.5B，约 1.2GB）。
            <br />
            需要安装 llama.cpp 并确保 llama-server 可执行文件在 PATH 中。
          </>
        ) : isTauri() ? (
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

// 本地模型配置子组件
function LocalModelConfig({
  modelPath,
  contextSize,
  threads,
  status,
  loading,
  onPickFile,
  onSetModelPath,
  onSetContextSize,
  onSetThreads,
  onStart,
  onStop,
}: {
  modelPath: string;
  contextSize: number;
  threads: number;
  status: { running: boolean; port: number; pid: number | null; error: string | null } | null;
  loading: boolean;
  onPickFile: () => void;
  onSetModelPath: (path: string) => void;
  onSetContextSize: (size: number) => void;
  onSetThreads: (threads: number) => void;
  onStart: (modelPath?: string) => Promise<boolean>;
  onStop: () => Promise<void>;
}) {
  const isRunning = status?.running ?? false;

  return (
    <div className="space-y-3">
      {/* 模型文件选择 */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">GGUF 模型文件</div>
        <div className="flex gap-2">
          <input
            value={modelPath}
            onChange={(e) => onSetModelPath(e.target.value)}
            placeholder="选择 .gguf 模型文件..."
            className="flex-1 bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
          />
          <button
            onClick={onPickFile}
            className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-surface-2 transition-colors"
          >
            浏览
          </button>
        </div>
      </div>

      {/* 上下文长度 */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">上下文长度</div>
        <select
          value={contextSize}
          onChange={(e) => onSetContextSize(Number(e.target.value))}
          className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
        >
          <option value={1024}>1024（低内存）</option>
          <option value={2048}>2048（推荐）</option>
          <option value={4096}>4096</option>
          <option value={8192}>8192（高内存）</option>
        </select>
      </div>

      {/* CPU 线程数 */}
      <div>
        <div className="text-[10px] text-text-tertiary mb-1">CPU 线程数</div>
        <select
          value={threads}
          onChange={(e) => onSetThreads(Number(e.target.value))}
          className="w-full bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
        >
          <option value={0}>自动检测</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </div>

      {/* 服务状态 */}
      <div className="px-3 py-2 rounded-btn bg-surface-2 border border-border">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">服务状态</span>
          <span className={`text-[10px] ${isRunning ? 'text-semantic-success' : 'text-text-tertiary'}`}>
            {isRunning ? `运行中 (端口 ${status?.port})` : '未启动'}
          </span>
        </div>
        {status?.pid && (
          <div className="text-[9px] text-text-tertiary mt-1">PID: {status.pid}</div>
        )}
        {status?.error && (
          <div className="text-[9px] text-semantic-error mt-1">{status.error}</div>
        )}
      </div>

      {/* 启动/停止按钮 */}
      <div className="flex gap-2">
        <button
          onClick={() => onStart()}
          disabled={loading || !modelPath || isRunning}
          className={`flex-1 px-3 py-1.5 text-xs rounded-btn transition-colors ${
            isRunning
              ? 'bg-surface-3 text-text-tertiary cursor-not-allowed'
              : 'bg-semantic-success text-white hover:bg-semantic-success/80'
          } disabled:opacity-50`}
        >
          {loading ? '启动中…' : isRunning ? '运行中' : '启动服务'}
        </button>
        {isRunning && (
          <button
            onClick={onStop}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-btn border border-semantic-error text-semantic-error hover:bg-semantic-error/10 transition-colors disabled:opacity-50"
          >
            停止
          </button>
        )}
      </div>

      {/* 推荐模型提示 */}
      {!modelPath && (
        <div className="text-[9px] text-text-tertiary leading-relaxed">
          推荐模型：Qwen2.5 1.5B Instruct（Q4_K_M 量化，约 1.2GB，中文友好）
          <br />
          下载地址：huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF
        </div>
      )}
    </div>
  );
}
