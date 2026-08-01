// src/components/LLMModeBadge.tsx
// 三档降级体验：在主界面显示当前 LLM 模式 + 降级通知 + 重试按钮
import { useState, useEffect } from 'react';
import { useLLMAvailabilityStore } from '@/stores/llmAvailabilityStore';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useLocalLLMStore } from '@/stores/localLLMStore';
import { useAppStore } from '@/stores/appStore';

type Mode = 'cloud' | 'local' | 'basic';

function getMode(hasApiKey: boolean, localRunning: boolean, override: Mode | null): Mode {
  if (override) return override;
  if (localRunning) return 'local';
  if (hasApiKey) return 'cloud';
  return 'basic';
}

const MODE_CONFIG: Record<Mode, { label: string; color: string; bg: string; border: string }> = {
  cloud: { label: '智能模式', color: 'text-[#7DD29D]', bg: 'bg-[#7DD29D]/10', border: 'border-[#7DD29D]/30' },
  local: { label: '本地模式', color: 'text-[#8B9AE8]', bg: 'bg-[#8B9AE8]/10', border: 'border-[#8B9AE8]/30' },
  basic: { label: '基础模式', color: 'text-text-tertiary', bg: 'bg-surface-2', border: 'border-border' },
};

export function LLMModeBadge() {
  const hasApiKey = useApiKeyStore((s) => s.hasApiKey);
  const localStatus = useLocalLLMStore((s) => s.status);
  const availabilityStatus = useLLMAvailabilityStore((s) => s.status);
  const getStatusMessage = useLLMAvailabilityStore((s) => s.getStatusMessage);
  const resetAvailability = useLLMAvailabilityStore((s) => s.reset);
  const llmModeOverride = useAppStore((s) => s.llmModeOverride);
  const setLlmModeOverride = useAppStore((s) => s.setLlmModeOverride);
  const openSettings = useAppStore((s) => s.openSettings);

  const [showDetail, setShowDetail] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const localRunning = localStatus?.running ?? false;
  const mode = getMode(hasApiKey, localRunning, llmModeOverride);
  const config = MODE_CONFIG[mode];
  const degraded = availabilityStatus === 'degraded';
  const statusMsg = degraded ? getStatusMessage() : null;

  // 点击模式行：切换模式
  const handleModeClick = (target: Mode) => {
    if (target === mode) return; // 已是当前模式
    if (target === 'cloud') {
      if (!hasApiKey) {
        // 没有配置 API Key，打开设置面板
        openSettings();
        setShowDetail(false);
        return;
      }
      setLlmModeOverride('cloud');
    } else if (target === 'local') {
      if (!localRunning) {
        // 没有启动本地 SLM，打开设置面板
        openSettings();
        setShowDetail(false);
        return;
      }
      setLlmModeOverride('local');
    } else {
      // basic：强制基础模式，跳过 LLM
      setLlmModeOverride('basic');
    }
    setShowDetail(false);
  };

  // 熔断倒计时
  useEffect(() => {
    if (!degraded) { setCountdown(null); return; }
    const timer = setInterval(() => {
      const msg = getStatusMessage();
      if (!msg) { setCountdown(null); return; }
      // 从消息中提取剩余分钟数
      const match = msg.text.match(/(\d+)\s*分钟/);
      setCountdown(match ? parseInt(match[1], 10) : null);
    }, 10000);
    return () => clearInterval(timer);
  }, [degraded, getStatusMessage]);

  return (
    <div className="relative">
      {/* 主徽章 */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className={`flex items-center gap-1.5 px-2 py-0.5 text-[9px] rounded-full border transition-colors ${config.bg} ${config.color} ${config.border} hover:opacity-80`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${
          degraded ? 'bg-[#e2b93d] animate-pulse' :
          mode === 'cloud' ? 'bg-[#7DD29D]' :
          mode === 'local' ? 'bg-[#8B9AE8]' :
          'bg-text-tertiary'
        }`} />
        {config.label}
        {degraded && <span className="text-[#e2b93d]">!</span>}
      </button>

      {/* 展开详情 */}
      {showDetail && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-bg-card border border-border rounded-card shadow-popover z-[100] p-3 space-y-2">
          <div className="text-[10px] text-text-secondary font-medium">当前模式</div>

          {/* 三档模式说明 */}
          <div className="space-y-1.5">
            <ModeRow
              active={mode === 'cloud' && !degraded}
              label="智能模式"
              desc="云端 LLM 增强（意图分析/动态追问/图片拆解）"
              color="text-[#7DD29D]"
              onClick={() => handleModeClick('cloud')}
            />
            <ModeRow
              active={mode === 'local'}
              label="本地模式"
              desc="本地 SLM 推理（数据不出机器，零成本）"
              color="text-[#8B9AE8]"
              onClick={() => handleModeClick('local')}
            />
            <ModeRow
              active={mode === 'basic' || degraded}
              label="基础模式"
              desc="纯规则引擎（核心提问流程完整可用）"
              color="text-text-tertiary"
              onClick={() => handleModeClick('basic')}
            />
          </div>

          {/* 降级通知 */}
          {degraded && statusMsg && (
            <div className="px-2 py-1.5 rounded bg-[#e2b93d]/10 border border-[#e2b93d]/20 text-[9px] text-[#e2b93d] leading-relaxed">
              {statusMsg.text}
              {countdown !== null && countdown > 0 && (
                <span className="block mt-0.5 text-text-tertiary">{countdown} 分钟后自动重试</span>
              )}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-1.5">
            {degraded && (
              <button
                onClick={() => { resetAvailability(); setShowDetail(false); }}
                className="flex-1 px-2 py-1 text-[9px] rounded-btn bg-brand-soft text-brand hover:bg-brand/20 transition-colors"
              >
                立即重试
              </button>
            )}
            <button
              onClick={() => setShowDetail(false)}
              className="px-2 py-1 text-[9px] rounded-btn border border-border text-text-secondary hover:text-text-primary transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeRow({ active, label, desc, color, onClick }: {
  active: boolean;
  label: string;
  desc: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2 px-2 py-1 rounded transition-colors text-left ${active ? 'bg-surface-2' : 'hover:bg-surface-2/50 cursor-pointer'}`}
    >
      <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? color : 'bg-surface-3'}`} />
      <div className="min-w-0">
        <div className={`text-[9px] ${active ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>{label}</div>
        <div className="text-[8px] text-text-tertiary leading-snug">{desc}</div>
      </div>
    </button>
  );
}
