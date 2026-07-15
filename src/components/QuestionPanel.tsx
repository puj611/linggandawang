// src/components/QuestionPanel.tsx
// 提问态：单问题对话气泡
import { useState } from 'react';
import { useEngineStore } from '@/stores/engineStore';
import { useFlow } from '@/hooks/useFlow';
import { useDrag } from '@/hooks/useDrag';
import { useResize } from '@/hooks/useResize';
import { IntentTagChips } from './IntentTagChips';
import { SkipConfirmDialog } from './SkipConfirmDialog';
import { STAGE_LABEL } from '@/engine/types';
import type { PromptStage } from '@/engine/types';
import { useAppStore } from '@/stores/appStore';

const STAGES: PromptStage[] = ['perceive', 'name', 'spec', 'execute', 'verify'];

export function QuestionPanel() {
  // v2.3：逐个 selector 精准订阅，避免整 store 订阅导致无关状态变化触发重渲染
  const currentQuestion = useEngineStore((s) => s.currentQuestion);
  const intentTags = useEngineStore((s) => s.intentTags);
  const consecutiveSkips = useEngineStore((s) => s.consecutiveSkips);
  const canUndo = useEngineStore((s) => s.canUndo);
  const { answer, skip, goBack } = useFlow();
  const [customInput, setCustomInput] = useState('');
  const [answering, setAnswering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { dragProps, offset, dragging } = useDrag();
  const { resizeProps, width } = useResize();
  const backToExpanded = useAppStore((s) => s.backToExpanded);

  if (!currentQuestion) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 9999 }}
      >
        <div
          className="window-panel p-6 text-center text-text-secondary text-sm flex flex-col items-center justify-center gap-3"
          style={{ width: `${width}px`, minHeight: '200px' }}
        >
          <div className="relative">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 w-8 h-8 border border-brand/30 rounded-full animate-pulse-soft" />
          </div>
          <div>
            <p className="text-text-primary text-sm font-medium">正在生成提示词</p>
            <p className="text-xs text-text-tertiary mt-1">灵感大王正在整理你的意图标签...</p>
          </div>
        </div>
      </div>
    );
  }

  const stageIdx = STAGES.indexOf(currentQuestion.stage);

  const handleOption = async (value: string, label: string, tags: string[]) => {
    if (answering) return;
    setAnswering(true);
    setErrorMsg(null);
    try {
      await answer(value, label, tags);
    } catch (e) {
      console.error('[QuestionPanel] answer 失败', e);
      setErrorMsg(e instanceof Error ? e.message : '提交答案失败，请重试');
    } finally {
      setAnswering(false);
    }
  };

  const handleCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim() || answering) return;
    setAnswering(true);
    setErrorMsg(null);
    try {
      await answer(customInput.trim(), customInput.trim(), []);
      setCustomInput('');
    } catch (e) {
      console.error('[QuestionPanel] 自定义答案提交失败', e);
      setErrorMsg(e instanceof Error ? e.message : '提交答案失败，请重试');
    } finally {
      setAnswering(false);
    }
  };

  const onSkip = async () => {
    if (answering) return;
    setAnswering(true);
    setErrorMsg(null);
    try {
      await skip();
    } catch (e) {
      console.error('[QuestionPanel] skip 失败', e);
      setErrorMsg(e instanceof Error ? e.message : '跳过失败，请重试');
    } finally {
      setAnswering(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      <div
        className={`window-panel flex flex-col overflow-hidden relative ${dragging ? '' : 'transition-fsm'}`}
        style={{
          width: `${width}px`,
          maxHeight: '85vh',
          minHeight: '420px',
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        {/* 顶部：进度条（拖动把手） */}
        <div
          className="px-4 py-3 border-b border-border shrink-0"
          {...dragProps}
        >
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
            <div className="flex items-center gap-2">
              <button
                onClick={backToExpanded}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors no-drag"
              >
                ← 返回
              </button>
              {canUndo && (
                <button
                  onClick={goBack}
                  disabled={answering}
                  title="撤销上一题的回答，重新选择"
                  className="text-xs text-text-tertiary hover:text-brand transition-colors no-drag disabled:opacity-40"
                >
                  ↻ 上一题
                </button>
              )}
            </div>
            <span className="text-xs text-text-secondary font-medium">
              {STAGE_LABEL[currentQuestion.stage]}（{stageIdx + 1}/5）
            </span>
            <span className="text-xs text-text-tertiary">
              <span className="text-brand font-semibold">{intentTags.length}</span> 标签
            </span>
          </div>
        </div>

        {/* 中部：问题（可滚动） */}
        <div className="px-4 py-4 flex-1 overflow-y-auto">
          {/* P1-6：错误提示 */}
          {errorMsg && (
            <div className="mb-3 px-3 py-2 rounded-btn bg-semantic-error/10 border border-semantic-error/30 text-semantic-error text-[11px] text-center">
              {errorMsg}
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <p className="text-text-primary text-lg font-semibold leading-snug mb-2 tracking-tight text-balance">
              {currentQuestion.text}
            </p>
            {currentQuestion.why && (
              <p className="text-xs text-text-tertiary mb-3 leading-relaxed max-w-[90%]">
                <span className="text-brand/80">💡 为什么问：</span>
                {currentQuestion.why}
              </p>
            )}
            {!currentQuestion.why && <div className="mb-3" />}

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
                  className="flex-1 bg-surface-2 border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand transition-colors"
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
              className="mt-3 text-xs text-text-tertiary hover:text-text-secondary transition-colors underline-offset-4 hover:underline"
            >
              跳过这个问题
            </button>
          </div>
        </div>

        {/* 底部：意图标签 chips */}
        <div className="px-4 py-3 border-t border-border bg-canvas/50 shrink-0">
          <IntentTagChips tags={intentTags} />
        </div>

        {consecutiveSkips >= 2 && <SkipConfirmDialog />}

        {/* 右下角宽度调整把手 */}
        <div
          {...resizeProps}
          data-no-drag
          className="absolute right-0 bottom-0 w-3 h-10 flex items-center justify-center hover:bg-surface-3/50 transition-colors group rounded-br-card"
          title="拖动调整宽度"
        >
          <div className="w-0.5 h-4 bg-border-light rounded-full group-hover:bg-brand transition-colors" />
        </div>
      </div>
    </div>
  );
}
