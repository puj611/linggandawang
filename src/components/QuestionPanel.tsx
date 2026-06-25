// src/components/QuestionPanel.tsx
// 提问态：单问题对话气泡
import { useState } from 'react';
import { useEngineStore } from '@/stores/engineStore';
import { useFlow } from '@/hooks/useFlow';
import { useDrag } from '@/hooks/useDrag';
import { IntentTagChips } from './IntentTagChips';
import { SkipConfirmDialog } from './SkipConfirmDialog';
import { STAGE_LABEL } from '@/engine/types';
import type { PromptStage } from '@/engine/types';
import { useAppStore } from '@/stores/appStore';

const STAGES: PromptStage[] = ['perceive', 'name', 'spec', 'execute', 'verify'];

export function QuestionPanel() {
  const { currentQuestion, intentTags, consecutiveSkips } = useEngineStore();
  const { answer, skip } = useFlow();
  const [customInput, setCustomInput] = useState('');
  const [answering, setAnswering] = useState(false);
  const { dragProps, offset, dragging } = useDrag();
  const backToExpanded = useAppStore((s) => s.backToExpanded);

  if (!currentQuestion) {
    return (
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-h-[580px] bg-surface-1 border border-border rounded-card shadow-card p-6 text-center text-text-secondary text-sm">
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span>已完成所有阶段，正在生成提示词…</span>
        </div>
      </div>
    );
  }

  const stageIdx = STAGES.indexOf(currentQuestion.stage);

  const handleOption = async (value: string, label: string, tags: string[]) => {
    if (answering) return;
    setAnswering(true);
    try {
      await answer(value, label, tags);
    } finally {
      setAnswering(false);
    }
  };

  const handleCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim() || answering) return;
    setAnswering(true);
    try {
      await answer(customInput.trim(), customInput.trim(), []);
      setCustomInput('');
    } finally {
      setAnswering(false);
    }
  };

  const onSkip = async () => {
    if (answering) return;
    setAnswering(true);
    try {
      await skip();
    } finally {
      setAnswering(false);
    }
  };

  return (
    <div
      className={`fixed left-1/2 top-1/2 w-[420px] max-h-[580px] bg-surface-1 border border-border rounded-card shadow-card flex flex-col overflow-hidden ${dragging ? '' : 'transition-fsm'}`}
      style={{
        zIndex: 9999,
        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
      }}
    >
      {/* 顶部：进度条（拖动把手） */}
      <div
        className="px-5 py-3 border-b border-border"
        {...dragProps}
      >
        {/* 改进的进度指示器：进度条 + 圆点标记 */}
        <div className="relative flex items-center gap-0 mb-2">
          {STAGES.map((s, i) => (
            <div key={s} className="flex-1 relative flex items-center">
              {i < STAGES.length - 1 && (
                <div
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 rounded-full transition-colors duration-300 ${
                    i < stageIdx
                      ? 'bg-brand-strong'
                      : 'bg-surface-3'
                  }`}
                />
              )}
              <div
                className={`progress-dot relative z-10 ${
                  i < stageIdx
                    ? 'bg-brand-strong'
                    : i === stageIdx
                      ? 'bg-brand scale-125 shadow-[0_0_8px_rgba(139,92,246,0.5)]'
                      : 'bg-surface-3'
                }`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <button
            onClick={backToExpanded}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors no-drag"
          >
            ← 返回
          </button>
          <span className="text-[11px] text-text-secondary font-medium">
            {STAGE_LABEL[currentQuestion.stage]}（{stageIdx + 1}/5）
          </span>
          <span className="text-[11px] text-text-tertiary">
            已挤出 <span className="text-brand font-semibold">{intentTags.length}</span> 个标签
          </span>
        </div>
      </div>

      {/* 中部：问题 */}
      <div className="px-5 py-5 flex-1 flex flex-col items-center justify-center text-center">
        <p className="text-text-primary text-base font-semibold leading-relaxed mb-5 tracking-tight text-balance">
          {currentQuestion.text}
        </p>

        {/* 选项 */}
        <div className="w-full flex flex-col gap-2">
          {currentQuestion.options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleOption(opt.value, opt.label, opt.tags)}
              disabled={answering}
              className="option-card"
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 自定义输入 */}
        {currentQuestion.allow_custom && (
          <form onSubmit={handleCustom} className="w-full mt-3 flex gap-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder={currentQuestion.placeholder ?? '或者用你自己的话说...'}
              className="flex-1 bg-surface-2 border border-border rounded-btn px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand transition-colors"
            />
            <button
              type="submit"
              disabled={!customInput.trim()}
              className="primary-btn px-4 py-2 text-xs"
            >
              提交
            </button>
          </form>
        )}

        {/* 跳过 */}
        <button
          onClick={onSkip}
          className="mt-4 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors underline-offset-4 hover:underline"
        >
          跳过这个问题
        </button>
      </div>

      {/* 底部：意图标签 chips（视觉权重降低） */}
      <div className="px-5 py-3 border-t border-border bg-canvas/50">
        <IntentTagChips tags={intentTags} />
      </div>

      {/* 二次确认弹窗 */}
      {consecutiveSkips >= 2 && <SkipConfirmDialog />}
    </div>
  );
}
