// src/components/SettingsPanel.tsx
// 设置面板：通用设置 + 词簇分析
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useContextStore } from '@/stores/contextStore';
import { useFeatureStore } from '@/stores/featureStore';
import type { FeatureFlags } from '@/stores/featureStore';
import { questionLoader } from '@/engine/QuestionLoader';
import { getHotkey, setHotkey } from '@/hooks/useHotkey';
import { ClusterAnalyticsPanel } from './ClusterAnalyticsPanel';
import { LLMConfigSection } from './LLMConfigSection';

type TabKey = 'general' | 'analytics';

export function SettingsPanel() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const ctxStore = useContextStore();
  const screenshotDiagnosis = useFeatureStore((s) => s.screenshotDiagnosis);
  const setFeatures = useFeatureStore((s) => s.set);
  const features = { screenshotDiagnosis, set: setFeatures };
  const [tab, setTab] = useState<TabKey>('general');
  const [hotkey, setHotkeyState] = useState(getHotkey());
  const [recording, setRecording] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [bankReloaded, setBankReloaded] = useState(false);
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

  const onReloadBank = () => {
    questionLoader.reload();
    setBankReloaded(true);
    setTimeout(() => setBankReloaded(false), 1500);
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
        className="bg-bg-card border border-border rounded-card shadow-card flex flex-col overflow-hidden"
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
            onSwitchTab={setTab}
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
  onSwitchTab: (k: TabKey) => void;
}

function GeneralSettings({
  hotkey, recording, confirmClear, bankReloaded, features, closeSettings,
  startRecordHotkey, onClearContext, onReloadBank, onSwitchTab,
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
        {/* 热键自定义 */}
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

        {/* AI 模型配置 */}
        <div className="pt-3 border-t border-border">
          <LLMConfigSection />
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

        {/* 清空上下文 */}
        <div>
          <button
            onClick={onClearContext}
            className={`w-full px-3 py-1.5 text-xs rounded-btn transition-colors ${
              confirmClear
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'border border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {confirmClear ? '再次点击确认清空上下文' : '清空上下文'}
          </button>
          <div className="text-[10px] text-text-secondary mt-1">
            清空 ~/.linggandawang/context.json
          </div>
        </div>
      </div>
    </>
  );
}
