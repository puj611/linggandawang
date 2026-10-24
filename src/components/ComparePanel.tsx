// src/components/ComparePanel.tsx
// 前后对比面板（R04 MVP）：双栏并排对比两版提示词。
// - A/B 两个槽位均可「载入当前结果」或从已保存对比回填；
// - 差异由 ComparisonEngine 纯函数计算：按段对齐 + 新增/缺失标记 + 约束条目差异；
// - 每段可折叠；对比结果可保存、可重命名、可删除（SQLite / localStorage 降级）；
// - 不做语义评分（路线图 R04 约束）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import {
  comparePromptResults,
  isPromptResultLike,
  type ComparisonResult,
  type ParagraphDiffItem,
  type SegmentComparison,
} from '@/engine/ComparisonEngine';
import {
  deleteComparisonRun,
  listComparisonRuns,
  renameComparisonRun,
  saveComparisonRun,
  type ComparisonRunRecord,
} from '@/lib/comparisonStore';
import type { PromptResult } from '@/types/prompt';

/** 删除二态确认的确认态保持时长（与 RecentPromptList 一致） */
const CONFIRM_TIMEOUT_MS = 2500;

/** 段落状态徽标文案 */
const SEGMENT_STATUS_LABEL: Record<SegmentComparison['status'], string> = {
  same: '一致',
  changed: '有差异',
  added: '新版新增',
  removed: '旧版独有',
};

/** 段落状态徽标配色（对齐项目语义色板） */
const SEGMENT_STATUS_CLASS: Record<SegmentComparison['status'], string> = {
  same: 'bg-surface-3 text-text-tertiary border-border-light',
  changed: 'bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30',
  added: 'bg-semantic-success/10 text-semantic-success border-semantic-success/30',
  removed: 'bg-semantic-error/10 text-semantic-error border-semantic-error/30',
};

/** 反序列化持久化的 PromptResult JSON，形状不符返回 null */
function parseStoredResult(raw: string): PromptResult | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPromptResultLike(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 时间格式化：非法时间返回空串 */
function formatTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  return new Date(ts).toLocaleString('zh-CN');
}

export function ComparePanel() {
  const closeCompare = useAppStore((s) => s.closeCompare);
  const currentResult = useEngineStore((s) => s.result);
  // R04 P1 修复：A/B 槽位存于全局 store 而非组件本地 state。
  // 面板随 compareOpen 卸载（关闭即卸载），若槽位放本地 state 会在「载入 A → 关面板 →
  // 重新生成 → 开面板 → 载入 B」链路中丢失 A，导致永远无法并排对比。
  const left = useAppStore((s) => s.compareLeft);
  const right = useAppStore((s) => s.compareRight);
  const setCompareSlot = useAppStore((s) => s.setCompareSlot);
  const swapCompareSlots = useAppStore((s) => s.swapCompareSlots);
  const [runs, setRuns] = useState<ComparisonRunRecord[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 卸载保护：async 操作 await 后不再 setState
  const mountedRef = useRef(true);

  const reloadRuns = useCallback(async () => {
    try {
      const rows = await listComparisonRuns(20);
      if (mountedRef.current) setRuns(rows);
    } catch (e) {
      console.warn('[ComparePanel] 加载对比历史失败', e);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reloadRuns();
    return () => {
      mountedRef.current = false;
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
    };
  }, [reloadRuns]);

  // 两侧就绪后实时对比（纯函数，无 IO）
  const diff = useMemo<ComparisonResult | null>(
    () => (left && right ? comparePromptResults(left, right) : null),
    [left, right],
  );

  const loadCurrent = (slot: 'left' | 'right') => {
    if (!currentResult) {
      setNotice('当前没有可载入的结果，请先在结果页生成提示词');
      return;
    }
    setCompareSlot(slot, currentResult);
    setNotice('');
  };

  const clearSlot = (slot: 'left' | 'right') => {
    setCompareSlot(slot, null);
  };

  const swapSlots = () => {
    swapCompareSlots();
  };

  const openRun = (run: ComparisonRunRecord) => {
    const parsedLeft = parseStoredResult(run.left_json);
    const parsedRight = parseStoredResult(run.right_json);
    if (!parsedLeft || !parsedRight) {
      setNotice('该对比记录数据已损坏，无法打开');
      return;
    }
    setCompareSlot('left', parsedLeft);
    setCompareSlot('right', parsedRight);
    setNotice('');
  };

  const onSave = async () => {
    if (!left || !right || !diff) {
      setNotice('请先载入 A/B 两侧结果再保存');
      return;
    }
    const name = nameDraft.trim() || `对比 ${new Date().toLocaleString('zh-CN')}`;
    try {
      await saveComparisonRun({
        name,
        left_json: JSON.stringify(left),
        right_json: JSON.stringify(right),
        diff_json: JSON.stringify(diff),
      });
      if (!mountedRef.current) return;
      setNameDraft('');
      setNotice('已保存对比记录 ✓');
      await reloadRuns();
    } catch (e) {
      console.warn('[ComparePanel] 保存对比失败', e);
      if (mountedRef.current) setNotice('保存失败，请重试');
    }
  };

  const onRename = async (id: number) => {
    // 无效 id（0/NaN）直接放弃，避免静默误操作
    if (!id) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    try {
      await renameComparisonRun(id, name);
      if (!mountedRef.current) return;
      setRenamingId(null);
      await reloadRuns();
    } catch (e) {
      console.warn('[ComparePanel] 重命名失败', e);
    }
  };

  const onDelete = (id: number) => {
    // 无效 id（0/NaN）直接放弃
    if (!id) return;
    // 二态确认：首次点击进入确认态并启动超时恢复，确认态超时/卸载后重置
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => {
        deleteTimerRef.current = null;
        if (mountedRef.current) setConfirmDeleteId(null);
      }, CONFIRM_TIMEOUT_MS);
      return;
    }
    setConfirmDeleteId(null);
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    void (async () => {
      try {
        await deleteComparisonRun(id);
        if (mountedRef.current) await reloadRuns();
      } catch (e) {
        console.warn('[ComparePanel] 删除对比失败', e);
      }
    })();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60"
      style={{ zIndex: 10001 }}
      data-no-drag
      onClick={closeCompare}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="前后对比"
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-card border border-border-light rounded-card shadow-popover flex flex-col overflow-hidden overscroll-contain"
        style={{ width: 880, maxWidth: '96vw', maxHeight: '88vh' }}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex flex-col">
            <span className="text-text-primary text-sm font-semibold tracking-tight">前后对比</span>
            <span className="text-[10px] text-text-tertiary mt-0.5">
              同一输入的两版提示词并排对比：按段对齐标记新增/缺失，并列出约束条目差异
            </span>
          </div>
          <button
            onClick={closeCompare}
            className="text-text-secondary hover:text-text-primary text-lg leading-none px-1"
            aria-label="关闭对比面板"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* A/B 槽位 */}
          <div className="grid grid-cols-2 gap-3">
            <SlotCard
              label="旧版（A）"
              result={left}
              onLoad={() => loadCurrent('left')}
              onClear={() => clearSlot('left')}
            />
            <SlotCard
              label="新版（B）"
              result={right}
              onLoad={() => loadCurrent('right')}
              onClear={() => clearSlot('right')}
            />
          </div>

          {/* 操作行 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={swapSlots}
              disabled={!left && !right}
              className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors disabled:opacity-40"
              title="交换 A/B 两侧"
            >
              ⇄ 交换 A/B
            </button>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="对比名称（可选，留栈自动命名）"
              className="flex-1 min-w-[180px] bg-bg-main border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-brand transition-colors"
            />
            <button
              onClick={() => void onSave()}
              disabled={!left || !right}
              className="primary-btn px-4 py-1.5 text-xs disabled:opacity-40"
            >
              保存对比
            </button>
          </div>
          {notice && <div className="text-[11px] text-semantic-warning">{notice}</div>}

          {/* 使用提示 */}
          <div className="text-[10px] text-text-tertiary leading-relaxed">
            用法：A 槽「载入当前结果」→ 关闭面板，重新生成（或编辑段落/删除标签后再生成）→
            再次打开面板（A 槽内容保留，槽位跨面板关闭保留）→ B 槽「载入当前结果」→ 自动显示逐段差异。
            清空某侧请点槽位右上角 ×。
          </div>

          {/* 差异区 */}
          {diff ? (
            <DiffView diff={diff} />
          ) : (
            <div className="text-xs text-text-tertiary text-center py-6 border border-border rounded-btn">
              A/B 两侧均载入结果后，此处显示逐段差异
            </div>
          )}

          {/* 已保存的对比 */}
          <div className="pt-3 border-t border-border">
            <div className="text-[11px] text-text-secondary mb-2">已保存的对比（{runs.length}）</div>
            {runs.length === 0 ? (
              <div className="text-[11px] text-text-tertiary py-2">暂无保存的对比记录</div>
            ) : (
              <div className="flex flex-col gap-1">
                {runs.map((run) => {
                  // id 为可选字段（存储层总会写入），此处归一为 0 并交给处理器做无效守卫
                  const runId = run.id ?? 0;
                  return (
                    <div
                      key={runId}
                      className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2 transition-colors"
                    >
                      {renamingId === runId ? (
                        <>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void onRename(runId);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="flex-1 bg-bg-main border border-brand rounded-btn px-2 py-1 text-[11px] text-text-primary"
                          />
                          <button
                            onClick={() => void onRename(runId)}
                            className="text-[11px] text-semantic-success hover:opacity-80"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="text-[11px] text-text-tertiary hover:text-text-secondary"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => openRun(run)}
                            className="flex-1 text-left min-w-0"
                            title="载入这条对比到 A/B 槽位"
                          >
                            <div className="text-[11px] text-text-primary truncate">{run.name}</div>
                            <div className="text-[9px] text-text-tertiary mt-0.5">
                              {formatTime(run.created_at)}
                            </div>
                          </button>
                          <button
                            onClick={() => {
                              setRenamingId(runId);
                              setRenameDraft(run.name);
                            }}
                            className="text-[11px] text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                            title="重命名"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => onDelete(runId)}
                            className={`text-[11px] px-1 transition-opacity ${
                              confirmDeleteId === runId
                                ? 'text-semantic-error opacity-100'
                                : 'text-text-tertiary hover:text-semantic-error opacity-0 group-hover:opacity-100'
                            }`}
                            title={confirmDeleteId === runId ? '再次点击确认删除' : '删除'}
                          >
                            {confirmDeleteId === runId ? '确认删除?' : '×'}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A/B 槽位卡片：已载入时预览四段摘要，未载入时提供「载入当前结果」入口 */
function SlotCard({
  label,
  result,
  onLoad,
  onClear,
}: {
  label: string;
  result: PromptResult | null;
  onLoad: () => void;
  onClear: () => void;
}) {
  return (
    <div className="bg-surface-2 border border-border rounded-btn p-3 flex flex-col min-h-[120px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-text-secondary font-medium">{label}</span>
        {result && (
          <button
            onClick={onClear}
            className="text-[11px] text-text-tertiary hover:text-semantic-error"
            title="清空此槽"
          >
            ×
          </button>
        )}
      </div>
      {result ? (
        <div className="flex-1 overflow-y-auto max-h-40 space-y-1.5">
          {result.project_context && (
            <SlotLine title={result.project_context.title || '项目上下文'} content={result.project_context.content} />
          )}
          <SlotLine title={result.action.title || '要做什么'} content={result.action.content} />
          <SlotLine title={result.spec.title || '怎么做'} content={result.spec.content} />
          <SlotLine title={result.constraint.title || '不能怎么'} content={result.constraint.content} />
          <SlotLine title={result.verify.title || '怎么算做好了'} content={result.verify.content} />
          <div className="text-[9px] text-text-tertiary">生成于 {formatTime(result.generated_at)}</div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-[11px] text-text-tertiary">未载入</span>
          <button
            onClick={onLoad}
            className="px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-bg-card-hover transition-colors"
          >
            载入当前结果
          </button>
        </div>
      )}
    </div>
  );
}

function SlotLine({ title, content }: { title: string; content: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] text-text-tertiary uppercase tracking-wider">{title}</div>
      <div className="text-[11px] text-text-secondary line-clamp-2 break-words">
        {content.trim() || '（空）'}
      </div>
    </div>
  );
}

/** 差异视图：摘要徽标 + 逐段可折叠对比 */
function DiffView({ diff }: { diff: ComparisonResult }) {
  const { summary } = diff;
  return (
    <div className="space-y-2">
      {/* 摘要行 */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span
          className={`px-2 py-0.5 rounded border ${
            summary.identical
              ? 'bg-semantic-success/10 text-semantic-success border-semantic-success/30'
              : 'bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30'
          }`}
        >
          {summary.identical ? '两版完全一致' : `差异 ${summary.changedSegments.length} / ${summary.totalSegments} 段`}
        </span>
        <span className="text-text-tertiary">约束条目差异 {summary.changedConstraintItems} 处</span>
      </div>

      {/* 逐段对比 */}
      {diff.segments.map((segment) => (
        <SegmentDiffSection key={segment.key} segment={segment} />
      ))}
    </div>
  );
}

/** 单段对比：头部（标题 + 状态徽标 + 折叠开关）+ 双栏段落对齐 + 约束条目差异 */
function SegmentDiffSection({ segment }: { segment: SegmentComparison }) {
  const [open, setOpen] = useState(true);
  const changedParagraphs = segment.paragraphs.filter((p) => p.status !== 'same').length;
  return (
    <div className="bg-surface-2 border border-border rounded-btn overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-tertiary text-[10px] w-3">{open ? '▾' : '▸'}</span>
          <span className="text-xs text-text-primary font-medium truncate">{segment.title}</span>
          <span className={`px-1.5 py-0.5 text-[9px] rounded border ${SEGMENT_STATUS_CLASS[segment.status]}`}>
            {SEGMENT_STATUS_LABEL[segment.status]}
          </span>
          {changedParagraphs > 0 && (
            <span className="text-[9px] text-text-tertiary">{changedParagraphs} 处段落变化</span>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          {/* 双栏段落对齐 */}
          {segment.paragraphs.length === 0 ? (
            <div className="text-[11px] text-text-tertiary py-1">（两版均为空）</div>
          ) : (
            segment.paragraphs.map((item, idx) => (
              <ParagraphRow key={`${segment.key}-${idx}`} item={item} />
            ))
          )}

          {/* 约束条目差异（仅约束段） */}
          {segment.constraintItems && segment.constraintItems.length > 0 && (
            <div className="pt-2 mt-1 border-t border-border-light">
              <div className="text-[10px] text-text-secondary mb-1">约束条目差异</div>
              <div className="space-y-0.5">
                {segment.constraintItems.map((item, idx) => (
                  <div
                    key={`constraint-${idx}`}
                    className={`flex items-start gap-1.5 text-[11px] px-1.5 py-1 rounded ${
                      item.status === 'added'
                        ? 'bg-semantic-success/10 text-semantic-success'
                        : item.status === 'removed'
                          ? 'bg-semantic-error/10 text-semantic-error'
                          : 'text-text-secondary'
                    }`}
                  >
                    <span className="shrink-0 font-mono">
                      {item.status === 'added' ? '+' : item.status === 'removed' ? '−' : '='}
                    </span>
                    <span className="break-words">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 双栏段落行：same 两栏同文；added 仅右栏高亮；removed 仅左栏高亮 */
function ParagraphRow({ item }: { item: ParagraphDiffItem }) {
  const cell = (side: 'left' | 'right') => {
    const text = side === 'left' ? item.left : item.right;
    if (text === null) {
      return <div className="flex-1 min-w-0 px-2 py-1 text-[11px] text-text-disabled">—</div>;
    }
    const isChanged = item.status !== 'same';
    const highlight =
      isChanged && item.status === (side === 'left' ? 'removed' : 'added');
    return (
      <div
        className={`flex-1 min-w-0 px-2 py-1 text-[11px] break-words rounded ${
          highlight
            ? item.status === 'removed'
              ? 'bg-semantic-error/10 text-semantic-error line-through'
              : 'bg-semantic-success/10 text-semantic-success'
            : 'text-text-secondary'
        }`}
      >
        {text}
      </div>
    );
  };
  return (
    <div className="flex items-stretch gap-2">
      {cell('left')}
      {cell('right')}
    </div>
  );
}
