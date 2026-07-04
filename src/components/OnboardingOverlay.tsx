// src/components/OnboardingOverlay.tsx
// 首次使用引导遮罩：3 步引导小白用户认识核心交互
// P1.4 - 解决"打开悬浮窗输入框空白不知道怎么写"的问题
import { useState } from 'react';

interface Props {
  /** 引导完成（点击"开始使用"或"跳过引导"）时回调，由父组件负责持久化标记 */
  onComplete: () => void;
}

// 热键文案统一从 useHotkey 取默认值即可，但引导页是静态展示，直接写死以避免循环依赖
const HOTKEY_LABEL = 'Alt+Shift+Space';

export function OnboardingOverlay({ onComplete }: Props) {
  const [step, setStep] = useState(0);

  const isLast = step === 3;
  const next = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setStep((s) => s + 1);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60"
      style={{ zIndex: 15000 }}
      data-no-drag
    >
      {/* 玻璃拟态引导卡片：参考 ExpandedCard 的暗色表面 + 品牌紫点缀 */}
      <div
        className="bg-surface-1/95 backdrop-blur-xl border border-border rounded-card shadow-popover w-[460px] max-w-[92vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部条：标题 + 跳过 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <span className="text-text-primary text-sm font-medium tracking-wide">
            欢迎使用灵感大王
          </span>
          <button
            onClick={onComplete}
            className="text-text-tertiary hover:text-text-secondary text-[11px] transition-colors"
          >
            跳过引导
          </button>
        </div>

        {/* 步骤内容 */}
        <div className="px-5 py-6 min-h-[260px] flex flex-col">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <FlowStep />}
          {step === 2 && <LlmOptionalStep />}
          {step === 3 && <HotkeyStep />}
        </div>

        {/* 底部：步骤指示器 + 主按钮 */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === step ? 'bg-brand w-4' : i < step ? 'bg-brand-soft' : 'bg-surface-3'
                }`}
              />
            ))}
          </div>
          <button
            onClick={next}
            className="primary-btn px-5 py-1.5 text-xs"
          >
            {isLast ? '开始使用 →' : '下一步 →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 步骤 1：欢迎页 =====
function WelcomeStep() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
          </svg>
        </div>
        <div>
          <div className="text-text-primary text-sm font-semibold">把模糊想法挤成精准提示词</div>
          <div className="text-text-tertiary text-[11px] mt-0.5">3 步认识核心交互</div>
        </div>
      </div>

      <p className="text-text-secondary text-xs leading-relaxed">
        灵感大王帮你把模糊想法挤成精准提示词。
        按 <Kbd>{HOTKEY_LABEL}</Kbd> 唤起/收起悬浮窗。
      </p>

      <div className="bg-surface-2 border border-border rounded-btn px-3 py-2.5">
        <div className="text-[10px] text-text-tertiary mb-1">举个例子</div>
        <div className="text-text-primary text-xs">
          输入「做一个登录页」→ 引导 7 题 → 输出可粘贴的提示词
        </div>
      </div>
    </div>
  );
}

// ===== 步骤 2：流程演示页 =====
function FlowStep() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-text-primary text-sm font-semibold">使用流程</div>
        <div className="text-text-tertiary text-[11px] mt-0.5">四步即可生成专属提示词</div>
      </div>

      <div className="flex items-center justify-between gap-1">
        <FlowNode
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <line x1="6" y1="20" x2="18" y2="20" />
            </svg>
          }
          label="唤起"
          hint="热键"
        />
        <FlowArrow />
        <FlowNode
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          }
          label="输入"
          hint="一句想法"
        />
        <FlowArrow />
        <FlowNode
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
          label="提问"
          hint="7~31 题"
        />
        <FlowArrow />
        <FlowNode
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </svg>
          }
          label="生成"
          hint="提示词"
        />
      </div>

      <div className="bg-surface-2 border border-border rounded-btn px-3 py-2.5 text-[11px] text-text-secondary leading-relaxed">
        <span className="text-text-primary font-medium">输入框空白时</span>，从下方「起点模板」选一个开始，
        或直接描述你想做的事（哪怕是「写个页面」也行）。
      </div>
    </div>
  );
}

// ===== 步骤 3：LLM 可选配置页 =====
function LlmOptionalStep() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-text-primary text-sm font-semibold">可选：配置 AI 模型</div>
        <div className="text-text-tertiary text-[11px] mt-0.5">不配置也能完整使用核心功能</div>
      </div>

      <div className="space-y-2">
        {/* 基础模式说明 */}
        <div className="bg-surface-2 border border-border rounded-btn px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-surface-3 text-text-tertiary border border-border-light">
              默认
            </span>
            <span className="text-text-primary text-xs font-medium">基础模式</span>
          </div>
          <div className="text-[10px] text-text-tertiary leading-relaxed">
            无需配置即可使用：关键词路由、规则引擎提问、Canvas 截图对比度诊断、提示词生成。
          </div>
        </div>

        {/* 智能模式说明 */}
        <div className="bg-brand-soft/30 border border-brand/20 rounded-btn px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-brand/15 text-brand border border-brand/30">
              可选
            </span>
            <span className="text-text-primary text-xs font-medium">智能模式</span>
          </div>
          <div className="text-[10px] text-text-tertiary leading-relaxed">
            配置 LLM 后额外获得：智能意图分析、动态追问题、图片提示词拆解。
          </div>
        </div>
      </div>

      <p className="text-text-secondary text-[11px] leading-relaxed">
        点击下方<span className="text-text-primary">「开始使用」</span>进入应用，
        随时可在<span className="text-text-primary">设置</span>中配置 LLM。
      </p>
    </div>
  );
}

// ===== 步骤 4：快捷键页 =====
function HotkeyStep() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-text-primary text-sm font-semibold">记住热键，随时唤起</div>
        <div className="text-text-tertiary text-[11px] mt-0.5">无需切窗口，随时呼出</div>
      </div>

      <div className="flex items-center justify-center py-3 bg-surface-2 border border-border rounded-btn">
        <Kbd large>{HOTKEY_LABEL}</Kbd>
      </div>

      <p className="text-text-secondary text-xs leading-relaxed text-center">
        点击下方按钮开始使用。
        热键可在<span className="text-text-primary">设置</span>中自定义。
      </p>
    </div>
  );
}

// ===== 子组件：键盘按键样式 =====
function Kbd({ children, large = false }: { children: React.ReactNode; large?: boolean }) {
  return (
    <kbd
      className={`inline-flex items-center gap-1 bg-surface-3 border border-border-light rounded-btn text-brand font-mono ${
        large ? 'px-4 py-2 text-sm' : 'px-2 py-0.5 text-[11px]'
      }`}
    >
      {children}
    </kbd>
  );
}

// ===== 子组件：流程节点 =====
function FlowNode({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
      <div className="w-9 h-9 rounded-btn bg-surface-2 border border-border flex items-center justify-center text-brand">
        {icon}
      </div>
      <div className="text-[10px] text-text-primary font-medium">{label}</div>
      <div className="text-[9px] text-text-tertiary">{hint}</div>
    </div>
  );
}

// ===== 子组件：流程箭头 =====
function FlowArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-tertiary flex-shrink-0"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
