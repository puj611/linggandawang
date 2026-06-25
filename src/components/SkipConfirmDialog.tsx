// src/components/SkipConfirmDialog.tsx
// 连续跳过二次确认弹窗
import { useAppStore } from '@/stores/appStore';
import { useFlow } from '@/hooks/useFlow';

export function SkipConfirmDialog() {
  const closeSkipConfirm = useAppStore((s) => s.closeSkipConfirm);
  const { finishEarlyAndGenerate, continueAfterSkipConfirm } = useFlow();

  const onContinue = () => {
    continueAfterSkipConfirm();
    closeSkipConfirm();
  };

  const onFinish = () => {
    finishEarlyAndGenerate();
    closeSkipConfirm();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60"
      style={{ zIndex: 10000 }}
      data-no-drag
      onClick={onContinue}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-card border border-border rounded-card shadow-card p-5 w-[320px]"
      >
        <div className="text-text-primary text-sm font-medium mb-2">连续跳过 ≥ 2 题</div>
        <div className="text-text-secondary text-xs mb-4">
          你已连续跳过多道问题。是否结束提问，基于现有信息生成提示词？
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onContinue}
            className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            继续提问
          </button>
          <button
            onClick={onFinish}
            className="px-3 py-1.5 text-xs rounded-btn bg-brand hover:bg-brand-hover text-white transition-colors"
          >
            结束并生成
          </button>
        </div>
      </div>
    </div>
  );
}
