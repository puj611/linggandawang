// src/components/RequirementSyncPanel.tsx
// M11: 需求同步面板 - 展示需求拆解结果和子任务进度
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRequirementStore } from '@/stores/requirementStore';
import { useProjectStore } from '@/stores/projectStore';
import { useEngineStore } from '@/stores/engineStore';
import { requirementSyncer } from '@/engine/RequirementSyncer';
import type { Requirement, Subtask, SubtaskStatus, SubtaskType, SubtaskPriority, RequirementFilter } from '@/types/requirement';

interface Props {
  onClose: () => void;
}

const STATUS_CONFIG: Record<SubtaskStatus, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: '待处理', color: 'text-text-secondary', bg: 'bg-surface-3', icon: '○' },
  in_progress: { label: '进行中', color: 'text-[#3B82F6]', bg: 'bg-[#1a2a4a]', icon: '◉' },
  done: { label: '已完成', color: 'text-[#10B981]', bg: 'bg-[#0f2a1f]', icon: '✓' },
  blocked: { label: '阻塞', color: 'text-[#EF4444]', bg: 'bg-[#2a0f1a]', icon: '⊘' },
  skipped: { label: '跳过', color: 'text-text-tertiary', bg: 'bg-surface-2', icon: '–' },
};

const TYPE_CONFIG: Record<SubtaskType, { label: string; color: string }> = {
  feature: { label: '功能', color: 'text-[#8B5CF6]' },
  bugfix: { label: '修复', color: 'text-[#EF4444]' },
  refactor: { label: '重构', color: 'text-[#F59E0B]' },
  test: { label: '测试', color: 'text-[#10B981]' },
  docs: { label: '文档', color: 'text-[#3B82F6]' },
  design: { label: '设计', color: 'text-[#E879A0]' },
};

const PRIORITY_CONFIG: Record<SubtaskPriority, { label: string; color: string }> = {
  P0: { label: 'P0 紧急', color: 'text-[#EF4444]' },
  P1: { label: 'P1 重要', color: 'text-[#F59E0B]' },
  P2: { label: 'P2 一般', color: 'text-text-secondary' },
};

function ProgressRing({ percentage, size = 48 }: { percentage: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percentage / 100) * c;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={percentage === 100 ? '#10B981' : '#8B5CF6'}
        strokeWidth={4}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
}

export function RequirementSyncPanel({ onClose }: Props) {
  const {
    requirements,
    activeRequirementId,
    filter,
    loaded,
    load,
    addRequirement,
    removeRequirement,
    setActiveRequirement,
    updateSubtaskStatus,
    setFilter,
  } = useRequirementStore(
    useShallow((s) => ({
      requirements: s.requirements,
      activeRequirementId: s.activeRequirementId,
      filter: s.filter,
      loaded: s.loaded,
      load: s.load,
      addRequirement: s.addRequirement,
      removeRequirement: s.removeRequirement,
      setActiveRequirement: s.setActiveRequirement,
      updateSubtaskStatus: s.updateSubtaskStatus,
      setFilter: s.setFilter,
      getActiveRequirement: s.getActiveRequirement,
    })),
  );

  const fingerprint = useProjectStore((s) => s.fingerprint);
  const intentTags = useEngineStore((s) => s.intentTags);

  const [inputValue, setInputValue] = useState('');
  const [decomposing, setDecomposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'detail'>('list');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const activeRequirement = useMemo(() => {
    if (!activeRequirementId) return null;
    return requirements.find((r) => r.id === activeRequirementId) ?? null;
  }, [requirements, activeRequirementId]);

  const filteredSubtasks = useMemo(() => {
    if (!activeRequirement) return [];
    let list = activeRequirement.subtasks;
    if (filter.status && filter.status !== 'all') {
      list = list.filter((st) => st.status === filter.status);
    }
    if (filter.priority && filter.priority !== 'all') {
      list = list.filter((st) => st.priority === filter.priority);
    }
    if (filter.type && filter.type !== 'all') {
      list = list.filter((st) => st.type === filter.type);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((st) => st.title.toLowerCase().includes(q) || st.description.toLowerCase().includes(q));
    }
    return list;
  }, [activeRequirement, filter]);

  const progress = useMemo(() => {
    if (!activeRequirement) return null;
    return requirementSyncer.getProgress(activeRequirement);
  }, [activeRequirement]);

  const handleDecompose = useCallback(async () => {
    const desc = inputValue.trim();
    if (!desc) return;
    setDecomposing(true);
    setError(null);
    try {
      const result = await requirementSyncer.decompose(desc, fingerprint, intentTags);
      if (!mountedRef.current) return;
      if (result) {
        await addRequirement(result.requirement);
        if (result.warnings.length > 0) {
          console.info('[RequirementSyncPanel] 拆解警告:', result.warnings);
        }
        setInputValue('');
        setActiveTab('detail');
      } else {
        setError('需求拆解失败，请重试');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : '拆解失败');
    } finally {
      if (mountedRef.current) setDecomposing(false);
    }
  }, [inputValue, fingerprint, intentTags, addRequirement, setActiveRequirement]);

  const handleStatusChange = useCallback(
    async (subtaskId: string, status: SubtaskStatus) => {
      if (!activeRequirement) return;
      await updateSubtaskStatus(activeRequirement.id, subtaskId, status);
    },
    [activeRequirement, updateSubtaskStatus],
  );

  const nextSubtask = useMemo(() => {
    if (!activeRequirement) return null;
    return requirementSyncer.getNextSubtask(activeRequirement);
  }, [activeRequirement]);

  if (!loaded) {
    return (
      <div className="window-panel w-full h-full flex items-center justify-center">
        <span className="text-text-tertiary text-sm">加载中...</span>
      </div>
    );
  }

  return (
    <div className="window-panel w-full h-full flex flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border drag-region">
        <div className="flex items-center gap-2 no-drag">
          <span className="text-lg">📋</span>
          <span className="text-sm font-medium text-text-primary">需求同步器</span>
          {activeRequirement && (
            <span className="text-xs text-text-tertiary ml-1">
              {progress?.percentage ?? 0}%
            </span>
          )}
        </div>
        <button onClick={onClose} className="no-drag text-text-tertiary hover:text-text-primary p-1 rounded-btn transition-fsm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* 输入区 */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="描述你的需求，灵感大王会拆解为子任务..."
            className="flex-1 bg-surface-2 border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:border-border-selected transition-fsm"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleDecompose();
              }
            }}
          />
          <button
            onClick={handleDecompose}
            disabled={!inputValue.trim() || decomposing}
            className="primary-btn self-end whitespace-nowrap"
          >
            {decomposing ? '拆解中...' : '拆解'}
          </button>
        </div>
        {error && <p className="text-xs text-[#EF4444] mt-2">{error}</p>}
      </div>

      {/* 需求列表/详情切换 */}
      {requirements.length > 0 && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2 text-xs font-medium transition-fsm ${
              activeTab === 'list' ? 'text-brand border-b-2 border-brand' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            需求列表 ({requirements.length})
          </button>
          <button
            onClick={() => setActiveTab('detail')}
            disabled={!activeRequirement}
            className={`flex-1 py-2 text-xs font-medium transition-fsm ${
              activeTab === 'detail' ? 'text-brand border-b-2 border-brand' : 'text-text-tertiary hover:text-text-secondary'
            } ${!activeRequirement ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            子任务 ({activeRequirement?.subtasks.length ?? 0})
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {requirements.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <span className="text-3xl mb-3">📋</span>
            <p className="text-sm text-text-secondary mb-1">还没有需求</p>
            <p className="text-xs text-text-tertiary">在上方输入需求描述，灵感大王会帮你拆解为子任务</p>
          </div>
        ) : activeTab === 'list' ? (
          <RequirementList
            requirements={requirements}
            activeId={activeRequirementId}
            onSelect={(id) => { setActiveRequirement(id); setActiveTab('detail'); }}
            onRemove={removeRequirement}
          />
        ) : activeRequirement && progress ? (
          <SubtaskDetail
            requirement={activeRequirement}
            progress={progress}
            filteredSubtasks={filteredSubtasks}
            filter={filter}
            onFilterChange={setFilter}
            onStatusChange={handleStatusChange}
            expandedId={expandedSubtaskId}
            onToggleExpand={(id) => setExpandedSubtaskId(expandedSubtaskId === id ? null : id)}
            nextSubtask={nextSubtask}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── 需求列表 ────────────────────────────────────────

function RequirementList({
  requirements,
  activeId,
  onSelect,
  onRemove,
}: {
  requirements: Requirement[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="p-3 space-y-2">
      {requirements.map((req) => {
        const prog = requirementSyncer.getProgress(req);
        return (
          <div
            key={req.id}
            onClick={() => onSelect(req.id)}
            className={`p-3 rounded-card border cursor-pointer transition-fsm ${
              activeId === req.id
                ? 'bg-brand-soft border-brand'
                : 'bg-surface-2 border-border hover:bg-surface-hover hover:border-border-light'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{req.title}</p>
                <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{req.description}</p>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <span className="text-xs text-text-tertiary">{prog.percentage}%</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(req.id); }}
                  className="text-text-tertiary hover:text-[#EF4444] p-0.5 rounded transition-fsm"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <StatusDots progress={prog} />
              <span className="text-xs text-text-tertiary">
                {prog.done}/{prog.total} 完成 · {prog.estimated_total_hours}h 预估
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusDots({ progress }: { progress: ReturnType<typeof requirementSyncer.getProgress> }) {
  return (
    <div className="flex gap-1">
      {progress.done > 0 && (
        <span className="progress-dot bg-[#10B981]" title={`${progress.done} 已完成`} />
      )}
      {progress.in_progress > 0 && (
        <span className="progress-dot bg-[#3B82F6]" title={`${progress.in_progress} 进行中`} />
      )}
      {progress.pending > 0 && (
        <span className="progress-dot bg-text-tertiary" title={`${progress.pending} 待处理`} />
      )}
      {progress.blocked > 0 && (
        <span className="progress-dot bg-[#EF4444]" title={`${progress.blocked} 阻塞`} />
      )}
    </div>
  );
}

// ─── 子任务详情 ────────────────────────────────────────

function SubtaskDetail({
  requirement,
  progress,
  filteredSubtasks,
  filter,
  onFilterChange,
  onStatusChange,
  expandedId,
  onToggleExpand,
  nextSubtask,
}: {
  requirement: Requirement;
  progress: NonNullable<ReturnType<typeof requirementSyncer.getProgress>>;
  filteredSubtasks: Subtask[];
  filter: RequirementFilter;
  onFilterChange: (f: RequirementFilter) => void;
  onStatusChange: (id: string, status: SubtaskStatus) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  nextSubtask: Subtask | null;
}) {
  return (
    <div className="flex flex-col">
      {/* 进度概览 */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-4">
        <div className="relative">
          <ProgressRing percentage={progress.percentage} size={48} />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-text-primary">
            {progress.percentage}%
          </span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">{requirement.title}</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {progress.done}/{progress.total} 完成 · {progress.estimated_total_hours}h 预估
            {progress.actual_total_hours > 0 && ` · ${progress.actual_total_hours}h 已用`}
          </p>
        </div>
      </div>

      {/* 下一个建议 */}
      {nextSubtask && (
        <div className="mx-4 mt-3 p-3 bg-brand-soft-light border border-brand/20 rounded-card">
          <p className="text-xs text-brand font-medium mb-1">💡 下一步建议</p>
          <p className="text-sm text-text-primary">{nextSubtask.title}</p>
          <p className="text-xs text-text-tertiary mt-1">{PRIORITY_CONFIG[nextSubtask.priority].label} · {TYPE_CONFIG[nextSubtask.type].label} · ~{nextSubtask.estimated_hours}h</p>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto border-b border-border">
        <FilterChip
          label="全部"
          active={!filter.status || filter.status === 'all'}
          onClick={() => onFilterChange({ ...filter, status: 'all' })}
        />
        {(Object.keys(STATUS_CONFIG) as SubtaskStatus[]).map((s) => (
          <FilterChip
            key={s}
            label={STATUS_CONFIG[s].label}
            active={filter.status === s}
            onClick={() => onFilterChange({ ...filter, status: s })}
          />
        ))}
      </div>

      {/* 子任务列表 */}
      <div className="p-3 space-y-2">
        {filteredSubtasks.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-4">无匹配子任务</p>
        ) : (
          filteredSubtasks.map((st) => (
            <SubtaskCard
              key={st.id}
              subtask={st}
              isExpanded={expandedId === st.id}
              isNext={nextSubtask?.id === st.id}
              onToggle={() => onToggleExpand(st.id)}
              onStatusChange={(status) => onStatusChange(st.id, status)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-chip whitespace-nowrap transition-fsm ${
        active
          ? 'bg-brand-soft text-brand border border-brand/30'
          : 'bg-surface-2 text-text-tertiary border border-border hover:bg-surface-hover hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}

// ─── 子任务卡片 ────────────────────────────────────────

function SubtaskCard({
  subtask,
  isExpanded,
  isNext,
  onToggle,
  onStatusChange,
}: {
  subtask: Subtask;
  isExpanded: boolean;
  isNext: boolean;
  onToggle: () => void;
  onStatusChange: (status: SubtaskStatus) => void;
}) {
  const statusConf = STATUS_CONFIG[subtask.status];
  const typeConf = TYPE_CONFIG[subtask.type];
  const priorityConf = PRIORITY_CONFIG[subtask.priority];

  return (
    <div
      className={`rounded-card border transition-fsm ${
        isNext
          ? 'bg-brand-soft-light border-brand/20'
          : 'bg-surface-2 border-border hover:bg-surface-hover hover:border-border-light'
      }`}
    >
      <div
        onClick={onToggle}
        className="px-3 py-2.5 cursor-pointer"
      >
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 ${statusConf.color}`}>{statusConf.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary leading-snug">{subtask.title}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-xs ${typeConf.color}`}>{typeConf.label}</span>
              <span className={`text-xs ${priorityConf.color}`}>{priorityConf.label}</span>
              <span className="text-xs text-text-tertiary">~{subtask.estimated_hours}h</span>
              {subtask.dependencies.length > 0 && (
                <span className="text-xs text-text-tertiary">🔗 {subtask.dependencies.length}</span>
              )}
            </div>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`text-text-tertiary mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* 展开详情 */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border mt-0 pt-2 space-y-2">
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{subtask.description}</p>

          {subtask.affected_files.length > 0 && (
            <div>
              <p className="text-xs text-text-tertiary mb-1">涉及文件：</p>
              <div className="flex flex-wrap gap-1">
                {subtask.affected_files.map((f) => (
                  <code key={f} className="text-xs bg-surface-3 px-1.5 py-0.5 rounded-sm text-text-secondary font-mono">{f}</code>
                ))}
              </div>
            </div>
          )}

          {subtask.prompt_suggestion && (
            <div>
              <p className="text-xs text-text-tertiary mb-1">提示词建议：</p>
              <p className="text-xs text-text-secondary bg-surface-3 p-2 rounded-sm leading-relaxed">{subtask.prompt_suggestion}</p>
            </div>
          )}

          {/* 状态切换按钮 */}
          <div className="flex gap-1.5 pt-1">
            {(Object.keys(STATUS_CONFIG) as SubtaskStatus[]).map((s) => (
              <button
                key={s}
                onClick={(e) => { e.stopPropagation(); onStatusChange(s); }}
                className={`px-2 py-1 text-xs rounded-chip transition-fsm ${
                  subtask.status === s
                    ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color} border border-current/20`
                    : 'bg-surface-3 text-text-tertiary border border-border hover:bg-surface-hover'
                }`}
              >
                {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
