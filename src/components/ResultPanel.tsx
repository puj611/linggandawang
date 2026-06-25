// src/components/ResultPanel.tsx
// 结果态：提示词面板
import { useEngineStore } from '@/stores/engineStore';
import { useFlow } from '@/hooks/useFlow';
import { useDrag } from '@/hooks/useDrag';
import { useResize } from '@/hooks/useResize';
import { IntentTagChips } from './IntentTagChips';
import { RawQuotesPanel } from './RawQuotesPanel';
import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { SegmentKey } from '@/engine/PromptGenerator';

export function ResultPanel() {
  const { result, intentTags } = useEngineStore();
  const { copyPrompt, exportPrompt, restart, removeTag, updateSection } = useFlow();
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const { dragProps, offset, dragging } = useDrag();
  // P1.5：右下角宽度调整把手
  const { resizeProps, width } = useResize();
  const backToExpanded = useAppStore((s) => s.backToExpanded);

  if (!result) {
    return (
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[80vh] max-w-[90vw] bg-surface-1 border border-border rounded-card shadow-card p-6 text-text-secondary flex items-center justify-center"
        style={{ zIndex: 9999, width: `${width}px` }}
      >
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span>生成中…</span>
        </div>
      </div>
    );
  }

  const onCopy = async () => {
    const ok = await copyPrompt(result);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={`fixed left-1/2 top-1/2 h-[80vh] max-w-[90vw] bg-surface-1 border border-border rounded-card shadow-card flex flex-col overflow-hidden relative ${dragging ? '' : 'transition-fsm'}`}
      style={{
        zIndex: 9999,
        width: `${width}px`,
        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
      }}
    >
      {/* 顶部标题栏（拖动把手） */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-border select-none"
        {...dragProps}
      >
        <span className="text-text-primary text-sm font-semibold tracking-tight">你的提示词</span>
        <div className="flex items-center gap-1.5 no-drag">
          <button
            onClick={backToExpanded}
            className="ghost-btn px-3 py-1 text-xs"
          >
            ← 返回
          </button>
          <button
            onClick={onCopy}
            className={`primary-btn px-3 py-1 text-xs ${copied ? '!bg-semantic-success' : ''}`}
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
          <button
            onClick={() => exportPrompt(result)}
            className="ghost-btn px-3 py-1 text-xs text-text-primary"
          >
            导出 .md
          </button>
          <button
            onClick={restart}
            className="ghost-btn px-3 py-1 text-xs"
          >
            重新提问
          </button>
        </div>
      </div>

      {/* 中部：四段提示词 */}
      <div className="flex-1 overflow-y-auto px-5 py-4 font-mono text-xs select-text">
        <div className="space-y-3">
          <Section
            title={result.action.title}
            content={result.action.content}
            segmentKey="action"
            onEdit={updateSection}
          />
          <Section
            title={result.spec.title}
            content={result.spec.content}
            mono
            segmentKey="spec"
            onEdit={updateSection}
          />
          <Section
            title={result.constraint.title}
            content={result.constraint.content}
            segmentKey="constraint"
            onEdit={updateSection}
          />
          <Section
            title={result.verify.title}
            content={result.verify.content}
            segmentKey="verify"
            onEdit={updateSection}
          />
        </div>

        {/* 用户原话折叠面板 */}
        <RawQuotesPanel
          quotes={result.raw_quotes}
          open={showRaw}
          onToggle={() => setShowRaw((v) => !v)}
        />
      </div>

      {/* 底部：意图标签清单 */}
      <div className="px-5 py-3 border-t border-border bg-canvas/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-text-tertiary">
            意图标签清单（{intentTags.length} 个，点击 × 删除重生成）
          </span>
        </div>
        <IntentTagChips tags={intentTags} onRemove={removeTag} />
      </div>

      {/* P1.5：右下角宽度调整把手 */}
      <div
        {...resizeProps}
        data-no-drag
        className="absolute right-0 bottom-0 w-3 h-10 flex items-center justify-center hover:bg-surface-3/50 transition-colors group"
        title="拖动调整宽度"
      >
        <div className="w-0.5 h-4 bg-border-light rounded-full group-hover:bg-brand transition-colors" />
      </div>
    </div>
  );
}

function Section({
  title,
  content,
  mono,
  segmentKey,
  onEdit,
}: {
  title: string;
  content: string;
  mono?: boolean;
  segmentKey: SegmentKey;
  onEdit: (key: SegmentKey, newContent: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  // 当外部 content 变化（如重新生成/删除标签后重生成），同步 draft
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const commit = async () => {
    setEditing(false);
    if (draft !== content) {
      await onEdit(segmentKey, draft);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(content);
  };

  return (
    <div className="bg-surface-2 border border-border rounded-btn p-3.5 group">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">{title}</div>
        {!editing && (
          <button
            onClick={startEdit}
            className="text-[10px] text-text-tertiary hover:text-brand opacity-0 group-hover:opacity-100 transition-opacity no-drag"
            title="编辑此段"
          >
            ✎ 编辑
          </button>
        )}
        {editing && (
          <div className="flex gap-1.5">
            <button
              onClick={commit}
              className="text-[10px] text-semantic-success hover:opacity-80 transition-opacity no-drag"
              title="保存"
            >
              ✓ 保存
            </button>
            <button
              onClick={cancel}
              className="text-[10px] text-text-tertiary hover:text-text-secondary transition-opacity no-drag"
              title="取消"
            >
              ✕ 取消
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
          className={`w-full bg-surface-1 border border-brand rounded-btn px-3 py-2 text-text-primary text-xs leading-relaxed resize-y focus:outline-none focus:border-brand-strong transition-colors ${
            mono ? 'font-mono' : ''
          }`}
        />
      ) : (
        <div
          className={`text-text-primary text-xs leading-relaxed whitespace-pre-wrap ${
            mono ? 'font-mono' : ''
          }`}
        >
          {content}
        </div>
      )}
    </div>
  );
}
