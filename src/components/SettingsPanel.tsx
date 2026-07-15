// src/components/SettingsPanel.tsx
// 设置面板：通用设置 + 词簇分析
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useContextStore } from '@/stores/contextStore';
import { useFeatureStore } from '@/stores/featureStore';
import type { FeatureFlags } from '@/stores/featureStore';
import { questionLoader } from '@/engine/QuestionLoader';
import { getHotkey, setHotkey } from '@/hooks/useHotkey';
import { isTauri } from '@/lib/env';
import { ClusterAnalyticsPanel } from './ClusterAnalyticsPanel';
import { LLMConfigSection } from './LLMConfigSection';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { setPreference } from '@/lib/sqlite';
import { useVectorStore } from '@/hooks/useVectorStore';

type TabKey = 'general' | 'analytics';

// 与 App.tsx 约定的跨组件事件名：派发此事件可重新唤起引导遮罩
const ONBOARDING_SHOW_EVENT = 'show-onboarding';
const ONBOARDING_SEEN_KEY = 'onboarding_seen';

export function SettingsPanel() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const ctxStore = useContextStore();
  const screenshotDiagnosis = useFeatureStore((s) => s.screenshotDiagnosis);
  const setFeatures = useFeatureStore((s) => s.set);
  const hasApiKey = useApiKeyStore((s) => s.hasApiKey);
  const features = { screenshotDiagnosis, set: setFeatures };
  const [tab, setTab] = useState<TabKey>('general');
  const [hotkey, setHotkeyState] = useState(getHotkey());
  const [recording, setRecording] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [bankReloaded, setBankReloaded] = useState(false);
  // LLM 高级功能分区默认折叠（基础模式）/ 默认展开（智能模式）
  const [llmExpanded, setLlmExpanded] = useState(hasApiKey);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const startRecordHotkey = () => {
    setRecording(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const parts: string[] = [];
      if (e.altKey) parts.push('Alt');
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      let main = e.key;
      if (e.code === 'Space') main = 'Space';
      parts.push(main);
      const k = parts.join('+');
      setHotkey(k);
      setHotkeyState(k);
      setRecording(false);
      document.removeEventListener('keydown', handler);
    };
    document.addEventListener('keydown', handler);
    cleanupRef.current = () => { document.removeEventListener('keydown', handler); };
    return cleanupRef.current;
  };

  const onClearContext = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await ctxStore.clear();
    setConfirmClear(false);
  };

  // P1.5 其他改进：导出 context.json 为本地文件
  const onExportContext = () => {
    const ctx = ctxStore.ctx;
    const json = JSON.stringify(ctx, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `linggandawang-context-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onReloadBank = () => {
    questionLoader.reload();
    setBankReloaded(true);
    setTimeout(() => setBankReloaded(false), 1500);
  };

  // 重新查看新手引导：重置标记并派发事件让 App.tsx 显示遮罩
  const onShowOnboarding = () => {
    void setPreference(ONBOARDING_SEEN_KEY, '');
    window.dispatchEvent(new CustomEvent(ONBOARDING_SHOW_EVENT));
    closeSettings();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60"
      style={{ zIndex: 10000 }}
      data-no-drag
      onClick={closeSettings}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-card border border-border rounded-card shadow-popover flex flex-col overflow-hidden"
        style={{ width: tab === 'analytics' ? 560 : 400, height: tab === 'analytics' ? 600 : 'auto', maxHeight: '80vh' }}
      >
        {tab === 'general' ? (
          <GeneralSettings
            hotkey={hotkey}
            recording={recording}
            confirmClear={confirmClear}
            bankReloaded={bankReloaded}
            features={features}
            closeSettings={closeSettings}
            startRecordHotkey={startRecordHotkey}
            onClearContext={onClearContext}
            onReloadBank={onReloadBank}
            onShowOnboarding={onShowOnboarding}
            onSwitchTab={setTab}
            contextPreview={ctxStore.ctx}
            onExportContext={onExportContext}
            llmExpanded={llmExpanded}
            onToggleLlmExpanded={() => setLlmExpanded((v) => !v)}
            hasApiKey={hasApiKey}
          />
        ) : (
          <ClusterAnalyticsPanel onBack={() => setTab('general')} />
        )}
      </div>
    </div>
  );
}

interface GeneralProps {
  hotkey: string;
  recording: boolean;
  confirmClear: boolean;
  bankReloaded: boolean;
  features: { screenshotDiagnosis: boolean; set: (p: Partial<FeatureFlags>) => void };
  closeSettings: () => void;
  startRecordHotkey: () => void;
  onClearContext: () => void;
  onReloadBank: () => void;
  onShowOnboarding: () => void;
  onSwitchTab: (k: TabKey) => void;
  // P1.5 其他改进：上下文预览数据与导出回调
  contextPreview: import('@/types/context').LinggandawangContext;
  onExportContext: () => void;
  // LLM 高级功能分区折叠状态
  llmExpanded: boolean;
  onToggleLlmExpanded: () => void;
  hasApiKey: boolean;
}

function GeneralSettings({
  hotkey, recording, confirmClear, bankReloaded, features, closeSettings,
  startRecordHotkey, onClearContext, onReloadBank, onShowOnboarding, onSwitchTab,
  contextPreview, onExportContext, llmExpanded, onToggleLlmExpanded, hasApiKey,
}: GeneralProps) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-text-primary text-sm font-medium">设置</span>
        <button
          onClick={closeSettings}
          className="text-text-secondary hover:text-text-primary"
        >
          ×
        </button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto">
        {/* 热键自定义（仅桌面版可用） */}
        {isTauri() && (
        <div>
          <div className="text-[11px] text-text-secondary mb-1">全局热键</div>
          <div className="flex gap-2">
            <input
              value={hotkey}
              readOnly
              className="flex-1 bg-bg-main border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary"
            />
            <button
              onClick={startRecordHotkey}
              className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors"
            >
              {recording ? '录制中…' : '修改'}
            </button>
          </div>
          <div className="text-[10px] text-text-secondary mt-1">
            全局热键由 Tauri 注册，Alt+Shift+Space 唤起/隐藏窗口
          </div>
        </div>
        )}

        {/* 截图诊断开关 */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-secondary">截图诊断</span>
            <button
              onClick={() => features.set({ screenshotDiagnosis: !features.screenshotDiagnosis })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                features.screenshotDiagnosis ? 'bg-brand' : 'bg-surface-3'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  features.screenshotDiagnosis ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="text-[10px] text-text-secondary mt-1">
            关闭后截图按钮置灰，提问引擎插入兜底问题
          </div>
        </div>

        {/* AI 模型配置（高级功能，可折叠） */}
        <div className="pt-3 border-t border-border">
          {/* 折叠标题栏：点击展开/收起 */}
          <button
            onClick={onToggleLlmExpanded}
            className="w-full flex items-center justify-between text-left group"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-secondary">高级功能</span>
              <span
                className={`px-1.5 py-0.5 text-[9px] rounded border ${
                  hasApiKey
                    ? 'bg-semantic-success/10 text-semantic-success border-semantic-success/30'
                    : 'bg-surface-3 text-text-tertiary border-border-light'
                }`}
              >
                {hasApiKey ? '已启用' : '可选'}
              </span>
              {!hasApiKey && (
                <span className="text-[10px] text-text-tertiary">
                  · 不配置也能用核心功能
                </span>
              )}
            </div>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-text-tertiary transition-transform group-hover:text-text-secondary ${
                llmExpanded ? 'rotate-180' : ''
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {/* 折叠内容 */}
          {llmExpanded && (
            <div className="mt-3 space-y-3">
              <LLMConfigSection />
              <RAGStatusSection />
            </div>
          )}
        </div>

        {/* 词簇分析入口 */}
        <div>
          <button
            onClick={() => onSwitchTab('analytics')}
            className="w-full px-3 py-2 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              词簇命中分析
            </span>
            <span className="text-text-tertiary">→</span>
          </button>
          <div className="text-[10px] text-text-secondary mt-1">
            查看模糊词识别命中率、簇分布、最近命中记录
          </div>
        </div>

        {/* 刷新问题库 */}
        <div>
          <button
            onClick={onReloadBank}
            className="w-full px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors"
          >
            {bankReloaded ? '已刷新 ✓' : '刷新问题库'}
          </button>
        </div>

        {/* 重新查看新手引导（P1.4） */}
        <div>
          <button
            onClick={onShowOnboarding}
            className="w-full px-3 py-1.5 text-xs rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            重新查看新手引导
          </button>
          <div className="text-[10px] text-text-secondary mt-1">
            重看 3 步使用流程和热键
          </div>
        </div>

        {/* 上下文管理（P1.5 其他改进）：预览 / 清空 / 导出 */}
        <div className="pt-3 border-t border-border">
          <div className="text-[11px] text-text-secondary mb-1.5">上下文管理</div>
          {/* 概要 */}
          <div className="text-[10px] text-text-tertiary mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>项目：{contextPreview.project?.name || contextPreview.project?.path || '未绑定'}</span>
            <span>最近问答：{contextPreview.recent_qa?.length ?? 0} 条</span>
            <span>意图标签：{contextPreview.intent_tags?.length ?? 0} 个</span>
          </div>
          <div className="text-[10px] text-text-tertiary mb-1.5">
            最后更新：{contextPreview.timestamps?.updated_at
              ? new Date(contextPreview.timestamps.updated_at).toLocaleString('zh-CN')
              : '未知'}
          </div>
          {/* JSON 预览（截断显示，避免过长） */}
          <pre className="bg-bg-main border border-border rounded-btn p-2 max-h-32 overflow-auto text-[10px] text-text-tertiary whitespace-pre-wrap break-all font-mono">
{(() => {
  const raw = JSON.stringify(contextPreview, null, 2);
  return raw.length > 800 ? raw.slice(0, 800) + '\n…（截断，导出查看完整）' : raw;
})()}
          </pre>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onExportContext}
              className="flex-1 px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors"
            >
              导出 .json
            </button>
            <button
              onClick={onClearContext}
              className={`flex-1 px-3 py-1.5 text-xs rounded-btn transition-colors ${
                confirmClear
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {confirmClear ? '再次点击确认' : '清空上下文'}
            </button>
          </div>
          <div className="text-[10px] text-text-secondary mt-1">
            上下文存储于 ~/.linggandawang/context.json
          </div>
        </div>
      </div>
    </>
  );
}

// RAG 向量检索状态组件
function RAGStatusSection() {
  const { ready, loading, size, error, reindex } = useVectorStore();

  return (
    <div className="pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-secondary">向量检索（RAG）</span>
          <span className={`px-1.5 py-0.5 text-[9px] rounded ${
            ready ? 'bg-semantic-success/10 text-semantic-success' : 'bg-surface-3 text-text-tertiary'
          }`}>
            {ready ? '就绪' : loading ? '加载中' : '未就绪'}
          </span>
        </div>
      </div>

      <div className="text-[10px] text-text-tertiary mb-2">
        {size > 0 ? (
          <span>已索引 {size} 条历史 QA，用于智能上下文增强</span>
        ) : (
          <span>暂无历史数据，回答问题后自动建立向量索引</span>
        )}
      </div>

      {error && (
        <div className="text-[9px] text-semantic-error mb-2">{error}</div>
      )}

      <button
        onClick={reindex}
        disabled={loading}
        className="w-full px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
      >
        {loading ? '重建中…' : '重建索引'}
      </button>

      <div className="text-[9px] text-text-tertiary mt-2 leading-relaxed">
        RAG 会将历史问答向量化存储，提问时自动检索相似历史增强上下文连续性。
        本地嵌入模型（all-MiniLM-L6-v2，~90MB）首次加载需下载。
      </div>
    </div>
  );
}
